---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: unknown
stopped_at: Completed 06-03-PLAN.md
last_updated: "2026-05-19T16:23:20.708Z"
progress:
  total_phases: 6
  completed_phases: 5
  total_plans: 31
  completed_plans: 30
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-18)

**Core value:** Owner creates content once, AI generates platform-specific copy, publishing pipeline delivers to Facebook/Instagram/GBP without manual intervention after approval.
**Current focus:** Phase 06 — analytics-link-in-bio-and-advanced-features

## Current Position

Phase: 06 (analytics-link-in-bio-and-advanced-features) — EXECUTING
Plan: 5 of 5

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 01 P01 | 3min | 2 tasks | 10 files |
| Phase 01 P02 | 3min | 2 tasks | 64 files |
| Phase 01 P04 | 3min | 2 tasks | 8 files |
| Phase 01 P03 | 8min | 2 tasks | 13 files |
| Phase 01 P05 | 2min | 2 tasks | 4 files |
| Phase 02 P01 | 2min | 2 tasks | 8 files |
| Phase 02 P02 | 3min | 2 tasks | 6 files |
| Phase 02 P03 | 3min | 2 tasks | 5 files |
| Phase 02 P05 | 5min | 2 tasks | 10 files |
| Phase 02 P04 | 8min | 2 tasks | 15 files |
| Phase 02 P06 | 8min | 3 tasks | 9 files |
| Phase 02 P07 | 6min | 2 tasks | 12 files |
| Phase 02 P08 | 12min | 3 tasks | 8 files |
| Phase 03 P01 | 4min | 2 tasks | 9 files |
| Phase 03 P02 | 3min | 2 tasks | 8 files |
| Phase 03 P03 | 3min | 2 tasks | 6 files |
| Phase 03 P04 | 7min | 2 tasks | 10 files |
| Phase 03 P05 | 5min | 4 tasks | 9 files |
| Phase 04 P01 | 4min | 2 tasks | 12 files |
| Phase 04 P03 | 4min | 2 tasks | 10 files |
| Phase 04 P02 | 4min | 2 tasks | 9 files |
| Phase 05 P05 | 2min | 2 tasks | 3 files |
| Phase 05 P04 | 2min | 2 tasks | 16 files |
| Phase 05 P01 | 4min | 2 tasks | 8 files |
| Phase 05 P02 | 5min | 2 tasks | 5 files |
| Phase 06 P01 | 5min | 2 tasks | 7 files |
| Phase 06 P05 | 4min | 2 tasks | 8 files |
| Phase 06 P02 | 4min | 2 tasks | 10 files |
| Phase 06 P03 | 12min | 2 tasks | 12 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Security first: all 6 critical issues (C-1 through C-6) resolved in Phase 1
- Greenfield rebuild: no v1 code carried forward
- QStash replaces Vercel Cron for publish pipeline reliability
- Token vault is hard prerequisite for provider adapters (Phase 1 before Phase 3)
- [Phase 01]: RLS policies use accounts table subquery (auth_user_id = auth.uid()) instead of JWT app_metadata for reliability
- [Phase 01]: Audit log enforces append-only at RLS level (SELECT and INSERT only, no UPDATE/DELETE)
- [Phase 01]: Lazy re-encrypt strategy for token vault key rotation
- [Phase 01]: Static CSP with unsafe-inline for styles; nonce-based deferred to Phase 5
- [Phase 01]: Axiom uses lazy singleton -- only initialized when AXIOM_TOKEN is present, otherwise no-op
- [Phase 01]: QStash setup intentionally minimal -- only client/receiver/verify, queue config deferred to Phase 4
- [Phase 01]: AuthContext exposes accountId at top level for backward compat with v1 server actions
- [Phase 01]: Lazy Upstash rate limiter init with console.warn fallback when env vars not set
- [Phase 01]: proxy.ts uses getUser() for JWT validation; getSession() prohibited for access control
- [Phase 01]: Coverage thresholds only enforced for auth (80%) now; scheduling and publishing thresholds deferred until code arrives
- [Phase 01]: Supabase migration-check uses db lint (schema validation) in CI
- [Phase 02]: Class-based dark mode (.dark) instead of prefers-color-scheme for programmatic toggle
- [Phase 02]: CSS custom properties for status/platform colours enabling runtime theming
- [Phase 02]: useState initializer with typeof window check for SSR-safe breakpoint detection
- [Phase 02]: Manual mapContentItem mapper matching tournament pattern instead of generic fromDb
- [Phase 02]: Full brief stored in body_draft JSONB for wizard resume capability
- [Phase 02]: weekly_recurring auto_confirm=true by default per Decision #5
- [Phase 02]: OpenAI schema uses .nullable() not .optional() -- API rejects optional fields in structured outputs
- [Phase 02]: v2 AI modules added alongside v1 exports to preserve backward compatibility
- [Phase 02]: ContentBriefInput (z.input) type for RHF+Zod discriminated union compatibility
- [Phase 02]: Form field components use FieldValues generic to avoid discriminated union type threading
- [Phase 02]: Storage paths use {account_id}/{uuid}.{ext} for RLS folder-level scoping
- [Phase 02]: Media upload runs on browser Supabase client for direct-to-storage uploads
- [Phase 02]: V2 scheduling functions added alongside v1 for backward compatibility
- [Phase 02]: Event import picker added to create wizard event form as enhancement beyond original plan scope
- [Phase 03]: Registry pattern uses simple Map singleton -- no DI container overhead for 3 adapters
- [Phase 03]: oauth_states uses created_by with auth.uid() instead of account_id FK -- OAuth state is per-user
- [Phase 03]: getConnectionMetadata uses service-role client -- adapters run in background job context
- [Phase 03]: Instagram carousel uses sequential child container creation then CAROUSEL media_type container
- [Phase 03]: GBP adapter calls ensureFreshGbpToken before every API call for just-in-time refresh
- [Phase 03]: Used 'disconnected' enum value instead of 'revoked' -- matches connection_status DB enum
- [Phase 03]: Facebook page tokens treated as non-expiring (null token_expires_at = green health)
- [Phase 04]: Two-layer idempotency: QStash deduplicationId + publish_attempts UNIQUE constraint
- [Phase 04]: Optimistic concurrency: transitionStatus uses WHERE status=from to guard concurrent modifications
- [Phase 04]: Handler re-throws on failure so webhook returns 500 and QStash retries at 5m/15m/45m
- [Phase 04]: MSW wildcard path patterns for API version-independent test mocking
- [Phase 04]: Tombstone pattern for deprecated cron/publish: 410 Gone instead of deletion
- [Phase 04]: Fresh deduplicationId with timestamp suffix for manual retries in QStash
- [Phase 04]: 60-second threshold for immediate vs scheduled publish determination
- [Phase 05]: Runbooks reference actual system components (connections UI, QStash console, Vercel dashboard) for actionable steps
- [Phase 05]: Password fallback auth for E2E fixture -- simpler than email interception
- [Phase 05]: Page object model for E2E selector encapsulation and maintainability
- [Phase 05]: Single Supabase channel per account for activity feed with dual postgres_changes listeners
- [Phase 05]: Server-side initial data fetch with client Realtime hydration to avoid loading flash
- [Phase 05]: REPLICA IDENTITY FULL on publish_jobs and notifications for UPDATE old-row access
- [Phase 05]: startTransition for filter state updates instead of debouncing -- React 19 concurrent rendering is the correct INP solution
- [Phase 05]: Lazy-load library at tag-group level via IntersectionObserver -- groups are the natural content boundary
- [Phase 05]: Aligned notification insert with actual DB schema (title/body columns, not message/metadata)
- [Phase 05]: Tiered expiry email: in-app at 7 days, email at 4 days or less (NOTIF-04)
- [Phase 05]: Token health fetches email via auth.admin.getUserById for expired/disconnected alerts
- [Phase 06]: Weighted engagement rate = sum(engagementCount) / sum(impressions) for accurate cross-post comparison
- [Phase 06]: GBP cron fetches date window (today-5 to today-3) for 2-3 day GBP data delay
- [Phase 06]: GBP API errors (429/401/403) return empty results with console warnings; cron retries next run
- [Phase 06]: Idempotency via publish_jobs existence check per content_item_id+platform for recurring dispatch
- [Phase 06]: Silent dispatch (D-13): no notification for auto-published recurring items
- [Phase 06]: Omitted FK constraint on hero_media_id/media_asset_id -- media_assets table not in migrations
- [Phase 06]: Zod v4 requires two-arg z.record(z.string(), z.unknown()) for record schemas
- [Phase 06]: Recharts for bar/line charts, custom CSS grid for heatmap (no native Recharts heatmap)

### Pending Todos

None yet.

### Blockers/Concerns

- Meta app review for `instagram_content_publish` scope should begin during Phase 3 — rejection delays Phase 4 by 2-4 weeks
- Instagram Stories API reliability conflicted across sources — needs spike during Phase 3

## Session Continuity

Last session: 2026-05-19T16:23:20.706Z
Stopped at: Completed 06-03-PLAN.md
Resume file: None
