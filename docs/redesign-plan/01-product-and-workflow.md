# CheersAI 2.0 — Product & Workflow Redesign Plan
> Document type: Planning artefact. Read-only analysis. No source files modified.
> Author: Product & Workflow Architect (AI audit)
> Date: 2026-03-05

---

## 1. Jobs-to-be-Done Map

Each JTBD is rated Red / Amber / Green based on how completely and reliably the current implementation supports the owner completing it without friction or workarounds.

---

### JTBD 1 — Plan content for the coming week

**Status: Amber**

**What works**

- `WeeklyCampaignForm` (weekly-campaign-form.tsx) generates a forward schedule of up to 12 weeks and surfaces a calendar preview with `ScheduleCalendar`.
- Manual slot editing allows the owner to override auto-suggested dates by toggling "Adjust manually" (line 217–219 of weekly-campaign-form.tsx).
- `PlannerCalendar` (planner-calendar.tsx) shows a 6-week grid per month with status chips (draft, scheduled, posted, failed) colour-coded per platform.
- `CreateWeeklyPlanButton` on the planner surface opens the create modal pre-set to the weekly tab (planner-interaction-components.tsx line 41–53).

**Pain points with evidence**

1. The Planner is a static server component. Navigation between months requires full-page reloads via `<Link href>` query-string changes (planner-calendar.tsx lines 178–195). There is no week-level view or agenda view. A pub owner's primary mental model is "this week's plan", not a month grid.
2. The `PlannerCalendar` fetches data at render time but there is no real-time status update; the owner must manually navigate away and back to see publishing outcomes (planner-calendar.tsx line 56 — server component with no polling/subscription).
3. The "Create Weekly Plan" button is located at the **bottom** of the calendar grid (line 359 of planner-calendar.tsx), below the trash section, which may not be visible on mobile without scrolling.
4. There is no concept of a "week health" summary (e.g., "3 of 5 slots approved, 2 still draft") visible on the planner homepage. The owner must count posts manually.
5. The weekly materialisation cron (`materialise.ts`) regenerates recurring campaign content from a stored cadence JSON blob, but the form collects `dayOfWeek` + `weeksAhead` rather than persisting a true cadence entity. Once posts are generated and approved, the weekly campaign has no ongoing "pause/resume" control in the UI — there is no campaign management surface in the planner or elsewhere.

**Gap analysis**

- No week-view / agenda-view mode (PRD section 5 says planning should stay within "three primary screens" but navigating months is the only option).
- No slot health indicator on the planner.
- Campaign lifecycle management (pause, resume, edit cadence) is completely absent post-creation.

---

### JTBD 2 — Generate platform-specific copy and media

**Status: Amber**

**What works**

- All five creation flows (Instant Post, Stories, Event, Promotion, Weekly) call the AI generation pipeline and produce per-platform content items.
- `content-rules.ts` applies a rich post-processing pipeline: banned phrase scrubbing (via `voice.ts`), claim stripping (capacity claims, end times, age), day-name normalisation, emoji/hashtag clamping per platform, word limit enforcement, URL removal, and proof-point injection.
- The `lintContent` function validates output before scheduling, and `preflight.ts` runs it again at approve-time.
- Advanced options (`toneAdjust`, `lengthPreference`, `includeHashtags`, `includeEmojis`, `ctaStyle`) are present in all form schemas, though they are hidden from the UI — they appear only in `defaultValues` blocks (instant-post-form.tsx lines 108–116) and are not exposed to the owner.
- Brand voice tone sliders (`toneFormal`, `tonePlayful`) are captured in Settings > Brand Voice, stored in `brand_profile`, and wired into the AI prompt builder.

**Pain points with evidence**

1. **Advanced options are invisible to the owner.** Fields such as `toneAdjust`, `lengthPreference`, `ctaStyle`, `proofPointMode` are populated with defaults but there is no UI to change them per-post (instant-post-form.tsx default values, lines 108–116; weekly-campaign-form.tsx lines 116–123). The PRD promises a "Fine-tune" toggle for progressive disclosure (PRD section 14) but it is not implemented.
2. **No regeneration capability in the review list.** After generation, the owner can edit copy manually in `GeneratedContentReviewList` or in `PlannerContentComposer`, but there is no "regenerate with this modifier" button. The PRD requires the ability to "request regeneration with new prompt modifiers" (sequence-flows.md section 4 step 2).
3. **No real platform preview.** `PlannerContentComposer` renders a lightweight chrome with Like/Comment/Share icons (lines 271–293) but it is not pixel-accurate — no profile photo, no page name, no link card preview. The PRD requires previews that "feel native to each platform" (PRD section 2, Quality criterion).
4. **Media is unvalidated at generation time.** The form accepts any processed asset without checking aspect ratio per placement type. Story constraints are validated post-approve in `preflight.ts`, not during the form flow, causing confusion when approval fails.
5. **Brand voice test post preview is absent.** PRD section 7.1 specifies an optional AI "test post" to validate tone but this feature does not exist.

**Gap analysis**

- Fine-tune controls must be exposed via progressive disclosure.
- Regenerate-with-modifier capability is missing from both the review list and the detail page.
- Platform previews need significantly more fidelity.
- Media aspect-ratio pre-validation should happen during media attachment, not at approval.

---

### JTBD 3 — Approve scheduled content

**Status: Amber**

**What works**

- `ApproveDraftButton` (approve-draft-button.tsx) calls a server action and transitions the item from `draft` to `scheduled`.
- `preflight.ts` (`getPublishReadinessIssues`) runs a comprehensive checklist before approval: token status, metadata completeness, media presence, story constraints, content lint.
- `GeneratedContentReviewList` groups items by time-slot so all platforms for the same post time are co-located, reducing approve friction.
- Per-item copy editing is available inline in the review list (the component accepts `updatePlannerContentBody` calls).

