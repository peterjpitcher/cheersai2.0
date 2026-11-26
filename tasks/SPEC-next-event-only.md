# Spec: next event only

Owner approval: 26 November 2026, in chat. Peter: "we are posting about events way before they are coming out. What we should probably do is focus on the next event until it's done ... Then, the next day, moving on to the next event." He approved the rule change, the re-plan of the live schedule, the copy rewrite and the new posts in the same conversation.

## Problem

- The order rule of 17 October 2026 (`tasks/SPEC-social-calendar-fill.md`) only stops two events of the same type being promoted at once.
- Events of different types interleave. On 26 November 2026 the schedule promoted Music Bingo (11 December) on 22, 27 and 30 November and Cash Bingo (16 December) on 24 November, 3 and 8 December, all while the Quiz on 2 December was the next event.
- That splits attention across three nights instead of pointing people at the next one to book.

## Decision

- An event's promotion window opens at 00:00 London on the day after the event before it, whatever its type. One event is promoted at a time: the next one.
- This replaces "the last event of the same type". Everything else about the window stays: it is looked up in the events system on import, stored with the brief, enforced when posts are created or moved, and re-checked daily at 06:45 UTC.
- An event with no category now has a window too, because the category is no longer needed.
- An event on the same day as another does not hold it back.
- A cancelled event still counts as the event before (unchanged; the events list does not tell this code an event is cancelled).
- Posts that are not events (Sunday roast, weekday lunch, private hire, Ladies Darts Night, opening hours) are outside the rule.
- The stored window keeps its `category` field so posts scheduled under the old rule still read back; it now holds the earlier event's category and the owner-facing message no longer uses it.

## What changes in code

- `src/lib/management-app/promotion-window.ts`: `promotionWindowFrom` takes the latest earlier event of any category. The message reads "X can be promoted from <day>, after <event> on <day>."
- `src/lib/management-app/promotion-window-loader.ts`: no longer returns early for an event with no category.
- `src/features/create/steps/schedule-step.tsx`: the same wording change.
- Comments that described the old rule.

No schema change, no migration, no new environment variable.

## Effects to expect

- The wizard drops any suggested slot before the window, so an event that follows another closely gets a short run. Cash Bingo on 16 December, five days after Music Bingo, could be posted from 12 December only.
- The weekly "N weeks out" suggestions (`src/lib/create/event-cadence.ts`) are unchanged; they are simply dropped when they fall before the window.
- The daily check flags any scheduled event post that goes out before its event's new window. The live schedule was re-planned on 26 November 2026 so none does.
- Posts already scheduled keep the window stored with them, so the planner's move check for those uses the old, wider window; the daily check uses the new rule for every post.

## Live schedule, 26 November 2026 (data, not code)

Done with one-off scripts in `temp/next-event-focus/` (git-ignored), through the calendar tool's apply and undo:

- The four out-of-turn slots (Music Bingo on 27 and 30 November, Cash Bingo on 3 and 8 December; 16 posts) went to the bin.
- New posts: Quiz on 27 and 30 November; Music Bingo on 3 and 8 December; Cash Bingo on 12 and 13 December; New Year's Eve on 17, 21, 23, 27, 29, 30 and 31 December; Ladies Darts Night at 07:00 on 3, 10 and 17 December; Christmas opening hours on 7, 18 and 24 December.
- The remaining Quiz, Music Bingo and Cash Bingo posts were rewritten to lead with the reason to come and ask for the booking early.

## Rollback

- Code: revert the PR. The old rule returns; stored windows are unaffected.
- Data: `npx tsx temp/next-event-focus/bin.ts --rollback` restores the binned posts; `npm run ops:calendar-fill -- --rollback --plan <plan.json>` removes the posts a plan added; `npm run ops:rewrite-event-posts -- --rollback --plan <plan.json>` puts old copy back.

## Tests

- The window opens after an earlier event of another type.
- The event itself, same-day events and later events are ignored.
- An event with no category gets a window; an invalid date or no earlier event gives none.
- The loader calls the events system for an event with no category.
- The owner-facing message in the library, the schedule step and the daily notice.
