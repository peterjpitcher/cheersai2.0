# Phase 5: Realtime UX and Notifications - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-19
**Phase:** 05-realtime-ux-and-notifications
**Areas discussed:** None (user deferred all to Claude's discretion)

---

## Gray Areas Presented

Four gray areas were identified and presented to the user:

1. **Activity feed & realtime** — What events appear, Realtime channel design, feed vs notification centre
2. **Notification routing** — Which events in-app vs email, notification preferences, planner banner
3. **Performance budgets** — LCP/INP targets, lazy loading, optimisation strategy
4. **E2E test journeys** — Which 6 critical journeys, Playwright setup, staging environment

## User's Choice

User selected "none, please proceed to planning" — all gray areas deferred to Claude's discretion.

## Claude's Discretion

All implementation decisions made by Claude based on:
- Existing codebase patterns (notifications table, cron routes, activity API, MSW tests)
- REQUIREMENTS.md specifications (NOTIF-01–05, PERF-01–06, TEST-03, INFRA-05–06)
- PROJECT.md key decisions (#3 Supabase Realtime, #7 in-app vs email routing)
- Prior phase context (Phase 1 notifications schema, Phase 4 failure emails and MSW patterns)

## Deferred Ideas

None.
