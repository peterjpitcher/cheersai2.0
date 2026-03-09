# 05 — Platform Integrations Redesign

**Document status:** planning only — no source files have been modified
**Audit date:** 2026-03-05
**Reviewed files:**
- `src/lib/connections/oauth.ts`
- `src/lib/connections/token-exchange.ts`
- `src/lib/connections/data.ts`
- `src/lib/connections/metadata.ts`
- `src/lib/connections/diagnostics.ts`
- `src/lib/meta/graph.ts`
- `src/lib/publishing/queue.ts`
- `src/lib/publishing/preflight.ts`
- `src/app/api/oauth/[provider]/callback/route.ts`
- `src/app/(app)/connections/actions.ts`
- `src/app/(app)/connections/page.tsx`
- `src/features/connections/connection-oauth-handler.tsx`
- `src/features/connections/connection-oauth-button.tsx`
- `src/features/connections/connection-diagnostics.tsx`
- `supabase/functions/publish-queue/index.ts`
- `supabase/functions/publish-queue/worker.ts`
- `supabase/functions/publish-queue/metadata.ts`
- `supabase/functions/publish-queue/providers/types.ts`
- `supabase/functions/publish-queue/providers/facebook.ts`
- `supabase/functions/publish-queue/providers/instagram.ts`
- `supabase/functions/publish-queue/providers/gbp.ts`
- `supabase/functions/publish-queue/providers/plan.md`
- `supabase/functions/publish-queue/providers/backlog.md`
- `docs/integration-spec.md`
- `docs/technical-design.md`

---

## 1. Current Integrations Audit

### 1.1 Architecture Overview

The system has two separate runtime contexts for platform logic:

1. **Next.js / Node.js runtime** (`src/lib/connections/`, `src/app/api/oauth/`): handles OAuth flows, token exchange, connection storage, and publish preflight checks.
2. **Supabase Edge Function (Deno runtime)** (`supabase/functions/publish-queue/`): the actual publisher — picks jobs from a queue, calls provider APIs, records results.

The two runtimes have independent type definitions and utility functions. The Edge Function's `providers/types.ts` duplicates the `ProviderPlatform` union type that is already defined in `src/lib/connections/oauth.ts`. Error formatters (`formatGraphError`, `resolveGraphError`) are duplicated across `token-exchange.ts` and the Facebook/Instagram provider files. This is a significant coherence gap: a type or API version change must be applied in two places.

Provider routing within the worker uses a plain switch statement in `worker.ts` (`publishByPlatform`) rather than a registered adapter map, meaning adding a provider requires editing the core worker.

### 1.2 Facebook

**What works:**
- OAuth URL construction uses `graph.facebook.com/{version}/dialog/oauth` via `getMetaOAuthBase()` with correct scopes: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_manage_metadata`, `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `business_management`.
- Short-lived token is immediately exchanged for a long-lived token (60-day) via `fb_exchange_token` grant. This is correctly implemented in `exchangeLongLivedFacebookToken`.
- Page token (not user token) is stored: `token-exchange.ts` calls `GET /me/accounts` and extracts per-page `access_token`. This is correct — page tokens are necessary for posting and are themselves long-lived.
- `pageId` is stored in `social_connections.metadata.pageId`.
- The publisher (`facebook.ts`) supports: text-only feed posts, single image feed posts via `/{pageId}/photos`, and image stories via the two-step `/{pageId}/photos?published=false` then `/{pageId}/photo_stories` flow.
- External post ID is captured (`id` or `post_id` from response) and stored in `publish_jobs.provider_response` via `markJobSucceeded`.
- Graph API version is configurable via `META_GRAPH_VERSION` env var, defaulting to `v24.0`.

**What is missing / risky:**
- **Multi-image / carousel posts:** Not implemented. The feed publisher uses only `payload.media[0]`. The integration spec calls for carousel support (up to 10 items via `/{page-id}/feed` with `attached_media[]`).
- **Video posts:** Not implemented. The spec references `POST /{page-id}/videos` but the adapter falls back to text-only feed post when `media[0].mediaType !== 'image'`.
- **Facebook Events:** Not implemented. `POST /{page-id}/events` is described in the integration spec but no adapter code exists. The `pages_manage_events` scope is also absent from `FACEBOOK_SCOPES` in `oauth.ts` — event creation would fail even if added.
- **Story video:** Only image stories are supported. The integration spec describes video stories with a 20-second limit.
- **No 429 / rate-limit detection in the publisher:** The Facebook adapter throws a generic error on any non-OK response. If the response is HTTP 429, the worker's retry logic will re-schedule — but no backoff specific to rate limiting is applied, and the `Retry-After` header is not read.
- **Token refresh:** Facebook page tokens do not support refresh tokens — they must be reissued by the user completing the OAuth flow. The adapter correctly stores `refreshToken: null` for Facebook. However, there is no proactive mechanism to re-exchange a 60-day token before it expires; the nightly health check sets status to `expiring` within 5 days but does not automatically extend the token.
- **`@ts-nocheck` in provider files:** Both `facebook.ts` and `instagram.ts` begin with `// @ts-nocheck`. This disables type-checking for the entire file, which is a significant quality risk in production code.
- **State parameter validation gap:** The callback handler (`route.ts`) checks that the `state` query param exists but does not verify it was generated by the current session (no CSRF binding to a cookie or session). The state is a UUID stored in `oauth_states`; the lookup validates it was created by the application, which is the important check. The risk is low but worth noting: if an `oauth_states` row could be guessed or leaked, a replay is conceivable. Binding state to a short-lived signed cookie would eliminate this.

### 1.3 Instagram