**Pain points with evidence**

1. **No bulk approve.** The owner must approve each platform variant individually. For an event campaign generating 12 items across 3 platforms for 4 time-slots, that is 12 separate approve actions with page refreshes between them (GeneratedContentReviewList has no "approve all" affordance).
2. **Approval clears the form but leaves the owner on the same screen.** After all items are approved in the modal context, the only exit is a "Done" button (instant-post-form.tsx line 599; event-campaign-form.tsx line 920). The owner has no confirmation of what was scheduled or a direct link back to the planner.
3. **Pre-flight errors are surfaced only at approve-time** with a generic "Post copy failed quality checks. Regenerate the content before scheduling." message (preflight.ts line 105). The lint issue codes (`word_limit`, `banned_phrases`, `day_name_mismatch`, etc.) are not shown to the owner — they cannot act on them without knowing what is wrong.
4. **No draft expiry policy.** Auto-generated drafts can linger indefinitely without warning. The PRD mentions auto-confirm for recurring slots (PRD section 7.4) but there is no UI or cron for this.

**Gap analysis**

- Bulk approve is essential for campaign workflows generating many items.
- Pre-flight error messages must be human-readable and actionable (not just "regenerate").
- Auto-confirm option for recurring campaigns needs both backend cron and UI toggle.

---

### JTBD 4 — Schedule and publish to all three platforms

**Status: Amber**

**What works**

- The scheduling engine (`conflicts.ts`) detects platform double-booking within a 30-minute window and proposes resolutions at ±15/30/45/60-minute offsets.
- `preflight.ts` validates token health, metadata completeness, and media processing status before allowing approval to `scheduled`.
- Connection cards (`connection-cards.tsx`) show `active`, `expiring`, and `needs_action` states with OAuth reconnect buttons.
- The sequence-flows document describes a robust retry pipeline (3 attempts, exponential backoff: +5m, +15m, +30m) with dead-letter fallback bundling.

**Pain points with evidence**

1. **Conflict detection is never shown to the owner.** `resolveConflicts` in `conflicts.ts` exists but its output is not surfaced in the schedule preview calendar or at approval time. An owner can approve two Facebook posts 10 minutes apart with no warning (ScheduleCalendar in create flows shows existing planner items as dots, but there is no conflict badge or resolution suggestion shown on the calendar).
2. **Story publishing via the Facebook/Instagram API is marked as an open question** (next-steps.md line 9: "Instagram Stories Support: Verify API availability for business account"). If Instagram does not support programmatic story publishing for the account type in use, the stories workflow silently fails after scheduling — there is no pre-connection-type validation in the form or preflight.
3. **Token refresh is documented in sequence-flows.md but the nightly cron triggering `checkExpiringTokens()` is not visible in the source tree reviewed.** The connection health indicator exists on the Connections page but there is no planner-level warning banner for expiring tokens.
4. **GBP offer/event post types are not implemented** in the publishing adapters (the PRD lists them, but the create flows only produce `update` type GBP posts — there are no `eventStart`/`eventEnd` fields or `offer` type in the GBP forms, only a generic link URL). This is a silent scope regression from PRD section 8.3.
5. **"Download assets" fallback** (sequence-flows.md section 1 step 6, PRD section 7.5) is specified but no UI component or server action implements it. When a post reaches final failure, the owner has nowhere to go.

**Gap analysis**

- Conflict warnings must be shown at schedule-review time (not just resolved silently server-side).
- GBP events and offers require dedicated form fields and publishing adapter logic.
- Download-assets fallback must be implemented as a first-class recovery path.
- Instagram story API availability must be validated at connection setup, not post-creation.

---

### JTBD 5 — Monitor publishing status and resolve failures

**Status: Amber**

**What works**

- `PlannerActivityFeed` (activity-feed.tsx) fetches notifications from `/api/planner/activity` and categorises them: `publish_success`, `publish_failed`, `publish_retry`, `story_publish_failed`, `connection_needs_action`, `media_derivative_failed`, etc.
- Each notification card includes a contextual action link (e.g., "Review post" → `/planner/{contentId}`, "Reconnect" → `/connections`).
- The detail page (`/planner/[contentId]`) surfaces `lastError`, `lastAttemptedAt`, and the raw `providerResponse` JSON in a `<details>` disclosure (lines 130–146).
- Status chips in `PlannerCalendar` use distinct colour coding per status (draft=caramel, scheduled/queued=blue, posted=teal, failed=rose).

**Pain points with evidence**

1. **Activity feed is client-side only and does not auto-refresh.** The owner must manually click "Refresh" to see new notifications (activity-feed.tsx line 139). For a high-stakes event night, this is a significant gap.
2. **Activity feed shows only 6 items** (`DEFAULT_LIMIT = 6`, activity-feed.tsx line 44). The "View full history" link leads to `/planner/notifications` but there is no evidence of pagination or filter controls on that page in the reviewed source.
3. **Planner calendar status is not updated in real-time.** After a post publishes, the `posted` chip does not appear until the owner navigates away and back (server component with no live update).
4. **The detail page does not offer a "Retry now" button.** When a post is in `failed` status, the owner can see the error but the only recovery actions are: edit copy, edit schedule, or delete. Manual retry of the publish job is not possible from the UI (preflight checks pass on retry but there is no server action to re-queue a failed job explicitly).
5. **No Planner-level summary of failures.** The planner page header has no count badge like "2 posts need attention" — the owner must scroll the calendar or check the activity feed to find failures.
6. **Token expiry warning is absent from the planner.** The activity feed does surface `connection_needs_action` events, but there is no persistent banner on the planner page if a token is nearing expiry while the owner is about to approve posts.

