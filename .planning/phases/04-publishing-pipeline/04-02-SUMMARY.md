---
phase: 04-publishing-pipeline
plan: 02
subsystem: publishing
tags: [qstash, cron, state-machine, preflight, email-alerts, server-actions]

requires:
  - phase: 04-publishing-pipeline/01
    provides: "QStash dispatch, state machine, queue, error messages, audit logger, publish handler"
provides:
  - "approveAndSchedule flow: preflight -> approve -> schedule/queue -> dispatch"
  - "publish-scheduler cron: promotes scheduled->queued every minute"
  - "QStash failure callback with email alert (PUB-09)"
  - "retryPublishJob server action for failed job recovery (PUB-05)"
  - "PreflightErrors component with fix-it CTAs (CONT-10)"
  - "RetryButton and PublishStatusCard components"
affects: [04-publishing-pipeline, 05-polish-testing]

tech-stack:
  added: []
  patterns:
    - "Approval flow: preflight gating before state transition"
    - "Cron scheduler: promotes scheduled->queued with QStash dispatch"
    - "QStash failure callback: immediate email on exhausted retries"
    - "Tombstone route pattern for deprecated cron endpoints"

key-files:
  created:
    - src/lib/publishing/approve-and-schedule.ts
    - src/lib/publishing/approve-and-schedule.test.ts
    - src/app/api/cron/publish-scheduler/route.ts
    - src/app/api/webhooks/qstash-publish/failure/route.ts
    - src/app/actions/publish.ts
    - src/features/publishing/components/preflight-errors.tsx
    - src/features/publishing/components/retry-button.tsx
    - src/features/publishing/components/publish-status-card.tsx
  modified:
    - src/app/api/cron/publish/route.ts

key-decisions:
  - "Tombstone pattern for old cron/publish: returns 410 Gone instead of deleting route"
  - "Fresh deduplicationId with timestamp suffix for retries so QStash treats as new message"
  - "60-second threshold for immediate vs scheduled determination in approve flow"

patterns-established:
  - "Approval flow: preflight -> approve -> schedule/queue -> QStash dispatch"
  - "Cron auth: x-cron-secret / authorization / ?secret= triple-check pattern"
  - "Failure callback: QStash signature verify -> load job -> check preferences -> email -> idempotency record"

requirements-completed: [PUB-05, PUB-09, CONT-09, CONT-10]

duration: 4min
completed: 2026-05-19
---

# Phase 4 Plan 2: Approval Flow and Failure Recovery Summary

**Approve-and-schedule flow with preflight gating, cron scheduler, QStash failure email alerts, retry server action, and three publishing UI components**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-19T13:34:44Z
- **Completed:** 2026-05-19T13:39:26Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Approval flow runs preflight per platform, transitions through state machine, creates publish jobs, and dispatches to QStash (immediately or deferred)
- Cron scheduler promotes scheduled->queued jobs every minute with QStash dispatch
- QStash failure callback sends email alert with plain-English error explanation on final failure
- Retry server action re-queues failed jobs with fresh deduplication ID and audit logging
- Three UI components: PreflightErrors (fix-it CTAs), RetryButton (loading/error states), PublishStatusCard (error explanation + retry)
- Old cron/publish tombstoned with 410 Gone (edge function call removed)
- CONT-09 bulk approve confirmed NOT implemented (DROPPED per D-03)

## Task Commits

Each task was committed atomically:

1. **Task 1: Approval flow, cron scheduler, failure callback, and old cron removal** - `84c4c9d` (feat)
2. **Task 2: Preflight errors, retry button, and publish status card components** - `b5853d2` (feat)

## Files Created/Modified
- `src/lib/publishing/approve-and-schedule.ts` - Approval flow: preflight, state transitions, QStash dispatch
- `src/lib/publishing/approve-and-schedule.test.ts` - 8 unit tests for approval flow
- `src/app/api/cron/publish-scheduler/route.ts` - 1-minute cron promoting scheduled->queued
- `src/app/api/cron/publish/route.ts` - Tombstoned with 410 Gone
- `src/app/api/webhooks/qstash-publish/failure/route.ts` - Email alert on final failure
- `src/app/actions/publish.ts` - Server action for retrying failed jobs
- `src/features/publishing/components/preflight-errors.tsx` - Plain-English issue list with fix-it CTAs
- `src/features/publishing/components/retry-button.tsx` - Retry button with loading/error states
- `src/features/publishing/components/publish-status-card.tsx` - Job status card with error details

## Decisions Made
- **Tombstone pattern:** Old cron/publish returns 410 Gone instead of being deleted, preventing 404s from old cron configurations
- **Fresh deduplication ID for retries:** Appends `:retry:{timestamp}` to idempotency key so QStash treats manual retries as new messages
- **60-second immediate threshold:** scheduledAt within 60 seconds of now counts as immediate dispatch rather than cron-scheduled

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing type errors in v1 files (planner/actions.ts, tournament.ts, create/service.ts) calling the Plan 01-refactored `enqueuePublishJob` with old parameter names. These are out of scope -- documented in deferred-items.md.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- End-to-end pipeline is now wired: create wizard approval -> preflight -> schedule/queue -> QStash dispatch -> webhook handler -> platform adapter -> success/failure
- Plan 03 (platform-specific editor and CONT-09 confirmation) can proceed
- Integration testing with real QStash requires UPSTASH_QSTASH_TOKEN configured

---
*Phase: 04-publishing-pipeline*
*Completed: 2026-05-19*
