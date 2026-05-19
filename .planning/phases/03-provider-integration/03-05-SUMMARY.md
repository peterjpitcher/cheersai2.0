---
phase: 03-provider-integration
plan: 05
subsystem: integration-wiring
tags: [rate-limits, cron, health-dots, toast, registry, ui]

requires:
  - phase: 03-provider-integration/02
    provides: "FacebookAdapter, InstagramAdapter"
  - phase: 03-provider-integration/03
    provides: "GbpAdapter"
  - phase: 03-provider-integration/04
    provides: "deriveConnectionHealth, getConnectionHealthSummaries, OAuth flow"
provides:
  - "Database-backed rate limit tracking via increment_rate_limit RPC (PLAT-08)"
  - "Nightly cron endpoint for token health checks (PLAT-10)"
  - "Sidebar health dots showing per-platform green/amber/red status (D-01)"
  - "Login toast for unhealthy connections, one-time per session (D-03)"
  - "All three adapters registered in provider registry"
affects: [sidebar, connections-page, cron-jobs, publishing-pipeline]

tech-stack:
  added: []
  patterns: ["increment_rate_limit RPC for atomic counters", "sessionStorage guard for one-time toast", "server component health dots"]

key-files:
  created:
    - src/lib/providers/rate-limits.ts
    - src/lib/providers/rate-limits.test.ts
    - src/lib/providers/init.ts
    - src/app/api/cron/token-health/route.ts
    - src/features/connections/health-dots.tsx
    - src/features/connections/connection-toast.tsx
  modified:
    - src/app/(app)/layout.tsx
    - src/components/layout/app-shell.tsx
    - src/components/layout/sidebar-nav.tsx

key-decisions:
  - "Rate limit counters use increment_rate_limit RPC (not manual upsert) for atomic increment"
  - "Rate limits are advisory -- increment failures logged but don't block publish"
  - "Health dots rendered as server component for zero client JS overhead"
  - "Login toast uses sessionStorage guard -- fires once per browser session"

patterns-established:
  - "Rate limit: call incrementRateLimit after each API call, checkRateLimit before"
  - "Cron auth: CRON_SECRET in Authorization Bearer header, 401 on mismatch"
  - "Health UI: server-fetched summaries passed as props to client toast component"

requirements-completed: [PLAT-08, PLAT-10]

duration: 5min
completed: 2026-05-19
---

# Phase 03 Plan 05: Integration Wiring & Health UI Summary

**Rate limit tracking (PLAT-08), nightly cron (PLAT-10), sidebar health dots (D-01), and login toast (D-03)**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-19T13:22:00Z
- **Completed:** 2026-05-19T13:28:00Z
- **Tasks:** 4 (3 auto + 1 human-verify checkpoint)
- **Files modified:** 9

## Accomplishments
- Database-backed rate limit counters using increment_rate_limit RPC for atomic per-provider tracking
- Nightly cron endpoint validates CRON_SECRET, checks all connections, updates expired statuses
- Sidebar health dots show three small coloured circles (green/amber/red) next to Connections nav item
- Login toast fires once per session for amber/red connections with actionable Reconnect button
- All three adapters (Facebook, Instagram, GBP) registered in provider registry via init.ts
- 8 tests covering rate limit increment, check, and status queries

## Task Commits

Each task was committed atomically:

1. **Task 1: Rate limit tracking (RED)** - `163dd66` (test)
2. **Task 1: Rate limit tracking + registry init (GREEN)** - `6af000b` (feat)
3. **Task 2: Nightly cron endpoint** - `19289dc` (feat)
4. **Task 3: Health dots + login toast** - `507a890` (feat)

## Files Created/Modified
- `src/lib/providers/rate-limits.ts` - incrementRateLimit, checkRateLimit, getRateLimitStatus using RPC
- `src/lib/providers/rate-limits.test.ts` - 8 tests for rate limit functions
- `src/lib/providers/init.ts` - initializeProviderRegistry registering all three adapters
- `src/app/api/cron/token-health/route.ts` - Nightly cron with CRON_SECRET auth and health derivation
- `src/features/connections/health-dots.tsx` - Server component with per-platform coloured dots
- `src/features/connections/connection-toast.tsx` - Client component with sessionStorage one-time guard
- `src/app/(app)/layout.tsx` - Wired ConnectionHealthDots and ConnectionHealthToast into app shell
- `src/components/layout/app-shell.tsx` - Updated for health dots integration
- `src/components/layout/sidebar-nav.tsx` - Updated for health dots placement

## Decisions Made
- **Advisory rate limits:** increment failures are logged but don't block publishing -- rate limits inform, not gate
- **Server component dots:** ConnectionHealthDots is async server component to avoid client-side data fetching overhead
- **sessionStorage guard:** Toast uses sessionStorage (not localStorage) so it resets per browser session as specified in D-03

## Deviations from Plan

None -- all tasks implemented as planned.

## Issues Encountered
None.

## User Setup Required
- QStash schedule must be configured externally to call `/api/cron/token-health` nightly

## Known Stubs
None -- all functions fully implemented with real logic.

## Next Phase Readiness
- All 10 PLAT requirements addressed across Plans 01-05
- Provider registry ready for Phase 4 publishing pipeline to call getAdapter()
- Rate limit checking available for preflight validation in Phase 4
- Connection health visible to owner in sidebar

---
*Phase: 03-provider-integration*
*Completed: 2026-05-19*
