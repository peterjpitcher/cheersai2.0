# Phase 3: Provider Integration - Research

**Researched:** 2026-05-19
**Domain:** Social media provider integration (Facebook, Instagram, GBP) with adapter pattern, OAuth, token lifecycle, rate limits
**Confidence:** HIGH

## Summary

Phase 3 connects three social media platforms (Facebook, Instagram, Google Business Profile) behind a uniform `PublishingAdapter` interface with a registry pattern. The codebase already has substantial v1 infrastructure: OAuth URL builders (`src/lib/connections/oauth.ts`), token exchange logic (`src/lib/connections/token-exchange.ts`), a Meta Graph API client (`src/lib/meta/graph.ts`), GBP business info resolution (`src/lib/gbp/business-info.ts`), connection cards UI, and a notify-expiring-connections cron endpoint. The v2 schema (Phase 1) established `social_connections` and `token_vault` tables with RLS, but the v1 action code still references columns that don't exist in v2 (`access_token`, `refresh_token`, `metadata`, `display_name`). The `oauth_states` table used by v1 actions does not exist in any v2 migration.

The primary work is: (1) create the `PublishingAdapter` interface and registry at `src/lib/providers/`, (2) implement three concrete adapters wrapping the existing API client code, (3) add the `oauth_states` table migration, (4) rewrite connection actions to use v2 schema + token vault, (5) add token refresh logic (GBP just-in-time, FB/IG nightly cron via QStash), (6) add rate limit tracking, (7) add error classification, (8) wire health dots into sidebar UI.

**Primary recommendation:** Build the adapter interface and registry first, then implement adapters one platform at a time (Facebook first as simplest, then Instagram, then GBP), then layer on token refresh and rate limit tracking. Reuse v1 API client code patterns but rewrite all storage to use token vault.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Health status visible in sidebar AND full connections page. Sidebar shows per-platform dots (FB, IG, GBP) each coloured independently -- green/amber/red. Owner sees at a glance which platform needs attention.
- **D-02:** Full connections page uses a card-per-provider layout. Each card shows: status dot, account name, last sync time, token expiry date, and a connect/reconnect button.
- **D-03:** When a connection goes amber or red, show an in-app toast notification on login: e.g. "Instagram token expires in 5 days -- reconnect". One-time per session, not persistent. No email alerts in this phase.
- **D-04:** When content targets a provider that doesn't support the content type (e.g. carousel to GBP), show a warning at create time: "GBP doesn't support carousels -- this post will only go to Instagram". Owner decides whether to proceed. No silent skipping, no auto-downgrade.
- **D-05:** Adapter interface uses common base + extensions pattern. Shared base interface (`publishPost`, `publishStory`) plus optional provider-specific methods (`publishOffer`, `publishEvent`). Callers check capability before calling.
- **D-06:** GBP post type (Standard / Event / Offer) selected via explicit picker dropdown in the create flow when GBP is a target platform. No auto-detection.
- **D-07:** Each adapter validates content format before publish via a `validate(content)` method that checks platform-specific rules (image dimensions, character limits, required fields). Fails early with clear errors.

