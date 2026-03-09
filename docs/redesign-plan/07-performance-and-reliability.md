# 07 — Performance and Reliability

> Redesign planning document. Describes current-state deficiencies, target budgets, and the
> architectural controls required for the rebuild. This document does not modify source files.

---

## 1. Current State Audit

### 1.1 Structured Logging

**Finding: No structured logging exists. All logging is plain `console.*` calls.**

Evidence: Every log site in the codebase uses ad-hoc `console.error`, `console.warn`, or
`console.debug` calls with freeform strings and unstructured objects, e.g.:

```
console.error("[create] openai generation failed", error)
console.error("[planner] failed to sign media previews", signedError)
console.warn("[connections] failed to obtain long-lived Facebook token", error)
```

There are no correlation IDs, no request IDs, no account IDs, no job IDs, no durations, and no
severity codes attached to any log entry. Vercel captures stdout/stderr but offers no searchable
structure unless an external log drain is configured — and none is configured.

**Severity: Critical.** When a publish fails at 2am, there is no reliable way to diagnose which
job failed, which provider rejected the request, what the error payload was, or how long the
call took.

---

### 1.2 Cron Route and Alerting

**Finding: The publish cron route has no alerting on failure.**

`/api/cron/publish/route.ts` (line 81–82) returns an HTTP error to Vercel when the Edge Function
call fails, but takes no further action — no email, no in-app notification, no webhook. Vercel
Cron will record a failed invocation in its dashboard but does not send alerts by default.

Additionally, the cron route contains no idempotency lock. The route is scheduled to fire every
minute (`"* * * * *"`) via `vercel.json`. If Vercel fires the cron twice in rapid succession
(a documented Vercel platform behaviour for at-least-once delivery) both invocations will call the
Supabase Edge Function simultaneously. Whether that results in a double-publish depends entirely
on the Edge Function's own locking — which is not visible in this codebase.

The `purge-trash` cron (`15 3 * * *`) is a simple DELETE and is naturally idempotent (rows
already deleted cannot be deleted again), so double-fire risk there is low.

**Severity: Critical** for publish; Low for purge-trash.

---

### 1.3 Publishing Queue

**Finding: `enqueuePublishJob` does not prevent duplicate jobs.**

`src/lib/publishing/queue.ts` performs a plain `insert` into `publish_jobs` with no `ON CONFLICT`
guard or pre-insert deduplication check. If `enqueuePublishJob` is called twice for the same
`content_item_id` (e.g. user double-submits, or a server action retries), two separate
`publish_jobs` rows are inserted and both will eventually be processed.

The `publish_jobs` table schema (from `technical-design.md`) has no unique constraint on
`content_item_id`. The status column (`queued`, `in_progress`, `succeeded`, `failed`) exists but
is not checked before insert.

**Severity: High.** Duplicate jobs risk double-publishing to Facebook/Instagram/GBP, which
is visible to followers and embarrassing.

---

### 1.4 Idempotency

**Finding: No idempotency guarantees anywhere in the publish pipeline.**

- No database-level unique constraint prevents duplicate `publish_jobs` rows.
- No advisory lock or `SELECT ... FOR UPDATE SKIP LOCKED` pattern guards job pickup.
- No idempotency key is sent to provider APIs (Facebook supports `idempotency` request headers;
  GBP does not but the operation can be detected by checking for existing posts).
- The cron route itself has no in-flight deduplication (e.g. a Redis/KV lock).

**Severity: High.**

---

### 1.5 TanStack Query Configuration

**Finding: QueryClient is instantiated with all defaults; no global cache or retry policy.**

`src/components/providers/app-providers.tsx` (line 19):
```ts
const [queryClient] = useState(() => new QueryClient());
```

No `defaultOptions` are passed. This means:
- `staleTime`: 0 (every focus/refocus triggers a background refetch)
- `gcTime`: 5 minutes (TanStack default)
- `retry`: 3 (TanStack default — all failed queries retry 3 times with exponential backoff)
- `refetchOnWindowFocus`: true (default)

The only non-default configuration found is in `src/features/create/create-modal.tsx`:
```ts
staleTime: 1000 * 60 * 5, // 5 minutes
```

All other `useQuery` calls (planner data, library data, connection diagnostics) inherit the
zero-stale-time default. On a single-owner app this causes unnecessary Supabase RLS reads on
every tab focus — wasteful but not harmful at current scale.

The more serious risk is the default `retry: 3` policy on mutation-adjacent queries. If a query
fetches data that has a side-effect (none currently, but worth noting), silent retries could be
problematic.

**Severity: Medium.** No correctness risk at current scale, but wastes Supabase quota and adds
latency noise. Warrants a global policy for the rebuild.

---

### 1.6 Suspense Boundaries and Loading States

**Finding: Partial coverage. Planner has a Suspense boundary; other routes do not use loading.tsx.**

`/app/(app)/planner/page.tsx` correctly wraps `<PlannerCalendar>` in `<Suspense fallback={<PlannerSkeleton />}>`.
`src/features/planner/planner-skeleton.tsx` exists as the skeleton UI.

However, there are no `loading.tsx` files anywhere in the App Router directory tree
(`src/app/**/loading.tsx` — zero results). This means navigation to Library, Connections,
Settings, and Create routes has no automatic loading state; the page simply hangs waiting
for server components to resolve.

**Severity: Medium.** Perceived performance impact on navigation; UX risk during slow Supabase
queries.

---

### 1.7 Image Optimisation

**Finding: `next/image` is used in only 2 of approximately 15 `<img>` tag sites.**

All media previews in the Planner calendar, Library grid, Create modal, and story selector use
bare `<img>` tags serving Supabase signed URLs. These URLs are raw storage URLs with no
dimension hints, no CDN caching (signed URLs expire and cannot be cached at edge), and no
format negotiation (no WebP/AVIF conversion).

`next/image` is only used in:
- `src/features/link-in-bio/public/link-in-bio-public-page.tsx`
- `src/features/settings/link-in-bio/link-in-bio-profile-form.tsx`

