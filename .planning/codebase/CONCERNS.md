# Codebase Concerns

**Analysis Date:** 2026-05-18

## Tech Debt

### Single Large Service File
- **Issue:** `src/lib/create/service.ts` is 2,290 lines. Combines campaign creation, variant generation, variant planning, scheduling logic, and copy generation in one module.
- **Files:** `src/lib/create/service.ts`
- **Impact:** Hard to understand control flow; difficult to modify promotion/event-specific logic without affecting other campaign types; heavy test mock coupling (service tests must mock OpenAI, Supabase, all scheduling helpers)
- **Fix approach:** Extract `createEventCampaign()` and `createPromotionCampaign()` into separate modules, keep shared `buildVariants()` and schedule resolution helpers in a core service.

### Campaign Forms Size and Repetition
- **Issue:** Event and promotion campaign forms are 1,055 and 905 lines respectively (`src/features/create/event-campaign-form.tsx`, `src/features/create/promotion-campaign-form.tsx`). Both duplicate form field layout, validation, and submission logic.
- **Files:** `src/features/create/event-campaign-form.tsx`, `src/features/create/promotion-campaign-form.tsx`
- **Impact:** Form changes require updates in two places; inconsistent field validation; larger bundle size for create tab
- **Fix approach:** Extract shared form components (field groups, validation wrappers, submission handlers). Use composition pattern to reduce duplication.

### Timezone Hardcoding to Europe/London
- **Issue:** `describePromotionTimingCue()`, `getPromotionEndDay()`, `getPromotionEffectiveEnd()`, and `describeEventTimingCue()` all hardcode `DEFAULT_TIMEZONE` (Europe/London).
- **Files:** `src/lib/create/service.ts`, `src/lib/scheduling/spread.ts`
- **Impact:** If multi-timezone support is added, timing cues and deconfliction will use different timezones, producing stale or wrong copy after schedule shifts. Already flagged as advisory by Codex review (ARCH-001).
- **Fix approach:** Thread `posting.timezone` through all timing helpers when account-level timezone support is implemented. This is explicitly out of scope for current sprint.
- **Current scope:** Out of scope until multi-timezone account support is implemented. Track as follow-up.

### Incomplete Promotion Timing Copy Repair Paths
- **Issue:** After `fix-promotion-timing.md`, two downstream copy-repair functions were only audited, not fully fixed:
  - `sanitiseCountdownLanguage()` in `src/lib/ai/postprocess.ts` may still produce wrong countdown wording
  - `finaliseCopy()` in `src/lib/create/service.ts` promotion-end block
- **Files:** `src/lib/ai/postprocess.ts`, `src/lib/create/service.ts`
- **Impact:** Generated copy could still contain "wraps in X days" wording even after promotion timing cue fix, if these helpers are not updated
- **Fix approach:** Audit `postprocess.ts` and `finaliseCopy()` to confirm they produce calendar-day-correct copy. If they reference raw date differences, update them to use `calendarDayDiff()` and effective-end helpers from promotion timing fix.

---

## Known Issues & Limitations

### Event Campaign Generation Latency (4-5 minutes)
- **Issue:** Creating an event campaign with auto-schedule takes 4-5 minutes. Two independent causes:
  1. `management.orangejelly.co.uk/api/events` is slow (likely cold starts, unindexed joins, connection pool exhaustion from 30+ cron jobs)
  2. Default event cadence is 8 weekly hype slots + 3 countdown slots = 11 slots × platforms = many generation calls
- **Files:** `src/lib/create/event-cadence.ts`, `src/app/(app)/create/actions.ts`
- **Impact:** Unusable wait time; users cannot complete event campaigns; scheduled post creation workflow blocked
- **Fix approach:** 
  1. In OJ-AnchorManagementTools: add `Cache-Control` headers, create index `idx_events_date_status`, review connection pool size
  2. In CheersAI: reduce default `maxWeekly` from 8 to 3-4, make higher cadences opt-in via form UI
  3. Async option: move large generation (5+ slots × multiple platforms) to background job instead of blocking server action