### Claude's Discretion
- OAuth connect flow UX details (modal vs page, step-by-step guidance)
- Error classification implementation (enum structure, retry categorisation)
- Rate limit counter storage approach (database vs in-memory)
- Nightly cron implementation details (QStash vs Vercel Cron)
- Token refresh retry strategy and backoff
- Registry pattern implementation (Map, class-based, or factory)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLAT-01 | Provider abstraction layer: `PublishingAdapter` interface with registry pattern | Adapter interface design, registry Map pattern, capability checking pattern |
| PLAT-02 | Facebook adapter: posts, stories, events via Graph API | Graph API v24+ `/{page-id}/feed` for posts, `/{page-id}/photos` for photo posts, long-lived page tokens don't expire |
| PLAT-03 | Instagram adapter: posts, stories, carousels via Content Publishing API | Two-step flow: `/{ig-user-id}/media` then `/{ig-user-id}/media_publish`, 200 req/hr rate limit |
| PLAT-04 | GBP adapter: Standard, Event, and Offer post types | Local Posts API v4 `accounts.locations.localPosts`, 1h access token TTL, refresh token pattern |
| PLAT-05 | GBP access token auto-refresh (1h TTL, just-in-time before publish) | Google OAuth2 refresh flow via `https://oauth2.googleapis.com/token`, existing refresh token in token vault |
| PLAT-06 | Facebook/Instagram token health: alert 7 days before expiry | Long-lived page tokens don't expire but user tokens do (60d); existing cron route at `src/app/api/cron/notify-expiring-connections/` |
| PLAT-07 | Per-provider error classification: auth errors, rate limits (429), content rejection, transient 5xx | Enum-based classification with retry categorisation per error type |
| PLAT-08 | API rate limit counters per provider | Database table `provider_rate_limits` for durable tracking across restarts |
| PLAT-09 | OAuth state session-bound via cookie (prevent state fixation) | Existing OAuth state flow in v1 actions; needs `oauth_states` migration + HMAC state validation |
| PLAT-10 | Nightly cron for proactive token refresh/alert | QStash scheduled job calling token health check endpoint |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @upstash/qstash | 2.11.0 | Nightly cron scheduling | Already in project, QStash chosen over Vercel Cron per project decision |
| openai | 6.15.0 | Already installed, no new dependency | N/A |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| p-limit | 7.3.0 | Rate limit concurrency for bulk operations | Already installed; use when making batched API calls |
| luxon | 3.7.2 | Token expiry date calculations | Already installed; all date work per project conventions |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Database rate limit tracking | In-memory Map | In-memory resets on deploy; database persists across restarts and multiple serverless instances. For a hospitality app with low API volume, database is simpler and more reliable. |
| QStash for nightly cron | Vercel Cron | Project already decided QStash (STATE.md); Vercel Cron limited to 1/day on free tier |
| class-based adapters | plain functions + factory | Classes provide cleaner interface contracts and are easier to test with dependency injection |

**No new npm installs required.** All needed packages are already in the project.

## Architecture Patterns

### Recommended Project Structure
```
src/
  lib/
    providers/
      types.ts              # PublishingAdapter interface, ProviderCapability, ProviderError
      registry.ts           # AdapterRegistry (Map-based singleton)
      errors.ts             # ProviderError class, ErrorClassification enum
      rate-limits.ts        # Rate limit counter logic (read/write to DB)
      token-refresh.ts      # GBP just-in-time refresh, FB/IG health check
      facebook/
        adapter.ts          # FacebookAdapter implements PublishingAdapter
        api.ts              # Graph API calls (publish post, story)
        validation.ts       # FB content validation rules
      instagram/
        adapter.ts          # InstagramAdapter implements PublishingAdapter
        api.ts              # Content Publishing API calls
        validation.ts       # IG content validation rules
      gbp/
        adapter.ts          # GbpAdapter implements PublishingAdapter + GbpExtensions
        api.ts              # Local Posts API calls
        validation.ts       # GBP content validation rules
  app/
    api/
      cron/
        token-health/       # NEW: nightly token health cron (QStash target)
          route.ts
```

### Pattern 1: PublishingAdapter Interface (D-05)
**What:** Common base interface with optional capability extensions.
**When to use:** All provider interactions for publishing.
**Example:**
```typescript
// src/lib/providers/types.ts

export type ProviderPlatform = 'facebook' | 'instagram' | 'gbp';

export interface PublishResult {
  platformPostId: string;
  url?: string;
}

export interface ContentPayload {
  text: string;
  mediaUrls?: string[];
  contentType: 'instant_post' | 'story' | 'event' | 'promotion';
  // Platform-specific fields
  eventDetails?: { title: string; startDate: string; endDate: string };
  offerDetails?: { couponCode: string; redeemUrl?: string; terms?: string };
}

export interface ValidationResult {
  valid: boolean;
  errors: { field: string; message: string; code: string }[];
}

export interface PublishingAdapter {
  readonly platform: ProviderPlatform;
  
  /** Check what this adapter can do */
  supports(contentType: string): boolean;
  
  /** Validate content before publish (D-07) */
  validate(content: ContentPayload): ValidationResult;
  
  /** Publish a post */
  publishPost(connectionId: string, content: ContentPayload): Promise<PublishResult>;
  
  /** Publish a story (FB + IG only) */
  publishStory?(connectionId: string, content: ContentPayload): Promise<PublishResult>;
}

/** GBP-specific extensions (D-05) */
export interface GbpExtensions {
  publishEvent(connectionId: string, content: ContentPayload): Promise<PublishResult>;
  publishOffer(connectionId: string, content: ContentPayload): Promise<PublishResult>;
}
```

