# CheersAI 2.0 - Application Testing Issues

> Review date: 2026-05-20  
> Scope: critical review of the previous browser-testing issue list against the actual codebase and live Supabase data.  
> Validated paths: login/auth, protected app shell, planner calendar/agenda/drawer, notifications, connections, routes/navigation, media thumbnail resolution, current tests.  
> Database validation: remote Supabase project from local env was queried with service-role access. No secrets are recorded here.

---

## Critical Review Notes

The previous version was useful as a symptom log, but too much of it guessed at causes. The biggest problem is that it pointed several planner issues at `src/lib/planner/data.ts`, while the visible planner page is currently driven by:

- `src/app/(app)/planner/page.tsx`
- `src/lib/content/queries.ts`
- `src/features/planner/planner-shell.tsx`
- `src/features/planner/planner-calendar-v2.tsx`
- `src/features/planner/planner-agenda.tsx`
- `src/features/planner/calendar-cell.tsx`

`src/lib/planner/data.ts` is still active for the post detail API and some activity helpers, but it is not the primary calendar/agenda data source. Fixes that only patch `PlannerItem` in that file will not fix the visible planner grid/list.

Live DB validation also changes the diagnosis:

| Check | Live result |
|---|---:|
| Active account content rows | 791 |
| Content rows with `title IS NULL` | 783 |
| Current 6-week planner window rows | 140 |
| Current 6-week rows with `title IS NULL` | 140 |
| Current 6-week status mix | 101 `posted`, 38 `scheduled`, 1 `draft` |
| Failed publish jobs | 6 |
| Failed content rows in current planner window | 0 |
| Unread, undismissed notifications | 1988 |
| Social connections | facebook, gbp, instagram all `active` |
| `social_connections.platform` column | does not exist |
| Sample signed media URLs | signed, TTL 600s, HTTP 200 |

---

## Critical Issues

### 1. Planner titles are broken because production rows have no titles

**Severity:** Critical  
**Status:** Confirmed by code and live DB  
**Location:** Planner calendar, mobile calendar list, agenda rows, post drawer context

**Observed:** Planner entries render `Untitled` or equivalent non-descriptive labels for scheduled and posted content.

**Actual root cause:** The active planner uses `getContentForCalendar()` in `src/lib/content/queries.ts`, which maps `content_items.title` into `ContentItem.title`. Live data shows the active account has 783/791 content rows with `title IS NULL`; the current 6-week planner window has 140/140 rows with `title IS NULL`. This is not primarily a missing `PlannerItem.title` field in `src/lib/planner/data.ts`.

**Contributing code paths:**

- `src/lib/content/queries.ts` maps `row.title` directly.
- `src/features/planner/calendar-cell.tsx` falls back to `Untitled`.
- `src/features/planner/planner-agenda.tsx` falls back to `Untitled`.
- `src/app/actions/content.ts#createScheduledBatch()` creates planner rows without `title` or `campaign_name`.

**Fix:**

1. Populate `title` and preferably `campaign_name` when planner-compatible rows are created.
2. Backfill existing rows from campaign data, draft brief titles, or the first meaningful line of `content_variants.body`.
3. Add a defensive display fallback such as campaign name, body preview, platform/date label, then `Untitled`.
4. Add tests for `mapContentItem()`/planner row creation and for calendar/agenda rendering with null titles.

---

### 2. Status model is inconsistent: DB uses `posted`, UI/types expect `published`

**Severity:** Critical  
**Status:** Confirmed by code and live DB  
**Location:** Planner calendar, agenda, status filters, header summary, detail drawer

**Observed:** Previously published posts are displayed as draft-like in parts of the planner. The earlier spec said the detail panel shows `Published`; the real issue is a status taxonomy mismatch.

**Actual root cause:** Live `content_items.status` values include `posted` (620 rows), but `src/types/content.ts` defines `ContentStatus` as `draft | review | approved | scheduled | queued | publishing | published | failed`. The v2 calendar and agenda status mappers handle `published`, not `posted`, so `posted` falls through to the default `draft` design status.

**Affected code:**

- `src/types/content.ts`
- `src/features/planner/calendar-cell.tsx#toDesignStatus`
- `src/features/planner/planner-agenda.tsx#toDesignStatus`
- `src/features/planner/status-filters.tsx` uses a `Published` filter mapped to `published`, not `posted`.
- `src/lib/planner/data.ts` old path types include `posted`, so the two planner paths disagree.

**Fix:**

1. Choose one canonical persisted status: either migrate DB `posted` to `published`, or formally add `posted` to `ContentStatus`.
2. Normalize any legacy status at the data boundary if migration cannot be immediate.
3. Update filters so "Published" includes the live persisted status.
4. Add tests with a `posted` row and a `published` row to prevent future drift.

