---
phase: 04-publishing-pipeline
plan: 03
subsystem: testing
tags: [msw, vitest, integration-tests, meta-graph-api, gbp-api, coverage-thresholds]

requires:
  - phase: 04-publishing-pipeline/01
    provides: "Publishing pipeline handler, state machine, adapter registry, provider adapters"
provides:
  - "MSW mock handlers for Meta Graph API and GBP Local Posts API"
  - "Integration tests for all 3 provider adapters (Facebook, Instagram, GBP)"
  - "Integration tests for pipeline handler (processPublishJob)"
  - "Coverage thresholds: publishing >=85%, scheduling >=90%"
affects: [05-polish-and-testing, ci-pipeline]

tech-stack:
  added: [msw@2.14.6]
  patterns: [msw-handler-per-provider, setupMswLifecycle-hook, error-handler-override-via-server-use]

key-files:
  created:
    - tests/msw/handlers/meta.ts
    - tests/msw/handlers/gbp.ts
    - tests/msw/handlers/index.ts
    - tests/msw/server.ts
    - src/lib/providers/facebook/adapter.integration.test.ts
    - src/lib/providers/instagram/adapter.integration.test.ts
    - src/lib/providers/gbp/adapter.integration.test.ts
    - src/lib/publishing/handler.integration.test.ts
  modified:
    - vitest.config.ts
    - package.json

key-decisions:
  - "MSW wildcard path patterns (e.g., graph.facebook.com/*/feed) instead of version-specific to decouple from API version changes"
  - "Separate metaIgAuthErrorHandler for Instagram container creation distinct from Facebook feed auth error"

patterns-established:
  - "MSW server lifecycle: import setupMswLifecycle() and call at describe-block level for consistent setup/teardown"
  - "Error handler override pattern: server.use(specificErrorHandler) in individual tests to simulate API failures"
  - "Integration test mocking: mock token-helpers and connection-metadata at module level, MSW handles HTTP layer"

requirements-completed: [TEST-01, TEST-02]

duration: 4min
completed: 2026-05-19
---

# Phase 04 Plan 03: MSW Integration Tests Summary

**MSW integration tests for all 3 provider adapters and pipeline handler with 85%/90% coverage thresholds**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-19T13:34:49Z
- **Completed:** 2026-05-19T13:38:52Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Installed MSW 2.14.6 with full Meta Graph API and GBP Local Posts API handler coverage
- 17 integration tests across Facebook (5), Instagram (3), GBP (4), and pipeline handler (5) -- all passing
- Coverage thresholds enforced: publishing >=85%, scheduling >=90% alongside existing auth >=80%

## Task Commits

Each task was committed atomically:

1. **Task 1: Install MSW and create provider mock handlers** - `02ed471` (chore)
2. **Task 2: Integration tests for adapters and pipeline handler** - `532d681` (test)

## Files Created/Modified
- `tests/msw/handlers/meta.ts` - MSW handlers for Facebook feed/photo/story and Instagram container/publish
- `tests/msw/handlers/gbp.ts` - MSW handlers for GBP local post creation and OAuth token refresh
- `tests/msw/handlers/index.ts` - Combined handler array with error handler re-exports
- `tests/msw/server.ts` - MSW setupServer with Vitest lifecycle hooks
- `src/lib/providers/facebook/adapter.integration.test.ts` - Facebook adapter: success, auth error, rate limit, story
- `src/lib/providers/instagram/adapter.integration.test.ts` - Instagram adapter: two-step publish, auth error, story
- `src/lib/providers/gbp/adapter.integration.test.ts` - GBP adapter: standard, event, offer, auth error
- `src/lib/publishing/handler.integration.test.ts` - Pipeline handler: success, idempotency, 23505, retry, failure
- `vitest.config.ts` - Added publishing and scheduling coverage thresholds
- `package.json` - Added msw devDependency

## Decisions Made
- Used wildcard MSW path patterns (`graph.facebook.com/*/feed`) instead of parameterized routes to match the actual fetch URLs without Graph API version coupling
- Created separate `metaIgAuthErrorHandler` for Instagram container creation failures, distinct from Facebook feed auth error handler

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added explicit vitest imports to MSW server.ts**
- **Found during:** Task 1 (MSW server setup)
- **Issue:** `beforeAll`, `afterEach`, `afterAll` not available as globals since vitest globals are not configured in tsconfig
- **Fix:** Added `import { beforeAll, afterEach, afterAll } from 'vitest'` to server.ts
- **Files modified:** tests/msw/server.ts
- **Verification:** TypeScript compilation passes with zero errors in MSW files
- **Committed in:** 02ed471 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Minimal -- vitest import addition is standard practice. No scope creep.

## Issues Encountered
None

## Known Stubs
None -- all test assertions use concrete mock data and validate real code paths.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- MSW infrastructure reusable for any future provider integration tests
- Coverage thresholds will enforce quality as publishing and scheduling code evolves
- All 17 provider integration tests provide regression safety for Phase 04 plans 01-02

---
*Phase: 04-publishing-pipeline*
*Completed: 2026-05-19*