**Gap analysis**

- Auto-refresh or SSE-based live updates for the activity feed are essential.
- Explicit "Retry publish" action needed on the detail page for failed posts.
- Planner-level attention badge for failures and expiring tokens.
- Download-assets fallback must be accessible from the failed post detail page.

---

### JTBD 6 — Reuse media and content (Library)

**Status: Amber**

**What works**

- `MediaAttachmentSelector` (media-attachment-selector.tsx) allows the owner to select from their library or upload new assets inline during any creation flow.
- `MediaAssetGrid` and `MediaAssetEditor` provide a dedicated library management surface.
- Derivative processing pipeline generates story (9:16) and square variants and stores them as `derived_variants`.
- Story constraints (single image, processed derivative required) are enforced at both form level (instant-post-form.tsx lines 246–261) and preflight (preflight.ts lines 126–158).

**Pain points with evidence**

1. **No tagging or campaign-based filtering in the library.** The PRD requires "tagging, search by campaign, and quick filters (e.g. 'Event Banners')" (PRD section 9). The library shows a flat grid with no filter controls visible in the reviewed component surface.
2. **No AI prompt presets.** PRD section 5 lists "AI prompt presets" as a Library feature. None exist.
3. **Video derivative processing is skipped** with a `media_derivative_skipped` notification (activity-feed.tsx lines 276–293 handles this category, noting "Video derivatives are skipped until video processing lands"). This means video posts cannot use auto-selected renditions — the publishing adapter must use the original file, which may exceed platform spec.
4. **No "saved drafts" surface in the Library.** PRD section 5 lists this under Library scope; it does not exist.

**Gap analysis**

- Library needs search, tagging, and campaign-filter UI.
- Video transcoding pipeline must be completed or a clear manual fallback documented.
- Prompt presets and saved drafts are PRD items that have not been started.

---

### JTBD 7 — Analyse publishing outcomes

**Status: Red**

**What works**

- Activity feed provides a log of publishing outcomes (success/failure).
- Per-post detail page surfaces `providerResponse` raw JSON for debugging.

**Pain points with evidence**

1. **Analytics is explicitly out of scope in the PRD** (section 4, Out of Scope: "Advanced analytics dashboards or reporting exports") but even basic counts (posts published this week, failure rate, best-performing time) are absent.
2. **The activity feed is the only analytical surface**, limited to 6 items, with no aggregation, filtering, or export.
3. **No engagement data is imported.** The system has no integration to pull back likes, comments, or reach from Facebook/Instagram/GBP after posting.

**Gap analysis**

This JTBD is deliberately deferred. For MVP, the acceptance criterion is "owner can see publishing success/failure status per post." Engagement analytics remain out of scope for v1.0 and v1.1.

---

## 2. Current-State Audit

### Critical Severity

**C-1: GBP event and offer post types are missing**
- PRD section 7.2 and 8.3 specify GBP events (title, start/end) and GBP offers (coupon code, redemption URL) as in-scope.
- All four campaign creation forms use a single `ctaUrl` + `ctaLabel` field for GBP without event or offer type switching.
- There are no `event_start`, `event_end`, or `offer_code` fields in any form schema reviewed.
- A GBP "update" post is published successfully, but the GBP Events and Offers API endpoints require different request bodies. Silently publishing all GBP content as standard updates means event and offer posts will not appear as events/offers on the owner's Google listing.
- **Files:** promotion-campaign-form.tsx (entire form), event-campaign-form.tsx (entire form), weekly-campaign-form.tsx (entire form), instant-post-form.tsx (entire form).

**C-2: No "Retry publish" or "Download assets" recovery path for failed posts**
- When a publish job reaches 3 failed attempts, the sequence-flows.md (section 1 step 6) specifies a fallback: "bundles copy + media, stores downloadable link in content_item metadata for manual posting."
- No server action, route, or UI component implements this fallback.
- The only UI on a failed post's detail page is copy editing, schedule rescheduling, and delete.
- An owner whose post fails the night of an event has no recovery option within the app.
- **Files:** `/app/(app)/planner/[contentId]/page.tsx` (lines 67–75 show error but no recovery CTA).

**C-3: Conflict detection is silently resolved server-side and never shown to the owner**
- `resolveConflicts` in `conflicts.ts` resolves scheduling conflicts by proposing ±15/30/45/60-minute offset alternatives.
- The function is imported in `materialise.ts` but its output (the `conflictWith` and `resolution` fields on each `ConflictResult`) is not surfaced in any UI component or form.
- `ScheduleCalendar` (schedule-calendar.tsx) shows existing planner items but there is no conflict badge or warning when a new slot collides with an existing one.
- The owner can approve two competing posts on the same platform without any indication.
- **Files:** `src/lib/scheduling/conflicts.ts` (full file), `src/features/create/schedule/schedule-calendar.tsx`.

**C-4: Instagram Stories API availability is unverified and there is no form-level pre-check**
- `next-steps.md` line 9 explicitly flags: "Instagram Stories Support: Verify API availability for business account; define manual fallback if unavailable."
- The story creation flow (`StorySeriesForm`, `InstantPostForm` in story placement) creates and approves story content items without checking whether the connected Instagram Business Account supports programmatic story publishing.
- A failed story publish produces a notification, but the owner discovers the limitation only after scheduling, not at connection setup.
- **Files:** `src/features/create/story-series-form.tsx`, `src/features/connections/connection-cards.tsx` (no story capability check).

---

### Major Severity

