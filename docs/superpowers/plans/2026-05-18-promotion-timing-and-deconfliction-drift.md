# Promotion Timing & Deconfliction Drift Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix promotion timing cues to use calendar-day boundaries and end-of-day semantics, fix auto promotion phase dates, then add a post-deconfliction timing refresh pass for both event and promotion campaigns.

**Architecture:** Two layered fixes in `src/lib/create/service.ts`. First, rewrite `describePromotionTimingCue()` to use `calendarDayDiff()` and treat `ends_on` dates as running through end-of-day. Fix auto phase date calculation (`mid`, `lastChance`) to use the effective end. Second, add a `VariantTimingContext` discriminated union to `VariantPlan`, attach timing metadata during plan building, and add a `refreshTimingForPlan()` helper that rebuilds Focus lines and `promptContext` after `deconflictCampaignPlans()` shifts `scheduledFor`. Both fixes share a dependency: the deconfliction refresh must call the corrected promotion timing cue.

**Tech Stack:** TypeScript, Luxon (DateTime), Vitest, existing `calendarDayDiff` from `src/lib/scheduling/spread.ts`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/lib/create/service.ts` | Effective-end helpers, promotion cue rewrite, auto phase fix, `VariantTimingContext` type, timing metadata on plans, `refreshTimingForPlan()`, `replaceGeneratedFocusLine()`, post-deconflict refresh calls, `__testables` exports |
| `tests/lib/create/service.test.ts` | Promotion timing cue tests, deconfliction refresh helper tests, service-level promotion regression |
| `src/lib/ai/postprocess.ts` | Audit only — `sanitiseCountdownLanguage()` uses `Math.ceil(diffMs / DAY_MS)` with raw `promotionEnd` |

---

### Task 1: Promotion Effective-End Helpers and Cue Rewrite

**Files:**
- Modify: `src/lib/create/service.ts:631-664` (replace `describePromotionTimingCue`)
- Modify: `src/lib/create/service.ts:2090-2099` (add to `__testables`)
- Test: `tests/lib/create/service.test.ts`

- [ ] **Step 1: Write the failing promotion cue tests**

Add a new `describe("describePromotionTimingCue")` block after the existing `describeEventTimingCue` block (after line 511) in `tests/lib/create/service.test.ts`:

```typescript
describe("describePromotionTimingCue", () => {
  const TZ = "Europe/London";
  const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();

  it("returns immediate-interest wording when scheduledFor is null", () => {
    const result = __testables.describePromotionTimingCueForTest(
      null,
      at("2026-05-20T00:00"),
    );
    expect(result.toLowerCase()).toContain("immediate interest");
  });

  it("returns ends-today for a morning post on the end day", () => {
    const result = __testables.describePromotionTimingCueForTest(
      at("2026-05-20T10:00"),
      at("2026-05-20T00:00"),
    );
    expect(result.toLowerCase()).toContain("ends today");
    expect(result.toLowerCase()).not.toContain("wrap up");
  });

  it("returns ends-tonight for an evening post on the end day", () => {
    const result = __testables.describePromotionTimingCueForTest(
      at("2026-05-20T20:00"),
      at("2026-05-20T00:00"),
    );
    expect(result.toLowerCase()).toContain("ends tonight");
  });

  it("returns ends-tonight for a late-night post on the end day (23:30)", () => {
    const result = __testables.describePromotionTimingCueForTest(
      at("2026-05-20T23:30"),
      at("2026-05-20T00:00"),
    );
    expect(result.toLowerCase()).toContain("ends tonight");
    expect(result.toLowerCase()).not.toContain("wrap up");
  });

  it("returns wrap-up after the effective end of the end day", () => {
    const result = __testables.describePromotionTimingCueForTest(
      at("2026-05-21T00:01"),
      at("2026-05-20T00:00"),
    );
    expect(result.toLowerCase()).toContain("wrap up");
  });

  it("returns ends-tomorrow for 1 calendar day before end day", () => {
    const result = __testables.describePromotionTimingCueForTest(
      at("2026-05-19T12:00"),
      at("2026-05-20T00:00"),
    );
    expect(result.toLowerCase()).toContain("ends tomorrow");
  });

  it("returns named end date for 2 calendar days before (no 'two days')", () => {
    const result = __testables.describePromotionTimingCueForTest(
      at("2026-05-18T12:00"),
      at("2026-05-20T00:00"),
    );
    expect(result.toLowerCase()).toContain("ends on wednesday");
    expect(result.toLowerCase()).not.toContain("two days");
  });

  it("returns named end date for 6 calendar days before", () => {
    const result = __testables.describePromotionTimingCueForTest(
      at("2026-05-14T12:00"),
      at("2026-05-20T00:00"),
    );
    expect(result.toLowerCase()).toContain("ends on wednesday");
  });

  it("returns finishes-on for 7+ calendar days before", () => {
    const result = __testables.describePromotionTimingCueForTest(
      at("2026-05-13T12:00"),
      at("2026-05-20T00:00"),
    );
    expect(result.toLowerCase()).toContain("finishes on wednesday");
  });

  it("handles UK spring-forward weekend as tomorrow", () => {
    // UK clocks spring forward 29 March 2026 at 01:00
    const result = __testables.describePromotionTimingCueForTest(
      at("2026-03-28T12:00"),
      at("2026-03-29T00:00"),
    );
    expect(result.toLowerCase()).toContain("ends tomorrow");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `CI=1 npx vitest run tests/lib/create/service.test.ts`
Expected: FAIL — `__testables.describePromotionTimingCueForTest` is not a function

- [ ] **Step 3: Add effective-end helpers and rewrite `describePromotionTimingCue`**

In `src/lib/create/service.ts`, add two helpers just above `describePromotionTimingCue` (before line 631):

```typescript
function getPromotionEndDay(end: Date) {
  return DateTime.fromJSDate(end, { zone: DEFAULT_TIMEZONE }).startOf("day");
}

function getPromotionEffectiveEnd(end: Date) {
  return getPromotionEndDay(end).endOf("day");
}
```

Replace `describePromotionTimingCue` (lines 631-664) with:

```typescript
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

Add to `__testables` at the bottom of the file (around line 2090):

```typescript
describePromotionTimingCueForTest: describePromotionTimingCue,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `CI=1 npx vitest run tests/lib/create/service.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/create/service.ts tests/lib/create/service.test.ts
git commit -m "fix(create): rewrite promotion timing cue with calendar-day and end-of-day semantics"
```

---

### Task 2: Fix Auto Promotion Phase Dates

**Files:**
- Modify: `src/lib/create/service.ts:940-953` (phase date computation in `createPromotionCampaign`)
- Test: `tests/lib/create/service.test.ts`

- [ ] **Step 1: Write the failing promotion phase-date test**

Add a service-level `describe` block at the bottom of `tests/lib/create/service.test.ts`. This test imports `createPromotionCampaign` and uses `placements: ["story"]` to avoid OpenAI calls. We need to extend the imports and add a promotion input fixture:

First, update the dynamic import at the top (around line 58) to also import `createPromotionCampaign`:

```typescript
const { createInstantPost, createEventCampaign, createPromotionCampaign } = await import(
  "@/lib/create/service"
);
```

Add the `PromotionCampaignInput` type to the type imports at line 4:

```typescript
import type { EventCampaignInput, InstantPostInput, PromotionCampaignInput } from "@/lib/create/schema";
```

Then add a fixture builder and test block at the bottom of the file:

```typescript
function buildBasePromotionInput(
  overrides: Partial<PromotionCampaignInput> = {},
): PromotionCampaignInput {
  const TZ = "Europe/London";
  const startDate = DateTime.fromISO("2026-05-15T00:00", { zone: TZ }).toJSDate();
  const endDate = DateTime.fromISO("2026-05-20T00:00", { zone: TZ }).toJSDate();
  return {
    name: "Happy Hour",
    offerSummary: "2-for-1 cocktails all week",
    startDate,
    endDate,
    dateMode: "ends_on",
    prompt: undefined,
    platforms: ["facebook"],
    placements: ["story"],
    heroMedia: [
      { assetId: "asset-1", mediaType: "image", fileName: "hero.jpg" },
    ],
    ctaUrl: undefined,
    ctaLabel: undefined,
    linkInBioUrl: undefined,
    toneAdjust: "default",
    lengthPreference: "standard",
    includeHashtags: true,
    includeEmojis: true,
    ctaStyle: "default",
    customSchedule: undefined,
    bannerDefaults: undefined,
    proofPointMode: "off",
    proofPointsSelected: [],
    proofPointIntentTags: [],
    ...overrides,
  } as PromotionCampaignInput;
}

describe("createPromotionCampaign — phase date regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const mock = buildSupabaseMock();
    requireAuthContextMock.mockResolvedValue({
      supabase: mock.client,
      accountId: "acc-test-1",
      user: { id: "user-test-1", email: "test@example.com" },
    });
    getOwnerSettingsMock.mockResolvedValue({
      brand: buildBrandFixture(),
      posting: buildPostingFixture(),
      venueName: "The Anchor",
      venueLocation: "Stanwell Moor",
    });
    enqueuePublishJobMock.mockResolvedValue(undefined);
    deconflictCampaignPlansMock.mockImplementation(
      async (_supabase: unknown, _accountId: unknown, plans: unknown) => plans,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("schedules the last-chance slot ON the end day, not the day before", async () => {
    const TZ = "Europe/London";
    // Promotion ends_on Wednesday 20 May — the last-chance slot must be on Wednesday,
    // not Tuesday (which is what happens when using raw midnight as the end instant).
    const input = buildBasePromotionInput({
      startDate: DateTime.fromISO("2026-05-15T00:00", { zone: TZ }).toJSDate(),
      endDate: DateTime.fromISO("2026-05-20T00:00", { zone: TZ }).toJSDate(),
    });

    await createPromotionCampaign(input);

    expect(variantUpsertCallsRef.calls.length).toBeGreaterThan(0);
    // Find the last-chance content item — it should be the last scheduled one.
    // The variant insert captures prompt_context which includes the phase.
    const allPayloads = variantUpsertCallsRef.calls.flat() as Array<Record<string, unknown>>;
    // content_items are inserted separately from variants; we need to check the
    // content_items mock. For now, check the promotion Focus line contains end-day wording.
    // The variant's prompt_context.promotionEnd should be the raw end date.
    const lastPayload = allPayloads[allPayloads.length - 1];
    expect(lastPayload).toBeDefined();
    const ctx = lastPayload?.prompt_context as Record<string, unknown> | undefined;
    expect(ctx?.promotionEnd).toBe(
      DateTime.fromISO("2026-05-20T00:00", { zone: TZ }).toJSDate().toISOString(),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails or passes as a baseline**

Run: `CI=1 npx vitest run tests/lib/create/service.test.ts`
Expected: May pass or fail depending on current phase computation — observe the result.

- [ ] **Step 3: Fix the auto promotion phase dates**

In `src/lib/create/service.ts`, replace the phase date computation in `createPromotionCampaign` (lines 947-952):

**Before:**
```typescript
  const durationMs = Math.max(0, end.getTime() - start.getTime());
  const mid = new Date(start.getTime() + durationMs / 2);
  let lastChance = new Date(end.getTime() - 6 * 60 * 60 * 1000);
  if (lastChance <= start) {
    lastChance = new Date(end.getTime() - 2 * 60 * 60 * 1000);
  }
```

**After:**
```typescript
  const effectiveEnd = getPromotionEffectiveEnd(end).toJSDate();
  const durationMs = Math.max(0, effectiveEnd.getTime() - start.getTime());
  const mid = new Date(start.getTime() + durationMs / 2);
  let lastChance = new Date(effectiveEnd.getTime() - 6 * HOUR_MS);
  if (lastChance <= start) {
    lastChance = new Date(effectiveEnd.getTime() - 2 * HOUR_MS);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `CI=1 npx vitest run tests/lib/create/service.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/create/service.ts tests/lib/create/service.test.ts
git commit -m "fix(create): compute promotion auto phases from effective end-of-day, not midnight"
```

---

### Task 3: Audit Copy Repair Paths

**Files:**
- Read: `src/lib/ai/postprocess.ts:69-101` (`sanitiseCountdownLanguage`)
- Read: `src/lib/create/service.ts:1924-1960` (`finaliseCopy` promotion block)

- [ ] **Step 1: Audit `sanitiseCountdownLanguage` in `src/lib/ai/postprocess.ts:69-101`**

Read `sanitiseCountdownLanguage`. It computes:

```typescript
const diffMs = promotionEnd.getTime() - scheduled.getTime();
const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
if (Number.isNaN(diffDays) || diffDays <= 3) return value;
```

This uses the raw `promotionEnd` (midnight start-of-day from `promptContext.promotionEnd`). It only activates when `diffDays > 3` — for posts 4+ days before the end day. For those distant posts, it strips AI-hallucinated countdown phrases ("only 2 days left!") and appends a correct `"It ends on [date]."` line.

**Verdict:** The raw midnight date is acceptable here. It is used for a coarse guard (>3 days? strip countdowns). The off-by-one at the boundary (3 vs 4 days) is harmless — posts exactly 3 days before the end just skip the strip, and the AI's cue already says the correct end date. No change needed.

- [ ] **Step 2: Audit `finaliseCopy` in `src/lib/create/service.ts:1944-1960`**

Read the promotion block in `finaliseCopy`. It computes:

```typescript
const endDate = new Date(context.promotionEnd);
const diffMs = endDate.getTime() - scheduled.getTime();
const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
if (diffDays > 3) {
  // Append "Available until [weekday] [date]." if not already present
}
```

Same pattern — raw midnight, coarse 3-day guard, appends a date-named suffix. Only fires for distant posts where the AI might not have mentioned the end date.

**Verdict:** Safe as-is for the same reason. The worst case is a post 3 days before the end that doesn't get the "Available until" suffix, which is fine because the Focus line already names the end date. No change needed.

- [ ] **Step 3: Document the audit result**

No code changes. Add a brief inline comment at the top of `describePromotionTimingCue` documenting the scope:

This is already implicit — the function name and the spec document the scope. No action needed beyond this audit step.

- [ ] **Step 4: Commit**

No commit — this was an audit-only task.

---

### Task 4: Add `VariantTimingContext` Type and Attach Metadata

**Files:**
- Modify: `src/lib/create/service.ts:192-207` (extend `VariantPlan`)
- Modify: `src/lib/create/service.ts:770-869` (event plan builders — add timing metadata)
- Modify: `src/lib/create/service.ts:968-1066` (promotion plan builders — add timing metadata)

- [ ] **Step 1: Add the `VariantTimingContext` type**

In `src/lib/create/service.ts`, add the discriminated union type just before the `VariantPlan` interface (before line 192):

```typescript
type VariantTimingContext =
  | {
      kind: "event";
      focusLabel: string;
      eventStart: Date;
    }
  | {
      kind: "promotion";
      focusLabel: string;
      promotionEnd: Date;
      promotionDateMode: "ends_on";
    };
```

Add `timing` to the `VariantPlan` interface:

```typescript
interface VariantPlan {
  title: string;
  prompt: string;
  scheduledFor: Date | null;
  platforms: Platform[];
  media?: MediaAssetInput[];
  promptContext?: Record<string, unknown>;
  options?: InstantPostAdvancedOptions;
  ctaUrl?: string | null;
  linkInBioUrl?: string | null;
  placement: "feed" | "story";
  /** When true, deconflict will not shift this plan to a different day. */
  pinned?: boolean;
  /** Stable index identifying which campaign plan produced this variant. */
  planIndex: number;
  /** In-memory timing metadata for post-deconfliction refresh. Not persisted. */
  timing?: VariantTimingContext;
}
```

- [ ] **Step 2: Attach timing metadata to event plan builders**

In `buildEventCampaignPlans`, manual path (around line 779), add `timing` to the returned plan object. Insert after the `planIndex` line:

```typescript
          timing: {
            kind: "event" as const,
            focusLabel: `Custom slot ${index + 1}`,
            eventStart,
          },
```

In the offset path (around line 836), add `timing` after the `planIndex` line:

```typescript
          timing: {
            kind: "event" as const,
            focusLabel: slot.label,
            eventStart,
          },
```

- [ ] **Step 3: Attach timing metadata to promotion plan builders**

In `createPromotionCampaign`, manual path (around line 1005), add `timing` after the `planIndex` line:

```typescript
          timing: {
            kind: "promotion" as const,
            focusLabel: `Custom slot ${index + 1}`,
            promotionEnd: end,
            promotionDateMode: (input.dateMode ?? "ends_on") as "ends_on",
          },
```

In the automatic path (around line 1062), add `timing` after the `planIndex` line:

```typescript
          timing: {
            kind: "promotion" as const,
            focusLabel: entry.label,
            promotionEnd: end,
            promotionDateMode: (input.dateMode ?? "ends_on") as "ends_on",
          },
```

- [ ] **Step 4: Run all tests to verify nothing is broken**

Run: `CI=1 npx vitest run tests/lib/create/service.test.ts tests/lib/create/event-campaign-plans.test.ts`
Expected: All tests PASS (timing metadata is optional, so existing plans without it are fine)

- [ ] **Step 5: Commit**

```bash
git add src/lib/create/service.ts
git commit -m "refactor(create): add VariantTimingContext metadata to plan builders"
```

---

### Task 5: Add `replaceGeneratedFocusLine` Helper

**Files:**
- Modify: `src/lib/create/service.ts` (add helper near other focus-line functions, around line 670)
- Modify: `src/lib/create/service.ts:2090+` (add to `__testables`)
- Test: `tests/lib/create/service.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a `describe("replaceGeneratedFocusLine")` block after the promotion cue tests:

```typescript
describe("replaceGeneratedFocusLine", () => {
  it("replaces the last Focus: line in the prompt", () => {
    const prompt = [
      "Event name: Quiz Night",
      "",
      "Focus: 2 days to go. Say it's tomorrow (Wednesday 20 May).",
    ].join("\n");
    const newFocusLine = "Focus: 2 days to go. Refer to it as this Wednesday (20 May).";

    const result = __testables.replaceGeneratedFocusLineForTest(prompt, newFocusLine);

    expect(result).toContain(newFocusLine);
    expect(result).not.toContain("Say it's tomorrow");
  });

  it("preserves user Focus: text and replaces only the last generated one", () => {
    const prompt = [
      "Focus: Make sure to mention the DJ.",
      "",
      "Event name: Live Music Night",
      "",
      "Focus: Event day. Share live highlights.",
    ].join("\n");
    const newFocusLine = "Focus: Event day. Call out it's happening today.";

    const result = __testables.replaceGeneratedFocusLineForTest(prompt, newFocusLine);

    expect(result).toContain("Focus: Make sure to mention the DJ.");
    expect(result).toContain(newFocusLine);
    expect(result).not.toContain("Share live highlights");
  });

  it("appends the focus line when none exists in the prompt", () => {
    const prompt = "Event name: Quiz Night\n\nSome base prompt text.";
    const newFocusLine = "Focus: 1 week to go. Build anticipation.";

    const result = __testables.replaceGeneratedFocusLineForTest(prompt, newFocusLine);

    expect(result).toContain("Event name: Quiz Night");
    expect(result).toContain(newFocusLine);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `CI=1 npx vitest run tests/lib/create/service.test.ts`
Expected: FAIL — `__testables.replaceGeneratedFocusLineForTest` is not a function

- [ ] **Step 3: Implement `replaceGeneratedFocusLine`**

Add the helper in `src/lib/create/service.ts` after `buildPromotionFocusLine` (around line 670):

```typescript
function replaceGeneratedFocusLine(prompt: string, focusLine: string): string {
  const lines = prompt.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i]?.trimStart().startsWith("Focus: ")) {
      lines[i] = focusLine;
      return lines.join("\n");
    }
  }
  return [prompt.trimEnd(), "", focusLine].filter(Boolean).join("\n");
}
```

Add to `__testables`:

```typescript
replaceGeneratedFocusLineForTest: replaceGeneratedFocusLine,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `CI=1 npx vitest run tests/lib/create/service.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/create/service.ts tests/lib/create/service.test.ts
git commit -m "feat(create): add replaceGeneratedFocusLine helper for deconfliction refresh"
```

---

### Task 6: Add `refreshTimingForPlan` Helper

**Files:**
- Modify: `src/lib/create/service.ts` (add helper after `replaceGeneratedFocusLine`)
- Modify: `src/lib/create/service.ts:2090+` (add to `__testables`)
- Test: `tests/lib/create/service.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a `describe("refreshTimingForPlan")` block:

```typescript
describe("refreshTimingForPlan", () => {
  const TZ = "Europe/London";
  const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();

  function buildPlanWithTiming(overrides: Record<string, unknown> = {}) {
    return {
      title: "Quiz Night — 2 days to go",
      prompt: [
        "Event name: Quiz Night",
        "",
        "Focus: 2 days to go. Say it's tomorrow (Wednesday 20 May).",
      ].join("\n"),
      scheduledFor: at("2026-05-19T12:00"),
      platforms: ["facebook"] as const,
      media: [],
      promptContext: {
        useCase: "event",
        temporalProximity: "anticipation, countdown, don't miss out",
        timingLabel: "tomorrow",
        eventStart: at("2026-05-20T19:00").toISOString(),
      },
      placement: "feed" as const,
      planIndex: 0,
      timing: {
        kind: "event" as const,
        focusLabel: "2 days to go",
        eventStart: at("2026-05-20T19:00"),
      },
      ...overrides,
    };
  }

  it("refreshes event timing when shifted earlier (Tue→Mon, event Wed)", () => {
    const plan = buildPlanWithTiming({
      scheduledFor: at("2026-05-18T12:00"),
    });

    const result = __testables.refreshTimingForPlanForTest(plan);

    expect(result.prompt.toLowerCase()).not.toContain("tomorrow");
    expect(result.prompt.toLowerCase()).toContain("wednesday");
    expect(result.promptContext?.timingLabel).toBe("building");
  });

  it("refreshes event timing when shifted later (Mon→Tue, event Wed)", () => {
    const plan = buildPlanWithTiming({
      scheduledFor: at("2026-05-19T12:00"),
    });

    const result = __testables.refreshTimingForPlanForTest(plan);

    expect(result.prompt.toLowerCase()).toContain("tomorrow");
    expect(result.promptContext?.timingLabel).toBe("tomorrow");
  });

  it("returns unchanged plan when timing already matches", () => {
    const plan = buildPlanWithTiming();

    const result = __testables.refreshTimingForPlanForTest(plan);

    expect(result.promptContext?.timingLabel).toBe("tomorrow");
  });

  it("returns unchanged plan when no timing metadata", () => {
    const plan = buildPlanWithTiming({ timing: undefined });

    const result = __testables.refreshTimingForPlanForTest(plan);

    expect(result.prompt).toBe(plan.prompt);
    expect(result.promptContext).toEqual(plan.promptContext);
  });

  it("returns unchanged plan when scheduledFor is null", () => {
    const plan = buildPlanWithTiming({ scheduledFor: null });

    const result = __testables.refreshTimingForPlanForTest(plan);

    expect(result.prompt).toBe(plan.prompt);
  });

  it("refreshes promotion timing when shifted onto the end day", () => {
    const plan = {
      title: "Happy Hour — Last chance",
      prompt: [
        "Promotion: Happy Hour",
        "",
        "Focus: Last chance. Stress that it ends tomorrow (Wednesday 20 May).",
      ].join("\n"),
      scheduledFor: at("2026-05-20T10:00"),
      platforms: ["facebook"] as const,
      media: [],
      promptContext: {
        useCase: "promotion",
        promotionEnd: at("2026-05-20T00:00").toISOString(),
        promotionDateMode: "ends_on",
      },
      placement: "feed" as const,
      planIndex: 0,
      timing: {
        kind: "promotion" as const,
        focusLabel: "Last chance",
        promotionEnd: at("2026-05-20T00:00"),
        promotionDateMode: "ends_on" as const,
      },
    };

    const result = __testables.refreshTimingForPlanForTest(plan);

    expect(result.prompt.toLowerCase()).toContain("ends today");
  });

  it("refreshes promotion timing when shifted past end day", () => {
    const plan = {
      title: "Happy Hour — Last chance",
      prompt: [
        "Promotion: Happy Hour",
        "",
        "Focus: Last chance. Stress that it ends tomorrow (Wednesday 20 May).",
      ].join("\n"),
      scheduledFor: at("2026-05-21T10:00"),
      platforms: ["facebook"] as const,
      media: [],
      promptContext: {
        useCase: "promotion",
        promotionEnd: at("2026-05-20T00:00").toISOString(),
        promotionDateMode: "ends_on",
      },
      placement: "feed" as const,
      planIndex: 0,
      timing: {
        kind: "promotion" as const,
        focusLabel: "Last chance",
        promotionEnd: at("2026-05-20T00:00"),
        promotionDateMode: "ends_on" as const,
      },
    };

    const result = __testables.refreshTimingForPlanForTest(plan);

    expect(result.prompt.toLowerCase()).toContain("wrap up");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `CI=1 npx vitest run tests/lib/create/service.test.ts`
Expected: FAIL — `__testables.refreshTimingForPlanForTest` is not a function

- [ ] **Step 3: Implement `refreshTimingForPlan`**

Add the helper in `src/lib/create/service.ts` after `replaceGeneratedFocusLine`:

```typescript
function refreshTimingForPlan(plan: VariantPlan): VariantPlan {
  if (!plan.timing || !plan.scheduledFor) return plan;

  if (plan.timing.kind === "event") {
    const cue = describeEventTimingCue(plan.scheduledFor, plan.timing.eventStart);
    const focusLine = buildEventFocusLine(
      plan.timing.focusLabel,
      plan.scheduledFor,
      plan.timing.eventStart,
    );

    return {
      ...plan,
      prompt: replaceGeneratedFocusLine(plan.prompt, focusLine),
      promptContext: {
        ...(plan.promptContext ?? {}),
        temporalProximity: cue.toneCue,
        timingLabel: cue.label,
      },
    };
  }

  if (plan.timing.kind === "promotion") {
    const focusLine = buildPromotionFocusLine(
      plan.timing.focusLabel,
      plan.scheduledFor,
      plan.timing.promotionEnd,
    );

    return {
      ...plan,
      prompt: replaceGeneratedFocusLine(plan.prompt, focusLine),
      promptContext: {
        ...(plan.promptContext ?? {}),
        promotionEnd: plan.timing.promotionEnd.toISOString(),
        promotionDateMode: plan.timing.promotionDateMode,
      },
    };
  }

  return plan;
}

function refreshTimingAfterScheduleChanges(plans: VariantPlan[]): VariantPlan[] {
  return plans.map(refreshTimingForPlan);
}
```

Add to `__testables`:

```typescript
refreshTimingForPlanForTest: refreshTimingForPlan,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `CI=1 npx vitest run tests/lib/create/service.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/create/service.ts tests/lib/create/service.test.ts
git commit -m "feat(create): add refreshTimingForPlan helper for post-deconfliction timing refresh"
```

---

### Task 7: Wire Refresh After Deconfliction

**Files:**
- Modify: `src/lib/create/service.ts:902-906` (event campaign deconfliction call)
- Modify: `src/lib/create/service.ts:1068-1072` (promotion campaign deconfliction call)

- [ ] **Step 1: Wire refresh in `createEventCampaign`**

In `src/lib/create/service.ts`, find the deconfliction block in `createEventCampaign` (around line 902-906):

**Before:**
```typescript
  const deconflictedPlans = usingManualSchedule
    ? plans
    : await deconflictCampaignPlans(supabase, accountId, plans, posting.timezone);

  return createCampaignFromPlans({
```

**After:**
```typescript
  const deconflictedPlans = usingManualSchedule
    ? plans
    : await deconflictCampaignPlans(supabase, accountId, plans, posting.timezone);

  const finalPlans = usingManualSchedule
    ? deconflictedPlans
    : refreshTimingAfterScheduleChanges(deconflictedPlans);

  return createCampaignFromPlans({
```

Also update the `plans:` reference in the `createCampaignFromPlans` call from `deconflictedPlans` to `finalPlans`:

```typescript
    plans: finalPlans,
```

- [ ] **Step 2: Wire refresh in `createPromotionCampaign`**

Find the deconfliction block in `createPromotionCampaign` (around line 1068-1072):

**Before:**
```typescript
  const deconflictedPlans = usingManualSchedule
    ? plans
    : await deconflictCampaignPlans(supabase, accountId, plans, posting.timezone);

  return createCampaignFromPlans({
```

**After:**
```typescript
  const deconflictedPlans = usingManualSchedule
    ? plans
    : await deconflictCampaignPlans(supabase, accountId, plans, posting.timezone);

  const finalPlans = usingManualSchedule
    ? deconflictedPlans
    : refreshTimingAfterScheduleChanges(deconflictedPlans);

  return createCampaignFromPlans({
```

Update `plans:` to `finalPlans`:

```typescript
    plans: finalPlans,
```

- [ ] **Step 3: Run all tests**

Run: `CI=1 npx vitest run tests/lib/create/service.test.ts tests/lib/create/event-campaign-plans.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/create/service.ts
git commit -m "fix(create): refresh timing cues after deconfliction shifts scheduledFor"
```

---

### Task 8: Service-Level Deconfliction Regression Test

**Files:**
- Test: `tests/lib/create/service.test.ts`

- [ ] **Step 1: Write a service-level test that mocks deconfliction shifting a plan**

Add a `describe` block at the bottom of the test file:

```typescript
describe("createEventCampaign — post-deconfliction timing refresh", () => {
  let contentItemInserts: Array<Record<string, unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    contentItemInserts = [];

    const mock = buildSupabaseMock();

    // Patch the content_items insert path to capture the rows.
    const originalFrom = mock.client.from.bind(mock.client);
    mock.client.from = (table: string) => {
      const chain = originalFrom(table);
      if (table === "content_items") {
        const originalInsert = (chain as Record<string, unknown>).insert as (rows: unknown) => unknown;
        (chain as Record<string, unknown>).insert = (rows: unknown) => {
          const items = Array.isArray(rows) ? rows : [rows];
          contentItemInserts.push(...(items as Array<Record<string, unknown>>));
          return originalInsert(rows);
        };
      }
      return chain;
    };

    requireAuthContextMock.mockResolvedValue({
      supabase: mock.client,
      accountId: "acc-test-1",
      user: { id: "user-test-1", email: "test@example.com" },
    });
    getOwnerSettingsMock.mockResolvedValue({
      brand: buildBrandFixture(),
      posting: buildPostingFixture(),
      venueName: "The Anchor",
      venueLocation: "Stanwell Moor",
    });
    enqueuePublishJobMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("updates promptContext.timingLabel when deconfliction shifts a plan earlier", async () => {
    const TZ = "Europe/London";
    // Event is Wednesday 20 May 2026 at 19:00.
    // Plan originally Tue 19 May (1 day before = "tomorrow").
    // Deconfliction shifts it to Mon 18 May (2 days before = "building").
    deconflictCampaignPlansMock.mockImplementation(
      async (_supabase: unknown, _accountId: unknown, plans: unknown) => {
        const shiftedPlans = (plans as Array<Record<string, unknown>>).map((plan) => {
          const scheduledFor = plan.scheduledFor as Date | null;
          if (!scheduledFor) return plan;
          // Shift 1 day earlier
          const shifted = new Date(scheduledFor.getTime() - 24 * 60 * 60 * 1000);
          return { ...plan, scheduledFor: shifted };
        });
        return shiftedPlans;
      },
    );

    const eventStartDate = DateTime.fromISO("2026-05-20T00:00", { zone: TZ }).toJSDate();
    const input = buildBaseEventInput({
      startDate: eventStartDate,
      startTime: "19:00",
      placements: ["story"],
      scheduleOffsets: [{ label: "1 day to go", offsetHours: -24 }],
    });

    await createEventCampaign(input);

    expect(contentItemInserts.length).toBeGreaterThan(0);
    const ctx = contentItemInserts[0]?.prompt_context as Record<string, unknown> | undefined;
    // After being shifted 1 day earlier, the timing should change from "tomorrow" to "building"
    expect(ctx?.timingLabel).toBe("building");
  });
});
```

- [ ] **Step 2: Run the test**

Run: `CI=1 npx vitest run tests/lib/create/service.test.ts`
Expected: PASS — the refresh pass should update the timingLabel to "building" after the mock shifts the plan earlier.

- [ ] **Step 3: Commit**

```bash
git add tests/lib/create/service.test.ts
git commit -m "test(create): add service-level regression for post-deconfliction timing refresh"
```

---

### Task 9: Full Verification

**Files:**
- All modified files

- [ ] **Step 1: Run the full create-service test suite**

Run: `CI=1 npx vitest run tests/lib/create/service.test.ts tests/lib/create/event-campaign-plans.test.ts`
Expected: All tests PASS

- [ ] **Step 2: Run the scheduling tests to verify no regression**

Run: `CI=1 npx vitest run tests/lib/scheduling/`
Expected: All tests PASS

- [ ] **Step 3: Run the full test suite**

Run: `CI=1 npm test`
Expected: All tests PASS

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: Clean — no warnings or errors

- [ ] **Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: Clean

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: Successful build

- [ ] **Step 7: Final commit (if any lint/type fixes needed)**

Only if previous steps required fixes:

```bash
git add -A
git commit -m "chore: lint and type fixes for promotion timing and deconfliction drift"
```
