# Fix: deconfliction can stale timing cues after shifting scheduledFor

## Critical review of the previous spec

The previous spec correctly identified the architecture problem: prompts are built before deconfliction, but `scheduledFor` can change afterward. The proposed fix needs tightening.

1. It proposed replacing the first line that starts with `Focus: `. That is brittle. User-supplied prompt text can contain a `Focus:` line. If string replacement is used, replace the last generated focus line, or better, centralize timing focus construction so initial build and refresh use the same helper.
2. It handled events first and left promotions as a maybe. Since `createPromotionCampaign()` also deconflicts and `buildPromotionFocusLine()` is timing-sensitive, the final design should support both campaign types. Sequence it after `tasks/fix-promotion-timing.md` if necessary.
3. The "shifted forward" / "shifted backward" test names were ambiguous. Use "shifted earlier" and "shifted later" relative to the original scheduled date.
4. The proposed integration test said to verify prompt text after mocking deconfliction, but prompt text is not persisted to `content_items`. Story-placement tests avoid OpenAI, so they cannot observe the final user prompt. Use exported helper tests for prompt text, and use service-level tests only for persisted `prompt_context` unless an OpenAI prompt-capture mock is added.
5. Event timing has already been fixed to compute cues from `placementScheduledFor`. Do not reintroduce the old `futureSlot` vs story/feed mismatch during refresh.
6. Deconfliction preserves time of day and shifts only `scheduledFor`; refresh must always use the final `plan.scheduledFor`, not recompute from offsets.

## Problem

`deconflictCampaignPlans()` in `src/lib/scheduling/deconflict.ts` can shift a campaign plan to another local calendar day to avoid crowded schedule days.

But event and promotion prompts are built before deconfliction:

```text
buildEventCampaignPlans() / promotion plan builder
  -> builds Focus line and timing promptContext from original scheduledFor
  -> deconflictCampaignPlans() may shift scheduledFor by +/- 1-2 calendar days
  -> createCampaignFromPlans() sends the stale prompt/context to generation
```

Example:

- Original event plan: Tuesday 19 May 2026, event Wednesday 20 May 2026.
- Focus line says "Say it's tomorrow".
- Deconfliction shifts the post earlier to Monday 18 May 2026.
- Correct wording is now "this Wednesday", but the generated prompt still says "tomorrow".

Manual schedule paths skip deconfliction, so this issue affects automatic event and promotion schedules.

## Root cause

`VariantPlan` currently stores the finished prompt string and prompt context, but it does not store enough timing metadata to rebuild those fields after schedule mutation.

`deconflictCampaignPlans()` intentionally only returns plans with adjusted `scheduledFor`. It should stay a generic scheduler and should not know about event or promotion copy.

## Fix

Add a post-deconfliction timing refresh pass in `src/lib/create/service.ts`. Keep scheduler logic generic; refresh prompt timing in the create service where campaign semantics are available.

### 1. Add timing metadata to `VariantPlan`

Prefer one `timing` object over multiple loose fields:

```ts
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

interface VariantPlan {
  // existing fields...
  timing?: VariantTimingContext;
}
```

This metadata is in-memory only. It is not written to the database.

### 2. Attach timing metadata while building plans

Event plans:

- Manual path: `focusLabel: "Custom slot N"`, `eventStart`.
- Offset path: `focusLabel: slot.label`, `eventStart`.

Promotion plans:

- Manual path: `focusLabel: "Custom slot N"`, `promotionEnd: end`, `promotionDateMode: input.dateMode ?? "ends_on"`.
- Automatic path: `focusLabel: entry.label`, `promotionEnd: end`, `promotionDateMode: input.dateMode ?? "ends_on"`.

Attach metadata to both feed and story plans. Even if story bodies are empty, their persisted `promptContext` and scheduling metadata should remain coherent.

### 3. Centralize timing application

Add a helper that rebuilds the generated timing fields from the final `scheduledFor`:

```ts
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
```

`replaceGeneratedFocusLine()` should replace the last generated `Focus:` line, not the first:

```ts
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

If `tasks/fix-promotion-timing.md` changes promotion cues to return a structured object, also update `promotionTimingLabel` or `temporalProximity` here. Do not invent persisted promotion timing fields unless a prompt or UI consumer uses them.

### 4. Refresh after deconfliction

In both `createEventCampaign()` and `createPromotionCampaign()`:

```ts
const deconflictedPlans = usingManualSchedule
  ? plans
  : await deconflictCampaignPlans(supabase, accountId, plans, posting.timezone);