---

### 3. "Posts need attention" banner cannot lead users to the failed rows

**Severity:** Critical  
**Status:** Confirmed by code and live DB  
**Location:** Planner attention banner and status filters

**Observed:** Banner says 6 posts need attention, but clicking the CTA opens `/planner?status=failed` and the planner remains empty for failed posts.

**Actual root cause:** There are three separate mismatches:

1. `getFailedPublishCount()` counts all `publish_jobs.status = failed` for the account, across all time.
2. The failed content rows are dated 2025-10-29, 2025-11-30, 2025-12-05, 2026-02-14, 2026-02-18, and 2026-03-17. None are inside the current 6-week May 2026 planner window.
3. The active planner does not parse `status=failed` from the URL. Status filters are local client state in `src/features/planner/planner-calendar-v2.tsx`.

**Affected code:**

- `src/lib/planner/notifications.ts#getFailedPublishCount`
- `src/features/planner/attention-needed-banner.tsx`
- `src/app/(app)/planner/page.tsx`
- `src/features/planner/planner-calendar-v2.tsx`
- `src/features/planner/status-filters.tsx`

**Fix:**

1. Decide whether the banner is an all-time failure queue or a current-window planner warning.
2. If all-time, link to a real failed publishing queue/status drawer that lists the six failed jobs directly.
3. If planner-scoped, count only failed content visible in the selected date range.
4. Parse `status`, `platform`, and potentially `month` URL params into initial filter state.
5. Rename the CTA from `Reconnect` unless the failure is actually a connection failure. The live failures are provider/media errors, not necessarily reconnect problems.

---

### 4. Notification badge displays an uncapped raw backlog count

**Severity:** Critical  
**Status:** Confirmed by code and live DB  
**Location:** Top navigation notification bell

**Observed:** The top rail badge displays `1988`, which overflows the small badge and is not actionable.

**Actual root cause:** `src/components/layout/top-rail.tsx` renders `notificationCount` directly. `getUnreadNotificationCount()` counts all notifications where `read_at IS NULL AND dismissed_at IS NULL`; live data has 1988 matching rows. The capped `NotificationBadge` component exists but is not used by `TopRail`.

**Fix:**

1. Cap display at `99+` or use the existing badge logic consistently.
2. Add "mark all as read" and/or bulk dismiss actions.
3. Introduce retention or read-on-open behavior for old `publish_success` noise.
4. Consider excluding low-value categories like `publish_success` from the top-level urgent count.

---

### 5. Connection health is partly broken by v1/v2 schema drift

**Severity:** Critical  
**Status:** Confirmed by code and live DB  
**Location:** App layout health summaries, connections page, token expiry display

**Observed:** Connection health indicators/toasts can silently disappear, and token expiry messaging is misleading.

**Actual root cause:**

- `src/lib/connections/health.ts#getConnectionHealthSummaries()` selects `social_connections.platform`, but the live table has `provider`, not `platform`. A live query for `platform` fails with `column social_connections.platform does not exist`. The app layout catches this and silently falls back to no health summaries.
- `src/lib/connections/data.ts` correctly selects `provider` and `token_expires_at`, but live GBP has `token_expires_at = null` while legacy `expires_at` is populated. The card therefore shows "Reconnect required" for an active GBP connection with expiry data stored in the legacy column.
- Facebook and Instagram have null token expiry. That may be valid for Facebook page tokens, but the UI currently gives users a blanket reconnect-style message when `expiresAt` is missing.

**Affected code:**

- `src/lib/connections/health.ts`
- `src/lib/connections/data.ts`
- `src/features/connections/connection-cards.tsx`
- `src/app/(app)/layout.tsx`
- `src/app/api/cron/notify-expiring-connections/route.ts` still reads legacy `expires_at`
- `src/lib/publishing/preflight.ts` still reads legacy connection fields

**Fix:**

1. Normalize `provider`/`platform` and `expires_at`/`token_expires_at` in one compatibility layer.
2. Update `getConnectionHealthSummaries()` to query the real schema.
3. Backfill `token_expires_at` from `expires_at` where appropriate, or intentionally deprecate `expires_at` and update every consumer.
4. Display "Does not expire", "Unknown", "Expires <date>", or "Reconnect required" as distinct states.
5. Stop swallowing schema errors silently in layout during development; log enough to catch this class of failure.

---

## High Issues

### 6. Auth routes are split between `/login` and `/auth/login`

**Severity:** High  
**Status:** Confirmed code risk; browser symptom needs re-test after proxy/middleware decision  
**Location:** Login/auth routing

**Observed in previous browser pass:** An authenticated user saw app layout/content at `/login` instead of a clean redirect.

