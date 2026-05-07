# Wave 1 / Label engine — Handoff

## Outputs
- `src/lib/scheduling/proximity-label.ts` (modified) — added `MONTH_SHORT`, extended `getEventLabel` with 7–13 day band (`NEXT [WEEKDAY]`) and 14+ day date format (`FRI 13 JUN`).
- `tests/lib/scheduling/proximity-label.test.ts` (extended) — added 6 new tests in a `getProximityLabel — extended bands` describe block; updated 2 pre-existing tests whose assertions encoded the now-superseded "null at 7+ days" contract.
- Commit: `44d3866 feat(banner): extend proximity-label with NEXT [WEEKDAY] and date format`

## Format
TypeScript module + Vitest tests. Zero new dependencies.

## Assumptions
- The plan's test snippet uses an outdated `CampaignTiming` shape (`kind: 'event'`, `eventStart`). The actual type in `src/lib/scheduling/campaign-timing.ts` is `{ campaignType: "event" | "promotion" | "weekly" | "story_series", startAt: DateTime, startTime?: string, ... }`. New tests were adapted to use the existing `eventTiming(date, time)` helper to match this shape, preserving each test's intent (reference-date, target-date, expected-label).
- The existing `WEEKDAY_NAMES` array is 1-indexed (`WEEKDAY_NAMES[0] === ""`, `WEEKDAY_NAMES[1] === "MONDAY"`) to match Luxon's `weekday` (1=Mon..7=Sun). The plan's snippet used a 0-indexed array with `weekday - 1`. Implementation kept the existing 1-indexed pattern to avoid touching the `THIS [WEEKDAY]` lookup.
- 3-letter weekday abbreviation comes from `.slice(0, 3)` of the full upper-case name (e.g. `"WEDNESDAY".slice(0,3) === "WED"`), matching the spec's `FRI 19 JUN` shape.
- Day-of-month uses Luxon's `.day` (no leading zero), which matches the plan's `5 JAN` example.
- Two pre-existing event tests (`should return null for 7+ days before event` and `should return null for Saturday→Saturday (7 days)`) asserted the exact contract being replaced. They were updated to assert the new `NEXT FRIDAY` / `NEXT SATURDAY` outputs — this is the only way the new contract can be verified, and one of the new tests (`uses NEXT [WEEKDAY] for same-weekday-7-days, not THIS [WEEKDAY]`) explicitly mandates the change.
- The promotion `getPromotionLabel` pre-start branch (which also returned `null` for 7+ days before the start date) was intentionally **not** modified. The brief scope is the event-label path; promotion banners are a separate concern with their own labels (`X WEEKS LEFT` etc.). Wave 2/3 owners can extend that branch separately if needed — the existing promotion test `should return null before start, 7+ days out` remains green and pins current behaviour.
- Story-series and weekly campaigns route through `getEventLabel` and therefore inherit the new bands automatically. No additional weekly tests were added because the existing weekly tests cover only ≤6-day cases; weekly campaigns recurse on a 7-day cycle so `NEXT [WEEKDAY]` and date-format paths are unreachable for them in practice.

## Issues
- During the work window, a sibling agent (working on Task 3 / `bannerConfigResolver`) committed concurrently and triggered a `git index.lock` race that wiped this worktree's uncommitted edits once. The fix was to clear the stale lock and re-apply both edits. No data was lost (changes are all in the final commit).
- The unrelated working-tree noise (`docs/architecture/*`, `package.json`, `vitest.config.ts`, `scripts/ops/cleanup-banner-storage.ts`, `tasks/banner-orchestration/`) was left untouched.

## Downstream notes
- Wave 2 / Wave 3 agents can rely on `getProximityLabel` returning a label for the full schedule horizon for `event`, `weekly`, and `story_series` campaigns. Same signature, same return type (`string | null`).
- For `promotion` campaigns, the pre-start path still returns `null` at 7+ days. If the banner orchestration spec requires labels in that band too, that's a small follow-up: mirror the new event branches inside `getPromotionLabel`'s pre-start block (after line 145). Out of scope here.
- The `// Duplicated in supabase/functions/publish-queue/proximity.ts — keep in sync` comment at the top of `proximity-label.ts` is a flag for whoever owns the publish-worker task — that file will need the same extension to keep the duplication in sync. Not this agent's scope.
