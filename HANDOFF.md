# Development Handoff

## Completed Work

### Publishing Pipeline
- Implemented real provider adapters:
  - `supabase/functions/publish-queue/providers/facebook.ts` posts to Page feed/photos via Facebook Graph API, handling image uploads, message publishing, and Graph errors.
  - `supabase/functions/publish-queue/providers/instagram.ts` performs Instagram Graph media creation + publish flow for single-image posts.
  - `supabase/functions/publish-queue/providers/gbp.ts` creates Google Business Profile posts with summary truncation and media attachments.
- Enhanced publish worker (`supabase/functions/publish-queue/index.ts`):
  - Validates connection metadata per provider (`metadata.ts`).
  - Sends Resend alert emails on failures/metadata issues.
  - Passes resolved metadata to adapters; marks connections `needs_action` when fields missing.
  - Improved logging/notification inserts.

### Media Processing
- Added migration `supabase/migrations/20250204103000_add_media_processing_columns.sql` (`processed_status`, `processed_at`, `derived_variants`).
- New edge function `supabase/functions/media-derivatives/index.ts` using FFmpeg WASM to generate square/story/landscape JPEGs.
- Upload flow now enqueues derivatives (`src/app/(app)/library/actions.ts`), library data exposes status (`src/lib/library/data.ts`), and UI shows progress + download links (`src/features/library/media-asset-grid.tsx`).

### Connections & Metadata
- Connection summaries expose metadata (`src/lib/connections/data.ts`); owner bootstrap seeds empty object (`src/lib/supabase/owner.ts`).
- Metadata editor server action lives at `src/app/(app)/connections/actions.ts`, and the UI uses a client form (`src/features/connections/connection-cards.tsx`, `connection-metadata-form.tsx`) with toast feedback + clear action.
- Required metadata keys enforced in publish worker (pageId/igBusinessId/locationId).
- Metadata updates now emit planner notifications (`connection_metadata_updated`) capturing stored values for history.
- OAuth kickoff implemented via `startConnectionOAuth` server action, storing state in `oauth_states` and redirecting to provider auth URLs (`src/lib/connections/oauth.ts`, `supabase/migrations/20250205150000_create_oauth_states.sql`).
- Callback endpoint `/api/oauth/[provider]/callback` saves auth codes for later token exchange and redirects operators back to Connections.

### Scheduling & Alerts
- `supabase/config.toml` defines cron entries for publish queue (every minute), `materialise-weekly` (daily 05:00), and `media-derivatives` (every 15 min).
- Email alerts via Resend triggered on publish failure/metadata gap.

### Planner Feedback & UX
- Added global toast system (`src/components/providers/toast-provider.tsx`) available via `AppProviders`, giving client features non-blocking feedback cues.
- Planner approval button now fires optimistic toasts, surfaces success/error details, and refreshes schedule after approval.
- Planner schedule banner highlights pending drafts and references the toast confirmations so operators know what to expect.
- Planner status feed differentiates publish successes vs connection metadata updates with icons, CTAs, inline detail, and a dismiss control wired to Supabase (`src/features/planner/activity-feed.tsx`, `src/app/(app)/planner/actions.ts`).
- Added `/planner/notifications` history view to inspect latest 50 alerts with metadata dumps (`src/app/(app)/planner/notifications/page.tsx`, `src/lib/planner/notifications.ts`).

### Testing & Tooling
- Added Vitest setup (`package.json`, `tsconfig.json`, `vitest.config.ts`) with PostCSS disabled for tests.
- Initial unit test `tests/resolveConnectionMetadata.test.ts` covering metadata resolver.
- Extracted materialise-weekly scheduling helpers into `supabase/functions/materialise-weekly/utils.ts` and added unit coverage for clamp/day logic and slot calculation.

### Documentation
- Updated `docs/runbook.md` with scheduler jobs, media pipeline steps, email alert configuration, and metadata requirements.
- Maintained backlog at `BACKLOG.md` for future items.

## Outstanding Tasks

1. **Connection Onboarding**
   - Capture metadata automatically during OAuth reconnect; integrate reconnect/refresh buttons with real flows.
   - Run `npm run ops:backfill-connections` in each environment to hydrate legacy connections before publishing.

2. **Testing & CI**
   - Add integration tests for publish worker success/failure paths, media derivative invocation, adapters (mock fetch/API).
   - Extend `materialise-weekly` coverage to include end-to-end dedupe + insert flows (current tests cover pure scheduling helpers only).
   - Configure CI to run `npm run lint`, `npm test`, `npm run build`, and Supabase migration checks.

3. **Media Pipeline Enhancements**
   - Video uploads now skip automatically with Planner alerts; plan scope for true derivative support if required.
   - Consider retry/backoff for derivative failures and expose status in UI notifications.
   - Optional: generate manual fallback package (zip) for failed posts.

4. **Notifications UX & Docs**
   - Surface publish failure alerts in Planner UI (toast/feed), add mark-read endpoints/UI.
   - Expand runbook with OAuth walkthroughs, ops scripts (`ops:retry-failed`, etc.).
   - Tune email templates (HTML, subject format) and ensure environment secrets set in deployment.

5. **Scheduler Deployment**
   - Cron jobs live in `supabase/config.toml` under `[[functions."name".schedules]]`; run `supabase config push` after edits (publish-queue every minute, materialise-weekly at 05:00 Europe/London, media-derivatives every 15 minutes).
   - Verify secrets (`RESEND_API_KEY`, `RESEND_FROM`, `ALERT_EMAIL`, `OPENAI_API_KEY`, etc.) set for Supabase Edge functions.

6. **Final Verification**
   - Run `npm run build`, execute full end-to-end staging drill (upload → derivatives → publish queue → provider success).
   - Monitor Resend alert flow and update documentation with findings.

## Quick Reference
- Media function invoke: `npm run ops:invoke -- media-derivatives '{"assetId":"<uuid>"}'`
- Publish worker invoke: `npm run ops:invoke -- publish-queue '{"leadWindowMinutes":5}'`
- Weekly materialisation invoke: `npm run ops:invoke -- materialise-weekly`
- Connection metadata keys: `pageId`, `igBusinessId`, `locationId`.

## Environment Variables of Note
- `MEDIA_BUCKET`, `RESEND_API_KEY`, `RESEND_FROM`, `ALERT_EMAIL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`.

Feel free to ping me if any context above needs elaboration; the references should let you dive straight back in.
