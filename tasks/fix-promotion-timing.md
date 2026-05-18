# Fix: promotion timing uses midnight end dates and elapsed-hour day math

## Critical review of the previous spec

The previous spec identified the right family of bug, but it was too narrow and had a few internal contradictions.

1. It focused only on `describePromotionTimingCue()`. That fixes some prompt wording, but auto-generated promotion phase dates in `createPromotionCampaign()` also use the raw midnight `endDate`. If `ends_on` means "through Wednesday", the "Last chance" slot should not be calculated from Wednesday 00:00 as though the offer ended before Wednesday began.
2. It said Monday -> Wednesday should not say "wraps in two days", then later required a two-day case to say "wraps in two days". Pick one rule. The safer copy rule is: use "tomorrow" only for exactly one calendar day ahead, and use the named end date for 2+ days to avoid inclusive/exclusive "days left" ambiguity.
3. It described `calendarDayDiff()` as something to add, but the current codebase already has it in `src/lib/scheduling/spread.ts`. Reuse it.
4. It assumed no signature change is needed because `dateMode` is always `"ends_on"`. That is true today, but the helper should document that assumption. If a real date-range mode is added later, this helper must either accept mode or split into separate helpers.
5. It ignored the downstream copy repair paths. `postProcessGeneratedCopy()` and `finaliseCopy()` also inspect `promotionEnd` using raw date differences. They may not need changes for this patch, but the implementer should audit them before claiming end-to-end promotion timing correctness.
6. It did not call out that `buildPromotionFocusLine()` is the only current carrier of the timing cue. Promotion `promptContext` has `promotionEnd` and `promotionDateMode`, but no `temporalProximity` or timing label.

## Problem

Promotion campaigns treat a selected end date as midnight at the start of that day in some places, even though the UI semantics are "ends on this date".

Current create flow:

- `handlePromotionCampaignSubmission()` parses `endDate` as `DateTime.fromISO(formValues.endDate, { zone: DEFAULT_TIMEZONE }).toJSDate()`, which is local midnight at the start of the selected date.
- `createPromotionCampaign()` sets `const end = input.endDate`.
- `describePromotionTimingCue()` compares `scheduledFor` directly against that midnight timestamp.
- Auto phase generation computes `durationMs`, `mid`, and `lastChance` from that same midnight timestamp.

That produces wrong or misleading timing. A post on Wednesday 20 May 2026 at 10:00 for a promotion that "ends on Wednesday 20 May" is currently after `end`, so the cue can become wrap-up copy even though the promotion should still be live all day.

## Root cause

There are two related defects:

1. `describePromotionTimingCue()` converts elapsed hours into days:

```ts
const hoursUntilEnd = endDiffMs / HOUR_MS;
const daysUntilEnd = Math.ceil(hoursUntilEnd / 24);
```

2. `createPromotionCampaign()` treats `endDate` as the exact end instant, but for `dateMode: "ends_on"` it is only the selected calendar day. The effective end instant is the end of that local day.

## Correct behaviour

For today's schema, promotion campaigns only support `dateMode: "ends_on"`. Treat `input.endDate` as the selected local end day, and derive:

```ts
const endDay = DateTime.fromJSDate(end, { zone: DEFAULT_TIMEZONE }).startOf("day");
const effectiveEnd = endDay.endOf("day");
```

Use `effectiveEnd` for expiry and short-hours urgency. Use `calendarDayDiff(scheduledFor, endDay.toJSDate(), DEFAULT_TIMEZONE)` for calendar labels.

| Situation | Expected cue |
|-----------|--------------|
| `scheduledFor` is null | Immediate-interest wording |
| Scheduled after the effective end of the end day | Wrap-up wording |
| Scheduled on the end day, with <=6h until effective end | Ends tonight / final rush |
| Scheduled on the end day, with >6h until effective end | Ends today / last chance |
| Scheduled 1 calendar day before the end day | Ends tomorrow |
| Scheduled 2-6 calendar days before the end day | Ends on `[weekday] [date]` |
| Scheduled 7+ calendar days before the end day | Finishes on `[weekday] [date]` |

