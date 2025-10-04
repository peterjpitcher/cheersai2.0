# Provider Adapter Implementation Plan

## Shared Foundations
- **Module path**: `supabase/functions/publish-queue/providers/`
- **Shared types**: `types.ts` already exports `ProviderPublishRequest` with payload/auth context.
- **Supabase resources**: `social_connections` table carries tokens, `media_assets` table references storage.
- **Media delivery**: Worker now passes signed URLs; adapters should accept both image and video.

## Facebook (Page Publishing)
1. **Endpoint**: Use Graph API `/PAGE_ID/feed` (text + link) or `/PAGE_ID/photos` for media. Requires page access token. Support:
   - Text-only posts.
   - Single image upload via `attached_media` or `/photos` with `published=true`.
   - Video fallback (initially degrade to photo + link message until Reels support confirmed).
2. **Token handling**:
   - `social_connections.access_token` should store long-lived page token. Detect expiry via `expires_at`.
   - On `OAuthException` responses, propagate error matching worker's auth failure regex.
3. **Implementation Steps**:
   - Build helper `fetchJson(url, init)` with Graph API error normalisation.
   - Implement media upload: if payload contains image => upload to `/PAGE_ID/photos` with `url` option (Facebook fetches signed URL).
   - Post message referencing uploaded media IDs.
   - Capture `id` from response, populate `ProviderPublishResult.externalId`.
4. **Edge Cases**:
   - Character limits (~63,206). Trim message if necessary.
   - When media upload fails, throw with error string.

## Instagram (Business Account via Facebook Graph)
1. **Endpoint**: Instagram Graph `/{igUserId}/media` + `/{igMediaId}/publish`. Requires:
   - Business account linked to Facebook Page. Store `instagram_ig_user_id` in `social_connections.metadata` (extend DB or metadata JSON).
2. **Flow**:
   - Create media container (`image_url` or `video_url`) using signed URL.
   - Poll or wait for container status (for videos). For MVP, limit to single image posts.
   - Publish container and return `id`.
3. **Auth**: Same token as Facebook page if shared; ensure `access_token` has `instagram_basic` and `pages_show_list` scopes.
4. **Fallback**: If video present, throw friendly error instructing manual story upload.

## Google Business Profile
1. **Endpoint**: Google Business Profile API `accounts/{accountId}/locations/{locationId}/localPosts`.
   - Need to store `locationId` per account (extend `posting_defaults` or `social_connections` metadata).
2. **Payloads**:
   - Text: `summary` field capped at 1500 chars.
   - CTA: map to default CTA stored in `posting_defaults` (already set in owner bootstrap).
   - Media: Provide `mediaFormat` + `sourceUrl` using signed URL. Requires HTTPS + accessible (signed URLs OK).
3. **Auth**: Use OAuth access token, refresh when `expires_at` passed. For MVP, require user to reconnect manually.
4. **Error Handling**: Parse Google API error JSON, throw message with `status` + `message`.

## Cross-Cutting Enhancements
- **Connection metadata**: Add `metadata` JSON column to `social_connections` for provider-specific IDs (FB page ID, IG user ID, GBP location).
- **Retry semantics**: On rate limits (HTTP 429), throw to trigger retry. On validation errors, mark as non-retryable (include `retryable=false` hint) once worker supports structured errors.
- **Logging**: Wrap provider calls with `console.info` including `contentId` and `platform` for traceability.
- **Testing**: Build integration tests using mocked fetch to assert outgoing requests and error translation.

## Deliverables
1. Update migrations to add connection metadata JSON + posting defaults for GBP location.
2. Implement each adapter with real API calls guarded by MVP constraints (single image, single location).
3. Extend worker to pass provider-specific context (page/location IDs) once stored.
4. Document manual steps for token refresh + location setup in `runbook.md`.
