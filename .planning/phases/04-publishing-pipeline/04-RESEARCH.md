# Phase 4: Publishing Pipeline - Research

**Researched:** 2026-05-19
**Domain:** Async job queue, publishing state machine, idempotent delivery, structured logging, integration testing
**Confidence:** HIGH

## Summary

Phase 4 wires together existing assets (QStash client, provider adapters, preflight checks, publish_jobs schema) into a reliable end-to-end pipeline. The codebase already has: a QStash client with signature verification (`src/lib/qstash/client.ts`), three registered provider adapters (Facebook, Instagram, GBP), comprehensive preflight checks (`src/lib/publishing/preflight.ts`), a basic `enqueuePublishJob()` function, the `publish_jobs` + `publish_attempts` schema with idempotency_key and EXCLUDE constraints, error classification (`src/lib/providers/errors.ts`), structured logging with Axiom and correlation IDs, and a failure notification cron (`api/cron/notify-failures`).

The main implementation work is: (1) replace the Vercel-Cron-to-Edge-Function publish trigger with QStash event-driven dispatch, (2) build the webhook handler that receives QStash messages, runs preflight, calls the adapter, and records attempts, (3) implement the 7-state machine transitions with proper idempotency, (4) create a `logAuditEvent()` utility (audit_log table exists but has zero application code), (5) build failure recovery UX with plain-English errors and retry CTAs, and (6) add MSW integration tests.

**Primary recommendation:** Use QStash's native `publishJSON` with `deduplicationId`, `retries: 3`, and custom `retryDelay: "min(2700000, pow(3, retried) * 300000)"` (5m/15m/45m) for the dispatch side. Handler-side idempotency uses `publish_attempts` table with attempt_number uniqueness. The existing `enqueuePublishJob()` inserts the DB row; a new `dispatchToQStash()` calls `publishJSON` targeting the webhook endpoint.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Review state is always required -- every piece of content must pass through review before it can be approved. No skip-to-approved shortcut.
- **D-02:** Approval happens within the creation flow itself. After the AI generates platform-specific copy and the owner reviews it, they approve right there in the wizard. No separate review queue page, no planner-based approval.
- **D-03:** Bulk approve (CONT-09) is dropped. Not needed -- recurring campaigns already auto-publish after first approval (`auto_confirm = true`, Phase 2 decision). Individual content is approved in the create flow.
- **D-04:** After approval, content auto-queues at the scheduled time. If scheduled for now, it publishes immediately. No extra confirmation step between approve and queue.

### Claude's Discretion
- Failure recovery UX: where failures surface (planner banner, toast, dedicated tab), what the retry button does, whether retry re-runs preflight, what plain-English errors look like per error type
- Preflight error presentation: when preflight checks block (at approval, scheduling, or publish time), what fix-it CTAs look like, whether all checks run at once or progressively
- Publishing status visibility: how the 7-state machine surfaces in the planner and elsewhere, real-time feedback during publishing
- QStash dispatch pattern: cron-poll vs event-driven, message format, multi-platform orchestration for a single content item
- Retry/backoff implementation details (5m/15m/45m schedule, QStash-native vs handler-side)
- Idempotency key strategy (QStash message ID vs content-derived key)
- Audit log entry structure for publish attempts
- Structured logging correlation IDs and job duration tracking
- MSW integration test approach and mock provider setup
- Email alert template and trigger conditions

