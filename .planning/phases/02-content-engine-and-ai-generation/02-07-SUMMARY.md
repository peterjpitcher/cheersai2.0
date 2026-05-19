---
phase: 02-content-engine-and-ai-generation
plan: 07
subsystem: scheduling, ui
tags: [luxon, conflict-detection, calendar, radix-sheet, react-query, planner]

requires:
  - phase: 02-01
    provides: content types, status chip, platform badge
  - phase: 02-02
    provides: content wizard brief types
  - phase: 02-03
    provides: getContentForCalendar query, getContentByAccount query
provides:
  - detectConflicts() — 30-min per-platform conflict detection with resolution suggestions
  - materialiseRecurring() — expands weekly campaigns into individual calendar slots
  - PlannerCalendar — 6-week grid with month navigation and filtering
  - CalendarCell — compact day cell with status chips and conflict indicators
  - StatusFilters — status and platform toggle filter bar
  - PostDrawer — right-side Sheet drawer for post detail (UX-10)
  - Planner page route with Suspense and server-side data loading
affects: [03-publish-pipeline, 04-analytics, planner]

tech-stack:
  added: []
  patterns: [v2-alongside-v1 scheduling logic, pure-function materialiser, client-calendar-with-server-loader]

key-files:
  created:
    - src/lib/scheduling/conflicts.test.ts
    - src/lib/scheduling/materialise.test.ts
    - src/lib/scheduling/conflicts-v1.ts
    - src/features/planner/calendar-cell.tsx
    - src/features/planner/status-filters.tsx
    - src/features/planner/post-drawer.tsx
    - src/features/planner/planner-calendar-v2.tsx
  modified:
    - src/lib/scheduling/conflicts.ts
    - src/lib/scheduling/materialise.ts
    - src/app/(app)/planner/page.tsx

key-decisions:
  - "V2 scheduling functions added alongside v1 for backward compatibility -- v1 code preserved in conflicts-v1.ts"
  - "PlannerCalendar is client component receiving server-fetched data via props (server loader pattern)"
  - "PostDrawer fetches via React Query from /api/content/{id} for client-side detail loading"

patterns-established:
  - "Server loader pattern: async server component fetches data, passes to client calendar via props"
  - "V2-alongside-V1: new implementations coexist with old via -v1 suffix files and re-exports"

requirements-completed: [SCHED-01, SCHED-02, SCHED-03, SCHED-05]

duration: 6min
completed: 2026-05-19
---

# Phase 02 Plan 07: Planner Calendar and Scheduling Summary

**6-week planner calendar with 30-min conflict detection, recurring materialisation, status/platform filters, and right-side post detail drawer -- all timezone-aware via Europe/London**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-19T09:54:55Z
- **Completed:** 2026-05-19T10:01:24Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- Conflict detection identifies items within 30-min window per platform with resolution suggestions (SCHED-02)
- Recurring materialiser expands weekly campaigns into individual calendar slots with weeksAhead control (SCHED-03)
- 6-week grid calendar with month navigation, today highlight, and compact density (SCHED-01)
- Post detail side drawer via Radix Sheet (UX-10, UX-08)
- 12 tests covering conflict edge cases and materialiser behavior

## Task Commits

Each task was committed atomically:

1. **Task 1: Scheduling logic -- conflict detection and recurring materialiser** - `7b11c3d` (feat)
2. **Task 2: Planner calendar UI, status filters, post drawer, and page route** - `ae7af16` (feat)

_Task 1 used TDD: tests written first (RED), then implementation (GREEN)._

## Files Created/Modified
- `src/lib/scheduling/conflicts.ts` - V2 detectConflicts with 30-min window per platform
- `src/lib/scheduling/conflicts-v1.ts` - V1 resolveConflicts preserved for backward compat
- `src/lib/scheduling/conflicts.test.ts` - 7 tests for conflict detection
- `src/lib/scheduling/materialise.ts` - Added materialiseRecurring pure function
- `src/lib/scheduling/materialise.test.ts` - 5 tests for recurring materialiser
- `src/features/planner/calendar-cell.tsx` - Compact day cell with status chips and conflict warnings
- `src/features/planner/status-filters.tsx` - Status and platform toggle filter bar
- `src/features/planner/post-drawer.tsx` - Right-side Sheet drawer for post detail
- `src/features/planner/planner-calendar-v2.tsx` - 6-week grid with filtering and drawer integration
- `src/app/(app)/planner/page.tsx` - Server component with Suspense and data loading

## Decisions Made
- V2 scheduling functions added alongside v1 for backward compatibility -- v1 code preserved in conflicts-v1.ts
- PlannerCalendar is a client component receiving server-fetched data via props (server loader pattern)
- PostDrawer uses React Query for client-side detail loading from /api/content/{id}

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Preserved v1 conflict resolution for existing materialise.ts**
- **Found during:** Task 1
- **Issue:** Existing materialise.ts imports resolveConflicts from conflicts.ts; rewriting conflicts.ts would break it
- **Fix:** Moved v1 code to conflicts-v1.ts, re-exported from new conflicts.ts for backward compat
- **Files modified:** src/lib/scheduling/conflicts-v1.ts, src/lib/scheduling/conflicts.ts
- **Verification:** npx tsc --noEmit passes, existing code unbroken

**2. [Rule 1 - Bug] Fixed BST timezone test expectation**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** Test expected 10:30 but April is BST (+1), so suggestion correctly shows 11:30
- **Fix:** Updated test to expect 11:30 with explanatory comment
- **Files modified:** src/lib/scheduling/conflicts.test.ts
- **Verification:** All 12 tests pass

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered
None beyond the auto-fixed items above.

## User Setup Required
None - no external service configuration required.

## Known Stubs
- PostDrawer fetches from `/api/content/{id}` -- this API route may not exist yet (depends on API layer plan). Drawer will show error state until wired.
- PostDrawer Edit/Delete buttons have no server action wired yet (UI shell only -- actions come from plan 02-03/02-06 server actions).

## Next Phase Readiness
- Planner calendar ready for integration with publish pipeline (Phase 3)
- Conflict detection available for scheduling validation in server actions
- Materialiser can be called from cron jobs for automated recurring expansion

---
*Phase: 02-content-engine-and-ai-generation*
*Completed: 2026-05-19*
