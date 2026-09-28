# SPEC: planner feed slots on clock-change days

Status: in progress (2026-09-27). Deadline: before Sunday 25 October 2026, when the clocks go back.

## Problem

"Save schedule" on the planner (`updatePlannerContentSchedule` in `src/app/(app)/planner/actions.ts`) runs feed posts through `reservePlannerSlotOnSameDay`, which finds the first free 30-minute slot at or after the time asked for. It built the answer as `startOfDay.plus({ minutes: hour * 60 + minute })`. Luxon's `plus` adds elapsed time, so on a day that is not 24 hours long the saved time is an hour out:

| Asked for | Day | Saved (before the fix) | Should be |
|---|---|---|---|
| 10:00 | Sun 25 Oct 2026 (25-hour day) | 09:00 GMT | 10:00 GMT |
| 10:00 | Sun 28 Mar 2027 (23-hour day) | 11:00 BST | 10:00 BST |
| 10:00 | Mon 14 Sep 2026 (normal) | 10:00 BST | 10:00 BST |

It happens for every feed save on those two days, whether or not the slot was free, because the helper always rebuilt the time from midnight. Stories skip the slot search and are not affected. The occupied-slot set is built from wall-clock hour and minute, so the search itself was already in wall-clock terms; only the final conversion back to a time was wrong.

## Change

Rebuild each candidate slot with `set({ hour, minute })` (wall-clock) instead of adding elapsed minutes to midnight. Two edge cases need a rule:

- **Spring-forward gap** (01:00 to 01:59 on 28 March in London does not exist). Luxon pushes a missing time an hour on, so a search that stepped from a taken 00:30 slot into 01:00 would land on 02:00, which may already be taken. Rule: a wall-clock slot that does not exist that day is skipped, and the search carries on to the next real slot. A time asked for directly inside the gap is already moved on by `DateTime.fromISO` before the search starts (01:30 becomes 02:30 BST), which is unchanged.
- **Repeated autumn hour** (01:00 to 01:59 on 25 October happens twice, first BST then GMT). Rule: each candidate is resolved from the requested slot's own offset, so a slot moved along stays on the same side of the change as the time asked for and can never land before it. The old code resolved from midnight's offset (BST), so moving on from 01:00 GMT could land in the past.

Known and accepted: in the repeated hour, a post at 01:00 BST and one at 01:00 GMT both count as the "01:00" slot, because the occupied set is wall-clock. The planner keeps them one slot apart rather than letting both through. This only matters for posts scheduled between 1am and 2am on one night a year.

## Tests

New `tests/app/planner-actions-schedule-slot.test.ts`, run through the real action with the Supabase mock pattern from `tests/app/planner-actions-drift.test.ts`, under both `npm run test:ci` (Europe/London) and `npm run test:utc`:

- normal day, 25 October and 28 March: free 10:00 saves as 10:00 local
- 25 October and 28 March: a taken 10:00 moves to 10:30 local
- 28 March: from a taken 00:30, the gap is skipped and a taken 02:00 is not double-booked
- 25 October: moving on from 01:00 BST stays in BST; moving on from 01:00 GMT stays in GMT (not in the past)

## Sweep of the rest of the code

Searched `src/` and `supabase/functions/` for any other time of day reached by adding elapsed hours or minutes to midnight (Luxon `plus`/`minus`, native `Date` millisecond maths, `setHours`, date-fns, dayjs, moment). **No other case exists.** Everything else that builds a wall-clock time already uses `set({ hour, minute })` or `fromISO` with an explicit zone, and every `plus({ days | weeks })` is a Luxon calendar step.

Two close relatives were found and verified; both are left out of this change (different pattern, no live impact) and raised as a follow-up:

- `src/lib/tournament/generate.ts` `computeScheduledFor`: kick-off minus `postLeadHours` as elapsed hours. The settings offer "1, 2, 3 or 7 days before", so a lead that crosses a clock change lands an hour off the kick-off's clock time (a 20:00 kick-off on 25 Oct, "1 day before", posts at 21:00 on the Saturday). Checked against the live database on 2026-09-27: no fixture's lead window crosses 25 Oct 2026 or 28 Mar 2027.
- `src/lib/scheduling/deconflict.ts` occupancy window: plus or minus 72 elapsed hours. Near a clock change it can miss posts in the first or last half hour of the furthest day it might move a plan to. Only affects plans within about an hour of midnight near a change.

Ruled out after checking: lead times measured from now, match durations (kick-off plus 120 minutes), 15 to 60 minute spacing between posts, look-back windows, and day differences taken between two start-of-day values.

## Rollback

Revert the PR. No schema, data or settings change; nothing to deploy first.
