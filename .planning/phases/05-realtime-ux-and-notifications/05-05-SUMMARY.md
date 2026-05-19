---
phase: 05-realtime-ux-and-notifications
plan: 05
subsystem: infra
tags: [runbooks, operations, token-rotation, publish-recovery, credential-management]

# Dependency graph
requires:
  - phase: 03-provider-adapters-and-connections
    provides: OAuth token vault and connection management
  - phase: 04-publish-pipeline-and-queue
    provides: QStash publish pipeline and state machine
provides:
  - Token reconnection runbook for OAuth re-auth across Facebook/Instagram/GBP
  - Publish outage runbook with QStash DLQ inspection and manual retry
  - Credential rotation runbook covering all 10 environment secrets
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [runbook-structure-with-symptoms-diagnosis-resolution-prevention]

key-files:
  created:
    - docs/runbooks/token-reconnection.md
    - docs/runbooks/publish-outage.md
    - docs/runbooks/credential-rotation.md
  modified: []

key-decisions:
  - "Runbooks reference actual system components (connections UI, QStash console, Vercel dashboard)"

patterns-established:
  - "Runbook structure: Symptoms, Diagnosis, Resolution, Post-Resolution/Verification, Prevention"

requirements-completed: [INFRA-06]

# Metrics
duration: 2min
completed: 2026-05-19
---

# Phase 5 Plan 5: Operational Runbooks Summary

**Three operational runbooks for token reconnection, publish outage recovery, and credential rotation with emergency leak procedures**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-19T14:59:14Z
- **Completed:** 2026-05-19T15:00:53Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Token reconnection runbook covering all 3 providers (Facebook, Instagram, GBP) with OAuth re-auth flow
- Publish outage runbook with error classification, QStash Dead Letter Queue inspection, webhook health check, and manual retry procedures
- Credential rotation runbook with inventory of all 10 secrets, lazy re-encrypt strategy for TOKEN_VAULT_KEY, and emergency leak procedure

## Task Commits

Each task was committed atomically:

1. **Task 1: Token reconnection and publish outage runbooks** - `b583426` (docs)
2. **Task 2: Credential rotation runbook** - `7b0693e` (docs)

## Files Created/Modified
- `docs/runbooks/token-reconnection.md` - Step-by-step guide for reconnecting expired/disconnected OAuth tokens
- `docs/runbooks/publish-outage.md` - Step-by-step guide for diagnosing and recovering from publish outages
- `docs/runbooks/credential-rotation.md` - Step-by-step guide for rotating environment credentials

## Decisions Made
- Runbooks reference actual system components (connections UI, QStash console, Vercel dashboard) for actionable steps

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Operational runbooks complete for the three most likely production incidents
- Runbooks cross-reference each other (publish outage links to token reconnection)

---
*Phase: 05-realtime-ux-and-notifications*
*Completed: 2026-05-19*
