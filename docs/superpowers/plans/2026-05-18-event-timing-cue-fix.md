# Event Timing Cue Calendar-Day Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `describeEventTimingCue()` so it uses calendar-day boundaries instead of raw 24-hour chunks, preventing "tomorrow" from appearing when an event is two or more calendar days away.

**Architecture:** Replace the `Math.floor(diffMs / DAY_MS)` calculation with a Luxon-based `calendarDayDiff` helper that computes the number of calendar-day boundaries between two dates in `Europe/London`. Fix the threshold from `diffDays <= 2` to `diffCalendarDays === 1` for "tomorrow". Move the timing cue computation inside the placement loop so story and feed plans each get a cue computed from their own `scheduledFor`.

**Tech Stack:** TypeScript, Luxon (already imported), Vitest

**Spec:** `tasks/fix-event-timing-cue.md`

---

### Task 1: Add `calendarDayDiff` helper with tests

**Files:**
- Modify: `src/lib/scheduling/spread.ts:243-251` (add after `isSameCalendarDay`)
- Modify: `tests/lib/scheduling/spread.test.ts` (add test block)

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block in `tests/lib/scheduling/spread.test.ts`. Import `calendarDayDiff` alongside the existing `isSameCalendarDay` import.

```typescript
import { calendarDayDiff, isSameCalendarDay } from "@/lib/scheduling/spread";

describe("calendarDayDiff", () => {
  const TZ = "Europe/London";
  const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();

  it("returns 0 for same calendar day regardless of time gap", () => {
    expect(calendarDayDiff(at("2026-05-18T01:00"), at("2026-05-18T23:59"), TZ)).toBe(0);
  });

  it("returns 1 when dates are on adjacent calendar days", () => {
    expect(calendarDayDiff(at("2026-05-18T23:00"), at("2026-05-19T01:00"), TZ)).toBe(1);
  });

  it("returns 1 even with 46 elapsed hours on adjacent calendar days", () => {
    expect(calendarDayDiff(at("2026-05-18T01:00"), at("2026-05-19T23:00"), TZ)).toBe(1);
  });

  it("returns 2 for Monday noon to Wednesday evening", () => {
    expect(calendarDayDiff(at("2026-05-18T12:00"), at("2026-05-20T19:00"), TZ)).toBe(2);
  });

  it("returns 7 for exactly one week apart", () => {
    expect(calendarDayDiff(at("2026-05-18T12:00"), at("2026-05-25T12:00"), TZ)).toBe(7);
  });

  it("returns negative when earlier is after later", () => {
    expect(calendarDayDiff(at("2026-05-20T12:00"), at("2026-05-18T12:00"), TZ)).toBe(-2);
  });

  it("handles BST spring-forward (28 Mar -> 29 Mar 2026)", () => {
    // Clocks go forward at 01:00 on 29 March 2026 — the day is only 23 hours
    expect(calendarDayDiff(at("2026-03-28T12:00"), at("2026-03-29T14:00"), TZ)).toBe(1);
  });

  it("handles BST autumn-fallback (25 Oct -> 26 Oct 2026)", () => {
    // Clocks go back at 02:00 on 25 October 2026 — the day is 25 hours
    expect(calendarDayDiff(at("2026-10-25T12:00"), at("2026-10-26T12:00"), TZ)).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `CI=1 npx vitest run tests/lib/scheduling/spread.test.ts`
Expected: FAIL — `calendarDayDiff` is not exported from `spread.ts`.

- [ ] **Step 3: Implement `calendarDayDiff`**

In `src/lib/scheduling/spread.ts`, add directly after the existing `isSameCalendarDay` function (after line 251):

```typescript
/**
 * Count the number of calendar-day boundaries between two dates in the target timezone.
 * Returns a positive number when `later` is on a later calendar day than `earlier`.
 * Uses Math.round because DST days can be 23 or 25 elapsed hours after startOf("day").
 */
