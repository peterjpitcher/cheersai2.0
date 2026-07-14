# Fix: planner post detail crashes on platform-less posts

## Problem
Clicking certain posts (e.g. the materialised weekly-recurring slots that land on
Mondays such as 27 Jul 2026) crashes the post detail view / drawer. Root cause:
`content_items.platform` can be `NULL` (39 rows: 2 weekly_recurring, 31 event,
5 instant_post, 1 story) but several components index a `facebook`/`instagram`-only
map with the raw platform value, so a null platform resolves to `undefined` and throws.

## Fix (class-wide, not one post)
- [x] Harden `PlatformDot` — tolerate null/unknown platform, neutral fallback
- [x] Harden `PlatformBadge` — tolerate null/unknown platform, neutral fallback
- [x] Harden `formatPlatformLabel` — accept null, return "No platform"
- [x] Harden `PlannerContentComposer` — neutral theme when platform is null
- [x] Normalise + retype `platform` in `getPlannerContentDetail` (data layer honesty)
- [x] Remove misleading `as Platform` cast in `post-drawer`
- [x] Tests: PlatformDot / PlatformBadge / formatPlatformLabel render with null (8 tests)
- [x] Verify: typecheck ✓ + lint ✓ + test ✓ (1727) + build ✓ (after clearing stale .next)
- [ ] Live-app repro is auth-gated (planner detail requires a session) — covered by unit tests instead

## Out of scope (flagged separately)
- Sibling enum lookups that could crash on unexpected DB values
  (CampaignList status, campaigns/[id] status, connection-cards provider).
- Data cleanup / completion of the 2 platform-less weekly_recurring drafts.
