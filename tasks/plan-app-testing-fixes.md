# Plan: App Testing Issues — Implementation

> Spec: `tasks/SPEC-app-testing-issues.md`
> Complexity: L (15 issues across 25+ files, no schema migrations)
> Strategy: Fix data-layer bugs first (status, titles, connections), then UI/UX polish

---

## Task 1: Fix status taxonomy — `posted` vs `published`

**Spec refs:** Critical Issue 2
**Why:** 620 DB rows with status `posted` render as draft styling because `ContentStatus` type and `toDesignStatus()` don't handle `posted`.

**Files:**
- `src/types/content.ts:9` — add `'posted'` to `ContentStatus` union
- `src/features/planner/calendar-cell.tsx:55-58` — update `toDesignStatus()` to map `'posted'` → `'posted'` (same as `'published'`)
- `src/features/planner/planner-agenda.tsx:17-20` — same `toDesignStatus()` fix
- `src/features/planner/status-filters.tsx:11` — make the `Published` filter match both `'published'` and `'posted'`

**Tests to add:**
- Unit test: `toDesignStatus('posted')` returns posted/published design status
- Unit test: status filter includes `posted` rows when "Published" is active

**Acceptance:** A content item with `status: 'posted'` renders with the same styling as `'published'`, not draft.

---

## Task 2: Fix planner title fallback chain

**Spec refs:** Critical Issue 1
**Why:** 140/140 current planner rows have `title IS NULL`, showing "Untitled" everywhere.