Do not use "by 12am", "tonight by 12am", or any other precise end time for `ends_on` promotions. The user selected a date, not a time.

## Implementation plan

### 1. Add a small effective-end helper

Keep this local to `src/lib/create/service.ts` unless another module needs it:

```ts
function getPromotionEndDay(end: Date) {
  return DateTime.fromJSDate(end, { zone: DEFAULT_TIMEZONE }).startOf("day");
}

function getPromotionEffectiveEnd(end: Date) {
  return getPromotionEndDay(end).endOf("day");
}
```

### 2. Rewrite `describePromotionTimingCue()`

Use the existing `calendarDayDiff` import from `src/lib/scheduling/spread.ts`.

```ts
function describePromotionTimingCue(scheduledFor: Date | null, end: Date) {
  if (!scheduledFor) {
    return "Drive immediate interest and invite guests to take advantage right now.";
  }

  const scheduledDt = DateTime.fromJSDate(scheduledFor, { zone: DEFAULT_TIMEZONE });
  const endDay = getPromotionEndDay(end);
  const effectiveEnd = endDay.endOf("day");

  if (scheduledDt.toMillis() > effectiveEnd.toMillis()) {
    return "Wrap up the promotion, thank guests, and hint that a new offer is on the way.";
  }

  const daysUntilEndDay = calendarDayDiff(
    scheduledFor,
    endDay.toJSDate(),
    DEFAULT_TIMEZONE,
  );
  const endWeekday = formatWeekday(endDay.toJSDate());
  const endDayMonth = formatDayMonth(endDay.toJSDate());

  if (daysUntilEndDay === 0) {
    const hoursUntilEffectiveEnd = effectiveEnd.diff(scheduledDt, "hours").hours;
    if (hoursUntilEffectiveEnd <= 6) {
      return "Make it crystal clear it ends tonight and push a final rush.";
    }
    return `Say it ends today (${endWeekday} ${endDayMonth}) and drive last-chance urgency.`;
  }

  if (daysUntilEndDay === 1) {
    return `Stress that it ends tomorrow (${endWeekday} ${endDayMonth}).`;
  }

  if (daysUntilEndDay >= 2 && daysUntilEndDay <= 6) {
    return `Keep momentum going and remind guests it ends on ${endWeekday} ${endDayMonth}.`;
  }

  return `Reinforce the value while reminding followers it finishes on ${endWeekday} ${endDayMonth}.`;
}
```

If product explicitly wants countdown wording for `2` days, add that as a deliberate product decision. Do not inherit it accidentally from elapsed-hour math.

### 3. Fix auto promotion phase dates

In `createPromotionCampaign()`, derive automatic phases from the effective end, not raw `end`.

Current code:

```ts
const durationMs = Math.max(0, end.getTime() - start.getTime());
const mid = new Date(start.getTime() + durationMs / 2);
let lastChance = new Date(end.getTime() - 6 * 60 * 60 * 1000);
```

Required shape:

```ts
const effectiveEnd = getPromotionEffectiveEnd(end).toJSDate();
const durationMs = Math.max(0, effectiveEnd.getTime() - start.getTime());
const mid = new Date(start.getTime() + durationMs / 2);
let lastChance = new Date(effectiveEnd.getTime() - 6 * HOUR_MS);
```

Then review the engagement-time normalization immediately below. It currently resets every automatic promotion phase to the account default or noon. That can move a "last chance" slot out of the final six-hour window. At minimum, the final slot must remain on the selected end day. If preserving final-rush urgency is desired, do not run the last-chance slot through the generic engagement-time override.

### 4. Keep prompt context honest

`promotionEnd` should remain the selected end date ISO in `promptContext`; `src/lib/ai/prompts.ts` formats it as a date, not a timestamp. Do not store `effectiveEnd` as `promotionEnd`, because that would make the raw context look like the user selected a time.

If we add a timing label for promotion in the deconfliction fix, use a separate field such as `promotionTimingLabel`.

### 5. Export only what tests need

Add this to `__testables`:

```ts
describePromotionTimingCueForTest: describePromotionTimingCue,
```

