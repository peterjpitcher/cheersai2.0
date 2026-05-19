---
phase: 06-analytics-link-in-bio-and-advanced-features
plan: 05
subsystem: publishing
tags: [recurring, auto-publish, qstash, cron, carousel, dnd-kit, instagram]

requires:
  - phase: 04-publish-pipeline
    provides: QStash dispatch, publish_jobs, state machine, approve-and-schedule
  - phase: 02-content-creation-and-scheduling
    provides: materialiseRecurringCampaigns, content_items schema, campaign_type weekly
provides:
  - Recurring auto-publish dispatch (dispatchRecurringPublishes)
  - Cron endpoint for recurring materialisation + dispatch
  - Carousel multi-image uploader with DnD reorder
  - Recurring campaign pause/resume/stop controls
  - Campaign lifecycle server actions with audit logging
affects: [publishing, planner, campaigns, create-flow]

tech-stack:
  added: ["@dnd-kit/core", "@dnd-kit/sortable", "@dnd-kit/utilities", "sonner"]
  patterns: [cron-auth-pattern, idempotent-dispatch, dnd-sortable-grid]

key-files:
  created:
    - src/lib/publishing/recurring-dispatch.ts
    - src/lib/publishing/recurring-dispatch.test.ts
    - src/app/api/cron/recurring-publish/route.ts
    - src/features/create/carousel-uploader.tsx
    - src/app/(app)/campaigns/[id]/recurring-controls.tsx
    - src/app/actions/campaigns.ts
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "Idempotency via publish_jobs existence check per content_item_id+platform"
  - "Silent dispatch (D-13): no notification for auto-published recurring items"
  - "Sonner toast for recurring controls feedback"

patterns-established:
  - "Recurring dispatch: query auto_confirm+auto_generated+scheduled+lte(now), check idempotency, insert job, transition, dispatch"
  - "Carousel DnD: @dnd-kit/sortable with rectSortingStrategy for grid reorder"

requirements-completed: [SCHED-04, PERF-03]

duration: 4min
completed: 2026-05-19
---

# Phase 06 Plan 05: Recurring Auto-Publish and Carousel Summary

**Recurring auto-publish dispatch with QStash cron (every 15 min), carousel uploader with DnD reorder (2-10 images), and pause/resume/stop controls for recurring campaigns**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-19T16:02:32Z
- **Completed:** 2026-05-19T16:06:50Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Recurring dispatch finds due auto_confirm items and dispatches to QStash silently (D-13, SCHED-04)
- Cron endpoint materialises recurring slots then dispatches on 15-min schedule
- Carousel uploader enforces Instagram constraints (2-10 images, 4:5 to 1.91:1 aspect, 8MB limit)
- Pause/resume/stop controls with confirmation dialog and audit logging (D-14)

## Task Commits

Each task was committed atomically:

1. **Task 1: Recurring auto-publish dispatch and cron endpoint** - `45d44d2` (feat)
2. **Task 2: Carousel uploader and recurring campaign controls** - `f9e4607` (feat)

## Files Created/Modified
- `src/lib/publishing/recurring-dispatch.ts` - Finds due auto_confirm items, creates publish_jobs, dispatches to QStash
- `src/lib/publishing/recurring-dispatch.test.ts` - 5 tests: dispatch, idempotency, error resilience, no-client
- `src/app/api/cron/recurring-publish/route.ts` - POST cron endpoint with CRON_SECRET auth
- `src/features/create/carousel-uploader.tsx` - Multi-image upload with DnD reorder via @dnd-kit
- `src/app/(app)/campaigns/[id]/recurring-controls.tsx` - Pause/resume/stop UI with confirmation
- `src/app/actions/campaigns.ts` - Server actions with auth, ownership check, audit logging

## Decisions Made
- Idempotency check queries publish_jobs for existing content_item_id+platform before inserting
- Silent dispatch (D-13): recurring auto-publishes have no notification -- by design
- Used sonner for toast notifications in recurring controls (installed as new dependency)
- Used @dnd-kit for carousel reorder (consistent with sortable grid pattern)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing @dnd-kit and sonner dependencies**
- **Found during:** Task 2
- **Issue:** @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities, and sonner not in package.json
- **Fix:** npm install for all four packages
- **Files modified:** package.json, package-lock.json
- **Verification:** tsc --noEmit passes with zero errors
- **Committed in:** f9e4607

**2. [Rule 1 - Bug] Fixed JSDoc comment with cron expression breaking TypeScript parser**
- **Found during:** Task 1 verification
- **Issue:** `*/15 * * * *` in JSDoc comment parsed as close-comment token
- **Fix:** Changed to single-line comment format
- **Files modified:** src/app/api/cron/recurring-publish/route.ts
- **Committed in:** f9e4607

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes necessary for compilation. No scope creep.

## Issues Encountered
None beyond the auto-fixed items above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Recurring dispatch ready for production once CRON_SECRET is configured in Vercel
- Carousel uploader ready to wire into create wizard form
- All Phase 06 plans now complete

---
*Phase: 06-analytics-link-in-bio-and-advanced-features*
*Completed: 2026-05-19*
