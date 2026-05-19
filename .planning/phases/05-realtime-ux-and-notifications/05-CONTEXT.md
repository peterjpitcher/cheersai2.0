# Phase 5: Realtime UX and Notifications - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

The application feels alive — publish status updates appear in real time via Supabase Realtime (no polling), urgent failures and token expiry trigger email alerts, the planner shows an "Attention Needed" failure count, performance budgets are met (LCP ≤2.5s, INP <200ms, Lighthouse ≥85/95), Playwright E2E covers 6 critical journeys, and runbooks exist for ops scenarios.

</domain>

<decisions>
## Implementation Decisions

### Activity Feed & Realtime
- **D-01:** Supabase Realtime subscription on `publish_jobs` and `notifications` tables — status changes push to connected clients within 5 seconds
- **D-02:** Activity feed displays in the existing planner sidebar/drawer area — not a separate page. Events: publish success, publish failure, token expiry warning, connection status changes
- **D-03:** Feed items show: event type icon, platform badge, plain-English message, relative timestamp, and a CTA link (e.g. "View in Planner", "Reconnect")
- **D-04:** Realtime channel scoped per account_id — single channel subscription per authenticated session

### Notification Routing
- **D-05:** Urgent events (publish failure, token expired/disconnected) → email + in-app notification
- **D-06:** Non-urgent events (token expiring ≤4 days, weekly summary) → in-app notification only; email for token expiry at ≤4 days per NOTIF-04
- **D-07:** Planner "Attention Needed" banner at top of planner view showing count of failed publishes requiring action
- **D-08:** Existing `notify-failures` cron and `token-health` cron are the email delivery mechanism — extend, don't replace
- **D-09:** Notification preferences stored in `posting_defaults.notifications` JSONB (already used by notify-failures cron)

### Performance Budgets
- **D-10:** Planner LCP ≤2.5s with skeleton paint ≤400ms — Server Component data fetch + Suspense boundaries
- **D-11:** INP <200ms — audit existing interactions, defer heavy work with startTransition
- **D-12:** Library lazy loading: first image row visible ≤2000ms, remaining rows use intersection observer
- **D-13:** Lighthouse targets: Performance ≥85, Accessibility ≥95 on all primary routes
- **D-14:** Load test: 50 concurrent Planner requests → p99 <500ms

### E2E Testing
- **D-15:** Playwright E2E suite covering 6 critical journeys: (1) sign-in via magic link, (2) create instant post end-to-end, (3) schedule and publish content, (4) connect social platform, (5) planner calendar navigation, (6) settings/brand voice update
- **D-16:** @smoke tag on subset for CI gating; full suite runs on staging
- **D-17:** Staging environment uses MSW-based mock providers (extending Phase 4 MSW patterns) for full regression without hitting live APIs

### Runbooks
- **D-18:** Three runbooks: token reconnection (OAuth re-auth flow), publish outage (QStash dead-letter inspection, manual retry), credential rotation (env var update + token re-encrypt)

### Claude's Discretion
- Activity feed component design (list vs timeline vs card layout)
- Realtime reconnection/error handling strategy
- Exact Playwright test structure and page object model design
- Performance optimization techniques (bundle splitting, image optimization, font loading)
- Notification badge/count display in nav/sidebar
- Runbook format and level of detail
- Nonce-based CSP implementation (deferred from Phase 1)
- Load test tooling choice

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Notification Requirements
- `.planning/REQUIREMENTS.md` §NOTIF-01 through NOTIF-05 — Activity feed, in-app notifications, email alerts, token expiry, planner failure banner
- `.planning/REQUIREMENTS.md` §PERF-01 through PERF-06 — LCP, INP, library lazy loading, Lighthouse scores, load test
- `.planning/REQUIREMENTS.md` §TEST-03 — Playwright E2E suite with 6 critical journeys and @smoke tag
- `.planning/REQUIREMENTS.md` §INFRA-05 — Staging environment with mock providers
- `.planning/REQUIREMENTS.md` §INFRA-06 — Runbooks for token reconnection, publish outage, credential rotation

### Prior Phase Context
- `.planning/phases/01-security-and-auth-foundation/01-CONTEXT.md` — Notifications table schema (D-07), Axiom logging (D-10), nonce-based CSP deferred to Phase 5
- `.planning/phases/04-publishing-pipeline/04-CONTEXT.md` — Failure email alerts via cron, MSW integration test patterns, QStash retry/backoff

### Project Context
- `.planning/PROJECT.md` §Key Decisions — Decision #7: in-app for non-urgent, email for urgent; Decision #3: Supabase Realtime for activity feed
- `.planning/ROADMAP.md` §Phase 5 — Goal, success criteria, dependency on Phase 4

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/app/api/cron/notify-failures/route.ts` — Publish failure email with idempotency via notifications table. Extends for NOTIF-03.
- `src/app/api/cron/token-health/route.ts` — Nightly token health check. Extends for NOTIF-04 email at ≤4 days.
- `src/app/api/cron/notify-expiring-connections/route.ts` — Connection expiry notification cron. Already partially covers NOTIF-04.
- `src/app/api/planner/activity/route.ts` — Polling-based activity API with `getPlannerActivity()`. Replace polling with Realtime subscription.
- `src/lib/planner/notifications.ts` — `listPlannerNotifications()` reads from notifications table. Reuse for notification history.
- `src/features/planner/dismiss-notification-button.tsx` — Dismiss notification UI component. Reuse directly.
- `src/components/layout/status-drawer.tsx` — Already references Supabase Realtime channel pattern.
- `src/lib/email/resend.ts` — `sendEmail()` helper for Resend. Used by all email notifications.
- `src/lib/supabase/service.ts` — Service-role client for system operations.
- MSW test patterns from Phase 4 (`*.test.ts` files with `setupServer`, wildcard path patterns).

### Established Patterns
- Server actions return `Promise<{ success?: boolean; error?: string }>`
- `fromDb<T>()` for snake_case → camelCase conversion
- `requireAuthContext()` for auth verification
- React Query for client-side data fetching with cache invalidation
- Sonner toast notifications for user feedback
- Design tokens in globals.css with semantic colour variables
- Status chips for state visualisation

### Integration Points
- Planner page (`src/app/(app)/planner/page.tsx`) — where activity feed and "Attention Needed" banner appear
- Sidebar/nav (`src/components/layout/`) — where notification badge/count appears
- `src/lib/supabase/client.ts` — browser Supabase client for Realtime subscription
- `src/app/(app)/connections/` — where token reconnection actions live
- CI pipeline configuration (GitHub Actions) — where Playwright and staging environment integrate

</code_context>

<specifics>
## Specific Ideas

No specific requirements — user deferred all areas to Claude's discretion. Open to standard approaches informed by existing codebase patterns and requirements.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 05-realtime-ux-and-notifications*
*Context gathered: 2026-05-19*