Supabase Storage does support image transformation via query parameters
(`?width=400&quality=80&format=webp`) but none of the storage URL generation code applies
these transforms.

**Severity: Medium.** Library and Planner grids loading full-resolution Supabase images will
cause significant LCP regression and mobile data waste as media libraries grow.

---

### 1.8 Bundle Size

**Finding: `framer-motion` is a heavy client-side dependency used in 5 files, including a
settings page and sidebar layout component.**

`framer-motion` at v12 is approximately 100–120 KB gzipped when the full library is bundled.
It is used in `src/components/layout/Sidebar.tsx`, `src/app/(app)/settings/page.tsx`, and
`src/features/create/create-wizard.tsx`. The sidebar is part of the root app layout, meaning
framer-motion is included in the root bundle for all authenticated routes.

`lucide-react` at v0.562 contains ~1,400 icons. Without tree-shaking verification, it could add
30–60 KB. The Next.js 16 bundler handles named imports well, but this should be verified in
build output.

`@tanstack/react-query-devtools` (v5) is loaded conditionally on `NODE_ENV !== 'production'`
(line 20 of `app-providers.tsx`). This is correct — it will not appear in production bundles
because Next.js removes dead branches at build time when `NODE_ENV` is set.

**Severity: Low–Medium.** Framer-motion in the root layout is the main concern.

---

### 1.9 External API Timeouts

**Finding: No timeouts are set on OpenAI or provider API calls from server routes.**

`src/lib/ai/client.ts` creates the OpenAI client with no timeout configuration:
```ts
client = new OpenAI({ apiKey: env.server.OPENAI_API_KEY });
```

The OpenAI Node SDK default timeout is 10 minutes. A stalled OpenAI call from a Server Action
will hold the Vercel function open until Vercel's own platform timeout (10s on Hobby, 25s on Pro,
60s on Enterprise for route handlers). If the platform limit is hit first, the user receives a
504 with no useful message.

The `management-app` internal client (`src/lib/management-app/client.ts`) does implement
`AbortController`-based timeouts, but this is an internal utility, not the social provider
adapters.

No `signal` with `AbortController` is passed to Facebook Graph API, Instagram Graph API, or GBP
API fetch calls. None of the social provider `fetch` calls in the codebase set a `signal`.

**Severity: High.** A hung OpenAI or provider call will silently time out and return a 504 to
the user or a failed cron run with no actionable error.

---

### 1.10 Vercel Function Duration Risk

**Finding: The publish cron route has a potential duration problem.**

`/api/cron/publish/route.ts` makes a `fetch` call to the Supabase Edge Function with no timeout.
If the Edge Function takes more than 10 seconds (Hobby plan) or 25 seconds (Pro plan), Vercel
will kill the function and the cron will log a failure — but the Edge Function may continue
running on Supabase's side, creating a split-brain scenario.

No route in the application exports `export const maxDuration` or `export const runtime = 'edge'`
to explicitly declare duration requirements. This is a gap in production readiness.

**Severity: High** on Hobby plan (10s limit hits real-world publish scenarios); **Medium** on Pro.

---

### 1.11 OpenAI Fallback

**Finding: No fallback when OpenAI is unavailable.**

If `getOpenAIClient()` throws (wrong key, quota exceeded, network error), the error propagates
directly to the Server Action caller and surfaces as a toast. There is no draft-with-placeholder
path, no queued-retry mechanism, and no user guidance on what to do.

**Severity: Medium.** Single-owner means this is a rare event, but when it happens during a
campaign creation session the whole flow is blocked.

---

## 2. Performance Budgets

### 2.1 Page Load — Core Web Vitals Targets

All targets are measured on a simulated mid-range Android device on a 4G connection (Lighthouse
Mobile preset) against the production Vercel deployment.

| Route | LCP Target | INP Target | CLS Target | Notes |
|---|---|---|---|---|
| `/` (public home) | ≤ 1.8s | ≤ 100ms | ≤ 0.05 | Fully static, ISR cached |
| `/link-in-bio/[slug]` | ≤ 2.0s | ≤ 100ms | ≤ 0.05 | Mostly static; one Supabase read |
| `/planner` | ≤ 2.5s | ≤ 200ms | ≤ 0.1 | Dynamic; uses Suspense skeleton |
| `/create` (modal) | ≤ 1.0s INP for open | ≤ 200ms | ≤ 0.1 | Modal open interaction |
| `/library` | ≤ 2.5s | ≤ 200ms | ≤ 0.1 | Media grid; progressive load |
| `/connections` | ≤ 2.0s | ≤ 200ms | ≤ 0.05 | Mostly static after auth |
| `/settings` | ≤ 2.0s | ≤ 200ms | ≤ 0.05 | Form-heavy, no media |

**LCP element targets:**
- Planner: skeleton paint ≤ 400ms; calendar fully rendered ≤ 2500ms
- Library: first image row visible ≤ 2000ms; remaining rows lazy-loaded
- Public link-in-bio: hero image ≤ 2000ms (must use next/image with priority prop)

### 2.2 Interaction Latency Targets

| Interaction | Target | Measurement Method |
|---|---|---|
| AI content generation (single platform) | ≤ 8s p95 | Server Action duration, logged per call |
| AI content generation (all 3 platforms) | ≤ 20s p95 | Server Action duration |
| Schedule post (form submit → DB write) | ≤ 1.5s p95 | Server Action duration |
| Media upload (10 MB image) | ≤ 6s p95 | Client-side upload to Supabase Storage |
| Publish now (instant post) | ≤ 3s p95 | Server Action → provider API round trip |
| Planner calendar month navigation | ≤ 400ms | Client-side re-render, no network |
| Content edit auto-save | ≤ 800ms | Debounced Server Action, 600ms debounce |

### 2.3 API Response Time Targets

