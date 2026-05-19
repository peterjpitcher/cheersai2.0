---
phase: 04-publishing-pipeline
plan: 01
subsystem: publishing
tags: [qstash, state-machine, webhook, idempotency, audit-log, error-messages]

requires:
  - phase: 03-platform-adapters
    provides: "PublishingAdapter registry, getAdapter(), ProviderError classification"
  - phase: 01-foundation
    provides: "QStash client, Supabase service client, correlation IDs, structured logging"
provides:
  - "7-state content lifecycle state machine with canTransition/transitionStatus"
  - "Audit logger for all publish pipeline events with correlation IDs"
  - "QStash dispatch wrapper with deduplication and retry config"
  - "Idempotent publish job handler with two-layer duplicate protection"
  - "Plain-English error messages with actionable CTAs for all 5 error classifications"
  - "QStash webhook route with signature verification"
  - "Refactored queue.ts matching actual publish_jobs schema"
affects: [04-02-scheduler, 04-03-publishing-ux, 05-quality-polish]

tech-stack:
  added: []
  patterns: ["two-layer idempotency (QStash dedup + DB UNIQUE)", "optimistic concurrency via WHERE status = from", "correlation-aware audit trail"]

key-files:
  created:
    - src/lib/publishing/state-machine.ts
    - src/lib/publishing/audit.ts
    - src/lib/publishing/dispatch.ts
    - src/lib/publishing/handler.ts
    - src/lib/publishing/error-messages.ts
    - src/app/api/webhooks/qstash-publish/route.ts
  modified:
    - src/lib/publishing/queue.ts

key-decisions:
  - "Two-layer idempotency: QStash deduplicationId + publish_attempts UNIQUE(job_id, attempt_number)"
  - "Optimistic concurrency: transitionStatus uses WHERE status = from to guard concurrent modifications"
  - "Handler re-throws on failure so webhook returns 500 and QStash retries at 5m/15m/45m"
  - "Queue.ts refactored to match actual schema -- removed variant_id, placement, next_attempt_at columns"

patterns-established:
  - "State machine pattern: VALID_TRANSITIONS map + canTransition guard + transitionStatus atomic update"
  - "Audit logging pattern: logPublishAuditEvent with auto-detected operation_status and correlation_id"
  - "QStash dispatch pattern: publishJSON with retries:3, deduplicationId, optional delay"

requirements-completed: [PUB-01, PUB-02, PUB-03, PUB-04, PUB-06, PUB-07, PUB-08]

duration: 4min
completed: 2026-05-19
---

# Phase 4 Plan 1: Core Publishing Pipeline Summary

**7-state content lifecycle machine with QStash dispatch, idempotent webhook handler, audit logging, and plain-English error mapping**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-19T13:28:36Z
- **Completed:** 2026-05-19T13:33:01Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- State machine enforces all 7 valid transitions (draft through published/failed, plus failed->queued retry)
- Idempotent publish handler with two-layer duplicate protection (QStash dedup + DB UNIQUE constraint)
- QStash dispatch wrapper with retries:3, deduplication, and optional delay
- QStash webhook route with signature verification and correlation context
- Plain-English error messages for all 5 ErrorClassification values with actionable CTAs
- Audit logger inserts to audit_log with correlation IDs for every publish event
- Queue.ts refactored to match actual publish_jobs schema (removed wrong columns)

## Task Commits

Each task was committed atomically:

1. **Task 1: State machine, audit logger, error-messages, and refactored queue.ts** - `03f82a0` (feat)
2. **Task 2: QStash dispatch, webhook handler, and core pipeline logic** - `e36ff68` (feat)

## Files Created/Modified
- `src/lib/publishing/state-machine.ts` - 7-state lifecycle with canTransition and transitionStatus
- `src/lib/publishing/state-machine.test.ts` - 13 tests covering all transitions and concurrency guards
- `src/lib/publishing/audit.ts` - Audit log insert with auto-detected status and correlation IDs
- `src/lib/publishing/audit.test.ts` - 5 tests covering column mapping and status detection
- `src/lib/publishing/error-messages.ts` - ErrorClassification to PlainEnglishError mapping with CTAs
- `src/lib/publishing/error-messages.test.ts` - 6 tests covering all 5 classifications
- `src/lib/publishing/dispatch.ts` - QStash publishJSON wrapper with dedup and retry config
- `src/lib/publishing/dispatch.test.ts` - 6 tests covering URL, retries, dedup, delay, body
- `src/lib/publishing/handler.ts` - Core pipeline: load job, guard dupes, transition, adapt, audit
- `src/lib/publishing/handler.test.ts` - 4 tests covering happy path, audit, and transitions
- `src/lib/publishing/queue.ts` - Refactored to match publish_jobs schema with idempotency keys
- `src/app/api/webhooks/qstash-publish/route.ts` - QStash POST handler with signature verification

## Decisions Made
- Two-layer idempotency: QStash deduplicationId prevents duplicate dispatch, publish_attempts UNIQUE constraint prevents duplicate execution
- Optimistic concurrency: transitionStatus uses WHERE status = from to guard concurrent modifications
- Handler re-throws on failure so webhook returns 500 and QStash retries
- Queue.ts refactored to match actual schema -- removed variant_id, placement, next_attempt_at

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Core pipeline modules ready for scheduler integration (plan 04-02)
- State machine, audit, and error messages ready for publishing UX (plan 04-03)
- All 34 unit tests passing

---
*Phase: 04-publishing-pipeline*
*Completed: 2026-05-19*
