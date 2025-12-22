# Sequence Flow Overviews

Textual sequence descriptions for core asynchronous processes.

## 1. Publishing Flow
1. **Scheduler** detects content item `status='scheduled'` and `scheduled_for <= now() + leadWindow` (e.g. 5 minutes).
2. Scheduler inserts/updates corresponding `publish_jobs` row with `status='queued'` and `next_attempt_at=scheduled_for`.
3. **Worker** (runs every minute):
   - Fetch up to N jobs where `status='queued'` and `next_attempt_at <= now()`.
   - For each job:
     1. Mark job `status='in_progress'`, increment `attempt`.
     2. Fetch associated `content_item`, `content_variant`, media assets, and connection credentials.
     3. Validate prerequisites (token status, media processed flag, content validation results). If validation fails, set job `status='failed'` and update `content_item.status='failed'`, create notification.
     4. Invoke provider adapter (Facebook/Instagram/GBP) to publish. Adapters handle upload, location tagging, CTA mapping, store external IDs.
     5. On success: set job `status='succeeded'`, `content_item.status='posted'`, store `provider_response`, create success notification (optional), append to activity feed.
     6. On failure: capture error, compute backoff (e.g. attempt 1 => +5m, attempt 2 => +15m, attempt 3 => +30m). Update `next_attempt_at`. If `attempt >= 3`, mark job `failed`, `content_item.status='failed'`, enqueue fallback asset packaging, notify owner.
   - Commit results; move to next job.
4. **Fallback Packaging**: If final failure, background task bundles copy + media, stores downloadable link in `content_item` metadata for manual posting.

## 2. Token Refresh / Health Check
1. Nightly cron triggers `checkExpiringTokens()`:
   - Query `social_connections` where `expires_at <= now() + interval '5 days'`.
   - Set connection `status='expiring'` (if not already), create notification, send email reminder.
2. For providers supporting programmatic refresh:
   - Call refresh endpoint, update tokens and `expires_at`, set status back to `active`.
   - On failure, set status `needs_action`, notify owner with reconnect CTA.
3. Additionally, publishing worker detects auth errors during job execution:
   - Immediately set connection to `needs_action` to prevent further jobs from queuing against invalid tokens.

## 3. Weekly Recurring Materialisation
1. Daily cron `materialiseRecurringContent()` executes:
   - For each weekly campaign where `status='scheduled'` and not paused, compute next occurrence within horizon (e.g. upcoming 14 days).
   - Check if `content_item` already exists for target datetime; if not, create draft item and variant using AI prompt template.
   - If auto-confirm enabled, set to `scheduled`; otherwise leave in `draft` pending user review.
   - Notify owner if new drafts awaiting approval (optional).
2. Remove or archive past occurrences based on retention policy (not critical initially).

## 4. AI Generation Loop
1. User triggers `generateContentVariant`:
   - Server fetches brand profile, campaign metadata, past successful copy (optional), builds prompt.
   - Call OpenAI API with system/user messages tailored to platform.
   - Receive response; run content validation (length checks, banned topics, CTA enforcement).
   - Persist result in `content_variants`, returning validation summary to client.
2. User may request regeneration; same steps with new prompt modifiers (e.g. “make it more playful”).

## 5. Notification Lifecycle
1. Events (publish success, failure, token expiring) create records in `notifications` table with metadata.
2. Planner view fetches unread notifications, displays banners or feed entries.
3. User marks notification as read via server action; `read_at` timestamp set.
4. Nightly job may prune notifications older than retention period (e.g. 90 days).

## 6. Media Upload & Processing
1. User requests signed upload URL for asset.
2. Client uploads file directly to storage.
3. `finaliseUpload` action records metadata and triggers background processing job.
4. Processing job generates required derivatives (story size, square, etc.), updates `media_assets` with processed flag and derived paths.
5. When content variant references media, publishing adapter selects best rendition per platform.

These descriptions should be converted to visual diagrams (e.g. Mermaid sequence charts) once flows are approved.