const finalPlans = usingManualSchedule
  ? plans
  : refreshTimingAfterScheduleChanges(deconflictedPlans);
```

Then pass `finalPlans` into `createCampaignFromPlans()`.

Calling the refresh helper for manual plans is harmless, but not required because manual schedules do not pass through deconfliction. If it is called unconditionally, tests should assert it does not change already-correct plans.

### 5. Export focused test hooks

Add to `__testables`:

```ts
refreshTimingForPlanForTest: refreshTimingForPlan,
replaceGeneratedFocusLineForTest: replaceGeneratedFocusLine,
```

If the public type of `VariantPlan` remains private, tests can use a minimal object cast to the helper parameter type.

## Tests

### Unit tests in `tests/lib/create/service.test.ts`

Use exported helpers for prompt string assertions.

| Scenario | Input | Expected |
|----------|-------|----------|
| Replaces last generated focus line | Prompt contains user `Focus:` text plus generated focus line | User text remains; last focus line is replaced |
| Event shifted earlier | Original stale prompt says tomorrow; final scheduledFor is Monday; event is Wednesday | Prompt says "this Wednesday"; context `timingLabel` is `building` |
| Event shifted later | Original stale prompt says this Wednesday; final scheduledFor is Tuesday; event is Wednesday | Prompt says "tomorrow"; context `timingLabel` is `tomorrow` |
| Event not shifted | Prompt/context already match final scheduledFor | Output stays semantically the same |
| Promotion shifted onto end day | Final scheduledFor is the promotion end day | Prompt says "ends today" or "ends tonight" per `fix-promotion-timing` rules |
| Promotion shifted after end day | Final scheduledFor is after effective end | Prompt says wrap-up |
| Plan with no timing metadata | Any plan | Returned unchanged |
| Plan with null scheduledFor | Any timing metadata | Returned unchanged |

### Service-level regression

Add a service-level test only for what can actually be observed without OpenAI.

Recommended low-friction path:

- Extend `buildSupabaseMock()` in `tests/lib/create/service.test.ts` to capture inserted `content_items`.
- Use `placements: ["story"]` so `buildVariants()` short-circuits and no OpenAI mock is needed.
- Mock `deconflictCampaignPlans()` to shift one plan's `scheduledFor`.
- Call `createEventCampaign()`.
- Assert inserted `content_items.prompt_context.timingLabel` reflects the shifted date.

If the test must verify the final prompt text sent to OpenAI, add an explicit `getOpenAIClient()` mock that captures the prompt input. Do not use a story-placement test for that assertion; stories do not call OpenAI.

### Existing scheduler tests

Do not change `tests/scheduling/deconflict.test.ts` unless scheduler behaviour changes. This fix should not alter `deconflictCampaignPlans()` itself.

## Scope

### In scope

- [ ] Add in-memory timing metadata to `VariantPlan`.
- [ ] Attach timing metadata for event and promotion plan builders.
- [ ] Add `refreshTimingForPlan()` and `refreshTimingAfterScheduleChanges()`.
- [ ] Replace or append the generated focus line safely.
- [ ] Call the refresh pass after deconfliction in event and promotion campaign creation.
- [ ] Add focused helper tests.
- [ ] Add one service-level regression for persisted event `promptContext`.

### Out of scope

- Changing `deconflictCampaignPlans()` scheduling rules.
- Planner reschedule/regeneration flows after content is already created.
- Weekly campaigns, unless they later gain relative-day focus wording and deconfliction.
- New promotion date-range schema support.

## Files to change

| File | Change |
|------|--------|
| `src/lib/create/service.ts` | Timing metadata, refresh helpers, post-deconfliction refresh calls, test exports |
| `tests/lib/create/service.test.ts` | Helper tests and service-level prompt-context regression |

## Verification

Run focused create-service tests:

```bash
CI=1 npm test -- --run tests/lib/create/service.test.ts
```

Run scheduler tests to prove the generic deconflicter still behaves the same:

```bash
CI=1 npm test -- --run tests/scheduling/deconflict.test.ts
```

Then run normal gates:

```bash
npm run lint:ci
npm run typecheck
npm run build
```

## Complexity

Score: 3 (M).

The refresh logic is not large, but it crosses event plans, promotion plans, prompt construction, prompt context, and test mocks. The risk is mostly in accidentally replacing user prompt text or refreshing from the wrong scheduled date.