**M-1: Advanced AI generation controls are invisible**
- All form schemas include `toneAdjust`, `lengthPreference`, `ctaStyle`, `proofPointMode`, `proofPointsSelected`, `proofPointIntentTags` as Zod-validated fields.
- All forms hard-code these to defaults (`"default"`, `"standard"`, `"off"`) with no UI to change them.
- PRD section 14 requires a "Fine-tune" toggle with progressive disclosure. The "proof-points" feature in particular (trust markers like "family-friendly", "live music") is entirely hidden.
- **Files:** instant-post-form.tsx lines 108–116, weekly-campaign-form.tsx lines 116–123, event-campaign-form.tsx lines 168–174, promotion-campaign-form.tsx lines 146–152.

**M-2: No "Regenerate with modifier" capability post-generation**
- After generation, the owner can edit copy manually but cannot ask the AI to regenerate with a new instruction.
- Sequence-flows.md section 4 step 2 requires this: "User may request regeneration; same steps with new prompt modifiers."
- **Files:** `src/features/create/generated-content-review-list.tsx` (no regenerate button), `src/features/planner/planner-content-composer.tsx` (no regenerate button).

**M-3: Pre-flight errors are not human-readable**
- When `assertPublishReadiness` throws, it joins all issue messages with a space (preflight.ts line 167: `issues.map((issue) => issue.message).join(" ")`).
- The UI in `ApproveDraftButton` receives a single concatenated string. The `lint_failed` issue message is always "Post copy failed quality checks. Regenerate the content before scheduling." — the actual lint issue codes (`word_limit`, `banned_phrases`, `day_name_mismatch`, etc.) from `lintContent` are never shown to the owner.
- **Files:** `src/lib/publishing/preflight.ts` lines 101–106 and 163–168, `src/features/planner/approve-draft-button.tsx`.

**M-4: No bulk approve**
- An event campaign for 4 time-slots × 3 platforms = 12 draft items requires 12 individual approve clicks with intermediate server round-trips.
- **Files:** `src/features/create/generated-content-review-list.tsx` (no bulk action affordance).

**M-5: Activity feed requires manual refresh and has no auto-update**
- `PlannerActivityFeed` fetches via `fetch()` on mount and only refreshes when the owner clicks "Refresh" (activity-feed.tsx lines 59–93, 139).
- No polling interval, no SSE subscription, no WebSocket.
- **Files:** `src/features/planner/activity-feed.tsx` lines 52–155.

**M-6: Planner has no week-level view or "this week" summary**
- The planner is month-only with full-page reload navigation. There is no condensed "this week" agenda that shows time-ordered posts with approve/reject inline.
- **Files:** `src/app/(app)/planner/page.tsx`, `src/features/planner/planner-calendar.tsx`.

**M-7: No attention/failure summary banner on the planner**
- When posts fail, the only signal on the planner is the rose-coloured `failed` status chip inside individual calendar cells, which is easy to miss.
- There is no page-level count badge or alert bar.
- **Files:** `src/app/(app)/planner/page.tsx` (no failure-count query in server component).

**M-8: Weekly campaign lifecycle management is absent post-creation**
- Once a weekly campaign is generated and approved, there is no UI to pause it, edit the cadence, or view which campaign produced a given post.
- `materialise.ts` reads cadence from `campaigns.metadata` JSON but there is no campaign list view, campaign edit page, or pause toggle.
- **Files:** `src/lib/scheduling/materialise.ts`, no corresponding `/app/(app)/campaigns/` route exists in the glob results.

**M-9: Library lacks search, tagging, and campaign filters**
- PRD section 9 requires tagging, campaign-based search, and quick filters.
- `MediaAssetGrid` renders a flat grid. No filter UI is visible in the reviewed components.
- **Files:** `src/features/library/media-asset-grid-client.tsx`.

---

### Minor Severity

**m-1: Inconsistent button styling across forms**
- `WeeklyCampaignForm` uses both `<Button>` component (lines 388, 500) and raw `<button>` with hard-coded Tailwind classes (line 471). This is a polish issue that increases maintenance cost.
- `EventCampaignForm` also mixes `<Button>` (lines 649, 748) with raw `<button>` (line 868).
- **Files:** weekly-campaign-form.tsx line 471, event-campaign-form.tsx line 824.

**m-2: `AddToCalendarButton` hardcodes `DEFAULT_TIMEZONE` instead of using owner settings**
- `planner-interaction-components.tsx` line 19 uses `DEFAULT_TIMEZONE` to construct the initial date when clicking the calendar day plus button. The owner timezone is not passed down, so if the owner's timezone differs from the default, the initial date in the create modal will be offset.
- **Files:** `src/features/planner/planner-interaction-components.tsx` line 19.

**m-3: `window.confirm()` used for management import conflict warnings**
- `event-campaign-form.tsx` line 390 and `promotion-campaign-form.tsx` line 313 use `window.confirm()` for the overwrite warning dialog. This blocks the main thread, has no custom styling, and is inaccessible.
- **Files:** event-campaign-form.tsx line 390, promotion-campaign-form.tsx line 313.

**m-4: Progress bar uses simulated random increments rather than real progress**
- All five creation forms use `setInterval` with `Math.random() * 12 + 3` increments to simulate a progress bar (instant-post-form.tsx lines 162–164). This gives no real signal about actual server-side progress.
- **Files:** instant-post-form.tsx lines 155–178, weekly-campaign-form.tsx lines 250–273, event-campaign-form.tsx lines 290–313.

**m-5: `create-modal-context.tsx` does not reset state on re-open with different options**
- If `openModal()` is called twice in quick succession with different `initialTab` values, the state is set sequentially and the second call's values may race. The `closeModal` callback resets all state to `undefined`, but intermediate state between two rapid `openModal` calls is not guarded.
- **Files:** `src/features/create/create-modal-context.tsx` lines 23–29.

