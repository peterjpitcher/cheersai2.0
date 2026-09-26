# Operational Runbook

## 1. Purpose
Provide procedures for monitoring, incident response, and routine maintenance of the rebuilt CheersAI platform.

## 2. Monitoring Overview
- **Metrics Dashboard**: Track job success rate, retry count, average publish latency, token status distribution.
- **Logs**: Centralised structured logs tagged by `job_id`, `content_item_id`, `provider`.
- **Alerts**: Configured for job failure spikes, token expiration, queue backlog, media processing errors.

## 3. Routine Checks
- Daily: Review publish job failures, confirm queue backlog < threshold (e.g. <20 jobs pending).
- Daily: Confirm the Vercel cron `/api/cron/publish-scheduler` (every minute) returns 200 in the Vercel cron logs, and that QStash deliveries to `/api/webhooks/qstash-publish` are not piling up on `/api/webhooks/qstash-publish/failure`. See section 11.
- Weekly: Verify token expiry notifications cleared; run end-to-end test post in staging.
- Monthly: Rotate API keys/secrets if required by providers; review storage usage.

## 4. Incident Response
### 4.1 Publishing Failures Spike
1. Alert triggers (e.g. >5% failures in 15 minutes).
2. Check logs for common error code (auth vs rate limit vs payload).
3. If provider outage, pause queue processing by toggling feature flag; notify owner with status update.
4. For auth errors, mark affected connections `needs_action`, send reconnect instructions.
5. After resolution, requeue failed jobs via runbook script `npm run ops:retry-failed`.

### 4.2 Token Expiry / Revocation
1. Notification indicates specific provider.
2. Owner re-authenticates via Connections page; confirm new tokens stored.
3. Run health check script to validate posting capability before resuming scheduled jobs.

### 4.3 Media Processing Failures
1. Review failed assets flagged in logs.
2. Trigger reprocessing job (`npm run ops:invoke -- media-derivatives '{"assetId":"<id>"}'`).
3. If recurring to specific format, inspect FFmpeg worker config; adjust transcoding parameters.

### 4.4 Queue Backlog
1. If `queued` jobs > threshold or next_attempt_at far in past, inspect worker status.
2. Restart worker instance or scale concurrency temporarily.
3. Investigate underlying cause (long-running video uploads, provider throttling).

## 5. Maintenance Tasks
- Update dependencies quarterly (Next.js, Supabase client, SDKs).
- Review AI prompt performance; adjust templates if acceptance rate drops.
- Clean up old notifications (>90 days) and media assets not referenced in content.

## 6. Deployment Checklist
1. Run `npm run lint:ci`, `npm run typecheck`, `npm test`, `npm run build`.
2. Deploy to staging, run smoke tests with mock providers.
3. Validate publishing queue in staging; confirm job metrics stable.
4. Promote to production; monitor metrics during first hour.

## 7. Disaster Recovery
- Database backups: Supabase daily automated snapshots; confirm retention policy.
- Media backups: enable versioning or replicate to secondary bucket weekly.
- In catastrophic failure, restore latest snapshot, rehydrate media from backup, re-run queued jobs as needed.

## 8. Tooling & Scripts
- `npm run ops:backfill-connections` – hydrates missing connection metadata (pageId/igBusinessId/locationId) using live provider APIs.
- `npm run ops:link-auth-user -- --email you@example.com --account <uuid>` – sets the Supabase auth `user_metadata.account_id`, ensures the `accounts` row exists, and seeds posting defaults for a new operator.
- `npm run ops:invoke -- publish-queue '{"leadWindowMinutes":5}'` – trigger the publish worker immediately (payload optional).
- `npm run ops:invoke -- media-derivatives '{"assetId":"<uuid>"}'` – force reprocessing for a specific media asset.

## 9. Communication Plan
- For incidents lasting >30 minutes, send status email describing issue, impact, mitigation steps, and ETA.
- Post-incident review recorded in docs with root cause, fixes, and follow-ups.

## 10. TODOs
- Define thresholds for alerting (exact numbers) once baseline established.
- Document credential rotation process for each provider (FB, IG, GBP).
- Add runbooks for new features as they ship.

## 11. Scheduled Jobs
- **All scheduled work runs on Vercel Cron**, defined in `vercel.json` (region `lhr1`, schedules evaluated in UTC). Every route checks `CRON_SECRET` through `verifyCronAuth()`. The full route table is in `docs/agent-reference.md` section 5.
- **Publishing**: `/api/cron/publish-scheduler` runs every minute. It promotes due `publish_jobs` to `queued` and dispatches them to QStash, which delivers each job to `/api/webhooks/qstash-publish`. It calls the Supabase `publish-queue` edge function instead only while `publish_jobs` lacks a `platform` column (the legacy bridge).
- `/api/cron/publish` is a 410 tombstone and is not in `vercel.json`. Do not schedule it.
- **There are no Supabase-side schedules.** The live project (`nbkjciurhvkfpcpatbnt`) has neither `pg_cron` nor `pg_net` installed (checked 2026-09-26), so nothing calls the edge functions on a timer:
  - `publish-queue` runs only when the legacy bridge above or tournament publishing (`src/app/actions/tournament.ts`) invokes it, and tournament publishing also does so only while `publish_jobs` lacks a `platform` column.
  - `media-derivatives` runs only on demand, through `npm run ops:regenerate-story-derivatives` or `npm run ops:invoke -- media-derivatives '{"assetId":"<uuid>"}'`. Library uploads create their derivatives in the browser and do not call it.

