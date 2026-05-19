---
phase: 05-realtime-ux-and-notifications
plan: 02
subsystem: notifications
tags: [cron, email, resend, supabase, routing, idempotency]

# Dependency graph
requires:
  - phase: 03-platform-integration
    provides: Connection health derivation, social_connections table, token expiry tracking
  - phase: 04-publish-pipeline
    provides: notify-failures cron, publish_jobs table, failure email delivery
provides:
  - Shared notification routing module (classifyUrgency, shouldSendEmail, isEmailEnabledForCategory)
  - Type-safe notification insert helper with 24h idempotency dedup
  - Email alerts for token expiry at 4 days or less (NOTIF-04)
  - Urgent email for expired/disconnected tokens (NOTIF-03)
affects: [05-realtime-ux-and-notifications, notifications, cron-jobs]

# Tech tracking
tech-stack:
  added: []
  patterns: [centralised-notification-routing, shared-insert-with-idempotency, tiered-email-threshold]

key-files:
  created:
    - src/lib/notifications/routing.ts
    - src/lib/notifications/insert.ts
  modified:
    - src/app/api/cron/notify-expiring-connections/route.ts
    - src/app/api/cron/token-health/route.ts
    - src/app/api/cron/notify-failures/route.ts

key-decisions:
  - "Aligned insert helper with actual DB schema (title/body columns, not message/metadata which do not exist)"
  - "Tiered notification: 5-7 days in-app only, 4 days or less triggers email per NOTIF-04"
  - "Token health fetches email via auth.admin.getUserById since accounts table has auth_user_id not email directly"

patterns-established:
  - "Notification routing: all crons use shared classifyUrgency/shouldSendEmail from routing.ts"
  - "Notification insert: all crons use insertNotification with built-in 24h idempotency"
  - "Email preference check: isEmailEnabledForCategory reads posting_defaults.notifications preferences"

requirements-completed: [NOTIF-03, NOTIF-04]

# Metrics
duration: 5min
completed: 2026-05-19
---

# Phase 5 Plan 2: Notification Routing and Cron Email Extensions Summary

**Centralised notification routing module with tiered email triggers: 4-day token expiry emails (NOTIF-04) and urgent expired/disconnected alerts (NOTIF-03)**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-19T14:59:22Z
- **Completed:** 2026-05-19T15:04:30Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Created shared notification routing module (classifyUrgency, shouldSendEmail, isEmailEnabledForCategory) centralising urgency/email logic for all crons
- Created type-safe insertNotification helper aligned with actual DB schema (title/body, not message/metadata) with 24h idempotency dedup
- Extended notify-expiring-connections to send email only at 4 days or less (NOTIF-04), with in-app notification for 5-7 days
- Extended token-health cron to send urgent email for expired/disconnected tokens (NOTIF-03) via auth.admin.getUserById
- Refactored notify-failures to use shared insertNotification helper

## Task Commits

Each task was committed atomically:

1. **Task 1: Shared notification routing and insert helpers** - `b583426` (feat)
2. **Task 2: Extend cron jobs with email routing for token events** - `7be8756` (feat)

## Files Created/Modified
- `src/lib/notifications/routing.ts` - Centralised urgency classification, email eligibility, preference checking
- `src/lib/notifications/insert.ts` - Type-safe notification insert with 24h idempotency dedup
- `src/app/api/cron/notify-expiring-connections/route.ts` - Tiered email: in-app at 7 days, email at 4 days or less
- `src/app/api/cron/token-health/route.ts` - Urgent email for expired/disconnected tokens via auth admin API
- `src/app/api/cron/notify-failures/route.ts` - Uses shared insertNotification for correct schema columns

## Decisions Made
- Aligned insert helper with actual notifications table schema (title, body, category, resource_type, resource_id). The table does NOT have message or metadata columns -- existing crons were inserting those fields which would be silently ignored by Supabase. Fixed all three crons to use correct columns.
- Token health cron fetches user email via accounts.auth_user_id then auth.admin.getUserById, since accounts table stores auth_user_id (not email directly). This matches the Supabase auth pattern used elsewhere.
- Tiered expiry notifications: 5-7 days gets in-app only (standard urgency), 4 days or less gets in-app + email (per NOTIF-04 requirement).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed notification insert schema mismatch**
- **Found during:** Task 1 (insert helper creation)
- **Issue:** Plan specified `message` and `metadata` columns, but the notifications table schema (00000000000003_notifications.sql) only has `title`, `body`, `category`, `resource_type`, `resource_id`. Existing crons were inserting non-existent columns.
- **Fix:** Aligned insert helper with actual DB schema. Used `title` for short headline, `body` for detailed message, `resource_type`/`resource_id` for idempotency linking.
- **Files modified:** src/lib/notifications/insert.ts, all three cron routes
- **Verification:** npx tsc --noEmit passes, eslint passes
- **Committed in:** b583426 (Task 1), 7be8756 (Task 2)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Essential correction -- without this fix, notification inserts would silently fail or lose data. No scope creep.

## Issues Encountered
- Build (npm run build) fails with webpack crash (OOM/minified bundle dump to stderr). Confirmed this is a pre-existing issue not caused by this plan's changes -- build also fails at EXIT=1 when changes are stashed. TypeScript compilation and lint both pass clean.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Shared notification helpers ready for any future cron or server action that needs to create notifications
- All three crons now use centralised routing -- adding new notification categories only requires updating the Sets in routing.ts
- Email delivery depends on RESEND_API_KEY and RESEND_FROM being configured (graceful skip if not)

---
*Phase: 05-realtime-ux-and-notifications*
*Completed: 2026-05-19*