**m-6: Story-series form is not listed in the CreateWizard tab labels in the mobile-visible tab bar**
- The "Stories" tab exists in `create-wizard.tsx` (line 17) but its form (`StorySeriesForm`) is a distinct workflow from `InstantPostForm` with placement=story. Having two separate paths to create a story (Instant Post > Story placement, and Stories tab) may confuse owners.
- **Files:** `src/features/create/create-wizard.tsx` lines 14–20.

---

## 3. MVP vs v1.1 Scope Definition

The table below consolidates features from the PRD against the current implementation state, defining what must ship Day 1 (MVP) versus what can follow in v1.1 without blocking the owner's core jobs.

| Feature | MVP | v1.1 | Rationale |
|---|---|---|---|
| Instant post creation (feed) | Must ship | — | Core JTBD; already implemented, needs polish |
| Instant story creation | Must ship | — | Core JTBD; implemented but needs API validation upfront |
| Event campaign (4-beat timeline) | Must ship | — | Primary use case; implemented, needs GBP event type |
| Promotion campaign (3-beat) | Must ship | — | Primary use case; implemented, needs GBP offer type |
| Weekly recurring campaign | Must ship | — | Primary use case; implemented |
| Story Series (multi-slot lineup) | v1.1 | Defer | Duplicates instant story; adds scheduling complexity; not referenced in PRD Key Workflows |
| GBP standard update posts | Must ship | — | Implemented |
| GBP event posts (with start/end) | Must ship | — | PRD section 8.3; currently absent — blocks meaningful GBP value |
| GBP offer posts (with coupon/URL) | v1.1 | Ship soon | PRD section 8.3; complex type; lower immediate urgency than events |
| Platform-specific AI copy generation | Must ship | — | Core; implemented |
| Fine-tune controls (tone/length/hashtags) | Must ship | — | Exists in schema, hidden in UI — expose via progressive disclosure |
| Regenerate-with-modifier | Must ship | — | Without this, bad AI output requires full re-creation |
| Proof-points / trust markers | v1.1 | — | Low owner urgency; complex UX; schema already exists |
| Planner month calendar view | Must ship | — | Core navigation; implemented |
| Planner week / agenda view | v1.1 | — | High value but not blocking Day 1 |
| Planner real-time status updates | v1.1 | — | Polling sufficient for MVP; SSE/WebSocket deferred |
| Planner failure attention banner | Must ship | — | Owner cannot miss failed posts; trivial to add |
| Planner token expiry warning banner | Must ship | — | Prevents silent auth failures |
| Bulk approve in review list | Must ship | — | Necessary for campaigns generating 10+ items |
| Human-readable pre-flight errors | Must ship | — | Currently opaque; blocks owner recovery |
| Conflict detection UI warning | Must ship | — | Conflict resolution exists server-side but is invisible |
| Retry publish action (failed posts) | Must ship | — | Without this, failure recovery requires deleting and recreating |
| Download-assets fallback on final failure | Must ship | — | PRD-specified recovery path; currently absent |
| Campaign lifecycle management (pause/resume/edit) | v1.1 | — | Post-creation control; important but owner can recreate for now |
| Activity feed auto-refresh (polling) | Must ship | — | Manual refresh is insufficient for monitoring; 30-second poll is acceptable |
| Activity feed auto-refresh (SSE) | v1.1 | — | SSE preferred long-term but not Day 1 |
| Media library search and tagging | v1.1 | — | PRD scope but not blocking content creation |
| Media library campaign filters | v1.1 | — | Same rationale |
| Video transcoding pipeline | v1.1 | — | Video uploads work; derivatives deferred; original file used |
| AI prompt presets (Library) | v1.1 | — | Not blocking core workflow |
| Saved drafts in Library | v1.1 | — | Not blocking core workflow |
| Brand voice test-post preview | v1.1 | — | Nice-to-have for onboarding; not Day 1 |
| Connection health indicators (Connections page) | Must ship | — | Implemented |
| Planner token expiry notification | Must ship | — | Needs planner-level banner; activity feed insufficient |
| Publishing pipeline (3 retries, backoff) | Must ship | — | Documented in sequence-flows; verify implementation complete |
| Publishing pipeline dead-letter / download fallback | Must ship | — | Currently missing |
| Notifications (in-app) | Must ship | — | Implemented via activity feed |
| Notifications (email) | v1.1 | — | next-steps.md question 3; not Day 1 |
| Link-in-bio public page | v1.1 | — | Already implemented; keep but not a primary MVP metric |
| Management app import (Event / Promotion) | Must ship | — | Already implemented; high owner value |
| Accessible overwrite confirm dialog (not window.confirm) | Must ship | — | Accessibility baseline; quick fix |
| Instagram story API capability pre-check | Must ship | — | Prevents silent scheduling of unpublishable stories |
| Auto-confirm toggle for recurring campaigns | v1.1 | — | PRD section 7.4; not blocking Day 1 |
| Drag-and-drop schedule adjustments | v1.1 | — | PRD section 7.4; calendar slot editing covers this for now |
| Engagement data import (likes, reach) | Out of scope | — | PRD section 4, Out of Scope |
| Analytics dashboards | Out of scope | — | PRD section 4, Out of Scope |

---

## 4. Core Workflow Acceptance Criteria

QA must be able to execute each scenario against a staging environment with real social connections. Pass/fail is binary.

---

### WF-1: Weekly Planning