**What works:**
- Instagram uses the same Facebook App OAuth flow (same `client_id`, same `getMetaOAuthBase()`). The separation into a distinct `instagram` provider is correct because it stores different credentials: a page token with `igBusinessId` metadata rather than `pageId`.
- `token-exchange.ts` correctly navigates: user token → `/me/accounts` → find pages with `instagram_business_account` linked → store `pageId` (the linked Facebook page token) and `igBusinessId` (the IG business account ID). This models the relationship correctly.
- The publisher uses the two-step Instagram Graph API flow: `POST /{igBusinessId}/media` (create container) then `POST /{igBusinessId}/media_publish` (publish). It polls `GET /{creationId}?fields=status_code,status` up to 10 times with a configurable delay (default 2 seconds). This correctly handles the asynchronous media processing.
- Stories are supported via `media_type=STORIES` on the container creation call.
- External media ID is captured from the publish response.

**What is missing / risky:**
- **Carousel posts:** Not implemented. The `INSTAGRAM_SCOPES` set matches what is needed for carousels, but the adapter only handles single-image posts.
- **Video posts:** `instagram.ts` throws immediately if `media[0].mediaType !== 'image'`. The integration spec describes video support up to 60 seconds for feed and 15 seconds for stories.
- **No `instagram_manage_insights` scope:** The integration spec lists this as optional but it is needed for analytics features. Currently absent.
- **Token model confusion:** Instagram does not have its own refresh token — it relies on the Facebook page token, which is long-lived. The system stores `refreshToken: null` for Instagram. This is correct but undocumented; the connection UI shows a "refresh token" column in diagnostics which is always `–` for Instagram, which could confuse operators.
- **Caption truncation:** The spec states captions are capped at 2,200 characters. No truncation guard exists in the Instagram adapter — an oversized caption will result in an API error rather than a clean pre-publish failure.
- **`@ts-nocheck`** is present, same risk as Facebook.
- **Media status polling inside the Edge Function:** The `waitForMediaReady` function does synchronous polling with `setTimeout` inside the Deno Edge Function. Deno Edge Functions have a CPU time budget. For video containers this could time out. A better design would enqueue a polling job rather than block.

### 1.4 Google Business Profile (GBP)

**What works:**
- Google OAuth uses `access_type: offline` and `prompt: consent`, which correctly forces a refresh token to be returned on first authorisation.
- Refresh token is stored (`refresh_token` column). This is the only provider that stores a real refresh token.
- `locationId` is resolved during token exchange by iterating `mybusinessbusinessinformation.googleapis.com/v1/accounts` → `/{account}/locations`. A 5-minute in-process cache reduces repeated lookups during reconnect flows.
- The GBP publisher correctly targets `mybusiness.googleapis.com/v4/{locationId}/localPosts` with a JSON body containing `languageCode`, `summary`, and optional `media`.
- Text is truncated to 1,500 characters in the adapter.
- Stories are rejected immediately (`placement !== 'feed'` check).
- External post `name` (e.g. `locations/12345/localPosts/67890`) is captured as `externalId`.

**What is missing / risky:**
- **No GBP refresh token is ever used.** The refresh token is stored but there is no code path that calls `https://oauth2.googleapis.com/token` with `grant_type=refresh_token`. The worker's `isConnectionUsable` check marks a connection invalid if `expires_at <= now` and leaves `retryable: false`, causing the job to fail permanently. Google access tokens expire in 3,600 seconds (1 hour). Without automated refresh, every GBP publish job that runs more than 1 hour after the last user interaction will fail.
- **GBP API version is hardcoded to v4** (`const GBP_BASE = "https://mybusiness.googleapis.com/v4"`). The currently active GBP API versions are: `mybusiness.googleapis.com/v4/localPosts` (still functional but Google has been migrating to the newer My Business APIs split into `mybusinessinformation`, `mybusinesspostings`, etc.). The token-exchange code already uses `mybusinessbusinessinformation.googleapis.com/v1/` for account/location discovery. The publisher and the discovery code are targeting different API generations.
- **No Event or Offer post types.** The adapter always sends `topicType: "STANDARD"`. The integration spec describes Event posts (with `topicType: "EVENT"`, `event.schedule.startDateTime`, `event.schedule.endDateTime`) and Offer posts (`topicType: "OFFER"`, with `couponCode`, `redeemOnlineUrl`, `termsConditions`). Neither is implemented.
- **No CTA button.** GBP posts support `callToAction` with `actionType` values (`CALL`, `BOOK`, `ORDER`, `LEARN_MORE`, `SIGN_UP`, `SHOP`, `GET_OFFER`). The adapter posts without any CTA. The integration spec notes this should be sourced from `brand_profile.gbp_cta` / posting defaults.
- **Video media is silently dropped.** `buildMediaAttachments` filters to `item.mediaType === "image"` only. Video assets are ignored without error.
- **Quota handling in token exchange:** The `resolveGoogleLocation` function has 429/quota detection but returns a cached fallback rather than failing loudly. This can result in a stale `locationId` being stored silently.

### 1.5 Cross-Cutting Issues

| Issue | Detail |
|---|---|
| No webhook support | All three providers support webhooks for publish confirmation and reach events. None are registered or handled. Status tracking relies solely on the synchronous API response at publish time. |
| No proactive token refresh | Facebook/Instagram: no refresh token — relies on user reconnect. GBP: refresh token exists but is never used. Nightly health check only sets `expiring` status; it does not extend tokens. |
| No API rate limit tracking | No counter tracks calls against Facebook's Business Use Case limits (BUC), Instagram's per-account container creation limits, or GBP's per-day post limits. 429 responses trigger a generic retry with the standard backoff. |
| Retry not classified by error type | Worker detects auth failures via regex on the error message string. Rate limits (429), transient server errors (5xx), and non-retryable content rejections (e.g. policy violation) all fall into the same retry path unless the regex matches. |
| OAuth state not session-bound | State UUIDs are stored in `oauth_states` without a binding to the user's browser session (no cookie). The callback route looks up the state in the DB and trusts it. This is functionally correct but does not defend against state fixation. |
| Token storage not encrypted | The integration spec requires AES-256-GCM encryption for tokens at rest. The `social_connections` table stores `access_token` and `refresh_token` as plaintext. Supabase AES-256 encryption is available via `pgcrypto` or column-level encryption extensions. |
| `@ts-nocheck` in two provider files | Deno Edge Function providers `facebook.ts` and `instagram.ts` both suppress TypeScript type-checking. This must be eliminated in the rebuild. |