If phase generation is extracted into a pure helper, export that helper for focused tests too. Otherwise test the phase dates through `createPromotionCampaign()` with story placements.

### 6. Audit copy repair paths

Review these before finishing:

- `src/lib/ai/postprocess.ts` `sanitiseCountdownLanguage()`
- `src/lib/create/service.ts` `finaliseCopy()` promotion-end block

Only change them if they can produce user-visible wrong timing after the cue fix. If left unchanged, document why they are safe or create a follow-up task.

## Tests

Add a `describe("describePromotionTimingCue")` block to `tests/lib/create/service.test.ts`.

```ts
const TZ = "Europe/London";
const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();
```

### Cue cases

| Scheduled for | Raw end date | Expected assertion |
|---------------|--------------|--------------------|
| `null` | `2026-05-20T00:00` | Contains "immediate interest" |
| `2026-05-20T10:00` | `2026-05-20T00:00` | Contains "ends today"; does not contain "wrap up" |
| `2026-05-20T20:00` | `2026-05-20T00:00` | Contains "ends tonight" |
| `2026-05-20T23:30` | `2026-05-20T00:00` | Contains "ends tonight"; does not contain "wrap up" |
| `2026-05-21T00:01` | `2026-05-20T00:00` | Contains "wrap up" |
| `2026-05-19T12:00` | `2026-05-20T00:00` | Contains "ends tomorrow" |
| `2026-05-18T12:00` | `2026-05-20T00:00` | Contains "ends on Wednesday"; does not contain "two days" unless product chose that wording |
| `2026-05-14T12:00` | `2026-05-20T00:00` | Contains "ends on Wednesday" |
| `2026-05-13T12:00` | `2026-05-20T00:00` | Contains "finishes on Wednesday" |
| `2026-03-28T12:00` | `2026-03-29T00:00` | Handles UK spring-forward weekend as tomorrow |

### Phase-date cases

Either extract a pure promotion plan builder or add a service-level test around `createPromotionCampaign()`.

Use `placements: ["story"]` to avoid OpenAI calls, and extend the Supabase test mock to capture inserted `content_items`.

Required assertions:

- For a promotion ending on Wednesday 20 May 2026, the automatic "Last chance" plan/content item is scheduled on Wednesday 20 May local time, not Tuesday 19 May.
- Same-day end-date submissions do not silently produce zero plans just because raw `endDate` is midnight at the beginning of the day.
- `promptContext.promotionEnd` remains the selected raw end date, not the synthetic `effectiveEnd`.

## Scope

### In scope

- [ ] Rewrite `describePromotionTimingCue()` with calendar-day and end-of-day semantics.
- [ ] Export the helper through `__testables`.
- [ ] Fix automatic promotion phase calculations to use the effective end day.
- [ ] Add cue tests, including same-day late-night and next-day wrap-up.
- [ ] Add at least one phase-date regression test.
- [ ] Audit promotion-end copy repair code and document any intentional non-change.

### Out of scope

- New promotion date-range UI or schema support.
- Changing banner proximity labels in `src/lib/scheduling/proximity-label.ts` or the Deno worker copy.
- Post-deconfliction timing refresh. That is covered by `tasks/fix-deconfliction-drift.md`.
- Broad account-timezone propagation beyond the existing `DEFAULT_TIMEZONE` behaviour.

## Files to change

| File | Change |
|------|--------|
| `src/lib/create/service.ts` | Effective-end helpers; cue rewrite; auto phase date fix; test export |
| `tests/lib/create/service.test.ts` | Cue tests and service-level phase-date regression |
| `src/lib/ai/postprocess.ts` | Audit only; change only if wrong timing remains |

## Verification

Run focused tests first:

```bash
CI=1 npm test -- --run tests/lib/create/service.test.ts
```

Then run the normal gates:

```bash
npm run lint:ci
npm run typecheck
npm run build
```

## Complexity

Score: 3 (M).

The cue rewrite is small, but a complete promotion timing fix also touches automatic phase scheduling and test mocks. Treating this as a single-function patch would leave the campaign schedule itself partly wrong.
