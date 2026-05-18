# Fix: event timing cue says "tomorrow" for events two calendar days away

## Critical review of the previous spec

The original diagnosis is directionally correct: `describeEventTimingCue()` tells the model to say "tomorrow" when the event is two calendar days away. But the implementation plan had several problems that would either miss regressions or widen the task in the wrong way.

1. The test path was wrong for this repo. There is already a `describeEventTimingCue` block in `tests/lib/create/service.test.ts`; adding `src/lib/create/event-timing-cue.test.ts` would violate the repo's `tests/` mirroring convention and split coverage for the same helper.
2. The existing test name "returns tomorrow for 1-2 days out" encodes the bug. That test must be rewritten, not supplemented.
3. The spec mixed "add a timezone parameter" with "no signature change needed". For this codebase, keep the helper defaulted to `DEFAULT_TIMEZONE` unless we deliberately propagate account timezones through `EventCampaignInput`. That broader timezone propagation is not required for this bug.
4. The spec kept the `diffHours <= 3` branch but did not notice that it currently says "tonight" even for a next-calendar-day 01:00 event. Imminent copy must still use the correct calendar phrase.
5. `Math.round(diffMs / HOUR_MS)` can classify 3h29m as "within 3 hours". Use a raw millisecond comparison for the imminent threshold.
6. The prompt context cue is currently computed before feed/story placement scheduling is resolved, while the focus line is computed after placement scheduling. Story plans can therefore get a focus line and `promptContext.temporalProximity` that disagree. Compute the cue from the same `placementScheduledFor` used in the focus line.
7. The promotion section was too casual. Promotions use `dateMode: "ends_on"` and store `endDate` as the start of the selected calendar day, so a promotion "ending Wednesday" should be treated as ending at the end of Wednesday for copy guidance. Do not simply swap in a calendar-day helper without preserving end-of-day semantics.
8. The DST fixture had the wrong 2026 dates. UK spring-forward in 2026 is Sunday 29 March, so the Saturday-to-Sunday fixture is 28 March -> 29 March.
9. The scope checkboxes were pre-marked as complete. This is a task spec, not an implementation record.

## Problem

When CheersAI generates social media copy for an event, it can tell the AI the wrong relative day.

Observed example:

> Content for a Wednesday 20 May 2026 event, scheduled to post on Monday 18 May 2026, says: "Join us at The Anchor tomorrow, Wednesday 20 May, for Cash Bingo from 7pm!"

Wednesday 20 May 2026 is not tomorrow from Monday 18 May 2026. It should say "this Wednesday" or avoid relative day language.

## Root cause

`describeEventTimingCue()` in `src/lib/create/service.ts:529` calculates day distance from raw elapsed milliseconds:

```ts
const diffMs = eventStart.getTime() - scheduledFor.getTime();
const diffHours = Math.round(diffMs / HOUR_MS);
const diffDays = Math.floor(diffMs / DAY_MS);
```

It then uses `diffDays <= 2` for the `tomorrow` branch:

```ts
if (diffDays <= 2) {
  return {
    description: `Say it's tomorrow (${weekday} ${dayMonth}) and stress limited spots before ${timeLabel}.`,
    toneCue: "anticipation, countdown, don't miss out",
    label: "tomorrow",
  };
}
```

For Monday 18 May 2026 12:00 -> Wednesday 20 May 2026 19:00:

- elapsed time is 55 hours
- `Math.floor(55 / 24)` is `2`
- `diffDays <= 2` is true
- the focus line explicitly tells the model to say "tomorrow"

There are three separate defects:

1. `diffDays <= 2` is too broad. "Tomorrow" should only mean exactly one calendar day ahead.
2. Elapsed 24-hour chunks are not calendar days. Monday 01:00 -> Tuesday 23:00 is 46 hours but still tomorrow. Monday 23:00 -> Tuesday 19:00 is 20 hours and also tomorrow.
3. The imminent branch is based on rounded hours and hard-codes "tonight", which is wrong for events just after midnight on the next calendar day.

## How it reaches the AI

The bad cue reaches generation in the focus line, which is stronger than the raw date context:

- `buildEventFocusLine()` appends `cue.description` directly to the prompt.
- `promptContext.temporalProximity` passes the `toneCue` into `src/lib/ai/prompts.ts`.
- The context block also includes the raw post and event dates, but the explicit focus instruction can override that.

Post-processing currently validates weekday names against the event date, but it does not validate relative words such as "tomorrow". The fix belongs in the cue generation, not in post-processing.

## Correct behaviour

Calendar-day semantics should drive relative day labels. Elapsed hours should only drive urgency.

| Situation | Expected label | Required wording |
|-----------|----------------|------------------|
| Scheduled after event start by more than 3h | `recap` | Recap / highlights language |
| Scheduled at event start or up to 3h after | `today_imminent` | Event is underway right now |
| Event starts within the next 3h | `today_imminent` | "in just a few hours"; mention the correct local day if not same calendar day |
| Same calendar day, before 14:00 local | `today_morning` | "happening today at [time]" |
| Same calendar day, 14:00 or later | `today_imminent` | "happening today at [time]" |
| Exactly 1 calendar day ahead | `tomorrow` | "tomorrow ([weekday] [date])" |
| 2-6 calendar days ahead | `building` | "this [weekday] ([date])" |
| 7+ calendar days ahead | `early_awareness` | Full date, no "this" or "tomorrow" |

For the imminent branch, do not say "tonight" unless the event and post are on the same local calendar day and the event time is actually in the evening.

## Implementation plan

### 1. Add a calendar-day helper

Add this beside `isSameCalendarDay()` in `src/lib/scheduling/spread.ts`, or keep it local to `service.ts` if we want a smaller surface. Export it if testing directly.

```ts
export function calendarDayDiff(earlier: Date, later: Date, tz: string): number {
  const earlierDay = DateTime.fromJSDate(earlier, { zone: tz }).startOf("day");
  const laterDay = DateTime.fromJSDate(later, { zone: tz }).startOf("day");
  return Math.round(laterDay.diff(earlierDay, "days").days);
}
```

Use Luxon day arithmetic, not native `Date` math. The `Math.round` is intentional here because both values are normalized to local start-of-day and DST days can be 23 or 25 elapsed hours.

### 2. Rework `describeEventTimingCue`

Replace `diffDays` and rounded-hour branching with:

```ts
const diffMs = eventStart.getTime() - scheduledFor.getTime();
const diffCalendarDays = calendarDayDiff(scheduledFor, eventStart, DEFAULT_TIMEZONE);
const isImminent = diffMs > 0 && diffMs <= 3 * HOUR_MS;
```

Branch in this order:

1. `scheduledFor === null`
2. `diffMs <= 0` for underway vs recap
3. `isImminent`
4. `diffCalendarDays === 0`
5. `diffCalendarDays === 1`
6. `diffCalendarDays >= 2 && diffCalendarDays <= 6`
7. fallback to `early_awareness`

The imminent branch must choose wording from `diffCalendarDays`:

- `0`: "in just a few hours (today at [time])"
- `1`: "in just a few hours ([weekday] at [time])"
- otherwise: "in just a few hours ([weekday] [dayMonth] at [time])"

Do not use `Math.round(diffMs / HOUR_MS)` for thresholding.

### 3. Align focus line and prompt context per placement

In `buildEventCampaignPlans`, compute the timing cue inside the placement loop, after `placementScheduledFor` is known.

Current bug shape:

```ts
const timingCue = describeEventTimingCue(futureSlot, eventStart);
const placementScheduledFor = placement === "story"
  ? resolveStoryScheduledFor(futureSlot, DEFAULT_TIMEZONE) ?? futureSlot
  : futureSlot;

// focus line uses placementScheduledFor, promptContext uses futureSlot cue
```

Required shape:

```ts
const placementScheduledFor = placement === "story"
  ? resolveStoryScheduledFor(futureSlot, DEFAULT_TIMEZONE) ?? futureSlot
  : futureSlot;