### Pattern 2: Registry Pattern
**What:** Map-based singleton that returns the correct adapter for a platform.
**When to use:** Any code that needs to publish to a specific platform.
**Example:**
```typescript
// src/lib/providers/registry.ts

const adapters = new Map<ProviderPlatform, PublishingAdapter>();

export function registerAdapter(adapter: PublishingAdapter): void {
  adapters.set(adapter.platform, adapter);
}

export function getAdapter(platform: ProviderPlatform): PublishingAdapter {
  const adapter = adapters.get(platform);
  if (!adapter) throw new Error(`No adapter registered for ${platform}`);
  return adapter;
}

// Initialize at module load
registerAdapter(new FacebookAdapter());
registerAdapter(new InstagramAdapter());
registerAdapter(new GbpAdapter());
```

### Pattern 3: Error Classification (D-07, PLAT-07)
**What:** Enum-based error classification determining retry behavior.
**When to use:** All API error handling in adapters.
**Example:**
```typescript
// src/lib/providers/errors.ts

export enum ErrorClassification {
  AUTH = 'auth',              // Token expired/revoked -- do NOT retry, reconnect
  RATE_LIMIT = 'rate_limit',  // 429 -- retry after backoff
  CONTENT_REJECTED = 'content_rejected', // Platform rejected content -- do NOT retry
  TRANSIENT = 'transient',    // 5xx, timeout -- retry with backoff
  UNKNOWN = 'unknown',        // Unclassified -- retry once then fail
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly platform: ProviderPlatform,
    public readonly classification: ErrorClassification,
    public readonly retryable: boolean,
    public readonly retryAfterMs?: number,
    public readonly rawError?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function classifyMetaError(statusCode: number, errorPayload: unknown): ErrorClassification {
  if (statusCode === 429) return ErrorClassification.RATE_LIMIT;
  if (statusCode === 401 || statusCode === 403) return ErrorClassification.AUTH;
  // Meta error subcodes 190, 463, 467 = expired/invalid token
  const subcode = (errorPayload as { error?: { error_subcode?: number } })?.error?.error_subcode;
  if (subcode && [190, 463, 467].includes(subcode)) return ErrorClassification.AUTH;
  if (statusCode >= 500) return ErrorClassification.TRANSIENT;
  if (statusCode === 400) return ErrorClassification.CONTENT_REJECTED;
  return ErrorClassification.UNKNOWN;
}
```

### Pattern 4: Token Retrieval via Token Vault
**What:** Adapters get decrypted tokens from token_vault, not from social_connections.
**When to use:** Every adapter method that makes an API call.
**Example:**
```typescript
// Token retrieval helper
async function getDecryptedToken(connectionId: string, tokenType: 'access' | 'refresh'): Promise<string> {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from('token_vault')
    .select('ciphertext, iv, tag, key_version')
    .eq('social_connection_id', connectionId)
    .eq('token_type', tokenType)
    .single();
  if (error || !data) throw new Error(`Token not found: ${tokenType} for connection ${connectionId}`);
  return decrypt({ ciphertext: data.ciphertext, iv: data.iv, tag: data.tag, keyVersion: data.key_version });
}
```

### Anti-Patterns to Avoid
- **Storing plaintext tokens in social_connections:** v1 stored `access_token` and `refresh_token` directly. V2 MUST use `token_vault` with AES-256-GCM encryption.
- **Querying social_connections for columns that don't exist:** v1 actions reference `metadata`, `display_name`, `last_synced_at`, `expires_at`, `access_token`. The v2 schema only has `platform_account_id`, `platform_account_name`, `status`, `scopes`, `token_expires_at`.
- **In-memory rate limit counters:** Serverless functions are ephemeral; counters reset on each cold start. Use database for durable tracking.
- **Hardcoded Graph API version:** Use `getMetaGraphApiBase()` from `src/lib/meta/graph.ts` which reads from env with v24.0 default.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OAuth state validation | Custom HMAC/crypto | Existing `oauth_states` pattern + cookie-bound state | CSRF prevention is security-critical; use established patterns |
| Token encryption | Custom crypto | `src/lib/token-vault/` (encrypt/decrypt/rotate) | Already built in Phase 1 with AES-256-GCM |
| Graph API version management | Hardcoded URL strings | `getMetaGraphApiBase()` from `src/lib/meta/graph.ts` | Already centralised with env var override |
| Token exchange flows | New fetch logic | Refactor `src/lib/connections/token-exchange.ts` | V1 logic is correct; just needs storage layer updated |
| Connection health derivation | Custom status logic | Refactor `src/lib/connections/data.ts` | Existing status derivation; update column references |
| GBP location resolution | New Google API client | `src/lib/gbp/business-info.ts` | Already handles rate limits, caching, error parsing |