**Files:**
- `src/features/planner/calendar-cell.tsx:26-27` — replace `item.title ?? 'Untitled'` with a `getDisplayTitle(item)` helper that walks: title → campaignName → body preview (first 40 chars) → platform + date → `'Untitled'`
- `src/features/planner/planner-agenda.tsx:179` — use same `getDisplayTitle(item)` helper
- `src/lib/content/queries.ts:21` — ensure `mapContentItem()` also maps `campaign_name` from the query (check if it's already selected)
- `src/types/content.ts` — ensure `ContentItem` has `campaignName: string | null`

**New file:**
- `src/lib/content/display-helpers.ts` — `getDisplayTitle(item: ContentItem): string` with fallback chain

**Tests to add:**
- Unit test: `getDisplayTitle()` with null title + campaignName returns campaignName
- Unit test: `getDisplayTitle()` with all nulls returns `'Untitled'`
- Unit test: `getDisplayTitle()` with body text returns truncated preview

**Acceptance:** Planner rows show campaign name or body preview instead of "Untitled" for rows that have that data available.

---

## Task 3: Fix "posts need attention" banner

**Spec refs:** Critical Issue 3
**Why:** Banner counts all-time failures (6), links to `/planner?status=failed` which the planner ignores, and says "Reconnect" for non-connection failures.

**Files:**
- `src/features/planner/attention-needed-banner.tsx:84` — change CTA text from "Reconnect" to "View failed posts"; change href to `/planner?status=failed`
- `src/app/(app)/planner/page.tsx` — parse `status` search param and pass as `initialStatus` prop to PlannerShell
- `src/features/planner/planner-shell.tsx` — accept `initialStatus` prop, pass to PlannerCalendar
- `src/features/planner/planner-calendar-v2.tsx` — initialise status filter state from `initialStatus` prop
- `src/features/planner/status-filters.tsx` — ensure "Failed" filter option exists
- `src/lib/planner/notifications.ts:55-74` — scope `getFailedPublishCount()` to the current planner window (last 6 weeks) instead of all-time, OR keep all-time but make the destination show all failed (not planner-scoped)

**Decision needed:** The spec says to choose between all-time failure queue vs planner-scoped count. **Recommendation:** Keep the count all-time (users want to know about all failures) but link to a filtered planner view that auto-expands the date range to include the failed items. Simplest MVP: just parse `?status=failed` and set the filter — users can then navigate months to find them.

**Tests to add:**
- Unit test: planner page passes `initialStatus` from search params
- Unit test: status filter initialises from prop

**Acceptance:** Clicking the banner CTA opens planner with the Failed filter pre-selected.

---

## Task 4: Fix connection health schema drift

**Spec refs:** Critical Issue 5
**Why:** `getConnectionHealthSummaries()` queries `social_connections.platform` which doesn't exist — live table uses `provider`. Silently fails in layout.

**Files:**
- `src/lib/connections/health.ts:54-66` — change `platform` to `provider` in the select query; map `provider` to the health summary output
- `src/lib/connections/data.ts` — verify it already uses `provider` (confirmed); ensure `token_expires_at` fallback to `expires_at` if needed
- `src/features/connections/connection-cards.tsx:88-95` — replace "Reconnect required" for null expiry with distinct states: "Does not expire" (Facebook), "Unknown expiry" (others with null), "Expires {date}", "Expired — reconnect required"
- `src/app/api/cron/notify-expiring-connections/route.ts` — check if it reads `expires_at` and update to `token_expires_at`
- `src/lib/publishing/preflight.ts` — check for legacy field references

**Tests to add:**
- Unit test: `getConnectionHealthSummaries()` handles all three providers with various expiry states
- Unit test: connection card renders correct status for Facebook (null expiry = does not expire)

**Acceptance:** Connection health loads without silent failure; each provider shows accurate expiry status.

---

## Task 5: Cap notification badge

**Spec refs:** Critical Issue 4
**Why:** Badge shows raw count `1988`, overflowing the small badge element.

**Files:**
- `src/components/layout/top-rail.tsx:21-49` — cap display: `notificationCount > 99 ? '99+' : notificationCount`

**Tests to add:**
- Unit test: badge renders "99+" when count is 100+
- Unit test: badge renders exact number when count ≤ 99

**Acceptance:** Badge never shows more than "99+".

---

## Task 6: Rationalise auth routes

**Spec refs:** High Issue 6
**Why:** `/login` is not in public paths list, causing unauthenticated users to be redirected to `/auth/login` which redirects to `/login` — fragile redirect chain.

**Files:**
- `src/app/proxy.ts:7-13` — add `/login` to `PUBLIC_PATH_PREFIXES`
- `src/app/(auth)/layout.tsx:10-12` — change redirect target from `/dashboard` to `/planner` (planner is the real app home)
- `src/app/proxy.ts:31-35` — change unauthenticated redirect from `/auth/login` to `/login`

**Tests to add:**
- Unit test: proxy identifies `/login` as public path

**Acceptance:** Unauthenticated users go directly to `/login` without double-redirect. Authenticated users at `/login` go to `/planner`.

---

## Task 7: Add cursor-pointer global rule

**Spec refs:** High Issue 10
**Why:** Buttons across the app don't show pointer cursor — weak clickable affordance.

**Files:**
- `src/app/globals.css` — add global rule: `button:not(:disabled), [role="button"]:not(:disabled) { cursor: pointer; }`

**No tests needed** — CSS-only change.

**Acceptance:** All enabled buttons show pointer cursor on hover.

---

## Task 8: Add mobile nav overflow menu

**Spec refs:** High Issue 8
**Why:** Mobile users can't reach Campaigns, Reviews, Tournaments, or Settings.

**Files:**
- `src/config/app-nav.ts:26-32` — add a "More" item to `MOBILE_NAV_ITEMS` with `isOverflow: true`
- `src/components/layout/bottom-nav.tsx` — render the "More" item as an overflow trigger that opens a sheet/popover with remaining nav items (Campaigns, Reviews, Tournaments, Settings)

**Tests to add:**
- Unit test: overflow menu contains all desktop nav items not in mobile nav

**Acceptance:** All app sections reachable from mobile bottom nav via overflow menu.

---

## Task 9: Fix tournaments route consistency

**Spec refs:** High Issue 9
**Why:** Tournaments is the only section nested under `/dashboard/tournaments` instead of root-level `/tournaments`.

**Files:**
- `src/config/app-nav.ts` — update tournaments href from `/dashboard/tournaments` to `/tournaments`
- Create `src/app/(app)/tournaments/page.tsx` — move/copy from `src/app/(app)/dashboard/tournaments/page.tsx`
- Create `src/app/(app)/tournaments/[id]/page.tsx` — move/copy from `src/app/(app)/dashboard/tournaments/[id]/page.tsx`
- Keep old routes as redirects to new paths

**Acceptance:** `/tournaments` loads the tournaments page; `/dashboard/tournaments` redirects to `/tournaments`.

---

## Task 10: Fix planner image toggle for agenda view

**Spec refs:** Medium Issue 11
**Why:** The "Images" toggle is visible in agenda view but has no effect.

**Files:**
- `src/features/planner/planner-shell.tsx:71-73` — pass `showImages` to `PlannerAgenda` as well, OR hide the toggle when agenda view is active

**Recommendation:** Hide the toggle in agenda view (simplest; agenda rows are compact and thumbnails would need design work).

**Acceptance:** Image toggle hidden or functional in agenda view.

---

## Task 11: Fix post drawer dead Delete button

**Spec refs:** Medium Issue 12
**Why:** Delete button renders but has no onClick handler — dead destructive control.

**Files:**
- `src/features/planner/post-drawer.tsx` — either wire the Delete button to a server action (soft-delete: set status to `'archived'`), or remove the button until delete functionality is implemented

**Recommendation:** Remove the button for now and add a TODO comment. A dead destructive button is worse than no button.

**Acceptance:** No non-functional Delete button visible in the drawer.

---

## Task 12: Fix login password form mode switch

**Spec refs:** Medium Issue 13
**Why:** Clicking "Use password instead" shows both forms simultaneously with mismatched heading.

**Files:**
- `src/app/(auth)/login/page.tsx` — use a single `authMode` state (`'magic-link' | 'password'`); conditionally render only the active form; update heading text per mode

**Acceptance:** Only one auth form visible at a time with matching heading.

---

## Task 13: Fix connection card expiry copy

**Spec refs:** Medium Issue 14
**Why:** Covered by Task 4 — the connection cards expiry states fix. No separate task needed.

**Status:** Merged into Task 4.

---

## Execution Order

Tasks are ordered by dependency and priority from the spec:

| Wave | Tasks | Rationale |
|------|-------|-----------|
| 1 | 1, 2, 5, 7 | Independent data/display fixes, no cross-dependencies |
| 2 | 3, 4, 6 | Depend on understanding from wave 1; touch routing and query layers |
| 3 | 8, 9, 10, 11, 12 | UI/UX polish; lower severity; independent of each other |

## Out of Scope

- **Issue 7 (media thumbnails):** Spec says to re-test with browser network evidence before implementing. Not actionable without that evidence.
- **Issue 15 (dev tools counter):** Needs console capture; not a confirmed app defect.
- **Database migrations:** No schema changes in this plan. Status fix adds `posted` to TS types only (DB already has `posted`). Connection fix changes query column names to match existing schema.
- **Backfill scripts:** Title backfill for existing rows is noted but deferred — the fallback chain will handle display immediately.