const timingCue = describeEventTimingCue(placementScheduledFor, eventStart);
```

Apply this in both the manual schedule path and the offset schedule path.

### 4. Treat promotion timing as a secondary fix, not a copy-paste fix

If `describePromotionTimingCue()` is touched in this task, fix it fully:

- Add `describePromotionTimingCueForTest` to `__testables`.
- For `dateMode: "ends_on"` style promotions, compare against the end of the selected local calendar day, not midnight at the start of that date.
- Use calendar days for "today", "tomorrow", and "N days" wording.
- Preserve the short-hours branch only when the promotion really ends within the next 6 elapsed hours.

If that is too much for this patch, leave promotions out of scope and create a separate task. Do not apply a partial "calendar diff" change that still treats end dates as midnight.

### 5. Do not silently ignore deconfliction drift

`deconflictCampaignPlans()` can shift `scheduledFor` after the prompt and prompt context have already been built. That can also stale relative timing language.

This is probably not the source of the Monday -> Wednesday "tomorrow" report, because the example matches the direct 55-hour calculation. Still, the implementation should not claim schedule/deconfliction is fully solved unless one of these is true:

- timing-sensitive prompt fields are rebuilt after deconfliction, or
- a follow-up task is created for deconfliction drift and this spec explicitly documents the residual risk.

## Tests

Use the existing `describe("describeEventTimingCue")` block in `tests/lib/create/service.test.ts`. Build dates via Luxon in `Europe/London`:

```ts
const TZ = "Europe/London";
const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();
```

Rewrite the current "returns tomorrow for 1-2 days out" test into exact 1-day behaviour.

### Event cue cases

| Post time | Event time | Expected label | Assertion |
|-----------|------------|----------------|-----------|
| 2026-05-18 12:00 | 2026-05-18 19:00 | `today_morning` | contains "happening today" |
| 2026-05-18 15:00 | 2026-05-18 19:00 | `today_imminent` | contains "happening today" |
| 2026-05-18 17:00 | 2026-05-18 19:00 | `today_imminent` | contains "few hours" |
| 2026-05-18 12:00 | 2026-05-19 19:00 | `tomorrow` | contains "tomorrow" |
| 2026-05-18 12:00 | 2026-05-20 19:00 | `building` | contains "this Wednesday"; does not contain "tomorrow" |
| 2026-05-18 12:00 | 2026-05-24 14:00 | `building` | contains "this Sunday" |
| 2026-05-18 12:00 | 2026-05-25 19:00 | `early_awareness` | does not contain "tomorrow" or "this Monday" |
| 2026-05-20 20:00 | 2026-05-20 19:00 | `today_imminent` | contains "underway" |
| 2026-05-21 12:00 | 2026-05-20 19:00 | `recap` | contains "recap" or "highlights" |

### Midnight and DST cases

| Post time | Event time | Expected label | Assertion |
|-----------|------------|----------------|-----------|
| 2026-05-18 23:00 | 2026-05-19 01:00 | `today_imminent` | contains "few hours"; does not contain "tonight" |
| 2026-05-18 23:30 | 2026-05-19 19:00 | `tomorrow` | contains "tomorrow" |
| 2026-05-18 01:00 | 2026-05-19 23:00 | `tomorrow` | contains "tomorrow" despite 46 elapsed hours |
| 2026-05-24 23:00 | 2026-05-25 19:00 | `tomorrow` | handles week boundary |
| 2026-03-28 12:00 | 2026-03-29 14:00 | `tomorrow` | handles UK spring-forward weekend |

### Plan-building regression

Add or extend coverage in `tests/lib/create/event-campaign-plans.test.ts`:

- Build an event on Wednesday 20 May 2026 at 19:00 with a manual feed slot on Monday 18 May 2026 at 12:00.
- Assert the generated prompt does not include "tomorrow".
- If both `feed` and `story` placements are present, assert each plan's `promptContext.timingLabel` was computed from that plan's own `scheduledFor`.

### Promotion tests, only if promotion is included

Add tests in `tests/lib/create/service.test.ts` after exporting `describePromotionTimingCueForTest`:

| Post time | Promotion end date | Expected wording |
|-----------|--------------------|------------------|
| 2026-05-20 10:00 | 2026-05-20 | ends today / last chance, not wrap-up |
| 2026-05-19 10:00 | 2026-05-20 | ends tomorrow |
| 2026-05-18 10:00 | 2026-05-20 | two days left / wraps in two days |
| 2026-05-21 10:00 | 2026-05-20 | wrap-up |

## Scope

### In scope

- [ ] Fix `describeEventTimingCue` calendar-day logic.
- [ ] Remove the `diffDays <= 2` tomorrow bug.
- [ ] Replace rounded-hour imminent thresholding with raw millisecond thresholding.
- [ ] Ensure imminent wording does not say "tonight" for next-day early-morning events.
- [ ] Compute event timing cue from `placementScheduledFor` in every plan path.
- [ ] Update existing tests and add midnight / DST regressions.

### Optional in this patch

- [ ] Fix `describePromotionTimingCue` with end-of-day semantics and tests.
- [ ] Add a shared `calendarDayDiff` export and direct tests for it.

### Out of scope

- UI changes.
- Banner overlay rendering.
- Broad account-timezone propagation through event campaign schemas.
- Rewriting the event cadence algorithm.
- Full deconfliction prompt rebuild, unless implemented explicitly as part of this patch.

## Files to change

| File | Change |
|------|--------|
| `src/lib/create/service.ts` | Fix event cue logic; align placement-specific prompt context; optionally fix promotion cue |
| `src/lib/scheduling/spread.ts` | Optional shared `calendarDayDiff` helper |
| `tests/lib/create/service.test.ts` | Rewrite and expand `describeEventTimingCue` tests; optionally add promotion tests |
| `tests/lib/create/event-campaign-plans.test.ts` | Add plan-level regression for Monday -> Wednesday and feed/story timing context |
| `tests/lib/scheduling/spread.test.ts` | Only if `calendarDayDiff` is exported |

## Verification

Run the focused tests first:

```bash
CI=1 npm test -- --run tests/lib/create/service.test.ts tests/lib/create/event-campaign-plans.test.ts
```

If `calendarDayDiff` is exported, include:

```bash
CI=1 npm test -- --run tests/lib/scheduling/spread.test.ts
```

Then run the normal quality gates:

```bash
npm run lint:ci
npm run typecheck
npm run build
```

## Complexity

Score: 3 (M).

The core bug is small, but the safe fix touches prompt construction, existing tests, and possibly promotion date semantics. Treat this as more than a one-line threshold change.
