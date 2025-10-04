# Provider Adapter Backlog

## Schema & Configuration
- [ ] Add `metadata jsonb` column to `social_connections` for provider-specific IDs (page_id, ig_user_id, location_id).
- [ ] Extend `posting_defaults` with `gbp_location_id` (if not captured elsewhere) and CTA overrides per content type (already partially baked).
- [ ] Ensure `media_assets.storage_path` accessible via public signed URL for all derivatives.

## Facebook Adapter
- [ ] Fetch Facebook Page ID (store in connection metadata) and publish using Graph API.
- [ ] Implement image upload via `photos` endpoint; support text-only fallback.
- [ ] Parse Graph API errors (look for `error.message`, `error.code`).

## Instagram Adapter
- [ ] Require `ig_user_id` in connection metadata and fail fast if missing.
- [ ] Implement container creation + publish for single image posts.
- [ ] Reject video content with actionable error (manual story fallback).

## Google Business Profile Adapter
- [ ] Store `locationId` in connection metadata.
- [ ] Map auto CTA defaults (learn_more, redeem) from `posting_defaults` per campaign type.
- [ ] Send media array with `mediaFormat` detection from `ProviderMedia.mediaType`.

## Worker Enhancements
- [ ] Pass provider metadata (page/location IDs) into adapter request.
- [ ] Distinguish retryable vs terminal failures to avoid unnecessary retries.
- [ ] Add structured logging (contentId, jobId, providerResponse).

## Testing & Tooling
- [ ] Mock fetch tests for each adapter covering success, auth error, validation error.
- [ ] Add smoke script to run provider publish against sandbox accounts.
- [ ] Update runbook with reconnect & troubleshooting steps.