**Key insight:** The v1 codebase has correct API integration logic for all three platforms. The work is not reimplementing API calls -- it's wrapping them in the adapter interface, fixing the storage layer to use token vault, and adding the missing `oauth_states` table.

## Common Pitfalls

### Pitfall 1: V2 Schema Mismatch with V1 Code
**What goes wrong:** The v1 connection actions (`src/app/(app)/connections/actions.ts`) query columns (`access_token`, `refresh_token`, `metadata`, `display_name`, `last_synced_at`, `expires_at`) that do NOT exist in the v2 baseline schema. Running these actions against v2 DB will fail silently (isSchemaMissingError handlers catch and return fallbacks).
**Why it happens:** Phase 1 built a clean v2 schema but didn't rewrite all v1 action code to match.
**How to avoid:** Audit every query in connection actions against the actual v2 schema before modifying. Map v1 columns to v2 equivalents: `access_token` -> token_vault, `display_name` -> `platform_account_name`, `metadata` -> needs new migration or JSONB column, `expires_at` -> `token_expires_at`.
**Warning signs:** Server actions returning fallback data instead of real data; `isSchemaMissingError` handlers firing in production logs.

### Pitfall 2: Missing oauth_states Table
**What goes wrong:** The OAuth connect flow stores state in an `oauth_states` table that does not exist in any v2 migration. The OAuth callback route and `completeConnectionOAuth` action both read/write this table.
**Why it happens:** V1 had this table; the v2 greenfield baseline intentionally excluded non-core tables for later phases.
**How to avoid:** Create a migration for `oauth_states` as the first task in this phase. Schema: `id uuid PK, state text UNIQUE, provider platform, auth_code text, error text, redirect_to text, used_at timestamptz, created_at timestamptz DEFAULT now()`.
**Warning signs:** OAuth callback returning 500 errors; "relation oauth_states does not exist" in logs.

