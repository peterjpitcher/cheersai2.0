---
phase: 05-realtime-ux-and-notifications
plan: 03
subsystem: performance
tags: [suspense, startTransition, IntersectionObserver, lazy-loading, autocannon, load-test, LCP, INP]

requires:
  - phase: 02-content-creation-and-scheduling
    provides: Planner calendar page with Suspense boundary and data-fetching
provides:
  - Planner Suspense boundary isolated to data-fetching component only
  - Calendar interactions wrapped in startTransition for INP < 200ms
  - Library lazy-loaded image grid via IntersectionObserver
  - Autocannon load test script targeting 50 concurrent connections at p99 < 500ms
  - Supabase preconnect hint in root layout
affects: [performance, planner, library, deployment]

tech-stack:
  added: [autocannon, "@types/autocannon"]
  patterns: [startTransition for deferred state updates, IntersectionObserver lazy loading, force-dynamic for personalised pages]

key-files:
  created:
    - scripts/load-test-planner.ts
    - src/features/library/lazy-image-row.tsx
  modified:
    - src/app/(app)/planner/page.tsx
    - src/features/planner/planner-calendar-v2.tsx
    - src/features/library/media-asset-grid-client.tsx
    - src/app/layout.tsx
    - package.json

key-decisions:
  - "Wrap filter callbacks in startTransition rather than debouncing -- React 19 concurrent rendering is the correct INP solution"
  - "Lazy-load at tag-group level rather than per-image -- groups are the natural content boundary in the library"
  - "Use eager loading for first image group, lazy for all subsequent groups via IntersectionObserver"

patterns-established:
  - "startTransition pattern: wrap any state setter that causes large re-renders in startTransition for INP optimization"
  - "LazyImageRow pattern: IntersectionObserver wrapper component with 200px rootMargin for below-fold content"
  - "force-dynamic export: use on all personalised pages to prevent stale static generation"

requirements-completed: [PERF-01, PERF-02, PERF-04, PERF-05, PERF-06]

duration: 4min
completed: 2026-05-19
---

# Phase 5 Plan 3: Performance Budgets Summary

**Planner Suspense isolation + startTransition INP optimization + library IntersectionObserver lazy loading + autocannon load test script**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-19T14:59:06Z
- **Completed:** 2026-05-19T15:03:36Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Planner page Suspense boundary properly isolated around data-fetching only; PageHeader renders immediately for fast skeleton paint
- Calendar filter interactions (status and platform) wrapped in startTransition for INP < 200ms
- Library image grid uses IntersectionObserver lazy loading -- first group renders immediately, subsequent groups load on scroll
- Autocannon load test script targets planner with 50 concurrent connections for 30s, asserts p99 < 500ms

## Task Commits

Each task was committed atomically:

1. **Task 1: Planner and Library performance optimization** - `af3e54a` (feat)
2. **Task 2: Load test script and performance verification tooling** - `5e9cc29` (feat)

## Files Created/Modified
- `src/app/(app)/planner/page.tsx` - Added force-dynamic, clarified Suspense boundary comments
- `src/features/planner/planner-calendar-v2.tsx` - Added startTransition wrapping for filter state updates
- `src/features/library/lazy-image-row.tsx` - New IntersectionObserver wrapper component for lazy loading
- `src/features/library/media-asset-grid-client.tsx` - Integrated LazyImageRow for non-first tag groups, eager/lazy loading strategy
- `src/app/layout.tsx` - Added Supabase preconnect hint in head
- `scripts/load-test-planner.ts` - Autocannon load test targeting 50 connections, 30s, p99 < 500ms
- `package.json` - Added autocannon devDep and perf:load-test script

## Decisions Made
- Wrap filter callbacks in startTransition rather than debouncing -- React 19 concurrent rendering is the correct INP solution
- Lazy-load at tag-group level rather than per-image -- groups are the natural content boundary in the library
- Use eager loading for first image group, lazy for all subsequent groups via IntersectionObserver

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing type errors in EnqueuePublishJobOptions (planner/actions.ts, tournament.ts, create/service.ts) -- not caused by this plan, documented as out of scope

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Performance optimizations in place for planner and library pages
- Load test script ready to verify p99 targets against running dev server
- Pre-existing type errors in EnqueuePublishJobOptions should be addressed in a separate fix

---
*Phase: 05-realtime-ux-and-notifications*
*Completed: 2026-05-19*