### Deferred Ideas (OUT OF SCOPE)
- **Bulk approve dropped** -- CONT-09 removed by user decision. Not needed given recurring auto-publish and in-flow approval.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PUB-01 | QStash-based async publish queue | QStash client exists; `publishJSON` with retries/delay/deduplication documented. Replace Vercel Cron trigger with event-driven dispatch. |
| PUB-02 | Publish job idempotency: duplicate fire is no-op | QStash `deduplicationId` (15min window) + handler-side `publish_attempts` table with UNIQUE(publish_job_id, attempt_number). |
| PUB-03 | Retry/backoff: 5m/15m/45m, 4 attempts max, QStash-native | QStash `retries: 3` (= 4 total) + `retryDelay` custom formula for 5m/15m/45m. |
| PUB-04 | Handler-side idempotency with publish_attempts table | Schema exists. Handler checks attempt_number before executing. |
| PUB-05 | Publish failure recovery: retry button + plain-English root cause | ErrorClassification already maps errors. Add human-readable messages and retry server action. |
| PUB-06 | Content state machine: 7 states | ContentStatus type and content_status enum both have all 7 values. StatusChip component renders them. |
| PUB-07 | Audit log for every publish attempt | audit_log table exists (append-only RLS). No logAuditEvent() function yet -- must be created. |
| PUB-08 | Structured logging with Axiom: correlation IDs, job durations | `src/lib/logging/` fully implemented with correlation IDs, Axiom transport. Extend with job-specific metadata. |
| PUB-09 | Email alerts for publish failures | `notify-failures` cron exists with full idempotency pattern. Adapt for immediate alert on final failure. |
| CONT-09 | Bulk approve | DROPPED by user decision D-03. Do not implement. |
| CONT-10 | Pre-flight errors in plain English with CTAs | `getPublishReadinessIssues()` returns coded issues with messages. Extend with CTA actions. |
| TEST-01 | Coverage thresholds (publishing >=85%) | vitest.config.ts has threshold structure. Add publishing coverage thresholds. |
| TEST-02 | MSW integration tests for all provider API flows | MSW not installed. Install msw@2.x, create handlers for Meta Graph + GBP APIs. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @upstash/qstash | 2.11.0 (installed) | Async message queue with retry/backoff | Already in project. publishJSON with native retries and deduplication. |
| msw | 2.14.6 | Mock Service Worker for integration tests | Industry standard for intercepting network requests in Vitest. Framework-agnostic, intercepts at network level. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| resend | 6.6.0 (installed) | Email alerts for failures | Already in project. sendEmail() helper exists. |
| luxon | 3.7.2 (installed) | Timezone-safe scheduling | Already in project. All date math uses Luxon. |

**Installation:**
```bash
npm install --save-dev msw@2.14.6
```

**Version verification:** @upstash/qstash 2.11.0 confirmed installed. MSW 2.14.6 is latest on registry (verified 2026-05-19).

## Architecture Patterns

### Recommended Project Structure
```
src/
  lib/
    publishing/
      preflight.ts        # EXISTS: readiness checks with issue codes
      queue.ts            # EXISTS: enqueuePublishJob, markContentScheduled
      dispatch.ts         # NEW: dispatchToQStash() -- sends QStash message
      handler.ts          # NEW: processPublishJob() -- core pipeline logic
      state-machine.ts    # NEW: transition guards, valid state transitions
      error-messages.ts   # NEW: ErrorClassification -> plain English mapping
      audit.ts            # NEW: logPublishAuditEvent() wrapping audit_log inserts
    logging/
      index.ts            # EXISTS: structured logger with Axiom
      correlation.ts      # EXISTS: AsyncLocalStorage correlation IDs
  app/
    api/
      webhooks/
        qstash-publish/
          route.ts        # NEW: QStash webhook handler (replaces cron/publish)
      cron/
        publish-scheduler/
          route.ts        # NEW: periodic poll for scheduled->queued transitions
        notify-failures/
          route.ts        # EXISTS: email alert cron
  features/
    publishing/
      components/
        preflight-errors.tsx    # NEW: plain-English error list with CTAs
        retry-button.tsx        # NEW: retry failed publish action
        publish-status-card.tsx # NEW: detailed status for failed jobs
```