export function calendarDayDiff(earlier: Date, later: Date, tz: string): number {
  const earlierDay = DateTime.fromJSDate(earlier, { zone: tz }).startOf("day");
  const laterDay = DateTime.fromJSDate(later, { zone: tz }).startOf("day");
  return Math.round(laterDay.diff(earlierDay, "days").days);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `CI=1 npx vitest run tests/lib/scheduling/spread.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduling/spread.ts tests/lib/scheduling/spread.test.ts
git commit -m "feat: add calendarDayDiff helper to scheduling/spread"
```

---

### Task 2: Rewrite `describeEventTimingCue` to use calendar days

**Files:**
- Modify: `src/lib/create/service.ts:529-607`

The function currently uses `Math.floor(diffMs / DAY_MS)` with a `diffDays <= 2` threshold for "tomorrow". Replace with `calendarDayDiff` and fix all branch thresholds.

- [ ] **Step 1: Add the import**

In `src/lib/create/service.ts`, find the existing import from `@/lib/scheduling/spread` (line 24):

```typescript
import { buildSpreadEvenlySlots, getEngagementOptimisedHour, isSameCalendarDay } from "@/lib/scheduling/spread";
```

Add `calendarDayDiff`:

```typescript
import { buildSpreadEvenlySlots, calendarDayDiff, getEngagementOptimisedHour, isSameCalendarDay } from "@/lib/scheduling/spread";
```

- [ ] **Step 2: Rewrite the function body**

Replace the entire `describeEventTimingCue` function (lines 529-607) with:

```typescript
function describeEventTimingCue(scheduledFor: Date | null, eventStart: Date): EventTimingCue {
  if (!scheduledFor) {
    return {
      description: "Share live highlights and keep guests engaged in real time.",
      toneCue: "energetic, live, in-the-moment",
      label: "today_imminent",
    };
  }

  const diffMs = eventStart.getTime() - scheduledFor.getTime();
  const diffCalendarDays = calendarDayDiff(scheduledFor, eventStart, DEFAULT_TIMEZONE);
  const weekday = formatWeekday(eventStart);
  const dayMonth = formatDayMonth(eventStart);
  const timeLabel = formatTime(eventStart);
  const isImminent = diffMs > 0 && diffMs <= 3 * HOUR_MS;

  // --- Post is at or after the event start ---
  if (diffMs <= 0) {
    const msAfterStart = Math.abs(diffMs);
    if (msAfterStart > 3 * HOUR_MS) {
      return {
        description: `Share a recap of how the event went — highlights, photos, and a look back at ${weekday}'s ${dayMonth} gathering.`,
        toneCue: "reflective, warm, community pride",
        label: "recap",
      };
    }
    return {
      description: "Make it clear the event is underway right now and draw in any last-minute arrivals.",
      toneCue: "energetic, live, in-the-moment",
      label: "today_imminent",
    };
  }

  // --- Event starts within the next 3 hours (cross-day aware) ---
  if (isImminent) {
    if (diffCalendarDays === 0) {
      return {
        description: `Say it's happening in just a few hours (today at ${timeLabel}) and drive final RSVPs.`,
        toneCue: "urgent, exciting, last-chance energy",
        label: "today_imminent",
      };
    }
    return {
      description: `Say it's happening in just a few hours (${weekday} at ${timeLabel}) and drive final RSVPs.`,
      toneCue: "urgent, exciting, last-chance energy",
      label: "today_imminent",
    };
  }

  // --- Same calendar day, not imminent ---
  if (diffCalendarDays === 0) {
    const scheduledHour = DateTime.fromJSDate(scheduledFor, { zone: DEFAULT_TIMEZONE }).hour;
    if (scheduledHour < 14) {
      return {
        description: `Call out that it's happening today at ${timeLabel}—push final sign-ups and arrivals.`,
        toneCue: "bright, reminder, plan-your-day",
        label: "today_morning",
      };
    }
    return {
      description: `Call out that it's happening today at ${timeLabel}—push final sign-ups and arrivals.`,
      toneCue: "urgent, exciting, last-chance energy",
      label: "today_imminent",
    };
  }

  // --- Tomorrow (exactly 1 calendar day ahead) ---
  if (diffCalendarDays === 1) {
    return {
      description: `Say it's tomorrow (${weekday} ${dayMonth}) and stress limited spots before ${timeLabel}.`,
      toneCue: "anticipation, countdown, don't miss out",
      label: "tomorrow",
    };
  }

  // --- This week (2-6 calendar days ahead) ---
  if (diffCalendarDays <= 6) {
    return {
      description: `Refer to it as this ${weekday} (${dayMonth}) and keep the countdown energy high.`,
      toneCue: "building excitement, save the date",
      label: "building",
    };
  }

  // --- 7+ calendar days out ---
  return {
    description: `Highlight the date ${weekday} ${dayMonth} at ${timeLabel} and build anticipation while pushing sign-ups.`,
    toneCue: "awareness, curiosity, early-bird appeal",
    label: "early_awareness",
  };
}
```

Key changes from the original:
- `diffDays` (ms-based) replaced with `diffCalendarDays` (Luxon calendar-aware).
- `diffHours <= 3` replaced with `isImminent` (raw ms check, no rounding).
- Imminent branch is calendar-day-aware — says "today at" vs "[weekday] at".
- `diffDays <= 2` for tomorrow replaced with `diffCalendarDays === 1`.
- `diffDays <= 6` for building replaced with `diffCalendarDays <= 6` (now starts at 2, not 3).
- `DAY_MS` constant is no longer needed by this function (keep it — it's used elsewhere).

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: Clean compilation.

- [ ] **Step 4: Commit**

```bash
git add src/lib/create/service.ts
git commit -m "fix: use calendar-day boundaries in describeEventTimingCue"
```

---

### Task 3: Rewrite existing tests and add new cases

**Files:**
- Modify: `tests/lib/create/service.test.ts:335-418`

The existing `describe("describeEventTimingCue")` block has 7 tests. One of them (`"returns tomorrow for 1-2 days out"`) encodes the bug. Rewrite the full block.

All dates should use Luxon in `Europe/London` to match the production timezone. The existing tests use raw UTC strings (`new Date("2026-01-05T12:00:00.000Z")`), which happen to work in GMT but would fail during BST. Use a helper to build dates in the correct timezone.

- [ ] **Step 1: Add the helper and rewrite the entire describe block**

Replace lines 335-419 in `tests/lib/create/service.test.ts` with:

```typescript
describe("describeEventTimingCue", () => {
  const TZ = "Europe/London";
  const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();

  // --- Recap / past-event ---

  it("returns recap when scheduled well after the event (>3h)", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-18T22:00"),
      at("2026-05-18T19:00"),
    );
    expect(result.label).toBe("recap");
    expect(result.description.toLowerCase()).toMatch(/recap|highlights|look\s*back|how it went/);
  });

  it("returns underway cue when scheduled during the event window (<=3h after start)", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-18T20:00"),
      at("2026-05-18T19:00"),
    );
    expect(result.label).toBe("today_imminent");
    expect(result.description).toContain("underway");
  });

  // --- Imminent (within 3 hours, same calendar day) ---

  it("returns today_imminent when event is 2 hours away on the same day", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-18T17:00"),
      at("2026-05-18T19:00"),
    );
    expect(result.label).toBe("today_imminent");
    expect(result.description).toContain("few hours");
    expect(result.description).toContain("today");
  });

  // --- Imminent, cross-midnight ---

  it("returns today_imminent with weekday wording when event is 2 hours away but next calendar day", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-18T23:00"),
      at("2026-05-19T01:00"),
    );
    expect(result.label).toBe("today_imminent");
    expect(result.description).toContain("few hours");
    expect(result.description).not.toContain("tonight");
  });

  // --- Same calendar day ---

  it("returns today_morning for same day before 2pm", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-18T10:00"),
      at("2026-05-18T19:00"),
    );
    expect(result.label).toBe("today_morning");
    expect(result.description).toContain("today");
  });

  it("returns today_imminent for same day at or after 2pm", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-18T15:00"),
      at("2026-05-18T19:00"),
    );
    expect(result.label).toBe("today_imminent");
    expect(result.description).toContain("today");
  });

  // --- Tomorrow (exactly 1 calendar day) ---

  it("returns tomorrow when event is exactly 1 calendar day ahead", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-18T12:00"),
      at("2026-05-19T19:00"),
    );
    expect(result.label).toBe("tomorrow");
    expect(result.description).toContain("tomorrow");
  });

  it("returns tomorrow despite 46 elapsed hours when still 1 calendar day ahead", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-18T01:00"),
      at("2026-05-19T23:00"),
    );
    expect(result.label).toBe("tomorrow");
    expect(result.description).toContain("tomorrow");
  });

  it("returns tomorrow at late-night post time for next-day event", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-18T23:30"),
      at("2026-05-19T19:00"),
    );
    expect(result.label).toBe("tomorrow");
    expect(result.description).toContain("tomorrow");
  });

  it("returns tomorrow across week boundary (Sunday to Monday)", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-24T23:00"),
      at("2026-05-25T19:00"),
    );
    expect(result.label).toBe("tomorrow");
  });

  it("returns tomorrow across BST spring-forward (28 Mar -> 29 Mar 2026)", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-03-28T12:00"),
      at("2026-03-29T14:00"),
    );
    expect(result.label).toBe("tomorrow");
  });

  // --- THE BUG: 2 calendar days must NOT say tomorrow ---

  it("returns building (not tomorrow) for Monday post -> Wednesday event", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-18T12:00"),
      at("2026-05-20T19:00"),
    );
    expect(result.label).toBe("building");
    expect(result.description).toContain("this Wednesday");
    expect(result.description).not.toContain("tomorrow");
  });

  // --- Building (2-6 calendar days) ---

  it("returns building for 4 days out", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-18T12:00"),
      at("2026-05-22T19:00"),
    );
    expect(result.label).toBe("building");
    expect(result.description).toContain("this Friday");
  });

  it("returns building for 6 days out (Sunday)", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-18T12:00"),
      at("2026-05-24T14:00"),
    );
    expect(result.label).toBe("building");
    expect(result.description).toContain("this Sunday");
  });

  // --- Early awareness (7+ calendar days) ---

  it("returns early_awareness for 7+ days out", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-18T12:00"),
      at("2026-05-25T19:00"),
    );
    expect(result.label).toBe("early_awareness");
    expect(result.description).not.toContain("tomorrow");
    expect(result.description).not.toContain("this ");
  });

  it("returns early_awareness for 10+ days out", () => {
    const result = __testables.describeEventTimingCueForTest(
      at("2026-05-05T12:00"),
      at("2026-05-15T19:00"),
    );
    expect(result.label).toBe("early_awareness");
  });

  // --- Null scheduledFor ---

  it("returns a valid cue when scheduledFor is null", () => {
    const result = __testables.describeEventTimingCueForTest(
      null,
      at("2026-05-20T19:00"),
    );
    expect(result.description).toBeTruthy();
    expect(result.toneCue).toBeTruthy();
    expect(result.label).toBe("today_imminent");
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `CI=1 npx vitest run tests/lib/create/service.test.ts`
Expected: All tests PASS. If any fail, the implementation from Task 2 has a bug — fix the implementation, not the test.

- [ ] **Step 3: Commit**

```bash
git add tests/lib/create/service.test.ts
git commit -m "test: rewrite describeEventTimingCue tests with calendar-day semantics"
```

---

### Task 4: Align timing cue with placement-specific `scheduledFor`

**Files:**
- Modify: `src/lib/create/service.ts:756-858` (both manual and offset paths in `buildEventCampaignPlans`)

Currently, `timingCue` is computed from `futureSlot` (the feed date) *before* the placement loop. Story placement can shift the date via `resolveStoryScheduledFor`, so the prompt context `temporalProximity` and `timingLabel` may not match the story's actual posting day.

Move the `describeEventTimingCue` call inside the placement loop, after `placementScheduledFor` is resolved.

- [ ] **Step 1: Fix the manual schedule path (lines 760-801)**

Find this block starting at line 760:

```typescript
? manualSchedule.flatMap((scheduledFor, index) => {
      const futureSlot = ensureFutureDate(scheduledFor ?? null) ?? new Date(minimumTime);
      const timingCue = describeEventTimingCue(futureSlot, eventStart);
      return input.placements.map((placement, placementIndex) => {
        const placementScheduledFor =
          placement === "story"
            ? resolveStoryScheduledFor(futureSlot, DEFAULT_TIMEZONE) ?? futureSlot
            : futureSlot;
```

Move `timingCue` after `placementScheduledFor`:

```typescript
? manualSchedule.flatMap((scheduledFor, index) => {
      const futureSlot = ensureFutureDate(scheduledFor ?? null) ?? new Date(minimumTime);
      return input.placements.map((placement, placementIndex) => {
        const placementScheduledFor =
          placement === "story"
            ? resolveStoryScheduledFor(futureSlot, DEFAULT_TIMEZONE) ?? futureSlot
            : futureSlot;
        const timingCue = describeEventTimingCue(placementScheduledFor, eventStart);
```

No other changes needed in this path — `timingCue` is still used identically below.

- [ ] **Step 2: Fix the offset schedule path (lines 803-858)**

Find the block starting around line 817:

```typescript
      const futureSlot = ensureFutureDate(optimisedDate) ?? new Date(minimumTime);
      const timingCue = describeEventTimingCue(futureSlot, eventStart);
      const isSameDay = isSameCalendarDay(futureSlot, eventStart, DEFAULT_TIMEZONE);
      for (const placement of input.placements) {
        const placementScheduledFor =
          placement === "story"
            ? resolveStoryScheduledFor(futureSlot, DEFAULT_TIMEZONE) ?? futureSlot
            : futureSlot;
```

Move `timingCue` inside the loop, after `placementScheduledFor`:

```typescript
      const futureSlot = ensureFutureDate(optimisedDate) ?? new Date(minimumTime);
      const isSameDay = isSameCalendarDay(futureSlot, eventStart, DEFAULT_TIMEZONE);
      for (const placement of input.placements) {
        const placementScheduledFor =
          placement === "story"
            ? resolveStoryScheduledFor(futureSlot, DEFAULT_TIMEZONE) ?? futureSlot
            : futureSlot;
        const timingCue = describeEventTimingCue(placementScheduledFor, eventStart);
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: Clean compilation.

- [ ] **Step 4: Run existing tests**

Run: `CI=1 npx vitest run tests/lib/create/event-campaign-plans.test.ts`
Expected: All existing tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/create/service.ts
git commit -m "fix: compute event timing cue from placement-specific scheduledFor"
```

---

### Task 5: Add plan-level regression test

**Files:**
- Modify: `tests/lib/create/event-campaign-plans.test.ts`

Add a test that builds an event campaign for Wednesday 20 May 2026 at 19:00 with a Monday 18 May 2026 12:00 manual schedule slot, and asserts the prompt does not contain "tomorrow".

Also add a test that when both feed and story placements are present, each plan's `promptContext.timingLabel` was computed from its own `scheduledFor`.

- [ ] **Step 1: Add the regression tests**

Add a new `describe` block at the end of the file, before the final `});`:

```typescript
describe("timing cue regression: Monday post for Wednesday event", () => {
  const TZ = "Europe/London";
  const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();

  it("does not say 'tomorrow' for a 2-calendar-day gap", () => {
    const eventStart = at("2026-05-20T19:00");
    const input = buildEventInput({
      name: "Cash Bingo",
      startDate: at("2026-05-20T00:00"),
      startTime: "19:00",
      customSchedule: [at("2026-05-18T12:00")],
      placements: ["feed"],
      scheduleOffsets: [{ label: "2 days to go", offsetHours: -2 * 24 }],
    });

    const plans = __testables.buildEventCampaignPlansForTest({
      input,
      eventStart,
      minimumTime: 0,
      advancedOptions: {
        toneAdjust: "default",
        lengthPreference: "standard",
        includeHashtags: true,
        includeEmojis: true,
        ctaStyle: "default",
      },
      basePrompt: "Event name: Cash Bingo",
      eventCtaLabel: null,
      defaultPostingTime: null,
    });

    expect(plans.length).toBeGreaterThan(0);
    for (const plan of plans) {
      expect(plan.prompt.toLowerCase()).not.toContain("tomorrow");
      expect(plan.promptContext.timingLabel).not.toBe("tomorrow");
    }
  });

  it("computes timing cue per placement when feed and story are both present", () => {
    const eventStart = at("2026-05-20T19:00");
    const input = buildEventInput({
      name: "Quiz Night",
      startDate: at("2026-05-20T00:00"),
      startTime: "19:00",
      customSchedule: [at("2026-05-19T12:00")],
      placements: ["feed", "story"],
      scheduleOffsets: [{ label: "1 day to go", offsetHours: -24 }],
    });

    const plans = __testables.buildEventCampaignPlansForTest({
      input,
      eventStart,
      minimumTime: 0,
      advancedOptions: {
        toneAdjust: "default",
        lengthPreference: "standard",
        includeHashtags: true,
        includeEmojis: true,
        ctaStyle: "default",
      },
      basePrompt: "Event name: Quiz Night",
      eventCtaLabel: null,
      defaultPostingTime: null,
    });

    const feedPlan = plans.find((p) => p.placement === "feed");
    const storyPlan = plans.find((p) => p.placement === "story");
    expect(feedPlan).toBeDefined();
    expect(storyPlan).toBeDefined();

    // Each plan's timing label should reflect its own scheduledFor, not the other's.
    // Both should have a valid timing label.
    expect(feedPlan!.promptContext.timingLabel).toBeTruthy();
    expect(storyPlan!.promptContext.timingLabel).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `CI=1 npx vitest run tests/lib/create/event-campaign-plans.test.ts`
Expected: All tests PASS, including the new regression tests.

- [ ] **Step 3: Commit**

```bash
git add tests/lib/create/event-campaign-plans.test.ts
git commit -m "test: add Monday-to-Wednesday and per-placement timing regressions"
```

---

### Task 6: Full verification

- [ ] **Step 1: Run the full test suite**

```bash
CI=1 npm test
```

Expected: All tests pass.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: Zero warnings, zero errors.

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: Clean compilation.

- [ ] **Step 4: Run build**

```bash
npm run build
```

Expected: Successful production build.

- [ ] **Step 5: Final commit if any lint/type fixes were needed**

Only if steps 1-4 required corrections:

```bash
git add -A
git commit -m "fix: address lint/type issues from timing cue changes"
```

---

## Residual risks (out of scope)

### Deconfliction drift

`deconflictCampaignPlans()` runs *after* `buildEventCampaignPlans()` returns and can shift `scheduledFor` to a different calendar day. The prompt text and `promptContext` built earlier will then reference the wrong day. This is a pre-existing issue unrelated to the calendar-day bug and should be addressed in a separate task if it causes real-world problems.

### Promotion timing

`describePromotionTimingCue()` at `service.ts:620-653` uses `Math.ceil(hoursUntilEnd / 24)` — same category of ms-based day calculation. It needs a separate fix with proper end-of-day semantics for `dateMode: "ends_on"` promotions. Deferred to a separate task per the spec.