**Code reality:** There are two login paths:

- `src/app/(auth)/login/page.tsx` serves `/login`.
- `src/app/auth/login/page.tsx` permanently redirects `/auth/login` to `/login`.
- `src/app/proxy.ts` treats `/auth/` as public but not `/login`.
- `src/app/(auth)/layout.tsx` redirects authenticated users to `/dashboard`.
- `middleware.ts` also exists for host redirects, so auth protection behavior depends on the Next 16 proxy/middleware configuration.

**Risk:** This is fragile enough to cause redirect loops for unauthenticated users or stale app shell leakage for authenticated users. It also redirects unauthenticated protected routes to `/auth/login`, which then redirects to `/login`.

**Fix:**

1. Pick one canonical auth URL.
2. Add `/login` to public auth paths if `/login` remains canonical.
3. Redirect authenticated users to `/planner` or the `next` target, not `/dashboard` unless `/dashboard` is intentionally the app home.
4. Add Playwright coverage for unauthenticated `/planner`, unauthenticated `/login`, authenticated `/login`, and `/auth/login`.

---

### 7. Media thumbnails rely on short-lived signed URLs in a dense image grid

**Severity:** High  
**Status:** Partially confirmed  
**Location:** Planner thumbnails

**Observed in previous browser pass:** Some image loads aborted or appeared blank.

**Validated facts:**

- The current planner resolves thumbnails through `src/lib/media/resolve-thumbnails.ts`.
- All 140 current planner rows have media attachments.
- Sample generated Supabase signed URLs have a 600-second TTL and returned HTTP 200 when checked immediately.
- `next.config.ts` allows `**.supabase.co`, so this is not simply a missing remote image host.

**What is not proven:** The live DB check does not prove the `ERR_ABORTED` cause. Aborts can come from route changes, browser cancellation, Next image optimizer retries, expired signed URLs, or too many simultaneous requests.

**Fix:**

1. Add browser/network instrumentation before claiming expiry as the cause.
2. Consider a stable authenticated image proxy route or longer-lived thumbnail cache for planner grids.
3. Avoid embedding 600-second signed URLs into UI that can remain mounted or cached longer than 10 minutes.
4. Add a fallback visual and retry behavior for failed thumbnails.

---

### 8. Mobile navigation hides major sections

**Severity:** High  
**Status:** Confirmed by code  
**Location:** Mobile app shell

**Observed:** Mobile bottom nav only includes Planner, Create, Library, and Connections. Campaigns, Reviews, Tournaments, and Settings are not first-class mobile destinations.

**Affected code:**

- `src/config/app-nav.ts#MOBILE_NAV_ITEMS`
- `src/components/layout/bottom-nav.tsx`
- `src/components/layout/top-rail.tsx`

**Fix:** Add an overflow menu or account menu that exposes all desktop nav items plus Settings. Do not rely on users guessing URLs.

---

### 9. Tournaments route is inconsistent with the rest of the app

**Severity:** High  
**Status:** Confirmed by code  
**Location:** Routing/navigation

**Observed:** Main app sections are root-level (`/planner`, `/create`, `/campaigns`, `/library`, `/reviews`, `/connections`) except tournaments at `/dashboard/tournaments`. There is no `/tournaments` route.

**Affected code:**

- `src/config/app-nav.ts`
- `src/app/(app)/dashboard/tournaments/page.tsx`
- `src/app/(app)/dashboard/tournaments/[id]/page.tsx`
- `src/app/actions/tournament.ts`

**Fix:** Either move tournaments to `/tournaments` or add redirects from `/tournaments` and `/tournaments/[id]` to the current route. Root-level is more consistent.

---

### 10. App-wide clickable affordance is weak because buttons omit pointer cursor

**Severity:** High  
**Status:** Confirmed by code  
**Location:** Global UI primitives and hand-written buttons

**Observed:** Buttons do not consistently show a pointer cursor.

**Root cause:** `Button`, `ToggleChip`, `Segmented`, `CalendarCell` buttons, and many inline buttons do not include `cursor-pointer`; there is no global `button { cursor: pointer; }` rule in `src/app/globals.css`.

**Fix:** Add a global interactive cursor rule for enabled buttons/links with role-button semantics, or include `cursor-pointer` in the shared primitives and audit inline buttons.

---

## Medium Issues

### 11. Planner image toggle has no effect in agenda view

**Severity:** Medium  
**Status:** Confirmed by code  
**Location:** Planner toolbar and agenda

**Observed:** The "Images" toggle remains visible in agenda view but `PlannerShell` passes `showImages` only to `PlannerCalendar`, not `PlannerAgenda`.