---

## 2. Provider Abstraction Layer Design

### 2.1 Design Goals

- Every provider implements one shared interface. The worker routes by provider ID and calls the same method signatures regardless of which platform is targeted.
- Provider-specific logic (authentication, API shape, media handling) is entirely encapsulated within the adapter module.
- Adding a new provider requires creating a new file and registering it — no existing code is modified.
- The interface is defined once and shared between the Next.js runtime and the Edge Function (via a shared types package or import path).

### 2.2 TypeScript Interface

```typescript
// packages/provider-types/index.ts  (or supabase/functions/_shared/provider.ts)

/** The stable set of platform identifiers. Extend by adding new string literals. */
export type ProviderId = "facebook" | "instagram" | "gbp";

// ─── Shared value types ──────────────────────────────────────────────────────

export interface ProviderMedia {
  id: string;
  url: string;               // signed URL with sufficient TTL for the adapter to fetch
  mediaType: "image" | "video";
  mimeType: string | null;
  widthPx: number | null;
  heightPx: number | null;
  durationSeconds: number | null;
}

export type ContentType =
  | "feed_post"      // standard feed post with optional media
  | "story"          // full-screen ephemeral story
  | "event"          // calendar event with start/end time
  | "offer"          // promotional offer with redemption details
  | "carousel";      // multi-image/video carousel

export interface PublishPayload {
  contentType: ContentType;
  body: string;              // caption / summary text
  media: ProviderMedia[];
  scheduledFor: string | null;   // ISO 8601
  campaignName: string | null;
  promptContext: Record<string, unknown> | null;

  // Type-specific optional fields
  event?: {
    title: string;
    startAt: string;           // ISO 8601
    endAt: string;             // ISO 8601
    locationName?: string;
    ticketUrl?: string;
  };

  offer?: {
    title: string;
    redeemUrl?: string;
    couponCode?: string;
    terms?: string;
    validFrom?: string;        // ISO 8601
    validUntil?: string;       // ISO 8601
  };

  callToAction?: {
    type: string;              // provider-specific CTA token, e.g. "LEARN_MORE", "BOOK"
    url?: string;
  };

  carousel?: {
    items: Array<{
      media: ProviderMedia;
      caption?: string;
    }>;
  };
}

export interface AuthContext {
  connectionId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;    // ISO 8601
  connectionMetadata: Record<string, unknown>;
}

export interface PublishRequest {
  accountId: string;
  contentId: string;
  jobId: string;
  attempt: number;
  payload: PublishPayload;
  auth: AuthContext;
}

export interface PublishSuccess {
  ok: true;
  externalId: string;          // platform-assigned post/story ID
  publishedAt: string;         // ISO 8601
  payloadPreview: string;      // first 140 chars for logging
  rawResponse: unknown;        // full API response for audit trail
}

export interface PublishFailure {
  ok: false;
  errorCode: ProviderErrorCode;
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number;  // honour Retry-After header when available
  rawResponse: unknown;
}

export type PublishResult = PublishSuccess | PublishFailure;

export type ProviderErrorCode =
  | "auth_expired"             // token expired — mark connection needs_action, no retry
  | "auth_revoked"             // permission revoked — mark connection needs_action, no retry
  | "rate_limited"             // 429 — retry with Retry-After or default backoff
  | "content_rejected"         // policy / validation — no retry, surface to user
  | "media_error"              // media fetch or processing failure
  | "provider_error"           // transient 5xx — retry
  | "configuration_error"      // missing metadata or misconfiguration — no retry
  | "unknown";

// ─── OAuth interface ─────────────────────────────────────────────────────────

export interface OAuthConfig {
  authUrl: string;             // constructed authorization URL
  scopes: string[];            // list of requested scopes
  responseType: "code";
  additionalParams: Record<string, string>;
}

export interface TokenExchangeResult {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;    // ISO 8601
  displayName: string | null;
  metadata: Record<string, unknown>;  // provider-specific IDs (pageId, igBusinessId, locationId)
}

export interface TokenRefreshResult {
  accessToken: string;
  expiresAt: string | null;    // ISO 8601
}

// ─── Media requirements ───────────────────────────────────────────────────────

export interface MediaRequirement {
  contentType: ContentType;
  mediaType: "image" | "video" | "either";
  minWidthPx: number;
  minHeightPx: number;
  maxWidthPx: number | null;
  maxHeightPx: number | null;
  aspectRatioMin: number | null;  // width/height, e.g. 1.0 for 1:1
  aspectRatioMax: number | null;
  maxFileSizeBytes: number;
  allowedMimeTypes: string[];
  maxDurationSeconds: number | null;
  maxItemCount: number;           // max number of media items (1 for story, 10 for carousel)
}

// ─── Provider adapter interface ───────────────────────────────────────────────

export interface ProviderAdapter {
  /** Stable identifier matching the ProviderId union. */
  readonly providerId: ProviderId;

  /** Human-readable label for UI display. */
  readonly displayName: string;

  /** Supported content types for this provider. */
  readonly supportedContentTypes: ContentType[];

  /**
   * Build the OAuth authorization URL for this provider.
   * Called server-side when the user clicks "Connect".
   */
  buildAuthUrl(params: {
    state: string;
    redirectUri: string;
    additionalMetadata?: Record<string, unknown>;
  }): OAuthConfig;

  /**
   * Exchange an authorization code for tokens and provider-specific metadata.
   * Called server-side in the OAuth completion flow.
   */
  exchangeCode(params: {
    code: string;
    redirectUri: string;
    existingMetadata: Record<string, unknown> | null;
    existingDisplayName: string | null;
  }): Promise<TokenExchangeResult>;

  /**
   * Refresh an access token using the stored refresh token.
   * Not all providers support this (Facebook page tokens do not).
   * Returns null if the provider does not support refresh.
   */
  refreshToken(params: {
    refreshToken: string;
    connectionMetadata: Record<string, unknown>;
  }): Promise<TokenRefreshResult | null>;

  /**
   * Returns true if this provider supports automated token refresh
   * (i.e. has a non-null refresh_token after OAuth).
   */
  supportsTokenRefresh(): boolean;

  /**
   * Validate that the stored connection metadata is complete and correct.
   * Returns a list of missing or invalid field names (empty = valid).
   */
  validateMetadata(metadata: Record<string, unknown> | null): string[];

  /**
   * Return media requirements for a specific content type.
   * Used by the publish preflight check and the media derivative pipeline.
   */
  mediaRequirements(contentType: ContentType): MediaRequirement | null;

  /**
   * Publish content to the platform.
   * The adapter is responsible for all API calls, error classification,
   * and returning a typed result.
   */
  publish(request: PublishRequest): Promise<PublishResult>;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export type ProviderRegistry = Map<ProviderId, ProviderAdapter>;

export function createProviderRegistry(
  adapters: ProviderAdapter[],
): ProviderRegistry {
  const registry = new Map<ProviderId, ProviderAdapter>();
  for (const adapter of adapters) {
    registry.set(adapter.providerId, adapter);
  }
  return registry;
}

export function getAdapter(
  registry: ProviderRegistry,
  providerId: ProviderId,
): ProviderAdapter {
  const adapter = registry.get(providerId);
  if (!adapter) {
    throw new Error(`No adapter registered for provider: ${providerId}`);
  }
  return adapter;
}
```