> **Deploy notes:** To change a schedule, edit `vercel.json` and deploy, then update the table in `docs/agent-reference.md` section 5 to match. `supabase/config.toml` holds only the `verify_jwt` flags for the two edge functions.

## 12. Media Processing Pipeline
- **Library uploads generate image derivatives in the browser.** `generateImageDerivatives()` in `src/lib/library/client-derivatives.ts` draws square (1080×1350), story (1080×1920) and landscape (1920×1080) JPEGs on a canvas. The upload components (`src/features/library/media-asset-grid-client.tsx`, `media-upload-panel.tsx`, `upload-panel.tsx` and `media-replace-button.tsx`) upload them to signed URLs and pass their paths to `finaliseMediaUpload()`. No upload calls the `media-derivatives` edge function.
- `finaliseMediaUpload()` (`src/app/(app)/library/actions.ts`) sets `processed_status` to `ready` when an image has a story derivative and `failed` when it does not. Videos are saved as `ready` with no derivatives.
- **The `media-derivatives` edge function runs only on demand**, through the ops scripts: `npm run ops:regenerate-story-derivatives` invokes it for every image that has no story derivative, and `npm run ops:invoke -- media-derivatives '{"assetId":"<uuid>"}'` invokes it for one asset. It renders the same three sizes with FFmpeg WASM and moves the asset `processing` → `ready` (or `failed`); for a video it sets `skipped` and writes a `media_derivative_skipped` notification.
- Troubleshooting: an image left on `failed` usually means the browser could not render or upload its derivatives (the uploader's browser console logs "derivative generation failed"). Re-run it through the edge function with one of the ops commands above, then check the function logs for FFmpeg errors.

## 13. Email Alerts
- Publish failures and metadata issues send alerts via Resend to `ALERT_EMAIL`/`RESEND_FROM`.
- Ensure `RESEND_API_KEY`, `RESEND_FROM`, and optionally `ALERT_EMAIL` are configured in deployment environments.
- Email content includes provider, content ID, and error message for quick diagnosis.

## 14. Connection Metadata
- Each connection requires provider-specific IDs stored in the `metadata` JSON:
  - Facebook: `pageId`.
  - Instagram: `igBusinessId`.
  - GBP: `locationId`.
- The Connections page allows editing these values; the publish worker enforces their presence and marks the connection `needs_action` when missing.
- Use `npm run ops:backfill-connections` after re-authenticating providers to automatically hydrate missing IDs. The script skips entries without valid access tokens and logs the connection IDs that need manual attention.
- OAuth reconnect flow populates these keys automatically when provider APIs return the necessary data:
  1. Facebook & Instagram: the server exchanges the authorization code for a long-lived token, enumerates managed Pages, and selects the Page matching any previously stored ID (falling back to the first available). It saves the Page access token and derived metadata (`pageId`, plus `igBusinessId`/`instagramUsername` when an Instagram Business Account is linked).
  2. Google Business Profile: the server exchanges the authorization code for access + refresh tokens, lists available accounts/locations, and captures the first verified location (or the one previously stored) as the `locationId`.
  3. If no eligible Page/Location is returned, the reconnect attempt fails so the owner can resolve permissions before retrying; the toast message surfaces the specific error.
- After a successful exchange the connection status is set to `active` when metadata is complete, otherwise `needs_action` persists until the owner supplies the missing identifier.

## 15. Connection Diagnostics
- The Connections page includes an admin-only diagnostics table showing stored tokens (truncated), expiry, last-sync timestamps, and raw metadata for each provider.
- Use the diagnostics view during incident response to confirm new tokens landed after an OAuth reconnect or to verify which metadata fields the publish worker will use.
- Tokens are masked to the first/last four characters; inspect Supabase directly if the full value is required for provider support tickets.
- Enable the table in production by setting `ENABLE_CONNECTION_DIAGNOSTICS=true` (or `1`) in the server environment; keep it disabled otherwise to avoid exposing token metadata unnecessarily.
- OAuth reconnects require `TOKEN_VAULT_KEY` in the app runtime. Publishing from encrypted vault rows requires the same `TOKEN_VAULT_KEY` in Supabase Edge Function secrets. If reconnect leaves a provider in `needs_action` and `token_vault` has no `access` row, verify this key first.

## 16. Planner & Scheduling Notes
- Planner renders a full-month calendar with platform/status chips, media previews, and quick actions. The "Status feed" now sits under Command Centre to keep the page narrow on smaller screens.
- Use the inline "Delete" control on a calendar card to remove a post; the server action cancels the publish job and revalidates the planner automatically.
- Weekly, event, and promotion flows seed default slots at 07:00 in the owner’s timezone and require at least one media asset per post. Operators can add/remove specific dates via the schedule calendar before generating content.
- Approval modals allow swapping hero media on a per-post basis; uploads accept images up to 5 MB (server validation returns a descriptive error when exceeded).
- Instant posts also enforce the media requirement; expect server-side validation errors if the planner/newsfeed is missing an asset.
