---
phase: 01-security-and-auth-foundation
plan: 04
subsystem: infra
tags: [logging, axiom, asynclocalstorage, correlation-id, qstash, upstash, structured-logging]

requires:
  - phase: 01-01
    provides: "env.ts with AXIOM_TOKEN, AXIOM_DATASET, UPSTASH_QSTASH_TOKEN, signing key env vars"
provides:
  - "Structured JSON logger with correlation IDs (createLogger, log)"
  - "AsyncLocalStorage-based request context propagation"
  - "Axiom transport with console fallback"
  - "QStash client and receiver for signed webhook verification"
affects: [publishing-pipeline, api-routes, server-actions, middleware]

tech-stack:
  added: ["@axiomhq/js@1.6.1", "@upstash/qstash@2.11.0"]
  patterns: ["AsyncLocalStorage for per-request context", "Lazy singleton initialization for external clients", "Conditional transport with graceful fallback"]

key-files:
  created:
    - src/lib/logging/types.ts
    - src/lib/logging/correlation.ts
    - src/lib/logging/axiom.ts
    - src/lib/logging/index.ts
    - src/lib/logging/correlation.test.ts
    - src/lib/qstash/client.ts
  modified: []

key-decisions:
  - "Axiom uses lazy singleton -- initialized on first log when AXIOM_TOKEN present, no-op otherwise"
  - "QStash client minimal -- no queue/DLQ setup, deferred to Phase 4 publish pipeline"

patterns-established:
  - "Structured logging: always use createLogger(domain) or log.info/warn/error, never raw console.log"
  - "Correlation context: wrap request handlers with withCorrelationId() for automatic trace propagation"

requirements-completed: [INFRA-01, INFRA-02]

duration: 3min
completed: 2026-05-19
---

# Phase 01 Plan 04: Structured Logging and QStash Setup Summary

**JSON-structured logging with AsyncLocalStorage correlation IDs, Axiom transport, and QStash signed delivery verification**

## Performance

- **Duration:** 3 min
- **Started:** 2026-05-19T06:52:41Z
- **Completed:** 2026-05-19T06:55:00Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Structured JSON logger with correlation ID propagation via AsyncLocalStorage
- Axiom transport that activates when AXIOM_TOKEN is configured, with console fallback always active
- QStash client with signed webhook verification ready for Phase 4 publish pipeline
- 4 passing correlation tests covering UUID format, context propagation, no-context fallback, and nested isolation

## Task Commits

Each task was committed atomically:

1. **Task 1: Structured logging with correlation IDs and Axiom transport** - `fedabdf` (feat)
2. **Task 2: QStash client with signed delivery verification** - `7d4ea82` (feat)

## Files Created/Modified
- `src/lib/logging/types.ts` - LogLevel and LogEntry type definitions
- `src/lib/logging/correlation.ts` - AsyncLocalStorage-based correlation ID propagation
- `src/lib/logging/axiom.ts` - Conditional Axiom transport with lazy initialization
- `src/lib/logging/index.ts` - Logger factory combining correlation + Axiom + console
- `src/lib/logging/correlation.test.ts` - 4 tests for correlation ID behavior
- `src/lib/qstash/client.ts` - QStash client and receiver with signature verification
- `package.json` - Added @axiomhq/js and @upstash/qstash dependencies
- `package-lock.json` - Lockfile updated

## Decisions Made
- Axiom uses lazy singleton pattern -- only initialized when AXIOM_TOKEN is present, otherwise no-op. This keeps development friction zero.
- QStash setup is intentionally minimal -- only client/receiver/verify. Queue creation, DLQ, and retry configuration deferred to Phase 4 per RESEARCH.md Open Question 3.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing @axiomhq/js and @upstash/qstash packages**
- **Found during:** Pre-task setup
- **Issue:** Neither package was in package.json despite being referenced by plan
- **Fix:** Ran `npm install @axiomhq/js @upstash/qstash`
- **Files modified:** package.json, package-lock.json
- **Verification:** `npm ls @axiomhq/js @upstash/qstash` confirms both installed
- **Committed in:** fedabdf (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential dependency installation. No scope creep.

## Issues Encountered
None

## Known Stubs
None -- all modules are fully wired with real implementations.

## User Setup Required
None - Axiom and QStash are optional in development (graceful fallback). Production deployment requires setting AXIOM_TOKEN, AXIOM_DATASET, UPSTASH_QSTASH_TOKEN, and QStash signing keys.

## Next Phase Readiness
- Logger available for all subsequent plans to import via `createLogger('domain')` or `log.info/warn/error`
- QStash verification helper ready for Phase 4 webhook handlers
- Correlation IDs ready for middleware integration (wrap request handlers with `withCorrelationId()`)

---
*Phase: 01-security-and-auth-foundation*
*Completed: 2026-05-19*