### 2.3 Worker Integration Pattern

The publish worker initialises the registry once at startup and then delegates entirely to the adapter:

```typescript
// supabase/functions/publish-queue/worker.ts (rebuild sketch)
import { createProviderRegistry, getAdapter } from "../_shared/provider.ts";
import { FacebookAdapter } from "./providers/facebook.ts";
import { InstagramAdapter } from "./providers/instagram.ts";
import { GbpAdapter } from "./providers/gbp.ts";

const registry = createProviderRegistry([
  new FacebookAdapter(),
  new InstagramAdapter(),
  new GbpAdapter(),
]);

// In handleJob():
const adapter = getAdapter(registry, content.platform);
const result = await adapter.publish(request);

if (!result.ok) {
  const retryable = result.retryable
    && result.errorCode !== "auth_expired"
    && result.errorCode !== "auth_revoked"
    && result.errorCode !== "content_rejected"
    && result.errorCode !== "configuration_error";
  await this.handleFailure({ ..., retryable });
}
```

---

## 3. OAuth and Token Management Design

### 3.1 Per-Provider OAuth Flow

#### Facebook

- **Auth URL:** `https://www.facebook.com/{META_GRAPH_VERSION}/dialog/oauth`
- **Required scopes:** `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_manage_metadata`, `pages_manage_events` (add for event support), `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `business_management`
- **Response type:** `code`
- **Token exchange:** `POST https://graph.facebook.com/{version}/oauth/access_token`
- **Long-lived exchange:** immediately chain with `grant_type=fb_exchange_token` to get a 60-day user token, then call `GET /me/accounts` to get per-page tokens (page tokens inherit the long-lived lifetime and do not expire on a set schedule when generated from a long-lived user token)
- **Refresh strategy:** none — page tokens must be re-issued by the user. Proactive alert at 7 days before expiry; force reconnect at expiry.
- **State validation:** store state UUID in `oauth_states`; also set an `HttpOnly SameSite=Strict` cookie containing the state so the callback can validate that the state was initiated from the same browser session.

#### Instagram

- Identical to Facebook (same App, same auth domain). A separate redirect URI (`/api/oauth/instagram/callback`) allows distinct processing.
- Scopes: same core set. Instagram Business does not require additional scopes beyond the Facebook set that already includes `instagram_basic` and `instagram_content_publish`.
- Post-exchange: navigate `GET /me/accounts` → find pages where `instagram_business_account.id` is present → store `pageId` (the linked Facebook page token) + `igBusinessId`.
- No refresh token. Token lifetime matches the Facebook page token (~60 days from last long-lived exchange).

#### GBP

- **Auth URL:** `https://accounts.google.com/o/oauth2/v2/auth`
- **Required scopes:** `https://www.googleapis.com/auth/business.manage`
- **Additional params:** `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`
- **Token exchange:** `POST https://oauth2.googleapis.com/token` with `grant_type=authorization_code`
- **Refresh:** `POST https://oauth2.googleapis.com/token` with `grant_type=refresh_token`, `refresh_token={stored_token}`, `client_id`, `client_secret`
- Access token TTL: 3,600 seconds (1 hour)
- Refresh tokens are long-lived (months to years) but can be revoked by the user or Google if the application is not used for 6 months (for apps not verified as published)

### 3.2 Facebook Long-Lived Token Exchange

Current implementation is correct. Documenting the exact chain for the rebuild:

```
1. User completes auth → callback receives short-lived code (expires ~10 min)
2. POST /oauth/access_token?code=...&grant_type=... → short-lived user access token (~1-2 hours)
3. GET /oauth/access_token?grant_type=fb_exchange_token&fb_exchange_token={short} → long-lived user token (~60 days)
4. GET /me/accounts?access_token={long_lived_user_token}&fields=id,name,access_token,instagram_business_account{...}
   → per-page access tokens (also long-lived, no fixed expiry when derived from long-lived user token)
5. Store the PAGE access token, not the user token. Set expires_at = now + 60 days as a conservative bound.
```

**Note:** Page tokens created from a long-lived user token do not have a fixed expiry. Meta's documentation states they are "long-lived" but the precise expiry is not guaranteed. Setting `expires_at = now + 55 days` (5-day buffer) and alerting at that point is appropriate.