| Endpoint Category | p50 Target | p95 Target | p99 Target |
|---|---|---|---|
| Auth (login, session check) | ≤ 300ms | ≤ 800ms | ≤ 1500ms |
| Planner data (calendar month load) | ≤ 400ms | ≤ 1200ms | ≤ 2500ms |
| Library list (paginated, 50 items) | ≤ 300ms | ≤ 800ms | ≤ 1500ms |
| Create Server Actions (non-AI) | ≤ 500ms | ≤ 1500ms | ≤ 3000ms |
| Create Server Actions (AI generation) | ≤ 4s | ≤ 10s | ≤ 20s |
| Cron `/api/cron/publish` (full round trip) | ≤ 5s | ≤ 15s | ≤ 25s |
| Connection OAuth exchange | ≤ 2s | ≤ 5s | ≤ 8s |
| Notification list | ≤ 200ms | ≤ 600ms | ≤ 1200ms |

### 2.4 Background Job SLAs

| Job | SLA | Definition of Breach |
|---|---|---|
| Publish job execution | ≤ 3 minutes after `scheduled_for` | Job not in `succeeded` state within 3 minutes of its `scheduled_for` timestamp |
| Publish job first attempt | ≤ 90 seconds after `scheduled_for` | Worker has not picked the job (status not yet `in_progress`) within 90 seconds |
| Publish failure notification | ≤ 5 minutes after all retries exhausted | Notification not inserted to `notifications` table within 5 minutes of final failure |
| Trash purge | Completes within 30 seconds | Cron handler returns non-200 or takes > 30s |
| Token health check (nightly) | Completes by 04:00 UTC | Expiring tokens flagged by 04:00 |
| Campaign materialisation | Completes within 60 seconds | New content items not created for upcoming 7 days within 60s of cron fire |

Rationale for 3-minute publish SLA: Vercel Cron fires at most every 60 seconds. Assuming at-most
one missed fire (platform jitter), the first attempt fires within 120 seconds. Add up to 60
seconds for the Edge Function to process. Anything beyond 3 minutes indicates a systemic problem
worth alerting on.

---

## 3. Caching Strategy

### 3.1 Static vs Dynamic Route Classification

| Route | Rendering Strategy | Cache Control |
|---|---|---|
| `/` public home | `export const revalidate = 3600` (ISR) | CDN-cached, stale-while-revalidate 1h |
| `/link-in-bio/[slug]` | `export const revalidate = 300` (ISR) | CDN-cached, revalidate on update via on-demand ISR |
| `/planner` | `force-dynamic` (per-request) | No CDN; Supabase RLS data is user-specific |
| `/library` | `force-dynamic` | No CDN |
| `/create` | `force-dynamic` | No CDN |
| `/connections` | `force-dynamic` | No CDN |
| `/settings` | `force-dynamic` | No CDN |
| `/api/cron/*` | Already `force-dynamic` | No CDN; must not be cached |

On-demand ISR revalidation (`revalidatePath`) should be called from Server Actions whenever the
link-in-bio profile is updated.

### 3.2 TanStack Query — Recommended Global Defaults

Add `defaultOptions` to the `QueryClient` constructor in `app-providers.tsx`:

```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,           // 30 seconds — prevents refetch on every focus
      gcTime: 5 * 60_000,          // 5 minutes — matches current default
      retry: 1,                    // Reduce from 3; most failures are non-transient auth/validation
      retryDelay: 1000,
      refetchOnWindowFocus: false, // Single owner: tab focus refetches are noisy
    },
    mutations: {
      retry: 0,                    // Never auto-retry mutations; user must confirm
    },
  },
})
```

Per-query overrides for specific data types:

| Query Key Pattern | staleTime | gcTime | Rationale |
|---|---|---|---|
| `["notifications"]` | 60s | 5min | Notification polling; balance freshness vs quota |
| `["planner", month]` | 30s | 10min | Calendar rarely changes mid-session |
| `["library"]` | 60s | 10min | Media library is stable during a session |
| `["create-modal-data"]` | 300s | 10min | Brand data; already set to 5min in code |
| `["connections"]` | 120s | 5min | Connection status; poll less aggressively |
| `["diagnostics"]` | 30s | 2min | Useful to be fresher for debugging |

### 3.3 Supabase Query Optimisation

**N+1 prevention targets:**

The Planner data loader (`src/lib/planner/data.ts`) fetches content items and then separately
signs media URLs in a second pass. This is an N+1 pattern: one query for items, then one
`createSignedUrls` call per batch. Review all data-loading functions to ensure:

1. All related data is fetched in a single Supabase query using embedded selects where possible,
   e.g. `.select("*, content_variants(*), media_assets(*)")` rather than sequential single-row
   lookups.
2. `createSignedUrls` is called once per list, not once per item.
3. The `preflight.ts` checker makes four sequential Supabase queries (`loadConnection`,
   `loadVariantData`, `loadContentContext`, `loadMediaAssets`). These should be batched into
   parallel `Promise.all` calls since they are independent.

**Index requirements** (to be verified against actual schema migrations):
- `publish_jobs(status, next_attempt_at)` — composite index for queue polling WHERE clause
- `content_items(account_id, scheduled_for)` — for Planner calendar month queries
- `content_items(campaign_id, scheduled_for)` — for materialisation conflict detection
- `notifications(account_id, created_at DESC)` — for notification feed queries
- `social_connections(account_id, provider)` — unique index (enforce one connection per provider)

### 3.4 Image Optimisation

**Immediate changes for the rebuild:**

1. Replace all bare `<img>` tags serving Supabase Storage URLs with `next/image`. Configure the
   image domain in `next.config.ts`:

   ```ts
   images: {
     remotePatterns: [
       {
         protocol: 'https',
         hostname: '*.supabase.co',
         pathname: '/storage/v1/object/**',
       },
     ],
   }
   ```

2. Apply Supabase image transformation parameters to all preview URL generation:
   - Library grid thumbnails: `?width=400&quality=75&format=webp`
   - Planner calendar thumbnails: `?width=200&quality=70&format=webp`
   - Story preview (full-bleed): `?width=800&quality=85&format=webp`
   - Link-in-bio hero: `?width=1200&quality=85&format=webp`

