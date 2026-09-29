# SPEC: event-day post at 07:00 on an empty planner

Status: in progress (2026-09-29). Follow-up to PR #31 (25 August 2026, "post events at 7am on the day and pair every post with a story").

## Problem

The rule from PR #31: an event campaign's event-day post goes out at 07:00 (`EVENT_DAY_POST_TIME`); the run-up posts on earlier days stay at midday (`DEFAULT_POST_TIME`). Each posting day gets a feed post and a story at the same time.

The create wizard only applied 07:00 when the planner already had posts. `buildEventCadenceSlots` (`src/lib/create/event-cadence.ts`) built every slot at 12:00, and `deconflictSuggestions` (`src/features/create/schedule/suggestion-utils.ts`) then moved the "Event day" suggestion to 07:00. But `schedule-step.tsx` returns the raw suggestions without deconflicting when there are no existing planner items:

```ts
if (!rawSuggestions.length || !existingItems.length) return rawSuggestions;
```

So the event-day suggestion stayed at 12:00:

- on an empty planner, which is how every new venue starts;
- while the planner fetch is still loading, on any planner;
- when the planner fetch fails.

The unit test added in PR #31 called `deconflictSuggestions` directly with an empty list, a path the wizard never takes, so it passed while the wizard did not. The homepage hero illustration (`planner-illustration.tsx`) says the event-day post goes out at 07:00; for a new venue it did not.

## Live check (read only, 2026-09-29)

`cheersai2.0` (`nbkjciurhvkfpcpatbnt`): every event post scheduled on its own event date since PR #31 is at 07:00. 32 upcoming (16 feed, 16 story, 8 campaigns, 30 September to 20 November) and 12 posted, all on one account, whose planner is never empty. No event-day post is at 12:00, so nothing needs moving.

## Decisions

- **The event-day time is set where the event suggestions are built**, in `buildEventCadenceSlots`, not in deconfliction. Deconfliction only pins or drops days and never changes a time.
- Nothing else moves: weekly hype and "2 days to go" / "1 day to go" stay at 12:00; promotion and weekly-recurring suggestions are untouched.
- The event-day slot is subject to the same "at least 15 minutes ahead" rule as every other cadence slot. On the day of the event, after 06:45, the wizard offers no event-day suggestion and the owner adds their own time. Before this change an empty planner offered 12:00 at that point, and a planner with posts showed a 07:00 button that did nothing when clicked (the slot was in the past).
- GMT/BST: both clock changes happen between 01:00 and 02:00 London time, so 07:00 exists exactly once on either change day. On Sunday 25 October 2026 the event-day post is at 07:00 GMT (07:00 UTC) and the run-up days are at 12:00 BST (11:00 UTC).
- `buildEventScheduleOffsets` shares the builder, so its event-day beat, fallback included, now uses 07:00 too. It has had no caller in `src/` since 28 June 2026 (26089fcd), so this changes nothing live.

## Paths checked

| Path | Builds event suggestions? | Result |
|---|---|---|
| Create wizard: `schedule-step.tsx` to `buildEventSuggestions` to `buildEventCadenceSlots` | Yes | Fixed at the builder |
| `deconflictSuggestions` | Only adjusts them | No longer sets any time |
| `buildEventScheduleOffsets` | Yes, no caller | Follows the builder |
| `createScheduledBatch` (`src/app/actions/content.ts`) | No: stores the wizard's slot times, one feed and one story row per slot at the same time | Unchanged |
| Manual slots (`infer-slot-label.ts`, calendar presets) | No: the owner picks the time | Unchanged |
| Weekly recurring (`buildWeeklyMultiDaySuggestions`, `materialiseRecurring`) | No event day | Unchanged |
| Promotions (`buildPromotionSuggestions`) | No event day | Unchanged |
| Tournament (`src/lib/tournament/generate.ts`) | No: posts a set lead before kick-off | Unchanged |
| `getEngagementOptimisedHour` (`src/lib/scheduling/spread.ts`) | Has its own same-day event rule (17:00), no caller in `src/` | Unchanged, reported |
| Supabase edge functions | None build schedules | Unchanged |

## Change

- `src/lib/create/event-cadence.ts`: the "Event day" countdown slot is set to `EVENT_DAY_POST_TIME` before the 15-minute filter; `buildEventScheduleOffsets`'s fallback uses the same time.
- `src/features/create/schedule/suggestion-utils.ts`: `deconflictSuggestions` keeps an "Event day" suggestion pinned to its date but no longer rewrites its time.
- `src/features/create/steps/schedule-step.tsx`: a comment on the empty-planner early return; no behaviour change.

No schema, data, settings or edge-function change.

## Tests

All run under `npm run test:ci` (Europe/London) and `npm run test:utc`.

- `src/features/create/steps/schedule-step.test.tsx` (the wizard, rendered): empty planner with the event on 25 October 2026; planner with posts in the same month (event day stays 07:00 and pinned, the occupied "1 day to go" is dropped, nothing else moves); an event in GMT (14 November 2026); the planner still loading.
- `tests/lib/create/event-cadence.test.ts`: event day 07:00 and the rest 12:00; exact London and UTC instants on 25 October 2026, in GMT and in BST; the 15-minute rule on the day; the offsets.
- `tests/features/create/suggestion-utils.test.ts`: `buildEventSuggestions` with no deconfliction; `deconflictSuggestions` never changes a time.

## Rollback

Revert the PR. No schema, data or settings change; nothing to deploy first. Posts already scheduled keep their times either way.