### 3.3 Instagram Token Handling

Instagram Business publishing requires:
- A **Facebook Page access token** (the token stored as `access_token` in the Instagram connection row)
- The **Instagram Business Account ID** (stored as `metadata.igBusinessId`)

The token is the same Facebook page token used for Facebook publishing — it is not a separate Instagram-issued token. The system correctly models this, but the diagnostics UI should label the Instagram connection's token as "Facebook Page Token (IG Publishing)" to avoid operator confusion.

### 3.4 GBP Refresh Token Flow

This is the most critical missing piece in the current implementation:

```typescript
// To be implemented in GbpAdapter.refreshToken()
async function refreshGbpToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<TokenRefreshResult> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const json = await response.json();

  if (!response.ok) {
    if (json.error === "invalid_grant") {
      // Refresh token revoked or expired — user must reconnect
      throw new AuthRevokedError("GBP refresh token invalid — reconnect required");
    }
    throw new Error(json.error_description ?? "GBP token refresh failed");
  }

  return {
    accessToken: json.access_token,
    expiresAt: new Date(Date.now() + json.expires_in * 1000).toISOString(),
  };
}
```

The worker must call `adapter.refreshToken()` before publishing if `expiresAt <= now` and `refreshToken` is non-null. If refresh fails with `invalid_grant`, the connection is set to `needs_action`.

### 3.5 Token Storage Schema

The `social_connections` table must be extended:

```sql
social_connections (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid references accounts(id) on delete cascade,
  provider          text not null check (provider in ('facebook','instagram','gbp')),
  status            text not null check (status in ('active','expiring','needs_action','disconnected'))
                    default 'needs_action',
  -- Tokens: store encrypted with pgcrypto or application-layer AES-256-GCM
  access_token      text,           -- encrypted
  refresh_token     text,           -- encrypted; null for facebook/instagram
  expires_at        timestamptz,
  -- Display / audit
  display_name      text,
  last_synced_at    timestamptz,
  -- Provider-specific IDs (pageId, igBusinessId, locationId)
  metadata          jsonb,
  -- Audit
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
)
```

**Token encryption:** Implement AES-256-GCM encryption at the application layer before writing to Supabase. Store the encrypted ciphertext as base64 in the text column. The encryption key lives in a server-only environment variable (`TOKEN_ENCRYPTION_KEY`). Decryption happens in the worker and in server actions — never in client components.

### 3.6 Proactive Refresh Strategy

```
For each provider, define:
  REFRESH_LEAD_DAYS: number of days before expiry to begin refresh/alert

  facebook: REFRESH_LEAD_DAYS = 7  (alert only — no automated refresh)
  instagram: REFRESH_LEAD_DAYS = 7  (alert only — no automated refresh)
  gbp: REFRESH_LEAD_DAYS = 0  (automated refresh; lead = 0 means refresh on any expired token)

Nightly cron (separate from publish-queue):
  1. Query all social_connections where expires_at < now() + REFRESH_LEAD_DAYS
  2. For each:
     a. If adapter.supportsTokenRefresh() and refresh_token is non-null:
        - Call adapter.refreshToken()
        - On success: update access_token, expires_at, status = 'active'
        - On invalid_grant: set status = 'needs_action', send alert
     b. Else (facebook/instagram):
        - If expires_at < now(): set status = 'needs_action', send reconnect alert
        - If expires_at < now() + REFRESH_LEAD_DAYS: set status = 'expiring', send warning

GBP also requires just-in-time refresh in the publish worker:
  - Before calling adapter.publish(), check if expiresAt <= now
  - If yes and supportsTokenRefresh(): call adapter.refreshToken(), update DB, proceed
  - If refresh fails: mark connection needs_action, fail job non-retryably
```

---

## 4. Publish Pipeline Design

### 4.1 Unified Publish Interface

**Input shape (PublishRequest — defined in section 2.2)**

Key fields for the rebuild:
- `contentType: ContentType` — replaces the current `placement: "feed" | "story"` binary; allows routing to event/offer/carousel adapters
- `payload.callToAction` — structured CTA, sourced from `brand_profile.gbp_cta` and campaign-level overrides
- `payload.event` / `payload.offer` — type-specific data passed through to provider adapters

**Output shape:**

```typescript
// Success
{
  ok: true,
  externalId: string,       // stored in publish_jobs.provider_response.externalId
  publishedAt: string,
  payloadPreview: string,
  rawResponse: unknown      // full API JSON for audit
}

// Failure
{
  ok: false,
  errorCode: ProviderErrorCode,
  message: string,
  retryable: boolean,
  retryAfterSeconds?: number,
  rawResponse: unknown
}
```

**Error shape stored in `publish_jobs`:**

```typescript
// publish_jobs columns:
{
  status: "queued" | "in_progress" | "succeeded" | "failed",
  attempt: number,
  last_error: string,            // human-readable message
  last_error_code: string,       // ProviderErrorCode value
  next_attempt_at: timestamptz,
  provider_response: jsonb,      // full PublishResult.rawResponse on success or failure
  external_post_id: text,        // denormalised from provider_response.externalId on success
}
```

Add `external_post_id` and `last_error_code` columns to `publish_jobs`. The `external_post_id` column allows quick lookups without JSON parsing.

### 4.2 Content Type Matrix

| Provider | feed_post | story | event | offer | carousel |
|---|---|---|---|---|---|
| Facebook | Yes (image, video, text-only) | Yes (image; video planned) | Yes (requires `pages_manage_events` scope) | No | Yes (up to 10 via `attached_media[]`) |
| Instagram | Yes (image, video up to 60s) | Yes (image, video up to 15s) | No | No | Yes (up to 10 via carousel container) |
| GBP | Yes (STANDARD topicType) | No | Yes (EVENT topicType with schedule) | Yes (OFFER topicType) | No |

