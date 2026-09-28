# SPEC: day-level leads and windows on clock-change days

Status: in progress (2026-09-28). Follow-up to PR #129 (`tasks/SPEC-planner-slot-clock-change.md`), whose sweep found these two cases and left them out. Should ship before Sunday 25 October 2026, when the clocks go back.

## Problem

### 1. Tournament posts land an hour off the kick-off's clock time

`computeScheduledFor(kickOff, leadHours, staggerIndex)` in `src/lib/tournament/generate.ts` takes `leadHours` off kick-off as elapsed time. The tournament settings (`TournamentScheduleDefault`, used by `CreateTournamentModal` and `TournamentSettingsModal`) offer "1, 2, 3 or 7 days before", stored as 24, 48, 72 or 168 hours, and describe any whole-day value as "N days before each game kicks off". When the lead crosses a clock change, elapsed hours do not give the same clock time:

| Kick-off | Lead | Posted (before the fix) | Should be |
|---|---|---|---|
| Sun 25 Oct 2026 20:00 GMT | 1 day | Sat 24 Oct 21:00 BST | Sat 24 Oct 20:00 BST |
| Sun 28 Mar 2027 20:00 BST | 1 day | Sat 27 Mar 19:00 GMT | Sat 27 Mar 20:00 GMT |
| Fri 30 Oct 2026 20:00 GMT | 7 days | Fri 23 Oct 21:00 BST | Fri 23 Oct 20:00 BST |
| Sat 14 Nov 2026 15:00 GMT | 2 days | Thu 12 Nov 15:00 GMT | unchanged |

### 2. The deconflict occupancy window can cut off the edge of a day

`buildOccupancyMap` in `src/lib/scheduling/deconflict.ts` queries existing `content_items` from the earliest plan minus 72 elapsed hours to the latest plus 72. A plan can move up to 2 London calendar days either way. Across the autumn change (a 25-hour day) 72 hours can fall short of the furthest day's edge, so posts there are not counted and that day looks empty:

- A plan at Tue 27 Oct 2026 23:30 GMT gives a window starting Sun 25 Oct 00:30 BST, so posts on 25 Oct from 00:00 to 00:30 are missed.
- A plan at Fri 23 Oct 2026 00:30 BST gives a window ending Sun 25 Oct 23:30 GMT, so posts on 25 Oct from 23:30 to midnight are missed.

In spring (a 23-hour day) 72 hours over-covers, so nothing is missed, but the window is still not day-aligned.

**No production impact today.** `deconflictCampaignPlans` has had no caller in `src/` since 9 September 2026 (d34e3fa3 removed the v1 streaming path, `src/lib/create/service.ts`, its only caller). The fix stops the bug returning if it is wired up again.

## Live check (read only, 2026-09-28)

`cheersai2.0` (`nbkjciurhvkfpcpatbnt`): 2 tournaments (World Cup 2026, 24 hours; Nations Championship 2026, 72 hours), 128 fixtures, kick-offs from 11 Jun to 29 Nov 2026, 24 in the future. **No fixture's lead window crosses a clock change**, so no scheduled tournament post is wrong today and nothing needs regenerating. Query: fixtures with a whole-day lead where the London UTC offset at kick-off differs from the offset at kick-off minus the lead.

## Decisions

- **A whole-day lead means the same London clock time N calendar days earlier.** This matches the UI wording ("1 day before", "Schedule new content 3 days before each game kicks off"). A lead that is not a multiple of 24 is shown as "N hours" and stays N elapsed hours.
- The 5-minute stagger between posts sharing a kick-off stays elapsed time, added after the lead.
- Tournament maths stays in Europe/London (`DEFAULT_TIMEZONE`), as the rest of the tournament code already is. Tournaments are not per-account-timezone today.
- **Kick-offs between 01:00 and 02:00 (London) only**, where the post-day clock time is odd:
  - Spring gap (01:00 to 01:59 on 28 March does not exist): the post moves an hour later (a Mon 29 Mar 2027 01:30 kick-off with 1 day posts at Sun 28 Mar 02:30 BST). This is Luxon's rule and matches how the rest of the app resolves a missing time.
  - Autumn repeat (01:00 to 01:59 on 25 October happens twice): the post keeps the kick-off's own offset where that is valid, so a Mon 26 Oct 01:30 GMT kick-off posts at Sun 25 Oct 01:30 GMT (the second 01:30).
- Deconflict window: from the start of the London day 2 days before the earliest plan to the start of the London day 3 days after the latest plan, exclusive (`gte` / `lt`). This is exactly the set of days a plan can move to, whatever the day lengths.

## Change

- `src/lib/tournament/generate.ts`: `computeScheduledFor` works in London time and subtracts `{ days: leadHours / 24 }` when `leadHours` is a whole number of days, otherwise `{ hours: leadHours }`, then adds the stagger.
- `src/lib/scheduling/deconflict.ts`: `buildOccupancyMap` builds the window in calendar days as above.

No schema, data, settings or edge-function change. Nothing in `supabase/functions/` computes a tournament lead or a deconflict window.

## Tests

Both run under `npm run test:ci` (Europe/London) and `npm run test:utc`.

- `src/lib/tournament/generate.test.ts`: 1 day across 25 Oct 2026 and 28 Mar 2027; 7 days across 25 Oct; stagger on a change day; a normal day; a 12-hour lead still elapsed across 25 Oct; the spring gap and autumn repeat rules above.
- `tests/scheduling/deconflict.test.ts`: the Supabase mock now applies the query's `gte` / `lt` bounds like the database would. New cases: a post at 25 Oct 00:15 BST counts for a plan at 27 Oct 23:30 GMT; a post at 25 Oct 23:45 GMT counts for a plan at 23 Oct 00:30 BST; the window is London-midnight aligned across 28 Mar 2027 and on a normal day.

## Rollback

Revert the PR. No schema, data or settings change; nothing to deploy first. Existing tournament posts keep the time they were generated with either way.
