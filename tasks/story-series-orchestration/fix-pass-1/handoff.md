# Fix pass 1 — Handoff

## Issue 1 status: FIXED (likely) with commit 9b4c184 — see notes
- **Root cause (best-supported hypothesis):** the previous code marked story-placement plans on the event day as `pinned: true` (because the per-slot `isSameDay` flag was applied to all placements). Stories shared the feed slot's exact `scheduledFor` (e.g. `2026-05-23T12:00`), so two pinned plans (one feed, one story) landed on the same `(account, scheduled_for, platform)` slot. Once that's combined with the AI generation timeline (feed plans go through OpenAI, story plans short-circuit with empty body) and `deconflictCampaignPlans`/`resolveScheduleConflicts` running over a mixed pinned/unpinned plan list, downstream code paths could throw inside the server action — surfacing in production as the generic "An error occurred in the Server Components render" digest because the create page re-renders after the failed `revalidatePath`.
- **Actual error message captured:** **NOT CAPTURED** in this fix pass. The orchestrator brief asked us to capture it from `npm run dev`, but reproduction requires authenticated session state (login + a configured account + media uploads) which can't be set up offline in a single test pass. We did:
  - Confirm `npx tsc --noEmit` clean before and after the change.
  - Confirm `npm run build` clean before and after the change.
  - Run `npm run ci:verify` clean (641 tests pass).
  - Add 7 unit tests in `tests/lib/create/event-campaign-plans.test.ts` that exercise the plan-building helper with `placements: ['feed','story']` and assert: no throw, plan count = slot-count × 2, correct placement distribution, stories at 07:00, story plans not pinned even on the event day.
  - Verify the new helper compiles into an orderly call from `createEventCampaign`.
  
  If the bug recurs after this fix pass, please capture the dev-mode error message and attach it here so we can target the residual cause.

- **Fix summary:** Refactored the event campaign plan-building loop into a pure helper `buildEventCampaignPlans(...)` (in `src/lib/create/service.ts`) so the logic can be unit-tested without auth/Supabase. Within that helper, two behaviours change:
  1. Story-placement plans are scheduled at 07:00 in `Europe/London` on the same calendar day as the resolved feed slot — using the existing `resolveStoryScheduledFor` helper (which already handles "07:00 has passed today, bump forward" correctly). This keeps `pinned`-on-the-event-day semantics meaningful for the feed plan only, while the story plan moves to a different time on the same day.
  2. The `pinned` flag is now `isSameDay && placement !== "story"` — stories are never pinned, even on the event day. This unblocks the deconflict path from having to reason about two pinned plans sharing the exact same `scheduledFor`.

  Same fix is applied inline in `createPromotionCampaign` (no helper extraction yet — promotion campaign uses a different shape with `entry.label`/`entry.context`/`entry.phase`, and it didn't seem worth a second refactor for this pass).

## Issue 2 status: FIXED with commit 3d6ea8a
- **Approach:** drop shifted cadence/weekly suggestions. The `deconflictSuggestions` helper used to shift collisions onto nearby empty days (±1, ±2, ±3, ±4) but kept the original label. Cadence labels carry meaning relative to a specific date (e.g. "1 day to go", "Weekly hype · 2 weeks out"), so a shift produces a misleading label. Now: when a cadence-labelled suggestion's date is occupied (by an existing planner item or a sibling suggestion), the suggestion is dropped from the list. "Event day" is still pinned and forced to 17:00 as before.
- **File:** `src/features/create/schedule/suggestion-utils.ts`
- **Test:** `tests/features/create/suggestion-utils.test.ts` — 6 tests covering: drop on occupancy, no shift, no relabel, sibling-collision, Event-day pin, no-conflict pass-through.
- **Commit:** `3d6ea8a fix(create): drop occupied cadence-suggestion slots instead of shifting them`

## Issue 3 status: FIXED with commit 9b4c184
- Stories default to 07:00 in `Europe/London` via `resolveStoryScheduledFor`.
- Applied to both `createEventCampaign` (manualSchedule + scheduleOffsets branches) and `createPromotionCampaign` (manualSchedule + 3-phase branches).
- **Test:** `tests/lib/create/event-campaign-plans.test.ts` — 7 tests in 3 groups:
  - Issue 1 regression (no-throw + correct counts/distribution)
  - Issue 3 (story-at-07:00) for both scheduleOffsets and manualSchedule paths
  - Placement distribution (feed-only and story-only)
- **Commit:** `9b4c184 fix(create): default story-placement plans to 07:00 in Europe/London`

## CI verify
**PASS** — `npm run ci:verify` clean. Lint (zero warnings), typecheck, 83 test files / 641 tests pass, production build OK.

## Open items
- **Issue 1 actual error message not captured** — see notes above. Recommend capturing it on the next time the bug surfaces in dev mode (or by spinning up a fully-authenticated dev instance) so we can verify the targeted fix landed on the right cause. The fix as committed addresses two concrete defects (story-day pinning, story sharing feed time) that align with the "Server Components render" symptom; if the bug recurs the next pass should target the residual cause directly.
- The `_timezone` parameter in `deconflictSuggestions` is now unused. Kept in the signature to avoid touching every caller, with an `eslint-disable-next-line` comment. A follow-up commit could remove it from the call sites if desired.
- `createPromotionCampaign` was patched inline rather than extracted into a pure helper — extraction is straightforward and would mirror `buildEventCampaignPlans` cleanly. Not done in this pass to keep scope tight.

## Commits visible
```
3d6ea8a fix(create): drop occupied cadence-suggestion slots instead of shifting them
9b4c184 fix(create): default story-placement plans to 07:00 in Europe/London
```

(Issue 1 fix is bundled into commit `9b4c184` since the refactor that made the regression test possible is the same change as the Issue 3 fix.)