**Scope additions required for full matrix:**
- Facebook events: add `pages_manage_events` to `FACEBOOK_SCOPES`
- Instagram video: no scope change; requires media container with `video_url` instead of `image_url` and polling until `FINISHED`
- GBP events and offers: no scope change; requires `topicType` field and type-specific body fields in the request

### 4.3 Media Pre-Processing Requirements

These requirements must be enforced both at the publish preflight check (before scheduling) and by the media derivative pipeline (before the derivative is marked ready).

#### Facebook

| Content Type | Media Type | Aspect Ratio | Min Dimensions | Max File Size | Formats |
|---|---|---|---|---|---|
| feed_post | image | 1.91:1 to 4:5 | 600×315 px | 4 MB | JPEG, PNG |
| feed_post | video | 9:16 to 16:9 | 1280×720 px recommended | 1 GB | MP4 (H.264) |
| story | image | 9:16 (1080×1920) | 500×889 px | 4 MB | JPEG, PNG |
| story | video | 9:16 | 1080×1920 recommended | 250 MB | MP4 (H.264), max 20s |
| carousel | image | 1:1 recommended | 600×600 px | 4 MB per item | JPEG, PNG |

#### Instagram

| Content Type | Media Type | Aspect Ratio | Min Resolution | Max File Size | Notes |
|---|---|---|---|---|---|
| feed_post | image | 4:5 to 1.91:1 | 1080 px shortest side | 8 MB | JPEG, PNG |
| feed_post | video | 4:5 to 16:9 | 1080 px recommended | 1 GB | MP4, max 60s |
| story | image | 9:16 | 1080×1920 recommended | 8 MB | JPEG, PNG |
| story | video | 9:16 | 1080×1920 recommended | 250 MB | MP4, max 15s per segment |
| carousel | image | 1:1 or 4:5 (all same) | 1080 px | 8 MB per item | Up to 10 items |

#### GBP

| Content Type | Media Type | Min Dimensions | Max File Size | Notes |
|---|---|---|---|---|
| feed_post / event / offer | image | 720×720 px (1200×900 recommended) | 5 MB | JPEG, PNG |
| feed_post | video | 720p | 75 MB | Max 30s |

The `media_derivatives` pipeline should produce the following named variants per uploaded asset:
- `feed` — 1080×1080 square (safe for all feed posts)
- `feed_landscape` — 1200×628 (Facebook link share aspect)
- `story` — 1080×1920 vertical
- `gbp` — 1200×900 landscape

### 4.4 Retry and Backoff Strategy

```
Default retry schedule (configurable via PUBLISH_RETRY_MINUTES env):
  Attempt 1: immediate (next_attempt_at = now)
  Attempt 2: now + 5 minutes
  Attempt 3: now + 15 minutes
  Attempt 4: now + 30 minutes (terminal — mark failed after this)

Per error code:
  rate_limited:     honour Retry-After header if present; otherwise use 60 minutes minimum
  provider_error:   use default backoff schedule
  auth_expired:     no retry; set connection needs_action immediately; send alert
  auth_revoked:     no retry; set connection needs_action immediately; send alert
  content_rejected: no retry; surface error to user via notification
  media_error:      retry up to maxVariantRetries (currently 3) with 45s delay; then fail
  configuration_error: no retry

For GBP: before marking auth_expired as terminal, attempt one token refresh.
If refresh succeeds, reset the error and retry immediately (counts as attempt 1).
```

### 4.5 External ID Storage and Publish Status Tracking

On success, record:
```sql
UPDATE publish_jobs SET
  status = 'succeeded',
  external_post_id = '{externalId from PublishSuccess}',
  provider_response = '{full rawResponse JSON}',
  updated_at = now()
WHERE id = '{jobId}';

UPDATE content_items SET
  status = 'posted',
  updated_at = now()
WHERE id = '{contentId}';

INSERT INTO notifications (account_id, category, message, metadata) VALUES
  ('{accountId}', 'publish_success', 'Posted to {provider}', '{"externalId": ..., "jobId": ...}');
```

The `external_post_id` column (to be added) allows:
- Linking to the live post for manual verification
- Deduplication checks before re-publishing on retry
- Future analytics queries against provider webhook events

### 4.6 Fallback: Downloadable Asset Package

When all retries are exhausted (`status = 'failed'`):

1. Collect: caption text, all media asset signed URLs (24-hour TTL), provider name, scheduled time.
2. Generate a JSON manifest:
   ```json
   {
     "provider": "facebook",
     "contentType": "feed_post",
     "scheduledFor": "2026-03-05T10:00:00Z",
     "body": "...",
     "media": [{ "url": "...", "type": "image" }],
     "manualInstructions": "..."
   }
   ```
3. Insert a `notifications` row with `category: 'publish_failed_fallback'` containing the manifest.
4. The UI surfaces this as a downloadable package with provider-specific manual posting instructions.

Implementation: a server action `generateFallbackPackage(jobId)` that reads the failed job and variant, signs media URLs, and returns a structured payload for client download.

---

## 5. Rate Limiting Strategy

### 5.1 Known Rate Limits

#### Facebook Graph API (v24.0)

| Limit type | Value | Notes |
|---|---|---|
| App-level | 200 calls per hour per user token | Business Use Case (BUC) limits apply per app |
| Page publishing | No explicit post-per-day limit documented, but practical limit ~25 posts/day per page before quality signals degrade | |
| Photo uploads | Part of app-level call limit | Each `/photos` call counts |
| Stories | Undocumented per-day limit; in practice ≤5 stories/day recommended | |
| Rate limit response | HTTP 429 or error code 4 (`OAuthException`) with `error.code = 4` or `error.code = 17` | Response headers: `X-Business-Use-Case-Usage`, `X-App-Usage` |

#### Instagram Graph API

| Limit type | Value | Notes |
|---|---|---|
| Container creation | 25 per 24 hours per user | Per Instagram Business Account ID |
| Media publish | 25 per 24 hours per user | Matches container limit |
| Rate limit response | HTTP 429, error code 4 (BUC limit) or `error.code = 32` (account-level limit) | |
| Carousel items | 10 per carousel | Hard limit |
| Caption length | 2,200 characters | Soft truncation warning at 125 |

