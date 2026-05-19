---
phase: 05-realtime-ux-and-notifications
plan: 01
subsystem: realtime
tags: [supabase-realtime, postgres-changes, notifications, activity-feed, websocket]

requires:
  - phase: 02-core-ui-and-content-creation
    provides: planner page, activity feed component, content types
  - phase: 04-publish-pipeline-and-queue
    provides: publish_jobs table, publish pipeline status transitions

provides:
  - Supabase Realtime enabled on publish_jobs and notifications tables
  - useRealtimeFeed hook for dual-table postgres_changes subscriptions
  - useFailedPublishCount hook for realtime failure tracking
  - AttentionNeededBanner component with realtime count
  - NotificationBadge component with realtime unread count
  - FeedEvent, NotificationRow, PublishJobRow centralised types
  - getFailedPublishCount and getUnreadNotificationCount server queries

affects: [05-realtime-ux-and-notifications, 06-analytics-and-link-in-bio]

tech-stack:
  added: []
  patterns:
    - "Supabase Realtime postgres_changes subscriptions scoped by account_id"
    - "Server-fetched initial state + client Realtime hydration pattern"
    - "REPLICA IDENTITY FULL for UPDATE event old-row access"

key-files:
  created:
    - supabase/migrations/00000000000008_realtime_and_notification_fix.sql
    - src/types/notifications.ts
    - src/hooks/use-realtime-feed.ts
    - src/features/planner/attention-needed-banner.tsx
    - src/components/layout/notification-badge.tsx
  modified:
    - src/features/planner/activity-feed.tsx
    - src/lib/planner/notifications.ts
    - src/app/(app)/planner/page.tsx

key-decisions:
  - "Single Supabase channel per account for activity feed with dual postgres_changes listeners"
  - "Server-side initial data fetch with client Realtime hydration avoids loading state flash"
  - "FeedEvent cap at 50 items to prevent unbounded memory growth"

patterns-established:
  - "useRealtimeFeed pattern: server initial data -> client Realtime subscription -> prepend new events"
  - "REPLICA IDENTITY FULL on tables needing UPDATE old-row detection"

requirements-completed: [NOTIF-01, NOTIF-02, NOTIF-05]

duration: 4min
completed: 2026-05-19
---

# Phase 05 Plan 01: Realtime Activity Feed Summary

**Supabase Realtime subscriptions on publish_jobs and notifications tables with dual-channel hooks powering live activity feed, attention banner, and notification badge**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-19T14:58:57Z
- **Completed:** 2026-05-19T15:02:41Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Migration adds message/metadata columns to notifications, enables Realtime publication on both tables with REPLICA IDENTITY FULL
- Activity feed rewritten from polling to Supabase Realtime subscriptions (removed ACTIVITY_ENDPOINT and manual refresh)
- Attention Needed banner shows failed publish count with live realtime updates
- Notification badge tracks unread count with INSERT/UPDATE subscriptions

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration + notification types + realtime hook** - `ccdf880` (feat)
2. **Task 2: Rewrite activity feed + attention banner + notification badge** - `39855e9` (feat)

## Files Created/Modified
- `supabase/migrations/00000000000008_realtime_and_notification_fix.sql` - Schema fix + Realtime enablement
- `src/types/notifications.ts` - FeedEvent, NotificationRow, PublishJobRow types
- `src/hooks/use-realtime-feed.ts` - useRealtimeFeed and useFailedPublishCount hooks
- `src/features/planner/activity-feed.tsx` - Rewritten from polling to Realtime
- `src/features/planner/attention-needed-banner.tsx` - Failed publish count banner
- `src/components/layout/notification-badge.tsx` - Unread notification badge
- `src/lib/planner/notifications.ts` - Added getFailedPublishCount, getUnreadNotificationCount
- `src/app/(app)/planner/page.tsx` - Wired server-side data + client Realtime components

## Decisions Made
- Single Supabase channel per account for activity feed with dual postgres_changes listeners (publish_jobs + notifications)
- Server-side initial data fetch with client Realtime hydration avoids loading state flash on page load
- FeedEvent array capped at 50 items to prevent unbounded memory growth in long-running sessions
- Notification badge uses separate channel from activity feed to avoid coupling badge state to feed component lifecycle

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all components are wired to live data sources via Supabase Realtime subscriptions.

## Next Phase Readiness
- Realtime infrastructure ready for email notifications (05-02)
- Notification badge can be integrated into sidebar/topbar layout in accessibility pass (05-03)
- useRealtimeFeed pattern reusable for future realtime features

---
*Phase: 05-realtime-ux-and-notifications*
*Completed: 2026-05-19*