---

## Security Considerations

### Promotion & Event Timing Metadata Not Validated
- **Issue:** `VariantTimingContext` metadata (focusLabel, eventStart, promotionEnd) is built in-memory and passed through the campaign pipeline, but not validated against the original inputs at deconfliction or refresh points.
- **Files:** `src/lib/create/service.ts` (lines 35-46 type definition, lines 1168-1175 attachment for events, lines 1172-1177 attachment for promotions)
- **Impact:** If deconfliction logic or refresh logic has a bug that produces a wrong scheduledFor date, the timing cues could refer to a different event/promotion end than was originally submitted
- **Current mitigation:** Timing metadata is in-memory only; persisted `promptContext` contains a copy of the timing details for audit. Timing refresh is called only for auto-scheduled campaigns, not manual.
- **Recommendations:** Add assertions in `refreshTimingForPlan()` to verify that refreshed `scheduledFor` is within the original campaign window. Log discrepancies for audit.

### Auth Check Missing in Tournament Async Job
- **Issue:** `src/app/actions/tournament.ts` `createTournamentAsyncJob()` server action does not re-verify permission to create tournaments before spawning the background job.
- **Files:** `src/app/actions/tournament.ts`
- **Impact:** UI auth checks could be bypassed; a user who loses permission between form submission and job spawn could still trigger tournament creation
- **Fix approach:** Add `requireAuthContext()` and explicit permission check in the server action, similar to other campaign creation actions.

### Social API Connection Status Not Refreshed Before Publish
- **Issue:** `getPublishReadinessIssues()` checks if a connection exists and has a valid token, but does not refresh OAuth token expiry or connection status from the social platform before validating.
- **Files:** `src/lib/publishing/preflight.ts` (lines 64-71 token expiry check)
- **Impact:** A token that is near expiry or revoked by the user on the platform may still pass validation, leading to failed publishes
- **Current mitigation:** Token expiry stored in database; refresh logic exists in connection management
- **Recommendations:** Add a pre-publish token refresh step; catch token-refresh failures and surface them to the user before scheduling.

---

## Performance Bottlenecks

### Large Service Mocks in Tests
- **Issue:** Service-level tests for campaign creation require mocking Supabase, OpenAI, all scheduling helpers, and engagement-time logic. Test setup is proportional to the 2,290-line service.
- **Files:** `tests/lib/create/service.test.ts`
- **Impact:** Test setup is brittle and slow; hard to add new tests; changes to unrelated helpers can break test mocks
- **Fix approach:** Extract event/promotion campaign creation into smaller units with thin public interfaces. Allow unit tests to mock fewer dependencies.

### Tournament Asset Generation Fills Library and Affects Pickers
- **Issue:** Tournament image assets are ingested into the main `media_assets` table without tagging or filtering. User-facing media pickers show tournament images alongside user-uploaded media, crowding the interface.
- **Files:** `src/lib/tournament/generate.ts`, `src/lib/management-app/client.ts` (tournament image ingestion), `src/features/library/media-asset-grid-client.tsx` (media picker)
- **Impact:** Normal user media pushed out of view; users forced to scroll past tournament images when selecting media for non-tournament posts
- **Fix approach:** Tag tournament assets with a `tournament_id` or source flag; filter media pickers to exclude tournament assets by default; add opt-in toggle to show tournament images only when creating tournament content.

### Planner/Dashboard Modal Not Navigating
- **Issue:** Planner and dashboard create buttons open a modal instead of navigating to `/create` page. This duplicates create form logic and blocks full-page create features.
- **Files:** `src/features/planner/create-post-button.tsx`, `src/features/planner/planner-interaction-components.tsx`, `src/components/providers/app-providers.tsx` (global modal provider)
- **Impact:** Users can't access full create UI from planner; create feature updates must be synced to both modal and page; bundle includes unused modal code
- **Fix approach:** Replace modal calls with `router.push('/create?tab=instant')` and `router.push('/create?tab=weekly&date=...')`. Remove global `CreateModalProvider` if no other callers remain.