### Pitfall 3: Facebook Page Tokens vs User Tokens
**What goes wrong:** Developers store long-lived user tokens (60-day expiry) and treat them like page tokens. Page tokens derived from long-lived user tokens do NOT expire, but user tokens do.
**Why it happens:** Confusing token types in Facebook's documentation.
**How to avoid:** The v1 `exchangeFacebookFamilyCode` already correctly exchanges for a long-lived user token then fetches page tokens. For Facebook connections, store the PAGE access token (which doesn't expire) and mark `token_expires_at` as null. For Instagram, the token IS the page token but Instagram API calls need the IG business account ID from metadata.
**Warning signs:** Facebook publishing working for 60 days then suddenly failing with auth errors.

### Pitfall 4: GBP Access Token 1-Hour TTL
**What goes wrong:** GBP access tokens expire after exactly 1 hour. If you cache/store them and don't refresh just-in-time, publish calls fail.
**Why it happens:** Google OAuth2 issues short-lived access tokens by design.
**How to avoid:** Before every GBP API call, check `token_expires_at`. If within 5 minutes of expiry (or expired), use the refresh token to get a new access token. Store the refreshed access token back in token_vault. The v1 code already stores refresh tokens for GBP.
**Warning signs:** GBP publishing working once then failing on subsequent attempts hours later.

### Pitfall 5: Instagram Content Publishing Two-Step Flow
**What goes wrong:** Developers try to publish to Instagram in a single API call. Instagram requires a two-step process: (1) create a media container, (2) publish the container.
**Why it happens:** Facebook's single-call publish is simpler; developers assume Instagram works the same way.
**How to avoid:** Instagram adapter must implement the two-step flow: POST to `/{ig-user-id}/media` to get a container ID, then POST to `/{ig-user-id}/media_publish` with the container ID. For stories, set `media_type=STORIES`. For carousels, create children containers first then a carousel container.
**Warning signs:** 400 errors from Instagram API; "Object does not exist" errors.

### Pitfall 6: Rate Limit Counter Drift in Serverless
**What goes wrong:** In-memory rate limit counters (like the existing `quotaCooldownByService` Map in `business-info.ts`) reset on every cold start in serverless environments, leading to over-requesting.
**Why it happens:** Vercel serverless functions are stateless; module-level Maps don't persist.
**How to avoid:** Store rate limit counters in the database with a `provider_rate_limits` table. Use database for ground truth; in-memory as fast-path cache within a single invocation.
**Warning signs:** 429 errors from platforms despite rate limit "tracking" showing available capacity.

## Code Examples

### Facebook Graph API: Publish Post to Page
```typescript
// Source: Facebook Pages API docs (https://developers.facebook.com/docs/pages-api/posts/)
const GRAPH_BASE = getMetaGraphApiBase(); // e.g., https://graph.facebook.com/v24.0

// Text-only post
const response = await fetch(`${GRAPH_BASE}/{page-id}/feed`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'Post text here',
    access_token: pageAccessToken,
  }),
});
// Returns: { id: "{page-id}_{post-id}" }

// Photo post
const photoResponse = await fetch(`${GRAPH_BASE}/{page-id}/photos`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: 'https://example.com/image.jpg', // or use source for upload
    caption: 'Photo caption',
    access_token: pageAccessToken,
  }),
});
```

### Instagram Content Publishing API: Two-Step Publish
```typescript
// Source: Instagram Platform docs (https://developers.facebook.com/docs/instagram-platform/content-publishing/)

// Step 1: Create media container
const containerResponse = await fetch(`${GRAPH_BASE}/{ig-user-id}/media`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    image_url: 'https://example.com/image.jpg',
    caption: 'Post caption #hashtag',
    access_token: pageAccessToken,
  }),
});
const { id: containerId } = await containerResponse.json();

// Step 2: Publish the container
const publishResponse = await fetch(`${GRAPH_BASE}/{ig-user-id}/media_publish`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    creation_id: containerId,
    access_token: pageAccessToken,
  }),
});
// Returns: { id: "{ig-media-id}" }

// Story: same flow but add media_type=STORIES in step 1
```

### GBP Local Posts API: Standard, Event, Offer
```typescript
// Source: GBP API docs (https://developers.google.com/my-business/content/posts-data)
const GBP_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1';

// Standard post
const standardPost = await fetch(`${GBP_BASE}/{location-name}/localPosts`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    languageCode: 'en',
    summary: 'Post text (max 1500 chars)',
    topicType: 'STANDARD',
    media: [{ mediaFormat: 'PHOTO', sourceUrl: 'https://...' }],
  }),
});

// Event post -- includes eventDetails
// topicType: 'EVENT', event: { title, schedule: { startDate, startTime, endDate, endTime } }

// Offer post -- includes offerDetails
// topicType: 'OFFER', offer: { couponCode, redeemOnlineUrl, termsConditions }
```

### GBP Just-In-Time Token Refresh
```typescript
// Source: Google OAuth2 docs (https://developers.google.com/identity/protocols/oauth2)
async function refreshGbpAccessToken(connectionId: string): Promise<string> {
  const refreshToken = await getDecryptedToken(connectionId, 'refresh');
  
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.server.GOOGLE_MY_BUSINESS_CLIENT_ID,
      client_secret: env.server.GOOGLE_MY_BUSINESS_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  
  const data = await response.json();
  if (!response.ok) throw new ProviderError('GBP token refresh failed', 'gbp', ErrorClassification.AUTH, false);
  
  // Store new access token in vault
  const encrypted = encrypt(data.access_token);
  const supabase = createServiceSupabaseClient();
  await supabase.from('token_vault')
    .upsert({
      social_connection_id: connectionId,
      token_type: 'access',
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag,
      key_version: encrypted.keyVersion,
    }, { onConflict: 'social_connection_id,token_type' });
  
  // Update expires_at on social_connections
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
  await supabase.from('social_connections')
    .update({ token_expires_at: expiresAt })
    .eq('id', connectionId);
  
  return data.access_token;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Graph API v21 | Graph API v24+ (v25 latest) | Oct 2025 (v24), Feb 2026 (v25) | Codebase already defaults to v24.0; safe |
| Instagram Graph API (legacy) | Instagram Platform API | 2024 | New apps must use Content Publishing API; v1 code already uses this |
| GBP My Business API v4 | Business Profile APIs (split into multiple services) | 2022-2024 | Location management and posting split into separate APIs; v1 code already handles this |
| Plaintext token storage | AES-256-GCM encrypted vault | Phase 1 (2026) | Critical security fix already complete |

**Deprecated/outdated:**
- Instagram Legacy API: fully removed; must use Instagram Graph API (via Facebook Login)
- Facebook FQL: removed years ago; Graph API is the only option
- GBP `v4/accounts/{account}/locations/{location}/localPosts` path: still works but newer endpoints may vary; verify during implementation

## Open Questions

1. **Social connections schema gap: metadata/display_name columns**
   - What we know: V2 schema has `platform_account_name` but not `metadata` JSONB. V1 code extensively uses `metadata` (for `pageId`, `igBusinessId`, `locationId`).
   - What's unclear: Should we add a `metadata jsonb` column to `social_connections` via migration, or store platform-specific IDs in separate columns?
   - Recommendation: Add `metadata jsonb DEFAULT '{}'` column via new migration. This matches the v1 pattern, is flexible for future providers, and avoids breaking the existing v1 code paths during transition. Add `display_name text`, `last_synced_at timestamptz` columns in the same migration.

2. **Instagram Stories API reliability**
   - What we know: STATE.md flags "Instagram Stories API reliability conflicted across sources -- needs spike during Phase 3". Stories publish via `media_type=STORIES` in the Content Publishing API.
   - What's unclear: Whether stories via API are reliable for all account types and media formats.
   - Recommendation: Implement story publishing as part of the Instagram adapter but add a feature flag (`ENABLE_IG_STORIES_PUBLISH`) defaulting to `true`. If issues arise, flag can be flipped without code change.

3. **Meta App Review for instagram_content_publish**
   - What we know: STATE.md notes "Meta app review for `instagram_content_publish` scope should begin during Phase 3". The v1 OAuth scopes already include this.
   - What's unclear: Whether the app already has approval or needs fresh review for v2.
   - Recommendation: Check Meta App Dashboard for current app review status. If not approved, submit during Phase 3. The adapter code can be built and tested with a test account before approval.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/lib/connections/`, `src/lib/meta/`, `src/lib/gbp/`, `src/lib/token-vault/`
- Codebase analysis: `supabase/migrations/00000000000000_baseline.sql` -- v2 schema
- Codebase analysis: `src/app/(app)/connections/actions.ts` -- v1 action patterns
- Codebase analysis: `src/app/api/cron/notify-expiring-connections/route.ts` -- existing cron pattern

### Secondary (MEDIUM confidence)
- Facebook Pages API docs: https://developers.facebook.com/docs/pages-api/posts/
- Instagram Content Publishing API: https://developers.facebook.com/docs/instagram-platform/content-publishing/
- Google Business Profile API: https://developers.google.com/my-business/content/posts-data
- Facebook token docs: https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/
- Google OAuth2: https://developers.google.com/identity/protocols/oauth2
- Graph API rate limits: https://developers.facebook.com/docs/graph-api/overview/rate-limiting/

### Tertiary (LOW confidence)
- Instagram 200 req/hr rate limit change (2025): multiple third-party sources report this but official Meta docs don't clearly state the number
- GBP daily quota specifics: official docs reference QPM/QPD but exact numbers require checking the Google Cloud Console quotas page

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies needed, all libraries already in project
- Architecture: HIGH -- adapter pattern well-understood, v1 code provides clear implementation reference
- Pitfalls: HIGH -- schema mismatch verified by direct code inspection, all claims backed by codebase analysis
- API specifics: MEDIUM -- API endpoints verified via official docs, but exact rate limit numbers for IG and GBP have some uncertainty

**Research date:** 2026-05-19
**Valid until:** 2026-06-19 (stable domain; API versions change quarterly)