3. Set `loading="lazy"` on all non-above-the-fold images and `loading="eager"` + `priority` on
   the first visible image in each grid (first item in Library grid; hero on link-in-bio page).

4. Provide `width` and `height` props to every `next/image` instance to prevent CLS. Use fixed
   aspect ratios (e.g. `aspect-video`, `aspect-square`) in container CSS to hold space before
   images load.

5. Signed Supabase URLs expire (typically 600 seconds as seen in the codebase). The
   transformation URL approach extends this to a CDN-cacheable public URL if the bucket is
   made public for media previews. If the bucket must remain private, accept that CDN edge
   caching will not work for media and focus on client-side caching via TanStack Query.

---

## 4. Publishing Pipeline Reliability

### 4.1 Idempotency — Exactly-Once Execution

**Database-level guard (required):**

Add a unique constraint to `publish_jobs`:
```sql
ALTER TABLE publish_jobs
  ADD CONSTRAINT publish_jobs_content_item_unique
  UNIQUE (content_item_id)
  WHERE status IN ('queued', 'in_progress');
```

This partial unique index means only one active job per `content_item_id` can exist at a time.
A second `enqueuePublishJob` call for the same item will raise a unique violation, which should
be caught and treated as a no-op (the job is already queued).

In the application layer, `enqueuePublishJob` should use an upsert:
```sql
INSERT INTO publish_jobs (...) VALUES (...)
ON CONFLICT (content_item_id) WHERE status IN ('queued', 'in_progress') DO NOTHING;
```

**Worker-level guard (required):**