---

## Fragile Areas

### Deconfliction + Timing Cue Coherence
- **Files:** `src/lib/scheduling/deconflict.ts`, `src/lib/create/service.ts` (describePromotionTimingCue, describeEventTimingCue, refreshTimingForPlan)
- **Why fragile:** 
  - Deconfliction shifts `scheduledFor` by ±1-2 calendar days
  - Timing cues are computed from the original `scheduledFor` at build time
  - If refresh logic has a bug (e.g., uses wrong `scheduledFor` or forgets to call for a campaign type), stale copy persists
  - Timezone mismatch between deconfliction and cue helpers could produce wrong shifts
- **Safe modification:**
  - Always run full test suite (`npm test`) after changes to deconfliction, timing cues, or schedule refresh
  - Add a test assertion for each campaign type (event, promotion) that verifies timing cue changes when `scheduledFor` shifts
  - Document the timezone assumption explicitly in timing helpers
- **Test coverage:** Deconfliction has tests (`tests/scheduling/deconflict.test.ts`); timing cue tests added in `fix-promotion-timing.md`; refresh tests added in `fix-deconfliction-drift.md`

### Engagement-Time Optimization and Manual Schedule Interaction
- **Files:** `src/lib/scheduling/spread.ts` (engagement-hour lookup), `src/lib/create/service.ts` (phase slot optimization at lines 1129-1131)
- **Why fragile:**
  - Automatic promotion phases are generated with raw end date, then slots are normalized to engagement-optimized hours
  - If a manual schedule is provided, slots are used as-is without engagement-time normalization
  - If UI displays computed times but backend uses different normalization, mismatch occurs
- **Safe modification:**
  - Check both automatic and manual schedule paths when changing engagement-time logic
  - Test with same form inputs for both auto and manual schedules to ensure consistency
  - Engagement-time helpers are in `src/lib/settings/` — changes there impact all campaign types

### Tournament Content and Main Content Separation
- **Files:** `src/lib/tournament/generate.ts`, `src/lib/tournament/` (all tournament-specific logic)
- **Why fragile:**
  - Tournament content creation shares the same `createEventCampaign()` and variant generation path as regular event campaigns
  - Tournament-specific rules (image constraints, copy tone, asset ingestion) are scattered across campaign and tournament modules
  - If variant generation changes, tournament campaigns may break without explicit tournament tests
- **Safe modification:**
  - Run tournament-specific tests when changing variant generation or campaign creation
  - Check `tests/lib/tournament/` and integration tests for tournament content flows
  - Document which campaign helpers should not be changed without tournament impact review

---

## Missing Critical Features

### No Campaign Reschedule or Publish Date Modification
- **Problem:** Once a campaign is created and scheduled, there is no way to adjust the publication date or shift scheduled posts without deleting and recreating the campaign.
- **Blocks:** User adjustments to campaign timing; recovery from scheduling mistakes; responding to event date changes
- **Current approach:** Users must delete content and recreate it
- **Recommended path:** Add a "reschedule" action that allows shifting all campaign posts by ±N days, re-running deconfliction, and refreshing timing cues

### No Bulk Content Regeneration for Campaign Changes
- **Problem:** If a campaign brief, media, or product context is updated, the generated copy does not automatically refresh.
- **Blocks:** Responding to product changes; correcting campaign errors without full recreation
- **Current approach:** Manual recreation
- **Recommended path:** Add a "regenerate variants" action that accepts new inputs and rebuilds prompts/content while preserving scheduling

---

## Test Coverage Gaps