**Fix:** Either hide/disable the toggle in agenda view or add thumbnail support to agenda rows.

---

### 12. Post drawer editing exists, but only for schedule and copy

**Severity:** Medium  
**Status:** Corrected from previous spec  
**Location:** Post detail drawer

**Previous claim:** The drawer has no edit functionality.  
**Actual:** `src/features/planner/post-drawer.tsx` has inline schedule editing and copy editing for editable statuses.

**Remaining issues:**

- The drawer title is generic `Post Details`; it does not expose the post title.
- There is no edit path for title, media, platform, placement, or campaign metadata.
- The visible Delete button has no handler, so it is currently a dead destructive control.

**Fix:** Replace the dead Delete button with a wired delete/soft-delete action and add title/media edit coverage if those workflows are in scope.

---

### 13. Login password fallback shows two auth forms at once

**Severity:** Medium  
**Status:** Confirmed by code  
**Location:** `/login`

**Observed:** Clicking "Use password instead" shows the password form below the magic-link form, while the heading still says "Enter your email to receive a sign-in link".

**Fix:** Use a single mode switch (`magic-link` vs `password`) or update the heading/subtitle when password mode is visible.

---

### 14. Connections page status copy conflates several token states

**Severity:** Medium  
**Status:** Confirmed by code and live DB  
**Location:** Connections cards

**Observed:** Missing expiry values are shown as "Reconnect required". Live data has active connections with null `token_expires_at`; for Facebook this can be expected, for Instagram it may be unknown, and for GBP the legacy `expires_at` column has a value.

**Fix:** Distinguish:

- Does not expire
- Unknown expiry
- Expires on date
- Expired
- Reconnect required

This should be driven by the normalized connection compatibility layer from Critical Issue 5.

---

## Low Issues / Needs Re-Test

### 15. Dev tools issue counter needs console evidence

**Severity:** Low  
**Status:** Browser-observed only  
**Location:** Next.js dev overlay

The earlier spec noted an increasing "N Issues" badge. Keep this as a re-test item, but do not treat it as a confirmed app defect until the console messages are captured and tied to source files.

---

## Removed or Corrected Claims

These were in the previous version but should not remain as-is:

| Previous claim | Correction |
|---|---|
| Add `title` to `PlannerItem` in `src/lib/planner/data.ts` fixes Untitled planner rows | Active planner uses `ContentItem.title`; live DB rows are null. Creation/backfill is required. |
| Agenda shows `DRAFT` while detail shows `Published` | Root issue is `posted` vs `published` taxonomy drift; v2 status chips default unknown `posted` to draft styling. |
| "38 posts scheduled" is misleading because there are many drafts | Live current-window data has exactly 38 `scheduled` rows. The count is not the main issue. |
| Calendar day "+" buttons have no accessible label | Active `CalendarCell` has `aria-label={Create post for ...}`. |
| Token expiry is blank | Current code renders "Reconnect required" when `expiresAt` is missing. The real issue is schema drift and unclear token states. |

---

## Test Coverage Gaps

The current tests do not protect the broken areas well enough.

- `e2e/tests/smoke/planner-nav.spec.ts` expects a `/planner` heading that the current page does not render as written; this smoke test is likely stale or too weak.
- `e2e/tests/full/schedule-publish.spec.ts` mostly clicks through happy-path placeholders and does not verify title/status/media rendering in the planner.
- There are no focused component tests for `PlannerCalendar`, `PlannerAgenda`, `CalendarCell`, `StatusFilters`, or `PostDrawer`.
- There is no regression test for `posted` rows.
- There is no regression test for URL-driven planner filters such as `/planner?status=failed`.
- Connection health tests cover the pure `deriveConnectionHealth()` function but not the live query shape in `getConnectionHealthSummaries()`.

Minimum tests to add:

1. Planner row with `status: "posted"` renders as published/posted, not draft.
2. Planner row with null title uses a meaningful fallback.
3. `/planner?status=failed` initializes the failed filter or redirects to the failed queue.
4. Top rail caps notification counts.
5. Connection health query uses the real `provider` column and handles legacy `expires_at`.
6. Auth route matrix for `/login`, `/auth/login`, and protected pages.

---

## Priority Order

1. Fix status taxonomy (`posted` vs `published`) and add tests.
2. Fix planner title creation/backfill/fallback.
3. Replace the failed banner CTA with a real failed-job destination or date-aware planner filter.
4. Fix connection schema drift (`provider`/`platform`, `expires_at`/`token_expires_at`).
5. Cap and clean notification counts.
6. Rationalize `/login` vs `/auth/login`.
7. Address mobile nav, tournaments route consistency, and cursor affordance.
8. Re-test image failures with browser network evidence before implementing a proxy/cache change.