The Supabase Edge Function worker must use `SELECT ... FOR UPDATE SKIP LOCKED` when picking the
next job:
```sql
UPDATE publish_jobs
SET status = 'in_progress', updated_at = now()
WHERE id = (
  SELECT id FROM publish_jobs
  WHERE status = 'queued'
    AND next_attempt_at <= now()
  ORDER BY next_attempt_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

This prevents two concurrent worker invocations from picking the same job even if Vercel Cron
fires twice simultaneously.

**Provider-level guard (advisory):**

When calling the Facebook/Instagram Graph API, include the Facebook `idempotency` header set to
the `publish_jobs.id` UUID. The Graph API will return the same response for duplicate requests
within a 10-minute window without re-publishing. GBP does not support this header but the risk
of double-GBP-post from two cron fires within one minute is low given the `FOR UPDATE SKIP LOCKED`
guard above.

### 4.2 Double-Fire Prevention for Vercel Cron

Vercel Cron uses at-least-once delivery semantics. The `FOR UPDATE SKIP LOCKED` pattern at the
database level is the primary defence. As a belt-and-suspenders measure, the cron route itself
can acquire a short-lived distributed lock using Supabase's `pg_advisory_xact_lock`:

```sql
SELECT pg_try_advisory_xact_lock(hashtext('publish-cron-lock'));
```

If this returns false, a concurrent invocation is already running and the current call should
return 200 immediately with `{ "skipped": true, "reason": "concurrent_lock" }`. The advisory
lock is automatically released when the transaction ends, making it safe for the Supabase Edge
Function to hold it for the duration of its execution.

### 4.3 Retry and Backoff Specification

The Supabase Edge Function worker (not the Next.js cron route) is responsible for retry logic.
The following specification should be implemented in the Edge Function:

| Parameter | Value |
|---|---|
| Maximum attempts | 4 (1 initial + 3 retries) |
| Initial delay | 5 minutes |
| Backoff multiplier | 3× |
| Maximum delay | 60 minutes |
| Jitter | ±20% of calculated delay |

Calculated delay schedule (before jitter):
- Attempt 1 → failure → retry after 5 minutes → Attempt 2 at T+5m
- Attempt 2 → failure → retry after 15 minutes → Attempt 3 at T+20m
- Attempt 3 → failure → retry after 45 minutes → Attempt 4 at T+65m
- Attempt 4 → failure → dead-letter

Rationale: 5-minute initial delay avoids hammering a transiently unavailable provider. The 65-
minute maximum span means a 2am failure resolves or is dead-lettered by approximately 3:05am —
well before business hours. Jitter prevents multiple failed jobs from retrying in lockstep.

**Error classification — do not retry:**
- Token expired or revoked (HTTP 190 from Facebook; `invalid_grant` from Google)
- Content policy violation (HTTP 400 with policy error codes)
- Permanent media rejection (Facebook media container in error state)
- Connection `status = 'needs_action'` (reconnect required — no point retrying)

**Retry-eligible errors:**
- HTTP 500/503 from provider
- Network timeouts
- Rate limit responses (HTTP 429 — add extra delay equal to the `Retry-After` header if present)
- Supabase transient errors (connection reset, statement timeout)

### 4.4 Dead-Letter Handling

After all 4 attempts are exhausted:

1. Set `publish_jobs.status = 'failed'` with `last_error` populated with the final error message
   and a timestamp.
2. Set `content_items.status = 'failed'`.
3. Insert a `notifications` row for the owner:
   ```json
   {
     "category": "publish_failed",
     "message": "Post scheduled for 02:00 could not be published to Instagram after 4 attempts. Tap to view and retry.",
     "metadata": {
       "publish_job_id": "...",
       "content_item_id": "...",
       "platform": "instagram",
       "last_error": "...",
       "attempts": 4
     }
   }
   ```
4. Send an email via Resend to the owner's registered email address. Email must include:
   - Scheduled time of the post
   - Platform(s) affected
   - Error summary
   - Direct link to the content item in the Planner
   - One-click "Retry now" link (authenticated deep link to trigger manual republish)
5. Generate a "fallback package": a pre-formatted text file containing the post copy and a
   signed download URL for the media asset, valid for 24 hours. Include the download link in
   the notification. This allows the owner to manually post even if the automation is broken.

**Do not auto-delete dead-letter jobs.** Retain them indefinitely (they will appear as `failed`
in the Planner). The owner should be able to trigger a manual retry from the Planner UI, which
creates a new `publish_job` row.

### 4.5 Timeout Configuration per External Provider

All external API calls from the publishing worker must use `AbortController` with explicit
timeouts. Recommended values:

| Provider / Operation | Timeout |
|---|---|
| OpenAI (content generation) | 25 seconds |
| OpenAI (proof point lookup) | 10 seconds |
| Facebook Graph API — media upload | 30 seconds |
| Facebook Graph API — post publish | 15 seconds |
| Facebook Graph API — token exchange | 10 seconds |
| Instagram Graph API — media container create | 30 seconds |
| Instagram Graph API — media publish | 15 seconds |
| Instagram Graph API — status poll | 10 seconds |
| Google Business Profile — post create | 15 seconds |
| Google Business Profile — token refresh | 10 seconds |
| Supabase Storage — signed URL generation | 5 seconds |
| Supabase DB — any single query | 8 seconds |

These timeouts must be applied via `AbortSignal.timeout(ms)` (Node 18+, available in all
current Vercel/Deno runtimes), not manual `setTimeout` + `clearTimeout` patterns.

Declare `export const maxDuration = 25` on the `/api/cron/publish` route to explicitly opt into
the 25-second Vercel function limit and prevent silent 10-second kills on Hobby plans. Upgrade to
Pro if needed — the cron publish route legitimately needs more than 10 seconds when the Edge
Function is cold-starting.

### 4.6 Circuit Breaker Pattern

Implement a provider-level circuit breaker using a `circuit_breaker_state` table in Supabase:

```sql
CREATE TABLE circuit_breaker_state (
  provider text PRIMARY KEY,
  state text CHECK (state IN ('closed', 'open', 'half_open')) DEFAULT 'closed',
  failure_count integer DEFAULT 0,
  last_failure_at timestamptz,
  open_until timestamptz
);
```

**State machine:**
- **Closed** (normal): allow all publish attempts.
- **Open** (tripped): do not attempt to publish to this provider. Skip the job and reschedule
  to `next_attempt_at = open_until`. Insert a notification: "Instagram is temporarily
  unavailable. Your posts are paused and will resume automatically."
- **Half-open** (testing): allow one attempt. If it succeeds, return to Closed. If it fails,
  return to Open with doubled timeout.

**Trip conditions:**
- 3 consecutive failures for the same provider within a 10-minute window → Open for 30 minutes
- 5 failures within 60 minutes → Open for 2 hours
- Provider returns HTTP 429 with `Retry-After > 3600` → Open until `Retry-After` expires

**Reset conditions:**
- Successful publish → reset `failure_count` to 0, return to Closed
- Manual override: owner can force-reset a circuit via a settings action

---

## 5. Observability Design

### 5.1 Structured Logging Specification

Every log entry emitted by any server-side code (Server Actions, API routes, Edge Functions,
background jobs) must be a single-line JSON object. Never use template strings or multi-argument
`console.log` calls.

**Required fields on every entry:**

| Field | Type | Description |
|---|---|---|
| `timestamp` | ISO 8601 string | UTC time of the event |
| `level` | `"debug"` \| `"info"` \| `"warn"` \| `"error"` | Severity |
| `service` | string | Module name, e.g. `"publish-worker"`, `"create-action"`, `"cron-publish"` |
| `message` | string | Human-readable description of the event |
| `correlationId` | string (UUID) | Request-scoped ID; propagated from cron invocation through Edge Function |
| `accountId` | string \| null | Supabase account UUID (null for system events) |
| `durationMs` | number \| null | Duration of the operation in milliseconds (null if not a timed operation) |
| `status` | `"ok"` \| `"error"` \| `"skip"` | Outcome of the operation |

**Conditional fields (include when applicable):**

| Field | When to Include |
|---|---|
| `jobId` | Any publish job operation |
| `contentItemId` | Any content item operation |
| `provider` | Any social provider API call |
| `placement` | Feed or story publish |
| `attempt` | Retry context |
| `httpStatus` | Provider API response code |
| `errorCode` | Structured error code from provider or internal |
| `errorMessage` | Error message (sanitised — never include tokens or PII) |
| `tokenExpiresAt` | Token health events |
| `model` | OpenAI API calls |
| `promptTokens` | OpenAI API calls |
| `completionTokens` | OpenAI API calls |

**Example structured log entry (publish attempt):**
```json
{
  "timestamp": "2026-03-05T02:01:34.221Z",
  "level": "info",
  "service": "publish-worker",
  "message": "Publish attempt started",
  "correlationId": "a3f7c2d1-...",
  "accountId": "9b2e4f...",
  "jobId": "1c3a5e...",
  "contentItemId": "7d9f2b...",
  "provider": "instagram",
  "placement": "feed",
  "attempt": 1,
  "durationMs": null,
  "status": "ok"
}
```

**Example structured log entry (failure):**
```json
{
  "timestamp": "2026-03-05T02:01:49.887Z",
  "level": "error",
  "service": "publish-worker",
  "message": "Publish attempt failed — provider error",
  "correlationId": "a3f7c2d1-...",
  "accountId": "9b2e4f...",
  "jobId": "1c3a5e...",
  "contentItemId": "7d9f2b...",
  "provider": "instagram",
  "placement": "feed",
  "attempt": 1,
  "durationMs": 4219,
  "status": "error",
  "httpStatus": 400,
  "errorCode": "MEDIA_CONTAINER_ERROR",
  "errorMessage": "Media container is in error state"
}
```

Implement a `createLogger(service: string, correlationId: string)` utility that returns a logger
object with `debug`, `info`, `warn`, and `error` methods that always emit the required base
fields. The `correlationId` must be generated at the cron route boundary and passed as a header
(`X-Correlation-Id`) to the Edge Function invocation.

### 5.2 Log Levels

| Level | When to Use |
|---|---|
| `debug` | Prompt text, API request/response bodies (disabled in production by env flag) |
| `info` | Job started, job completed, retry scheduled, notification sent, token health check result |
| `warn` | Non-fatal issues: missing optional fields, degraded path taken, circuit half-open |
| `error` | Job failed permanently, unhandled exception, circuit opened, alert-worthy events |

`debug` logging must be gated by a `LOG_LEVEL=debug` environment variable. In production, set
`LOG_LEVEL=info`.

### 5.3 Metrics to Capture

The following business metrics must be captured as structured log entries with `"type": "metric"`
and ingested by the log drain for dashboarding:

| Metric | Capture Point | Fields |
|---|---|---|
| `publish.attempt` | Each job attempt | provider, placement, attempt number, outcome |
| `publish.success` | Job reaches `succeeded` | provider, placement, time_to_publish_ms (from scheduled_for) |
| `publish.failure_permanent` | Job reaches dead-letter | provider, placement, attempts, final_error_code |
| `publish.retry_scheduled` | Retry enqueued | provider, placement, attempt, next_attempt_delay_ms |
| `ai.generation` | OpenAI call completes | model, platforms, prompt_tokens, completion_tokens, duration_ms, outcome |
| `token.health` | Nightly health check | provider, status (active/expiring/expired), days_until_expiry |
| `circuit_breaker.opened` | Circuit trips | provider, failure_count, open_duration_ms |
| `circuit_breaker.closed` | Circuit resets | provider |
| `cron.invocation` | Cron route fires | route, duration_ms, jobs_processed, jobs_skipped, outcome |

These metrics can be aggregated in a log-based dashboard (Axiom, Logflare) — no separate metrics
system is required at current scale.

### 5.4 Recommended Observability Tooling

**Recommendation: Axiom**

Rationale:
- Axiom has a native Vercel integration (one-click log drain setup) that captures all stdout/stderr
  from Vercel Functions without code changes.
- Provides SQL-like query language (APL) for log analysis, suitable for filtering structured JSON.
- Free tier includes 500 GB/month ingest — more than sufficient for a single-owner app.
- Supports real-time dashboards and alert rules with webhook/email delivery.
- Lighter operational overhead than Datadog (which is significantly over-engineered for this scale
  and expensive).
- Logflare is viable but has a smaller ecosystem and less mature alerting.
- Vercel's built-in log viewer is useful for recent logs but has no persistent storage or
  structured query capability.

**Setup steps:**
1. Install Axiom Vercel integration from the Vercel marketplace.
2. Configure log drain to send all function logs to Axiom dataset `cheersai-prod`.
3. Create APL dashboard with panels for: publish success rate (last 24h), retry rate, average
   time-to-publish, circuit breaker state per provider.
4. Add Axiom dataset to Edge Functions via the `axiom-js` SDK for log emission from Supabase
   Edge Functions (Vercel log drain does not capture Supabase Edge Function logs).

### 5.5 Alert Thresholds

All alerts notify the owner via email (Resend) and optionally Slack webhook. Alerts use a
5-minute evaluation window unless noted.

| Alert | Condition | Severity | Delivery |
|---|---|---|---|
| Publish job dead-lettered | Any job reaches `failed` status | Critical | Immediate email + in-app notification |
| Publish success rate drops | < 90% success rate over the last 10 publish attempts | High | Email within 5 minutes |
| Cron invocation failed | `/api/cron/publish` returns non-200 | High | Email + Vercel notification |
| Circuit breaker opened | Any provider circuit opens | High | Email within 1 minute |
| Token expiring soon | Any `social_connections.expires_at` within 5 days | Medium | Daily digest email at 09:00 |
| Token expired | Any `social_connections.expires_at` in the past | Critical | Immediate email |
| OpenAI latency spike | AI generation p95 > 20s in a 30-minute window | Medium | Email |
| OpenAI unavailable | 3 consecutive OpenAI API errors | High | Email |
| Cron missed | No cron invocation recorded for > 3 minutes | High | Axiom alert (requires uptime monitor) |
| Supabase DB slow | Any Supabase query taking > 5s | Medium | Log-based alert, daily digest |

Configure a Vercel uptime monitor on `/api/cron/publish?secret=...` with a 2-minute check
interval to catch cases where the cron schedule itself is broken (Vercel platform issue).

---

## 6. Graceful Degradation

### 6.1 OpenAI Unavailable

**Fallback behaviour:**

When `getOpenAIClient()` throws or the API call times out:

1. Do not throw a generic error. Return a structured result indicating the AI service is
   unavailable.
2. In the Create flow: display a banner — "AI generation is temporarily unavailable. You can
   write your post copy manually or try again in a few minutes." Pre-fill the copy editors with
   empty fields so the user can proceed manually.
3. Do not block scheduling. The user can create a content item with manually written copy even
   when AI is unavailable.
4. Log the failure with `level: "error"` and trigger the "OpenAI unavailable" alert after 3
   consecutive failures.
5. Cache a "degraded mode" flag in a server-side variable for 60 seconds to avoid hammering
   OpenAI with retries during an outage. Show a small status indicator in the UI when degraded
   mode is active.

**What must not degrade:** Scheduling, publishing, library management, planner navigation.
These must all remain fully functional when OpenAI is unavailable.

### 6.2 Social Provider API Down

**User communication strategy:**

When the circuit breaker opens for a provider:

1. Immediately insert a `notifications` row categorised as `provider_outage`:
   "Instagram is experiencing issues. Your scheduled posts are safely queued and will be
   published automatically when Instagram is available."
2. In the Planner, show an inline banner on affected content items: "Pending: Instagram
   unavailable. Will retry automatically." Use a distinct amber colour, not red (red implies
   permanent failure).
3. In the Connections page, show the provider status with a last-checked timestamp. If the
   outage is confirmed (3+ hours), surface a link to the provider's status page
   (developers.facebook.com/status, status.cloud.google.com).
4. Do not cancel or delete queued jobs during an outage. The retry schedule absorbs outages of
   up to ~65 minutes automatically. For longer outages, the dead-letter notification guides
   the owner to manually post.
5. When the circuit closes (provider recovers), insert a resolution notification: "Instagram
   is back online. Your queued posts will resume publishing."

### 6.3 Supabase Unavailable

**Graceful degradation by feature:**

| Feature | Supabase Down Behaviour |
|---|---|
| Authentication | Session is cookie-based; existing sessions remain valid for their TTL. Login fails hard — acceptable. |
| Planner calendar | Server component fetch fails; show error boundary with "Unable to load planner. Refresh to retry." |
| Library grid | Server component fetch fails; show error boundary. |
| Create flow | Server Actions fail; toast error. User cannot create content. |
| Background publish | Edge Function cannot read `publish_jobs`; cron route returns 502. All jobs are held until Supabase recovers — they will be picked up on the next cron fire. No data loss as long as Supabase recovers within the retry window. |
| Notifications | Fail silently (return empty array per existing code pattern). |
| Settings | Server component fetch fails; show error boundary. |

**What fails hard (acceptable):** Authentication, data creation, real-time updates.
**What must not lose data:** Publish queue. The queue is in Supabase, so if Supabase is down the
queue is also inaccessible — but since jobs are persisted, they survive the outage and will
be processed when the database recovers.

Supabase's hosted Postgres has a historical SLA of 99.9% uptime. At a single-owner scale with
no SLA-backed revenue, full offline capability is not justified. The graceful degradation target
is: no data loss and a clear user-facing message for every failure mode.

### 6.4 Fallback UI Patterns

**Skeleton loaders:**

Every data-fetching server component must have a corresponding Suspense boundary with a skeleton.
The current skeleton coverage (planner only) must be extended:

| Route/Component | Required Skeleton |
|---|---|
| `/planner` | `PlannerSkeleton` (exists) |
| `/library` | `LibrarySkeleton` — grid of placeholder image cards |
| `/create` (modal open) | `CreateModalSkeleton` — form outline |
| `/connections` | `ConnectionsSkeleton` — provider card outlines |
| `/settings` | `SettingsSkeleton` — form section outlines |

Implement `loading.tsx` files at the route segment level for all app routes. This ensures the
App Router's automatic Suspense wrapping shows a skeleton immediately on navigation, before the
server component resolves.

**Error boundaries:**

Each page should wrap its main content in a React error boundary (client component) that catches
thrown errors from server component hydration. Display a generic "Something went wrong — tap to
retry" card rather than a blank page or a raw Next.js error.

**Offline-capable actions:**

At the current architecture (server-rendered, Server Actions, no service worker), true offline
support is not feasible and not warranted for a single-owner app. The only offline-capable
behaviour to implement is:

- TanStack Query `gcTime` keeping recently loaded data in memory during brief connectivity drops,
  allowing the user to read (but not modify) cached planner/library data.
- Form state preservation using React Hook Form's in-memory state so that a failed Server Action
  does not lose the user's input.

---

## 7. Resilience Checklist

Ordered by implementation priority. Each item has a testable pass/fail criterion.

### Priority 1 — Critical Path (must be done before launch)

- [ ] **IDEM-01: Unique constraint on publish_jobs**
  Add `UNIQUE (content_item_id) WHERE status IN ('queued', 'in_progress')` partial index.
  _Pass: Inserting two `enqueuePublishJob` calls for the same `content_item_id` within 1 second
  results in exactly one row in `publish_jobs` with status `queued`._

- [ ] **IDEM-02: `FOR UPDATE SKIP LOCKED` in Edge Function worker**
  Worker picks jobs using a locking query.
  _Pass: Firing the Supabase Edge Function twice simultaneously (two `curl` calls in parallel)
  results in each invocation processing a different job; no job is processed by both._

- [ ] **ALERT-01: Dead-letter email notification**
  Email sent via Resend when a job exhausts retries.
  _Pass: After forcing a job to fail 4 times, owner receives an email within 5 minutes containing
  the content item ID, platform, and a direct link to the Planner._

- [ ] **ALERT-02: In-app notification for dead-letter**
  `notifications` row inserted with `category = "publish_failed"` on dead-letter.
  _Pass: After forced dead-letter, notification appears in the Planner notification feed._

- [ ] **TIMEOUT-01: OpenAI timeout**
  OpenAI client configured with `timeout: 25000` ms.
  _Pass: Pointing at a mock endpoint that never responds, the Server Action returns an error
  within 30 seconds (25s timeout + 5s overhead)._

- [ ] **TIMEOUT-02: Provider API timeouts**
  All `fetch` calls to Facebook, Instagram, GBP use `AbortSignal.timeout(ms)`.
  _Pass: With a mock endpoint that never responds, the publish worker logs a timeout error and
  schedules a retry within the expected delay window._

- [ ] **MAXDURATION-01: Declare `maxDuration` on cron route**
  `export const maxDuration = 25` on `/api/cron/publish/route.ts`.
  _Pass: Vercel function configuration shows 25-second limit; does not default to 10s._

- [ ] **LOG-01: Structured logging utility**
  `createLogger(service, correlationId)` implemented and used in all server-side paths.
  _Pass: Every log entry during a publish cycle is valid JSON with all required fields present._

- [ ] **LOG-02: Correlation ID propagation**
  Cron route generates a UUID, passes it as `X-Correlation-Id` to the Edge Function, Edge
  Function includes it in all log entries.
  _Pass: All log entries for a single cron invocation share the same `correlationId` value._

### Priority 2 — High (required for production reliability)

- [ ] **RETRY-01: Retry/backoff implementation in Edge Function**
  4 attempts with 5m/15m/45m delays and ±20% jitter.
  _Pass: Forcing provider failures, `publish_jobs.next_attempt_at` timestamps follow the
  specified schedule within ±20% jitter tolerance._

- [ ] **RETRY-02: Non-retryable error classification**
  Token errors and policy violations do not trigger retries.
  _Pass: A job that fails with Facebook error code 190 (token invalid) immediately moves to
  `failed` status without scheduling a retry._

- [ ] **CB-01: Circuit breaker state table and trip logic**
  `circuit_breaker_state` table created; 3 consecutive failures within 10 minutes trips the
  circuit for 30 minutes.
  _Pass: After 3 forced failures, subsequent publish attempts for the affected provider are
  skipped and logged with `status: "skip"` and `reason: "circuit_open"`._

- [ ] **CB-02: Circuit breaker user notification**
  Notification inserted when circuit opens and when it closes.
  _Pass: Circuit opening inserts an amber `provider_outage` notification; circuit closing inserts
  a resolution notification._

- [ ] **CACHE-01: QueryClient global defaults**
  `staleTime: 30_000`, `refetchOnWindowFocus: false`, `retry: 1` set as global defaults.
  _Pass: Network tab shows no refetch requests when switching browser tabs._

- [ ] **IMG-01: `next/image` for all media previews**
  Zero bare `<img>` tags serving Supabase Storage URLs in Planner, Library, and Create.
  _Pass: Lighthouse audit shows no "Image elements do not have explicit width and height" warnings
  for any authenticated route._

- [ ] **IMG-02: Supabase image transformation parameters**
  All signed URLs for preview thumbnails include `?width=X&quality=Y&format=webp`.
  _Pass: Network requests in the Library grid show images ≤ 400px wide and in WebP format._

- [ ] **AXIOM-01: Log drain configured**
  Axiom integration active; structured logs searchable by `correlationId`.
  _Pass: After triggering a publish, querying Axiom for `correlationId` returns all log entries
  for that invocation._

### Priority 3 — Medium (required for good UX)

- [ ] **LOADING-01: `loading.tsx` files for all app routes**
  Files at `src/app/(app)/library/loading.tsx`, `connections/loading.tsx`, `settings/loading.tsx`.
  _Pass: Navigating to Library shows skeleton within 100ms of click; does not show blank white
  page while data loads._

- [ ] **SKELETON-01: Skeleton components for Library, Connections, Settings**
  Implement `LibrarySkeleton`, `ConnectionsSkeleton`, `SettingsSkeleton`.
  _Pass: Visual review shows a recognisable layout skeleton during the loading state._

- [ ] **DEGRADE-01: OpenAI degraded mode UI**
  Create flow shows a banner and allows manual copy entry when OpenAI is unavailable.
  _Pass: With `OPENAI_API_KEY` set to an invalid value, the Create modal opens, shows a "AI
  unavailable" banner, and allows the user to type copy manually and schedule the post._

- [ ] **DEGRADE-02: Provider outage UI in Planner**
  Affected content items show an amber "pending" badge (not red "failed") when circuit is open.
  _Pass: With circuit breaker in open state, Planner shows amber badge on affected items._

- [ ] **PERF-01: Planner LCP ≤ 2.5s**
  Lighthouse Mobile audit of `/planner`.
  _Pass: LCP ≤ 2500ms in Lighthouse CI report._

- [ ] **PERF-02: Library LCP ≤ 2.5s**
  Lighthouse Mobile audit of `/library`.
  _Pass: LCP ≤ 2500ms with a library of 50+ assets._

- [ ] **PERF-03: AI generation p95 ≤ 8s (single platform)**
  Measure Server Action duration for 20 generations.
  _Pass: p95 of 20 timed runs ≤ 8 seconds._

- [ ] **IDX-01: Database indexes verified**
  Confirm composite indexes on `publish_jobs(status, next_attempt_at)` and
  `content_items(account_id, scheduled_for)`.
  _Pass: `EXPLAIN ANALYZE` on queue poll query and planner calendar query show index scans, not
  sequential scans._

- [ ] **FALLBACK-01: Fallback package generation on dead-letter**
  Signed download URL for media + formatted copy block generated and included in dead-letter
  email.
  _Pass: Dead-letter email contains a working download link for the post's media asset._

### Priority 4 — Low (quality of life improvements)

- [ ] **BUNDLE-01: Framer Motion lazy import in sidebar**
  Sidebar animation uses `dynamic(() => import('framer-motion'), { ssr: false })` or equivalent
  to prevent it from blocking the root bundle.
  _Pass: Next.js bundle analyser shows `framer-motion` in a separate async chunk, not the main
  bundle._

- [ ] **PREFLIGHT-PARALLEL-01: Parallelise preflight checks**
  `getPublishReadinessIssues` runs `loadConnection`, `loadVariantData`, `loadContentContext`
  in `Promise.all`.
  _Pass: Total preflight duration ≤ the single slowest individual query time + 100ms overhead._

- [ ] **ALERT-AXIOM-01: Automated alerts in Axiom**
  Axiom alert rules created for all Critical and High alerts in Section 5.5.
  _Pass: Forcing a dead-letter job triggers an Axiom webhook that sends an email within 5
  minutes._

- [ ] **UPTIME-01: Vercel uptime monitor on cron endpoint**
  Monitor configured at 2-minute intervals.
  _Pass: Deliberately breaking `CRON_SECRET` triggers an uptime alert within 4 minutes._

---

## Appendix A — Key Files Referenced

| File | Role in Audit |
|---|---|
| `src/app/api/cron/publish/route.ts` | Cron trigger — no alerting, no timeout, no idempotency lock |
| `src/app/api/cron/purge-trash/route.ts` | Cron trigger — naturally idempotent, low risk |
| `src/lib/publishing/queue.ts` | No deduplication guard on insert |
| `src/lib/publishing/preflight.ts` | 4 sequential Supabase queries — should be parallelised |
| `src/lib/planner/notifications.ts` | No alerting integration — in-app only |
| `src/lib/scheduling/materialise.ts` | Conflict detection exists; no logging |
| `src/lib/scheduling/conflicts.ts` | Pure function — no issues |
| `src/lib/connections/diagnostics.ts` | Masks tokens correctly |
| `src/components/providers/app-providers.tsx` | QueryClient with no defaultOptions |
| `src/lib/ai/client.ts` | No timeout on OpenAI client |
| `src/lib/create/service.ts` | OpenAI call at line 1207 — no timeout, no AbortSignal |
| `next.config.ts` | No `images` configuration; no `remotePatterns` |
| `vercel.json` | Cron at `* * * * *` (every minute); no `maxDuration` on routes |
| `package.json` | `framer-motion` v12 in root bundle; no observability SDK |