### Service-Level Campaign Creation Tests
- **Untested area:** End-to-end event and promotion campaign creation flows (with mocked Supabase, OpenAI, scheduling helpers)
- **Files:** `src/lib/create/service.ts` (`createEventCampaign`, `createPromotionCampaign`)
- **Risk:** Deconfliction, timing refresh, prompt context assembly, and database persistence could fail silently
- **Priority:** High
- **Path:** Extend `tests/lib/create/service.test.ts` with service-level tests that verify:
  - Event campaigns with auto and manual schedules produce correct `content_items` with timing labels
  - Promotion campaigns with auto phases have last-chance slot on the effective end day
  - Deconfliction + refresh produces coherent timing cues and persisted context
  - Manual schedules skip deconfliction but preserve all other invariants

### Social API Integration Tests
- **Untested area:** Preflight checks, token validation, connection status evaluation
- **Files:** `src/lib/publishing/preflight.ts`, webhook handlers in `src/app/api/`
- **Risk:** Missing connections, expired tokens, or revoked permissions could cause silent publish failures
- **Priority:** Medium
- **Path:** Add tests for preflight scenarios: missing connection, expired token, metadata incomplete, token refresh failure

### Tournament Isolation Tests
- **Untested area:** Tournament content does not leak into media pickers; tournament assets are tagged/filtered correctly
- **Files:** `src/lib/tournament/generate.ts`, media asset ingestion, picker filtering logic
- **Risk:** Tournament images shown in user media pickers; normal media crowded out
- **Priority:** Medium
- **Path:** Add tests that verify tournament images are tagged with source and do not appear in non-tournament media selections

---

## Scaling Limits

### Database Connection Pool Under Cron Load
- **Current capacity:** Default Supabase connection pool; 30+ cron jobs trigger every 1-5 minutes
- **Limit:** Connection pool exhaustion during peak load; API requests to Anchor Management Tools slow down
- **Scaling path:**
  1. Review cron job schedule: consolidate overlapping jobs
  2. Increase Supabase connection pool size if usage is sustained
  3. Add connection pool metrics to monitoring dashboard
  4. Consider deferring non-critical crons (e.g., daily email digest) to off-peak hours

### OpenAI Rate Limits on Bulk Campaign Creation
- **Current capacity:** Standard OpenAI API rate limits (tokens/min, requests/min)
- **Limit:** Users creating campaigns with many slots (8+ weekly + countdown + multiple platforms) hit rate limits and get 429 errors
- **Scaling path:**
  1. Reduce default cadence (per `fix-spec.md` item B2)
  2. Batch variant generation for the same prompt to reuse completion
  3. Use background jobs for large campaigns (5+ slots × 3+ platforms)
  4. Consider OpenAI Batch API for non-real-time campaign generation

### Media Asset Storage and Query Performance
- **Current capacity:** Supabase object storage; media picker queries all assets without pagination
- **Limit:** Large media libraries (100+ images from tournaments) slow down media picker; pickers load entire asset list into memory
- **Scaling path:**
  1. Add pagination or lazy-loading to media pickers
  2. Add database index on `media_assets(account_id, created_at)` for efficient sorting
  3. Add filtering to exclude tournament assets from user-facing pickers (see "Tournament Asset Generation" above)

---

## Dependencies at Risk

### OpenAI API Dependency on Promotion/Event Copy
- **Risk:** OpenAI outage or model deprecation blocks campaign creation
- **Impact:** Users cannot create event or promotion campaigns until service is restored
- **Current mitigation:** Copy generation is optional for some campaign types (tournaments have hard-coded copy); instant posts can use user-provided copy
- **Recommendations:** 
  - Add fallback copy templates for event/promotion campaigns
  - Add a "use my copy" option for campaigns to bypass AI generation
  - Implement retry logic with exponential backoff for OpenAI failures

### Anchor Management Tools Dependency on Event Campaigns
- **Risk:** AnchorManagementTools API down or slow blocks event campaign creation
- **Impact:** Users cannot load event list or create event campaigns
- **Current mitigation:** 10-second client timeout in CheersAI
- **Recommendations:**
  - Cache event list locally with a TTL (e.g., 5 minutes)
  - Add a "create event campaign without preview" flow that skips the event list load
  - Monitor AnchorManagementTools API latency and alert on > 3 seconds

---

*Concerns audit: 2026-05-18*