### Pattern 1: QStash Event-Driven Dispatch
**What:** When content is approved in the create flow, insert a `publish_jobs` row then call QStash `publishJSON` targeting the webhook endpoint. QStash handles delivery, retry, and backoff natively.
**When to use:** Every time a publish job is created or needs re-dispatch.
**Example:**
```typescript
// src/lib/publishing/dispatch.ts
import { getQStashClient } from '@/lib/qstash/client';
import { env } from '@/env';

interface DispatchOptions {
  jobId: string;
  deduplicationId: string;
  delaySeconds?: number;
}

export async function dispatchToQStash({ jobId, deduplicationId, delaySeconds }: DispatchOptions) {
  const client = getQStashClient();
  const baseUrl = env.client.NEXT_PUBLIC_SITE_URL;

  await client.publishJSON({
    url: `${baseUrl}/api/webhooks/qstash-publish`,
    body: { jobId },
    retries: 3,
    // Custom backoff: 5m, 15m, 45m (pow(3, retried) * 300000ms)
    // retried=0: 300000ms=5m, retried=1: 900000ms=15m, retried=2: 2700000ms=45m
    headers: {
      'Upstash-Retry-Delay': 'min(2700000, pow(3, retried) * 300000)',
    },
    deduplicationId,
    callback: `${baseUrl}/api/webhooks/qstash-publish/callback`,
    failureCallback: `${baseUrl}/api/webhooks/qstash-publish/failure`,
    ...(delaySeconds ? { delay: delaySeconds } : {}),
  });
}
```
Source: [Upstash QStash Retry Docs](https://upstash.com/docs/qstash/features/retry), [QStash Publish SDK](https://upstash.com/docs/qstash/sdks/ts/examples/publish)

### Pattern 2: Two-Layer Idempotency
**What:** QStash provides deduplication (15-min window) at the message level. Handler-side idempotency uses `publish_attempts` table with UNIQUE(publish_job_id, attempt_number) to prevent re-execution within the same attempt.
**When to use:** Always. QStash guarantees at-least-once delivery, so the handler MUST be idempotent.
**Example:**
```typescript
// In handler.ts
async function processPublishJob(jobId: string, db: SupabaseClient) {
  // 1. Load job, check status
  const job = await db.from('publish_jobs').select('*').eq('id', jobId).single();
  if (job.data?.status === 'published') return { alreadyDone: true };

  // 2. Insert attempt (UNIQUE constraint prevents duplicate)
  const attemptNumber = (job.data?.retry_count ?? 0) + 1;
  const { error: attemptError } = await db.from('publish_attempts').insert({
    publish_job_id: jobId,
    account_id: job.data!.account_id,
    attempt_number: attemptNumber,
    status: 'started',
  });
  if (attemptError?.code === '23505') return { alreadyDone: true }; // duplicate

  // 3. Transition to 'publishing'
  await db.from('publish_jobs').update({ status: 'publishing', started_at: new Date().toISOString() }).eq('id', jobId);

  // 4. Run preflight, call adapter, record result
  // ...
}
```

### Pattern 3: State Machine Transitions
**What:** Enforce valid transitions: draft->review->approved->scheduled->queued->publishing->published|failed. Each transition is a function that validates the current state before updating.
**When to use:** Every status change goes through a transition function, never raw UPDATE.
**Example:**
```typescript
const VALID_TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  draft: ['review'],
  review: ['approved', 'draft'],   // can go back to draft
  approved: ['scheduled', 'queued'], // queued if immediate
  scheduled: ['queued'],
  queued: ['publishing'],
  publishing: ['published', 'failed'],
  published: [],                    // terminal
  failed: ['queued'],               // retry re-queues
};

export function canTransition(from: ContentStatus, to: ContentStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
```

### Pattern 4: Cron Scheduler for Scheduled->Queued Promotion
**What:** A periodic cron (every 1 minute) queries `publish_jobs WHERE status='queued' AND scheduled_at <= now()` and dispatches them to QStash. For content scheduled for the future, a separate cron promotes `scheduled` to `queued` when `scheduled_at` arrives.
**When to use:** Content with future scheduled_at times. Immediate publishes skip directly to QStash dispatch.

### Anti-Patterns to Avoid
- **Direct adapter calls from server actions:** Never call publishPost() from user-facing code. Always go through QStash for reliability.
- **Trusting QStash deduplication alone:** Its 15-min window is insufficient for jobs that retry over 45+ minutes. Always pair with handler-side idempotency.
- **Mixing sync and async status updates:** Never update content_items.status directly in the publish handler. Update publish_jobs.status first, then sync content_items in a separate step.
- **Blocking preflight in the webhook handler:** Run preflight asynchronously before dispatch (at approval time). At publish time, only re-validate token freshness, not full preflight.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Message retry/backoff | Custom setTimeout chains | QStash native retries + retryDelay | Battle-tested, survives server restarts, tracks delivery state |
| Request deduplication | Custom Redis lock | QStash deduplicationId + DB UNIQUE constraint | Two-layer approach covers both message and handler levels |
| Structured logging | Custom JSON formatter | Existing `log.*` + `createLogger()` | Already wired to Axiom with correlation IDs and duration |
| Email delivery | Raw SMTP/SES | Existing `sendEmail()` via Resend | Already handles missing config gracefully |
| Error classification | Per-handler if/else | Existing `classifyMetaError` / `classifyGoogleError` | Already maps status codes to ActionableClassifications |
| Webhook signature verify | Manual HMAC | Existing `verifyQStashSignature()` | Uses Upstash Receiver with key rotation |

**Key insight:** This phase is primarily orchestration of existing components, not net-new library integration. The codebase already has every building block -- the work is wiring them into a reliable pipeline.

## Common Pitfalls

### Pitfall 1: Queue.ts Missing Fields for publish_jobs Schema
**What goes wrong:** Current `enqueuePublishJob()` inserts with `status`, `next_attempt_at`, `placement` but the schema requires `platform`, `idempotency_key`, `scheduled_at`, `account_id`.
**Why it happens:** queue.ts was a Phase 1 skeleton. The schema has fields the function does not populate.
**How to avoid:** Refactor enqueuePublishJob to accept all required fields and generate the idempotency_key (e.g., `${contentItemId}:${platform}:${scheduledAt.toISOString()}`).
**Warning signs:** Insert failures with NOT NULL violations.

### Pitfall 2: QStash Retry Counting Mismatch
**What goes wrong:** QStash retries 3 times (4 total including initial). But the pipeline expects 4 retries at 5m/15m/45m. That is actually 3 retries + 1 initial = 4 attempts, matching QStash `retries: 3`.
**Why it happens:** Off-by-one confusion between "retries" (re-attempts) and "attempts" (total tries).
**How to avoid:** Set `retries: 3` in QStash (3 retries = 4 total attempts). Document clearly: attempt 1 = initial, attempts 2-4 = retries at 5m/15m/45m.

### Pitfall 3: Audit Log Has No Application Code
**What goes wrong:** The audit_log table exists with RLS policies but zero functions write to it. The CLAUDE.md documents `logAuditEvent()` but it does not exist.
**Why it happens:** Phase 1 created the schema; the function was deferred.
**How to avoid:** Create `logAuditEvent()` early in this phase. Use service-role client since publish jobs run in system context (no auth.uid() in cron/webhook context).
**Warning signs:** RLS INSERT policy requires `account_id = auth.uid()` match, but pipeline runs with service-role. The service-role client bypasses RLS, so this works correctly.

### Pitfall 4: Existing queue.ts Uses Wrong Column Names
**What goes wrong:** `queue.ts` inserts `next_attempt_at` into publish_jobs, but the schema column is `scheduled_at`. It also uses `variant_id` which is not in the schema.
**Why it happens:** queue.ts was written before the schema was finalised.
**How to avoid:** Align queue.ts inserts with the actual schema columns from 00000000000002_publishing.sql.
**Warning signs:** Supabase 400 errors on insert.

### Pitfall 5: Multi-Platform Content Needs Per-Platform Jobs
**What goes wrong:** A single content item may target Facebook + Instagram + GBP. Each platform needs its own publish_job with its own retry lifecycle.
**Why it happens:** The create flow already creates separate content_items per platform per variant. Each content_item maps to exactly one platform, so each gets one publish_job.
**How to avoid:** Verify the 1:1 mapping: content_items.platform -> one publish_job per content_item. The EXCLUDE constraint on (content_item_id, platform) WHERE status IN ('queued','publishing') enforces this.

### Pitfall 6: MSW Setup Needs Careful Vitest Integration
**What goes wrong:** MSW 2.x requires `server.listen()` in setup, `server.resetHandlers()` between tests, and proper module mocking order.
**Why it happens:** MSW intercepts at the network level and must be set up before any fetch calls.
**How to avoid:** Add MSW server setup to `tests/setup.ts` or create a dedicated `tests/msw/setup.ts` with `beforeAll/afterEach/afterAll` hooks. Create handler files per provider.

## Code Examples

### QStash Webhook Handler Route
```typescript
// src/app/api/webhooks/qstash-publish/route.ts
import { NextResponse } from 'next/server';
import { verifyQStashSignature } from '@/lib/qstash/client';
import { processPublishJob } from '@/lib/publishing/handler';
import { withCorrelationId } from '@/lib/logging/correlation';
import { createLogger } from '@/lib/logging';

export const dynamic = 'force-dynamic';
const logger = createLogger('publish-webhook');

export async function POST(request: Request) {
  const isValid = await verifyQStashSignature(request);
  if (!isValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // Body already consumed by verify, re-parse from raw
  const body = await request.clone().json();
  const { jobId } = body;

  return withCorrelationId(async () => {
    const startMs = Date.now();
    logger.info('Processing publish job', { jobId });

    try {
      const result = await processPublishJob(jobId);
      const durationMs = Date.now() - startMs;
      logger.info('Publish job complete', { jobId, result, durationMs });
      return NextResponse.json({ success: true, ...result });
    } catch (error) {
      const durationMs = Date.now() - startMs;
      logger.error('Publish job failed', error as Error, { jobId, durationMs });
      // Return 500 so QStash retries
      return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
    }
  });
}
```

### Audit Event Logger
```typescript
// src/lib/publishing/audit.ts
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { getCorrelationId } from '@/lib/logging/correlation';

interface AuditEventParams {
  accountId: string;
  operationType: 'publish_attempt' | 'publish_success' | 'publish_failure' | 'publish_retry';
  resourceType: 'publish_job';
  resourceId: string;
  details?: Record<string, unknown>;
}

export async function logPublishAuditEvent(params: AuditEventParams): Promise<void> {
  const db = createServiceSupabaseClient();
  await db.from('audit_log').insert({
    account_id: params.accountId,
    operation_type: params.operationType,
    resource_type: params.resourceType,
    resource_id: params.resourceId,
    operation_status: params.operationType.includes('failure') ? 'failure' : 'success',
    details: params.details ?? null,
    correlation_id: getCorrelationId(),
  }).throwOnError();
}
```

### Plain-English Error Mapping
```typescript
// src/lib/publishing/error-messages.ts
import { ErrorClassification } from '@/lib/providers/errors';

interface PlainEnglishError {
  title: string;
  description: string;
  cta: { label: string; action: 'reconnect' | 'retry' | 'edit_content' | 'wait' };
}

const ERROR_MAP: Record<ErrorClassification, PlainEnglishError> = {
  [ErrorClassification.AUTH]: {
    title: 'Connection expired',
    description: 'Your social media connection needs to be refreshed. This usually happens when a token expires.',
    cta: { label: 'Reconnect account', action: 'reconnect' },
  },
  [ErrorClassification.RATE_LIMIT]: {
    title: 'Too many posts',
    description: 'The platform is temporarily limiting posts. We will retry automatically.',
    cta: { label: 'Wait for retry', action: 'wait' },
  },
  [ErrorClassification.CONTENT_REJECTED]: {
    title: 'Content not accepted',
    description: 'The platform rejected this post. Check the content meets their guidelines.',
    cta: { label: 'Edit content', action: 'edit_content' },
  },
  [ErrorClassification.TRANSIENT]: {
    title: 'Temporary error',
    description: 'The platform had a temporary issue. We will retry automatically.',
    cta: { label: 'Wait for retry', action: 'wait' },
  },
  [ErrorClassification.UNKNOWN]: {
    title: 'Something went wrong',
    description: 'An unexpected error occurred. Try again or contact support.',
    cta: { label: 'Retry now', action: 'retry' },
  },
};

export function getPlainEnglishError(classification: ErrorClassification): PlainEnglishError {
  return ERROR_MAP[classification];
}
```

### MSW Handler Setup for Meta Graph API
```typescript
// tests/msw/handlers/meta.ts
import { http, HttpResponse } from 'msw';

const GRAPH_BASE = 'https://graph.facebook.com';

export const metaHandlers = [
  // Facebook page post
  http.post(`${GRAPH_BASE}/:version/:pageId/feed`, () => {
    return HttpResponse.json({ id: '12345_67890' });
  }),

  // Instagram container creation
  http.post(`${GRAPH_BASE}/:version/:igUserId/media`, () => {
    return HttpResponse.json({ id: 'container_123' });
  }),

  // Instagram publish
  http.post(`${GRAPH_BASE}/:version/:igUserId/media_publish`, () => {
    return HttpResponse.json({ id: 'post_456' });
  }),
];
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Vercel Cron -> Edge Function | QStash event-driven dispatch | Project decision (Phase 1) | Reliable delivery with native retry and DLQ |
| QStash dedup window only (15min) | Two-layer: QStash dedup + DB UNIQUE constraint | Requirement PUB-04 | Covers full retry window (>45min) |
| console.log debugging | Axiom structured logging with correlation IDs | Phase 1 (INFRA-01) | Trace individual job lifecycle across retries |
| No failure notification | Cron-based email alerts | Phase 3 (exists already) | Owner aware within 2 hours of failure |

**Deprecated/outdated in this codebase:**
- `src/app/api/cron/publish/route.ts`: Calls Supabase Edge Function. Will be replaced by QStash webhook handler. The edge function call should be removed entirely.
- `src/lib/publishing/queue.ts`: Field names (`next_attempt_at`, `variant_id`, `placement`) do not match the actual `publish_jobs` schema. Must be refactored.

## Open Questions

1. **verifyQStashSignature consumes the request body**
   - What we know: `verifyQStashSignature()` calls `request.text()` which consumes the body stream. The handler then needs to parse the body as JSON.
   - What's unclear: Whether to clone the request before verify, or restructure verify to return the body.
   - Recommendation: Clone the request before passing to verify, or refactor verify to return the parsed body alongside the boolean result. Simple fix during implementation.

2. **Immediate publish vs scheduled publish flow**
   - What we know: If `scheduledFor` is null/now, content should publish immediately (D-04). If future, it waits.
   - What's unclear: Whether immediate publishes skip the cron scheduler entirely and dispatch directly to QStash.
   - Recommendation: Yes -- immediate publishes call `dispatchToQStash()` directly from the create flow. Only future-scheduled content goes through the cron scheduler that promotes scheduled->queued.

3. **Content_items.status sync with publish_jobs.status**
   - What we know: Both tables have a `status` field using the same enum. They must stay in sync.
   - What's unclear: Whether to update both atomically or have a sync mechanism.
   - Recommendation: The webhook handler updates `publish_jobs.status` first, then updates `content_items.status` to match. Use a Supabase RPC function or handle in the same transaction for atomicity.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/lib/qstash/client.ts`, `src/lib/publishing/`, `src/lib/providers/`, `src/lib/logging/`, `src/app/api/cron/notify-failures/route.ts`
- Database schema: `supabase/migrations/00000000000002_publishing.sql` (publish_jobs, publish_attempts, audit_log)
- QStash TS SDK: @upstash/qstash 2.11.0 (installed, verified)

### Secondary (MEDIUM confidence)
- [Upstash QStash Retry Docs](https://upstash.com/docs/qstash/features/retry) - custom retryDelay formula syntax
- [QStash Publish SDK Examples](https://upstash.com/docs/qstash/sdks/ts/examples/publish) - publishJSON API options
- [MSW Node.js Integration](https://mswjs.io/docs/integrations/node/) - Vitest setup pattern
- [QStash Delay Docs](https://upstash.com/docs/qstash/features/delay) - delay parameter for scheduled dispatch

### Tertiary (LOW confidence)
- None. All findings verified against installed packages and official docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - @upstash/qstash already installed and used; MSW is the clear standard for network mocking in Vitest
- Architecture: HIGH - all building blocks exist in codebase; orchestration patterns are straightforward
- Pitfalls: HIGH - identified by direct comparison of queue.ts code against publish_jobs schema; verified column mismatches

**Research date:** 2026-05-19
**Valid until:** 2026-06-19 (stable -- all libraries are production releases)