**Scenario:** Owner creates a weekly recurring campaign for Thursday Quiz Night, platforms Facebook + Instagram, starting the current week, 4 weeks ahead, default time 19:00.

| # | Criterion | Pass condition |
|---|---|---|
| 1.1 | Form completes in ≤ 15 minutes from Planner | Owner reaches "Review & approve" in under 15 minutes starting from Planner landing page |
| 1.2 | Schedule preview is correct | Calendar shows 4 Thursday slots in the correct weeks at 19:00 in owner timezone |
| 1.3 | No conflict with existing posts | If a slot conflicts with an existing post, a warning badge is shown on that slot |
| 1.4 | Conflict resolution offered | If warned, owner can shift the conflicting slot or confirm override |
| 1.5 | Generation succeeds | All 8 content items (4 Facebook + 4 Instagram) appear in the review list |
| 1.6 | Copy is platform-appropriate | Facebook items have ≤ 3 hashtags; Instagram items have ≤ 6 hashtags and a "link in bio" line if linkInBioUrl provided |
| 1.7 | Bulk approve works | "Approve all" button approves all 8 items in one action; confirmation count shown |
| 1.8 | Planner reflects approved items | Navigating to Planner shows 8 items with `scheduled` chip; items appear in correct calendar cells |
| 1.9 | Campaign pause works (v1.1) | Owner can pause the campaign; future materialisations stop; existing approved posts unaffected |

---

### WF-2: Event Launch

**Scenario:** Owner launches an event campaign for "Acoustic Fridays" on 14 March 2026 at 21:00, platforms Facebook + Instagram + GBP, with hero media attached.

| # | Criterion | Pass condition |
|---|---|---|
| 2.1 | Management import works | "Load events" fetches Anchor events; selecting one pre-fills name, date, time, ctaUrl |
| 2.2 | Suggested schedule contains correct beats | Calendar shows: T-7 (7 March), T-3 (11 March), T-2 (12 March), T-1 (13 March), Day-of AM (14 March) — or per configured offsets |
| 2.3 | GBP event is created as event type | GBP post for this campaign uses the Events API with `startDate` + `endDate`; not a standard update |
| 2.4 | Hero media is attached to all variants | All generated items show the attached image in the review list |
| 2.5 | Story variants (if selected) fail gracefully if API unsupported | If Instagram story API is unavailable, owner sees a clear message at connection setup or before approval, not a silent publish failure |
| 2.6 | Copy does not contain disallowed claims | None of the generated posts contain capacity claims ("limited spaces"), age restrictions, or specific end times not provided by owner |
| 2.7 | Approve generates correct schedule | After approving 15 items (5 beats × 3 platforms), Planner shows all 15 with correct dates and statuses |
| 2.8 | Rescheduling a single item works | Owner opens a scheduled item, changes the time by 30 minutes, saves; Planner reflects the new time |
| 2.9 | Failed post shows actionable error | If Facebook publish fails, activity feed shows "Publish failed" with error detail; detail page shows "Retry" CTA and "Download assets" CTA |

---

### WF-3: Promotion Campaign

**Scenario:** Owner creates a promotion "Two-for-one cocktails" running 15–22 March 2026, platforms Facebook + Instagram + GBP, management import from Anchor specials.

| # | Criterion | Pass condition |
|---|---|---|
| 3.1 | Management special import pre-fills fields | Name, offer summary, start/end dates pulled from Anchor |
| 3.2 | Default beats are: launch (15 March), mid-run (18 March), last chance (21 March) | Calendar pre-selects these three slots |
| 3.3 | Owner can add repeat reminder | Owner can click a date on the calendar to add an extra reminder; new item appears in selected slots |
| 3.4 | GBP offer post is correct type | GBP variant uses the Offers API endpoint (not standard update); includes `couponCode` if provided (v1.1 gate) |
| 3.5 | Instagram copy references link-in-bio | If `linkInBioUrl` is provided, Instagram copy contains "link in our bio" or variant |
| 3.6 | Facebook copy contains CTA URL | If `ctaUrl` is provided, Facebook copy ends with "Book now: {url}" or equivalent |
| 3.7 | Approve all succeeds | All 9 items (3 beats × 3 platforms) approved in one action; Planner updated |

---

### WF-4: Instant Post

**Scenario:** Owner creates an instant feed post for Facebook + Instagram with a prompt "Friday night live music — vibe is relaxed acoustic", attaches one image from library, schedules for next Friday 19:00.

| # | Criterion | Pass condition |
|---|---|---|
| 4.1 | Form completes in ≤ 5 minutes | Owner submits from opening Create to "Review & approve" in under 5 minutes |
| 4.2 | Two platform variants are generated | Facebook and Instagram items appear in review list |
| 4.3 | Fine-tune controls are accessible | Owner can change tone, length, hashtag preference before or after generation without leaving the page |
| 4.4 | Regenerate with modifier works | Owner can click "Regenerate" with an instruction modifier; new copy replaces old in the review list |
| 4.5 | Scheduled time is correct | After approval, Planner shows item at next Friday 19:00 in owner timezone |
| 4.6 | "Publish now" path works | If owner selects "Publish now", post transitions to `queued`/`publishing` and eventually `posted` within 2 minutes |
| 4.7 | Story variant enforces single-image constraint | If owner switches to Story placement, only one image can be attached; adding a second shows error immediately (not at approve time) |
| 4.8 | Pre-flight errors are human-readable | If approve fails due to content lint, owner sees specific plain-English reason (e.g., "Post contains a banned phrase" not "Post copy failed quality checks") |

---

### WF-5: Monitoring and Recovery

**Scenario:** A scheduled post fails after 3 retries. Owner is notified and recovers.

