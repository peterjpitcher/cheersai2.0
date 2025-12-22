# Operational Runbook

## 1. Purpose
Provide procedures for monitoring, incident response, and routine maintenance of the rebuilt CheersAI platform.

## 2. Monitoring Overview
- **Metrics Dashboard**: Track job success rate, retry count, average publish latency, token status distribution.
- **Logs**: Centralised structured logs tagged by `job_id`, `content_item_id`, `provider`.
- **Alerts**: Configured for job failure spikes, token expiration, queue backlog, media processing errors.

## 3. Routine Checks
- Daily: Review publish job failures, confirm queue backlog < threshold (e.g. <20 jobs pending).
- Daily: Confirm the Vercel cron invocation (`/api/cron/publish`) completes with 200 status and that the Supabase Scheduler is **disabled** for the same job to avoid duplicate triggers.
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
- `npm run ops:invoke -- materialise-weekly` – run weekly cadence expansion on demand.

## 9. Communication Plan
- For incidents lasting >30 minutes, send status email describing issue, impact, mitigation steps, and ETA.
- Post-incident review recorded in docs with root cause, fixes, and follow-ups.

## 10. TODOs
- Define thresholds for alerting (exact numbers) once baseline established.
- Document credential rotation process for each provider (FB, IG, GBP).
- Add runbooks for new features as they ship.

## 11. Scheduled Jobs
- **Primary bridge**: Vercel Cron calls `/api/cron/publish` every minute (see `vercel.json`). The endpoint validates `CRON_SECRET` and forwards the request to the Supabase `publish-queue` function using the service role key.
- **Supabase Scheduler**: Keep the native scheduler **disabled** for `publish-queue` during normal ops so the queue is processed exactly once per minute. Re-enable only for emergencies by creating a schedule in the Supabase dashboard and remember to remove it afterwards.
- `materialise-weekly` runs daily at 05:00 Europe/London via Supabase Scheduler.
- `media-derivatives` runs every 15 minutes as a safety net; uploads also invoke it directly after finalisation.

> **Deploy notes:** Scheduler cadences are currently managed via the Supabase dashboard / CLI commands (`supabase functions schedule create`). `supabase/config.toml` retains `verify_jwt` flags only.

## 12. Media Processing Pipeline
- Upload flow triggers `media-derivatives` edge function with the asset ID.
- FFmpeg wasm generates square (1080×1350), story (1080×1920), and landscape (1920×1080) JPEG derivatives.
- Status transitions: `pending` → `processing` → `ready` (or `failed`/`skipped` when videos are uploaded).
- Troubleshooting: inspect function logs for FFmpeg errors; trigger a retry via `npm run ops:invoke -- media-derivatives '{"assetId":"..."}'`. Videos currently skip processing and raise a Planner alert so operators can fall back to manual publishing.

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

## 16. Planner & Scheduling Notes
- Planner renders a full-month calendar with platform/status chips, media previews, and quick actions. The "Status feed" now sits under Command Centre to keep the page narrow on smaller screens.
- Use the inline "Delete" control on a calendar card to remove a post; the server action cancels the publish job and revalidates the planner automatically.
- Weekly, event, and promotion flows seed default slots at 07:00 in the owner’s timezone and require at least one media asset per post. Operators can add/remove specific dates via the schedule calendar before generating content.
- Approval modals allow swapping hero media on a per-post basis; uploads accept images up to 5 MB (server validation returns a descriptive error when exceeded).
- Instant posts also enforce the media requirement; expect server-side validation errors if the planner/newsfeed is missing an asset.
