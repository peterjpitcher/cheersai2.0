# SPEC: offer suggestions never repeat a day

Status: in progress (2026-09-29). Found in review while fixing PR #169 (`tasks/SPEC-event-day-seven-am-empty-planner.md`).

## Problem

In the create wizard, an offer (promotion) campaign gets three suggested slots from `buildPromotionSuggestions` (`src/features/create/schedule/suggestion-utils.ts`): "Launch" (today), "Mid-run reminder" (halfway to the end date) and "Last chance" (the end date, less six hours). Each is then set to 12:00 London (`DEFAULT_POST_TIME`) on its day.

For a short run those beats land on the same day:

| Offer ends | Suggested before this change (09:00 London) |
|---|---|
| today | Launch, Mid-run reminder and Last chance, all today at 12:00 |
| tomorrow | Launch and Mid-run reminder both today at 12:00, Last chance tomorrow |
| already ended | Launch and Mid-run reminder both today at 12:00 |
| in 2 days or more | three different days, no repeat |

On a planner with posts, `deconflictSuggestions` keeps the first suggestion on each day and drops the rest, so the owner saw one slot per day. `schedule-step.tsx` skips that step on an empty planner (and while the planner is loading, or if loading fails), so the owner saw two or three "Add suggested slot" buttons for the same day and time with different labels. Clicking any of them adds one slot labelled "Launch" (`handleAddSlot` matches the first suggestion at that date and time), so picking "Mid-run reminder" gave a slot, and AI copy, labelled "Launch". No duplicate posts were created: the wizard refuses a second slot at the same date and time.

It happens only before 11:45 London time: after that, today's 12:00 slots fall inside the 15-minute rule and are not offered. The 25 October 2026 clock change does not cause it and does not change it: a run ending tomorrow repeats today on either side of the change, and longer runs over the change keep three different days.

## Decision

- **`buildPromotionSuggestions` keeps the first suggestion on each London day** and drops the rest, after the 15-minute rule. Every offer suggestion is at 12:00, so one per day also means one per date and time.
- This is the same rule `deconflictSuggestions` applies, so an empty planner and a planner with unrelated posts now offer the same slots: for a run ending tomorrow, Launch today and Last chance tomorrow; for a run ending today, Launch only.
- The fix sits where the suggestions are built, as in PR #169: the wizard skips deconfliction on an empty planner, so anything the suggestions must always satisfy belongs in the builder.
- Nothing else changes: event, weekly-recurring, story and instant-post suggestions; the event-day 07:00 rule; `deconflictSuggestions`; `schedule-step.tsx`.

## Change

- `src/features/create/schedule/suggestion-utils.ts`: `buildPromotionSuggestions` drops a suggestion whose London date is already taken by an earlier one.

No schema, data, settings or edge-function change.

## Tests

All run under `npm run test:ci` (Europe/London) and `npm run test:utc`.

- `tests/features/create/suggestion-utils.test.ts`: offers ending today, tomorrow, in 3, 10 and 30 days, on the day the clocks go back, starting on that day, and running over it. Each checks the exact suggestions, that no two share a date and time, and that deconflicting against an unrelated post changes nothing. Plus the exact UTC instants either side of the change (12:00 BST and 12:00 GMT).
- `src/features/create/steps/schedule-step.test.tsx` (the wizard, rendered): the same offer on an empty planner and on a planner with one unrelated post offers the same buttons; an offer ending on 25 October offers each day once and both slots can be added with their own labels.

## Rollback

Revert the PR. No schema, data or settings change; nothing to deploy first. Posts already scheduled are not touched either way.