| # | Criterion | Pass condition |
|---|---|---|
| 5.1 | Failed post is visible on planner | Calendar cell shows rose `failed` chip within 1 minute of final failure |
| 5.2 | Attention banner shown on planner | Page-level banner "N posts need attention" appears at planner top when ≥ 1 post is failed |
| 5.3 | Activity feed updates within 5 minutes | "Publish failed" notification appears in activity feed without manual refresh (30-second poll or faster) |
| 5.4 | Activity feed card has actionable link | "Review post" link leads directly to the failed post's detail page |
| 5.5 | Detail page shows specific error | `lastError` field shows provider error message (e.g., "OAuth token expired"); not generic |
| 5.6 | "Retry" action is available | A "Retry now" button is visible on the detail page for failed posts; clicking it re-queues the publish job |
| 5.7 | "Download assets" fallback is available | A "Download copy & media" link is visible on the detail page for failed posts; clicking it downloads a ZIP or opens a modal with copy text + image URL |
| 5.8 | Token expiry warning is visible | If a social connection token expires within 5 days, a banner appears on the Planner page (not just in the activity feed) |
| 5.9 | Reconnect flow resolves the issue | Clicking "Reconnect" on the banner completes OAuth and restores connection status to `active` within 2 minutes |

---

## 5. New PRD Delta

The following changes are required against `docs/cheersai-rebuild-prd.md`. This is an addendum/correction list, not a replacement.

### 5.1 Additions to Section 7.2 (Campaign Types)

- **GBP post types must be differentiated by campaign type.** Event campaigns must produce GBP event-type posts (with `eventTitle`, `startDate`, `startTime`, `endDate`). Promotion campaigns must produce GBP offer-type posts (with `couponCode` optional, `redeemOnlineUrl` optional, `startDate`, `endDate`). Instant posts and weekly recurring campaigns produce GBP standard updates only.
- **Add: Story API pre-check requirement.** During connection setup for Instagram, the system must verify whether the connected Business Account supports programmatic story publishing. If not, the story creation flows must be disabled or redirected to a manual-posting guide.
- **Add: Campaign lifecycle management.** Weekly recurring campaigns must support pause, resume, and cadence-edit actions after creation. A `/campaigns` or embedded campaign management surface must exist.

### 5.2 Additions to Section 7.3 (Editor & AI Generation)

- **Add: Regenerate-with-modifier action** in both the post-generation review list and the post detail page. The modifier is a free-text instruction (e.g., "make it more casual") applied on top of the original prompt context.
- **Add: Fine-tune controls exposed via progressive disclosure.** At minimum, `toneAdjust` (more formal / default / more casual), `lengthPreference` (short / standard / long), `includeHashtags` (toggle), and `includeEmojis` (toggle) must be accessible via a "Fine-tune" expandable section on every creation form.
- **Clarify: Content validation errors must be human-readable.** The `lint_failed` pre-flight error must map each issue code to a specific plain-English message shown to the owner. Issue codes must not be concatenated into a single generic message.

### 5.3 Additions to Section 7.4 (Scheduling & Calendar)

- **Add: Conflict warning UI.** When the owner selects or auto-assigns a time slot that is within 30 minutes of an existing post on the same platform, a warning badge must appear on that slot in the schedule calendar. A "Shift by 1 hour" suggestion must be offered.
- **Add: Bulk approve action.** The post-generation review list must include an "Approve all ready" button that approves all items passing pre-flight checks in a single action.

### 5.4 Additions to Section 7.5 (Publishing Pipeline)

- **Add: Explicit retry action.** Failed posts must expose a "Retry publish now" server action accessible from the post detail page. This re-queues the job immediately (bypassing the backoff timer).
- **Add: Download-assets fallback must be implemented.** On final failure (after 3 attempts), the system must package copy text + media asset download URLs into a presentable format (modal or ZIP download) accessible from the post detail page and from the activity feed notification.
- **Add: Activity feed auto-refresh.** The activity feed must poll for new notifications at a minimum of every 60 seconds without user interaction. SSE can replace polling in v1.1.

### 5.5 Additions to Section 7.6 (Notifications & Status)

- **Add: Planner-level failure count badge.** When ≥ 1 content item has status `failed`, a persistent banner at the top of the Planner page must show the count and link to a filtered view of failed items.
- **Add: Planner-level token expiry banner.** If any social connection has `status='expiring'` or `status='needs_action'`, the Planner page must show a persistent banner with a "Reconnect" link.

### 5.6 Removals / Clarifications

- **Clarify section 6 (Key Workflows) — Story Series workflow:** The "Stories" tab in CreateWizard (`StorySeriesForm`) is a distinct workflow not described in the PRD's five key workflows. The PRD should explicitly include or remove it. Recommendation: remove the dedicated Stories tab; story creation should be via Instant Post (placement=story) to reduce duplication. The story series batch-scheduling capability can be preserved as a "Schedule multiple stories" extension of the instant post flow in v1.1.
- **Clarify section 9 (Media Management) — Video:** The PRD says "Automatic compression/transcoding pipeline producing platform-ready variants." This must carry a caveat: video derivatives are not currently implemented. The PRD must be updated to reflect that video posts use the original file until the transcoding pipeline is completed (v1.1 gate).
- **Remove from MVP gate: Drag-and-drop schedule adjustments** (PRD section 7.4). Manual time-slot editing via form input is sufficient for MVP. Drag-and-drop adds significant engineering complexity for limited Day 1 value; it is a v1.1 enhancement.

---

## 6. Open Product Decisions

Each decision is listed with the recommended default to unblock design and engineering. Decisions must be confirmed by the owner before implementation begins.

---

**OPD-1: Instagram Stories API — programmatic publish or manual fallback?**

