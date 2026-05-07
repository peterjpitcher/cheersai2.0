# Banner Overlay Consistency — Orchestration Plan

**Plan source:** [docs/superpowers/plans/2026-05-07-banner-overlay-consistency.md](../../docs/superpowers/plans/2026-05-07-banner-overlay-consistency.md)
**Spec:** [docs/superpowers/specs/2026-05-07-banner-overlay-consistency-design.md](../../docs/superpowers/specs/2026-05-07-banner-overlay-consistency-design.md)

## Wave Structure

### Wave 1 — Foundation (parallel, 4 agents)
- **migration-1**: Task 1 — additive schema migration + validated data copy.
- **label-engine**: Task 2 — extend `getProximityLabel` with `NEXT [WEEKDAY]` and date format.
- **pure-utils**: Tasks 3 + 4 — `bannerConfigResolver` and `useNowMinute()`.
- **storage-cleanup**: Task 14 — `scripts/ops/cleanup-banner-storage.ts` (independent of all others).

### Wave 2 — Composition (parallel, 2 agents; depends on Wave 1)
- **ui-swap**: Tasks 5 + 6 + 7 + 8 + 9 — `<BannerOverlay />`, planner data fetch, planner composer, calendar, link-in-bio, campaign dashboard, streaming preview, simplified BannerControls, settings page banner defaults.
- **renderer**: Task 10 — `renderBannerServer` (Sharp JPEG).

### Wave 3 — Integration & cleanup (1 agent; depends on Wave 2)
- **worker-and-cleanup**: Tasks 11 + 12 + 13 + 15 — publish worker preflight render, Migration 2, delete dead code, final CI verification.

## Total
- 7 agents, 3 waves. Within default limits (max 7 agents, max 4 waves).