#### Google Business Profile API

| Limit type | Value | Notes |
|---|---|---|
| localPosts.create | ~20 posts per location per day | Approximate; exact quota undocumented |
| API quota | 1,500 requests per day (free tier); higher for verified apps | Managed via Google Cloud Console |
| Rate limit response | HTTP 429, `error.status = "RESOURCE_EXHAUSTED"` | |
| Token introspection / info | ~1,000 requests per day | Applies to account/location discovery calls |

### 5.2 Rate Limit Tracking

Introduce a `provider_rate_limits` table:

```sql
provider_rate_limits (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid references accounts(id) on delete cascade,
  provider        text not null,
  bucket          text not null,    -- e.g. 'container_creation', 'post_publish', 'api_calls'
  window_start    timestamptz not null,
  window_end      timestamptz not null,
  count           integer not null default 0,
  limit_value     integer not null,
  updated_at      timestamptz default now(),
  unique (account_id, provider, bucket, window_start)
)
```

The publish worker increments the relevant bucket counter after each successful API call. Before publishing, the worker checks if the bucket is at its limit for the current window and, if so, defers the job with `next_attempt_at = window_end`.

Additionally, parse rate limit headers from API responses:
- **Facebook:** `X-App-Usage` and `X-Business-Use-Case-Usage` headers contain JSON with `call_count`, `total_time`, `total_cputime` percentages
- **Instagram:** Same headers as Facebook (same Graph API infrastructure)
- **GBP:** No equivalent headers; rely on 429 response status and `Retry-After` header

### 5.3 Backoff Implementation

```typescript
function resolveRetryDelay(
  result: PublishFailure,
  attempt: number,
  defaultBackoffMinutes: number[],
): number {
  if (result.errorCode === "rate_limited") {
    // Honour Retry-After if present (in seconds)
    if (result.retryAfterSeconds && result.retryAfterSeconds > 0) {
      return result.retryAfterSeconds;
    }
    // Default: 60 minutes for rate limits, regardless of attempt count
    return 60 * 60;
  }

  // Exponential-ish via configured steps
  const index = Math.min(Math.max(attempt - 1, 0), defaultBackoffMinutes.length - 1);
  return defaultBackoffMinutes[index] * 60;
}
```

Each adapter must classify 429 responses as `rate_limited` and parse the `Retry-After` header:

```typescript
// In adapter.publish() error handling:
if (response.status === 429) {
  const retryAfter = parseInt(response.headers.get("Retry-After") ?? "", 10);
  return {
    ok: false,
    errorCode: "rate_limited",
    message: "Rate limit reached",
    retryable: true,
    retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
    rawResponse: json,
  };
}
```

---

## 6. Adding a New Provider

The following steps describe how to add a new provider (e.g. TikTok, LinkedIn) without modifying any existing provider code.

### Step 1: Extend the provider type union

In `packages/provider-types/index.ts` (shared types):

```typescript
export type ProviderId = "facebook" | "instagram" | "gbp" | "tiktok";
```

Update `social_connections.provider` CHECK constraint in a new migration:
```sql
ALTER TABLE social_connections
  DROP CONSTRAINT social_connections_provider_check,
  ADD CONSTRAINT social_connections_provider_check
    CHECK (provider IN ('facebook','instagram','gbp','tiktok'));
```

### Step 2: Create the adapter file

Create `supabase/functions/publish-queue/providers/tiktok.ts`:

```typescript
import type { ProviderAdapter, PublishRequest, PublishResult, /* ... */ } from "../_shared/provider.ts";

export class TikTokAdapter implements ProviderAdapter {
  readonly providerId = "tiktok" as const;
  readonly displayName = "TikTok for Business";
  readonly supportedContentTypes = ["feed_post", "story"] as const;

  buildAuthUrl(...) { /* TikTok OAuth 2.0 */ }
  async exchangeCode(...) { /* TikTok token exchange */ }
  async refreshToken(...) { /* TikTok supports refresh tokens */ }
  supportsTokenRefresh() { return true; }
  validateMetadata(metadata) { /* check for creatorId */ }
  mediaRequirements(contentType) { /* TikTok-specific limits */ }
  async publish(request: PublishRequest): Promise<PublishResult> {
    /* Call TikTok Content Posting API */
  }
}
```

### Step 3: Register the adapter in the worker

```typescript
// supabase/functions/publish-queue/worker.ts
import { TikTokAdapter } from "./providers/tiktok.ts";

const registry = createProviderRegistry([
  new FacebookAdapter(),
  new InstagramAdapter(),
  new GbpAdapter(),
  new TikTokAdapter(),   // add this line only
]);
```

### Step 4: Add OAuth URL builder in the server-side OAuth module

Create (or extend) a provider configuration map in `src/lib/connections/providers/tiktok.ts` implementing the same interface used by `oauth.ts`. Register it in `src/lib/connections/oauth.ts`'s `buildOAuthRedirectUrl` function, or better — migrate to a registry pattern there too:

```typescript
// src/lib/connections/oauth.ts (rebuild)
const providerAdapters = new Map<Provider, ServerProviderAdapter>([
  ["facebook", new FacebookServerAdapter()],
  ["instagram", new InstagramServerAdapter()],
  ["gbp", new GbpServerAdapter()],
  ["tiktok", new TikTokServerAdapter()],
]);

export function buildOAuthRedirectUrl(provider: Provider, state: string) {
  const adapter = providerAdapters.get(provider);
  if (!adapter) throw new Error(`Unsupported provider: ${provider}`);
  return adapter.buildAuthUrl({ state, redirectUri: `${SITE_URL}/api/oauth/${provider}/callback` });
}
```

### Step 5: Add metadata validation

In `src/lib/connections/metadata.ts`, add the required metadata keys for the new provider:

```typescript
const REQUIRED_KEYS: Record<ConnectionProvider, { key: string; label: string }> = {
  // existing entries...
  tiktok: { key: "creatorId", label: "TikTok Creator Account ID" },
};
```

### Step 6: Add scope validation and UI copy

- Add the new provider to `PROVIDER_LABELS` in `data.ts`, `actions.ts`, and `preflight.ts`.
- Update the connections UI to show the new provider card.
- Update the integration spec doc with TikTok-specific API limits and content type support.

### Step 7: Add to preflight checks

In `src/lib/publishing/preflight.ts`, if the new provider has unsupported placement types, add a check:

```typescript
if (placement === "story" && platform === "tiktok") {
  // Only if TikTok stories are not yet supported
  issues.push({ code: "placement_invalid", message: "TikTok stories not yet supported." });
}
```

### Step 8: Test

- Write unit tests for the new adapter covering: successful publish, auth error, rate limit, content rejection.
- Add a smoke test against the TikTok sandbox environment.
- Deploy to staging with a test account before production.

---

## 7. Risk Register

### 7.1 Facebook

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Graph API version deprecation (v24.0) | Medium — Meta deprecates old versions annually | High — publishing breaks for all Facebook/Instagram users | Pin version in env var (`META_GRAPH_VERSION`); set calendar reminder 6 months before each API EOL date (check [Meta API changelog](https://developers.facebook.com/docs/graph-api/changelog)); test upgrade in staging before production |
| `pages_manage_events` scope removal or review gate | Low | Medium — events feature disabled until re-approved | Submit app for advanced access review before enabling events feature; test with test pages |
| Business Verification requirement | Medium — Meta increasingly requires Business Verification for advanced permissions | High — loss of `pages_manage_posts` for non-verified apps | Complete Meta Business Verification before launch; maintain verified status |
| Page token revocation (user removes app from Page settings) | Medium | Medium — connection goes to needs_action for that page | Detect `OAuthException: (#200)` response; immediately set connection to `needs_action`; alert user |
| Long-lived token expiry without reconnect | High — 60-day tokens require user action | Medium — missed scheduled posts | Proactive alerts at 7 days; automated reconnect email with CTA |
| Story publishing API instability | High — `/{pageId}/photo_stories` is not officially documented as a stable API | High — stories may break without notice | Monitor responses; add `@ts-nocheck` removal as first rebuild task; test on each Graph API version upgrade |

### 7.2 Instagram

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| 25 container/publish calls per 24h limit | Medium — customers posting frequently could hit this | High — publishing fails silently | Track container creation count per IG account per day in `provider_rate_limits`; warn at 20/25; defer jobs to next window |
| Instagram API for Stories availability | Medium — Stories API availability depends on account type (Creator vs Business) | High — stories fail for Creator accounts | Check account type at connection time; surface fallback if `media_type=STORIES` returns error |
| Instagram decoupling from Facebook Graph API | Low — Meta has been consolidating, not decoupling | Very High — entire Instagram integration must be rewritten | Monitor Meta developer blog; design adapter so the Facebook token dependency is documented as an architectural note |
| Caption 2,200 character hard limit | Low (editorial oversight) | Low (API error, retryable after edit) | Add pre-publish character count validation; truncate with ellipsis if exceeding limit (or block and notify user) |
| Media container processing timeout | Medium — video containers take >20 seconds | Medium — Deno Edge Function may time out before polling completes | Move media status polling to a separate queued job; do not poll synchronously in the Edge Function |

### 7.3 Google Business Profile

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| GBP refresh token not implemented (current state) | Certain — this gap exists today | High — every GBP publish fails after 1 hour | Implement GBP token refresh as the first priority in the rebuild |
| GBP v4 API EOL | Medium — Google has been restructuring GBP APIs into separate services | High — endpoint `mybusiness.googleapis.com/v4/localPosts` may stop working | Migrate publisher to the newer `mybusinesspostings.googleapis.com/v1/` endpoint; monitor [Google API changelog](https://developers.google.com/my-business/reference/rest) |
| Location access revoked | Medium — user may disconnect GBP from their Google Account | Medium — connection goes to needs_action | Detect `PERMISSION_DENIED` (403) and `NOT_FOUND` (404) responses; set connection to needs_action immediately |
| refresh_token revoked after 6 months inactivity | Low if app is in production use | High — silent failure to refresh, all GBP posts fail | Track `last_token_refresh_at`; if approaching 5.5 months, proactively request user to re-authorise |
| GBP daily post quota (approx 20/day) | Low for typical pub use | Medium — posts queued for next day | Track post count per location per day; surface warning in scheduler if approaching limit |
| API quota (1,500 req/day on default tier) | Medium — if account discovery runs frequently | Medium — token exchange fails silently | Cache location lookups (already done with 5-minute TTL); request quota increase for production app in Google Cloud Console |
| GBP Event/Offer not implemented (current state) | Certain — these content types are missing | Medium — reduces product value vs spec | Implement `topicType: "EVENT"` and `topicType: "OFFER"` adapters in GBP provider |

### 7.4 Cross-Provider

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Token encryption not implemented | Certain (plaintext storage today) | High — credential exposure in Supabase breach | Implement AES-256-GCM application-layer encryption before any production token is stored; migrate existing tokens in a one-time migration |
| No webhook confirmation | Certain — status relies on synchronous response | Medium — failed posts may appear successful if network drops after API accepts the request | Register webhooks for Facebook Page events and GBP notifications; use webhook delivery to confirm published status |
| State parameter CSRF binding missing | Low exploitability | Medium — theoretical OAuth CSRF | Bind state to an HttpOnly cookie during `startConnectionOAuth`; validate cookie matches state in callback route |
| Single-tenant architecture limits multi-location GBP | N/A currently | Medium — future limitation if business has multiple locations | `social_connections` stores one GBP connection per account; multi-location support would require one connection row per location or a `locations[]` metadata array |