- **Problem:** Instagram Graph API story publishing requires the account to be a Creator or Business account with content publishing enabled. Not all accounts have this. A silent failure mode currently exists.
- **Options:** (a) Require API capability check at connection time; disable story flows if not supported. (b) Always allow story scheduling but surface a "may require manual posting" disclaimer.
- **Recommended default:** Option (a). Add a capability check when the Instagram connection is authorised. If story publishing is not confirmed, disable the story placement option system-wide and show "Stories are not available for your account type — post manually" with a download link.
- **Blocks:** Story series form design, preflight validation spec.

---

**OPD-2: GBP offer posts — require `couponCode` or make optional?**

- **Problem:** The GBP Offers API requires either a `couponCode` or a `redeemOnlineUrl`. Without one, the offer cannot be created. The PRD lists offers as in-scope but gives no detail on mandatory fields.
- **Options:** (a) Require at least one of `couponCode` or `redeemOnlineUrl` for GBP offer posts. (b) Make GBP offer type optional — if neither is provided, fall back to a standard GBP update.
- **Recommended default:** Option (a) for explicit offer campaigns; Option (b) as fallback to avoid blocking the whole campaign if GBP offer fields are skipped.
- **Blocks:** Promotion form design (GBP-specific field section), GBP publishing adapter spec.

---

**OPD-3: Bulk approve — approve all or per-timeslot?**

- **Problem:** For a campaign with 12 items across 4 time-slots and 3 platforms, "approve all" is convenient but risks approving items the owner hasn't reviewed.
- **Options:** (a) "Approve all" button approves every draft item passing pre-flight. (b) "Approve slot" button per time-slot group; owner reviews each group then approves it. (c) Both: per-slot approve + "approve all remaining."
- **Recommended default:** Option (c). Per-slot "Approve this slot" button on each row group, plus a footer "Approve all ready" that approves every pre-flight-passing item in one click. Items with pre-flight failures are excluded and flagged.
- **Blocks:** GeneratedContentReviewList redesign, ApproveMultiple server action.

---

**OPD-4: Activity feed refresh mechanism — polling interval or SSE?**

- **Problem:** Activity feed currently requires manual refresh. Polling is simple but adds request volume; SSE is better UX but requires infrastructure changes.
- **Options:** (a) 30-second polling using `setInterval` in the client component. (b) Server-Sent Events subscription. (c) No auto-refresh — rely on planner page re-validation after approve actions.
- **Recommended default:** Option (a) for MVP (30-second poll). Upgrade to SSE in v1.1. The 30-second window is acceptable for a single-owner system without concurrent users.
- **Blocks:** Activity feed component design.

---

**OPD-5: Retry publish — immediate or with validation gate?**

- **Problem:** When an owner clicks "Retry", should the system re-run pre-flight checks before queuing, or queue immediately and let the worker handle validation?
- **Options:** (a) Re-run pre-flight before queuing; reject retry if checks still fail. (b) Queue immediately; let the worker validate and fail again if issues persist.
- **Recommended default:** Option (a). Re-run pre-flight on retry click and surface any blocking issues (expired token, missing media) before queuing. This prevents queuing a job that will certainly fail again.
- **Blocks:** Retry server action design, pre-flight error display on detail page.

---

**OPD-6: Download-assets fallback — ZIP download or modal with copy/paste?**

- **Problem:** Bundling a ZIP requires server-side file assembly and download. A modal with formatted copy text and asset download links is simpler.
- **Options:** (a) ZIP download (requires Edge Function or API route to assemble). (b) Modal showing formatted caption text per platform + direct storage URLs for each media asset. (c) Both: modal first, ZIP option in modal.
- **Recommended default:** Option (b) for MVP. The owner can copy text from the modal and download images via direct links. ZIP generation is a v1.1 enhancement.
- **Blocks:** DownloadAssetsModal component design, failed post detail page layout.

---

**OPD-7: Story Series form — keep as separate tab or fold into Instant Post?**

- **Problem:** The "Stories" tab (`StorySeriesForm`) allows batch-scheduling multiple story slots with individual media per slot. The "Instant Post" flow (placement=story) handles single-story creation. Two paths to create stories causes confusion.
- **Options:** (a) Remove the Stories tab; all stories go through Instant Post. (b) Keep both; document the difference clearly ("single story" vs "story lineup"). (c) Merge: Instant Post becomes "1 story"; Stories tab becomes "Multiple stories" — rename labels to remove ambiguity.
- **Recommended default:** Option (c) for MVP with a clear label distinction. "Instant post" → "Single post or story". "Stories" tab renamed to "Story lineup" with a description "Schedule multiple stories in one go." This preserves the batch capability without confusion.
- **Blocks:** Tab label copy, CreateWizard tab definitions, onboarding tooltip content.

---

**OPD-8: Campaign management surface — dedicated `/campaigns` route or embedded in Planner?**

- **Problem:** Weekly (and future recurring) campaigns need a management surface for pause/resume/edit. Should this be a top-level nav item or a section within the Planner?
- **Options:** (a) New top-level nav item "Campaigns" — breaks the ≤5 nav limit in PRD section 5. (b) Sub-section within Planner ("Active campaigns" sidebar or tab). (c) Accessible from individual campaign items in the Planner calendar (each item links back to its campaign).
- **Recommended default:** Option (c) for MVP (detail page of a campaign item shows "Part of campaign: Thursday Quiz Night — Pause / Edit cadence" link). Option (b) as a Planner sidebar section in v1.1. This preserves the 5-item navigation constraint.
- **Blocks:** Campaign entity detail page design, PlannerCalendar item card update (add campaign link).

---

*End of document.*
