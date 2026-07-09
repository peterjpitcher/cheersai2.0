# Weekly Recurrence — CTA link, multi-day + end date, planner overlay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the weekly recurring campaign type an optional CTA link (into Facebook copy + link-in-bio card), multi-select days + an end date instead of a post count, and the same planner date-picking overlay every other campaign type gets.

**Architecture:** All new config lives in existing JSONB (`campaigns.metadata`, `content_items.body_draft`) and the existing `campaigns.link_in_bio_url` column — **no DB migration**. The weekly brief schema swaps `dayOfWeek: number` → `daysOfWeek: number[]` and `weeksAhead: number` → `endDate: string`; metadata keeps writing `dayOfWeek = daysOfWeek[0]` so every existing single-day reader (`campaign-timing.ts`, `banner-label.ts`, link-in-bio card) keeps working untouched, and newly writing `metadata.endDate` makes the bio card expire with zero timing-code changes. The CTA URL flows through the pre-existing `ctaLinks` pipeline (prompt → postprocess → `composePublishBody`).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Zod, Luxon (Europe/London), Vitest, Supabase, Deno edge functions.

**Reference spec:** `tasks/SPEC-weekly-recurrence-cta-and-date-controls.md`. Supersedes the schedule-model decisions in `tasks/SPEC-weekly-recurrence-story-gbp-removal.md` while preserving its "no unbounded recurrence" and "legacy materialisers stay retired" constraints.

**Conventions:** JS weekday convention throughout (0=Sunday … 6=Saturday), matching the existing form and `content_items.recurring_day_of_week`. Run `npm run typecheck` and `npm test` between tasks. Commit after each task with a conventional-commit message.

**Ship order:** three PRs. PR1 is independently deployable (weekly still auto-selects, now from the multi-day set). PR2 depends on PR1. PR3 soft-depends on PR1 (needs `metadata.endDate`).

---

## Files touched (map)

**PR1 — recurrence model**
- Modify: `src/features/create/schemas/content-schemas.ts` (weekly schema)
- Modify: `src/features/create/schemas/content-schemas.test.ts` (tests)
- Modify: `src/features/create/schedule/suggestion-utils.ts` (add multi-day builder, remove old)
- Create: `src/features/create/schedule/suggestion-utils.test.ts` (builder tests)
- Modify: `src/features/create/forms/weekly-recurring-fields.tsx` (checkboxes + date + counter)
- Modify: `src/features/create/create-wizard.tsx` (defaults + Brief→Media gate)
- Modify: `src/features/create/steps/schedule-step.tsx` (builder call site)
- Modify: `src/app/actions/content.ts` (`createDraft` weekly branch; server slot cap in `createScheduledBatch`)
- Modify: `src/lib/publishing/build-campaign-metadata.ts` (weekly metadata shape)
- Modify: `src/lib/publishing/build-campaign-metadata.test.ts` if present, else create
- Modify: `src/lib/ai/prompts.ts` (weekly "Days of week" line)
- Modify: `docs/runbook.md` (correct the materialise-weekly schedule line)

**PR2 — planner overlay**
- Modify: `src/features/create/schedule/schedule-calendar.tsx` (`onMonthChange` prop)
- Modify: `src/features/create/steps/schedule-step.tsx` (un-hide calendar, seed-once, month fetch)
- Modify: `src/features/create/create-wizard.tsx` (remove weekly slot-gate bypass)

**PR3 — CTA link**
- Modify: `src/features/create/forms/weekly-recurring-fields.tsx` (CTA URL field)
- Modify: `src/app/actions/content.ts` (`createScheduledBatch` writes `link_in_bio_url`)
- Modify: `src/lib/publishing/compose-body.test.ts` if present, else create (weekly CTA behaviour)

**Do NOT touch (verified correct via metadata back-compat):** `src/lib/scheduling/campaign-timing.ts`, `supabase/functions/publish-queue/banner-label.ts`, `src/lib/create/temporal-context.ts` (reads through `buildCampaignMetadata`), `src/lib/ai/proof-points.ts` (line 314 reads a generation-context key that this flow never populated — unaffected by the brief change), `src/lib/scheduling/materialise.ts` (draft-ghost path already defaults gracefully; batch rows excluded by the `recurringDayOfWeek == null` guard).

---

# PR 1 — Recurrence model (multi-day + end date)

## Task 1: Weekly brief schema — `daysOfWeek` + `endDate`

**Files:**
- Modify: `src/features/create/schemas/content-schemas.ts:105-115`
- Test: `src/features/create/schemas/content-schemas.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `content-schemas.test.ts` inside the top-level `describe('Content Zod Schemas', …)` block (reuse the existing `baseFields`):

```ts
  describe('weeklyCampaignBriefSchema (multi-day + end date)', () => {
    const weeklyBase = {
      ...baseFields,
      contentType: 'weekly_recurring' as const,
      time: '19:00',
      endDate: '2026-08-31',
    };

    it('accepts a single day', () => {
      const result = weeklyCampaignBriefSchema.safeParse({ ...weeklyBase, daysOfWeek: [3] });
      expect(result.success).toBe(true);
    });

    it('accepts multiple unique days', () => {
      const result = weeklyCampaignBriefSchema.safeParse({ ...weeklyBase, daysOfWeek: [1, 4] });
      expect(result.success).toBe(true);
    });

    it('rejects an empty days array', () => {
      const result = weeklyCampaignBriefSchema.safeParse({ ...weeklyBase, daysOfWeek: [] });
      expect(result.success).toBe(false);
    });

    it('rejects duplicate days', () => {
      const result = weeklyCampaignBriefSchema.safeParse({ ...weeklyBase, daysOfWeek: [2, 2] });
      expect(result.success).toBe(false);
    });

    it('rejects a day outside 0-6', () => {
      const result = weeklyCampaignBriefSchema.safeParse({ ...weeklyBase, daysOfWeek: [7] });
      expect(result.success).toBe(false);
    });

    it('rejects a malformed end date', () => {
      const result = weeklyCampaignBriefSchema.safeParse({ ...weeklyBase, daysOfWeek: [1], endDate: '31/08/2026' });
      expect(result.success).toBe(false);
    });

    it('rejects a malformed time', () => {
      const result = weeklyCampaignBriefSchema.safeParse({ ...weeklyBase, daysOfWeek: [1], time: '7pm' });
      expect(result.success).toBe(false);
    });

    it('carries the optional ctaLinks field', () => {
      const result = weeklyCampaignBriefSchema.safeParse({
        ...weeklyBase,
        daysOfWeek: [1],
        ctaLinks: { facebook: 'https://book.example', instagram: 'https://book.example' },
      });
      expect(result.success).toBe(true);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/create/schemas/content-schemas.test.ts`
Expected: FAIL — `daysOfWeek`/`endDate` unknown; old schema still requires `dayOfWeek`.

- [ ] **Step 3: Replace the weekly schema**

In `content-schemas.ts`, replace the `weeklyCampaignBriefSchema` block (lines 105-115) with:

```ts
export const weeklyCampaignBriefSchema = baseContentSchema.extend({
  contentType: z.literal('weekly_recurring'),
  // Days to post on each week, JS getDay() convention (0=Sunday..6=Saturday).
  // Multi-select; at least one, at most seven, no duplicates.
  daysOfWeek: z
    .array(z.number().int().min(0).max(6))
    .min(1, 'Pick at least one day')
    .max(7, 'Pick at most seven days')
    .refine((days) => new Set(days).size === days.length, 'Days must be unique'),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM format'),
  // Calendar end date (YYYY-MM-DD, Europe/London). Occurrences are generated up
  // to and including this date. The occurrence-count bound (1-12) is enforced in
  // the wizard and server-side in createScheduledBatch, not here, because the
  // count depends on the current date and must stay out of the pure schema.
  endDate: z.string().date(),
  // Whether each occurrence posts to the feed or as a story (Facebook/Instagram only).
  placement: z.enum(['feed', 'story']).default('feed'),
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/create/schemas/content-schemas.test.ts`
Expected: PASS (new block passes; existing suite unaffected). TypeScript will now fail to compile elsewhere — that is expected and fixed by later tasks in this PR.

- [ ] **Step 5: Commit**

```bash
git add src/features/create/schemas/content-schemas.ts src/features/create/schemas/content-schemas.test.ts
git commit -m "feat: weekly brief schema takes daysOfWeek + endDate"
```

---

## Task 2: Multi-day suggestion builder

**Files:**
- Modify: `src/features/create/schedule/suggestion-utils.ts` (add builder; keep old for now)
- Test: `src/features/create/schedule/suggestion-utils.test.ts` (create)

- [ ] **Step 1: Write failing tests**

Create `src/features/create/schedule/suggestion-utils.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DateTime, Settings } from 'luxon';

import { buildWeeklyMultiDaySuggestions } from './suggestion-utils';

const TZ = 'Europe/London';

/** Pin Luxon's "now" so the min-slot / anchor logic is deterministic. */
function withNow<T>(iso: string, fn: () => T): T {
  const original = Settings.now;
  const fixed = DateTime.fromISO(iso, { zone: TZ }).toMillis();
  Settings.now = () => fixed;
  try {
    return fn();
  } finally {
    Settings.now = original;
  }
}

describe('buildWeeklyMultiDaySuggestions', () => {
  it('generates one occurrence per selected weekday up to and including the end date', () => {
    // Wed 2026-07-01 09:00 → pick Mon(1)+Thu(4), end Sun 2026-07-19 (inclusive)
    const slots = withNow('2026-07-01T09:00:00', () =>
      buildWeeklyMultiDaySuggestions({
        startDate: '2026-07-01',
        daysOfWeek: [1, 4],
        time: '18:00',
        endDate: '2026-07-19',
        timezone: TZ,
      }),
    );
    // Thu 2/7, Mon 6/7, Thu 9/7, Mon 13/7, Thu 16/7 (Mon 20/7 is past end) → 5
    expect(slots.map((s) => s.date)).toEqual([
      '2026-07-02', '2026-07-06', '2026-07-09', '2026-07-13', '2026-07-16',
    ]);
  });

  it('uses date-unique ids and weekday·week labels', () => {
    const slots = withNow('2026-07-01T09:00:00', () =>
      buildWeeklyMultiDaySuggestions({
        startDate: '2026-07-01', daysOfWeek: [1, 4], time: '18:00', endDate: '2026-07-13', timezone: TZ,
      }),
    );
    expect(slots[0]).toMatchObject({ id: 'weekly-2026-07-02', time: '18:00', label: 'Thursday · Week 1' });
    expect(slots.find((s) => s.date === '2026-07-06')?.label).toBe('Monday · Week 2');
    expect(new Set(slots.map((s) => s.id)).size).toBe(slots.length);
  });

  it('skips occurrences earlier than now + 15 minutes', () => {
    // now = Thu 2026-07-02 18:10; today's 18:00 Thursday slot is already past
    const slots = withNow('2026-07-02T18:10:00', () =>
      buildWeeklyMultiDaySuggestions({
        startDate: '2026-07-02', daysOfWeek: [4], time: '18:00', endDate: '2026-07-16', timezone: TZ,
      }),
    );
    expect(slots.map((s) => s.date)).toEqual(['2026-07-09', '2026-07-16']);
  });

  it('returns empty when the end date is before the first occurrence', () => {
    const slots = withNow('2026-07-10T09:00:00', () =>
      buildWeeklyMultiDaySuggestions({
        startDate: '2026-07-10', daysOfWeek: [1], time: '18:00', endDate: '2026-07-05', timezone: TZ,
      }),
    );
    expect(slots).toEqual([]);
  });

  it('holds wall-clock time across a BST→GMT boundary', () => {
    // Clocks go back Sun 2026-10-25. A Monday 19:00 slot stays 19:00 both sides.
    const slots = withNow('2026-10-19T09:00:00', () =>
      buildWeeklyMultiDaySuggestions({
        startDate: '2026-10-19', daysOfWeek: [1], time: '19:00', endDate: '2026-11-02', timezone: TZ,
      }),
    );
    expect(slots.map((s) => `${s.date} ${s.time}`)).toEqual([
      '2026-10-19 19:00', '2026-10-26 19:00', '2026-11-02 19:00',
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/create/schedule/suggestion-utils.test.ts`
Expected: FAIL — `buildWeeklyMultiDaySuggestions` is not exported.

- [ ] **Step 3: Add the builder**

In `suggestion-utils.ts`, add this exported function directly after `buildWeeklySuggestions` (keep `buildWeeklySuggestions` for now; it is removed in Task 5). Reuse the existing module-private `parseDate`, `normaliseTime`, `safeIsoDate`:

```ts
interface WeeklyMultiDaySuggestionInput {
  startDate: string | undefined;
  daysOfWeek: number[];
  time: string;
  endDate: string;
  timezone: string;
}

/**
 * Build one suggestion per selected weekday, from today up to and including
 * `endDate`. Days use JS getDay() convention (0=Sunday..6=Saturday). Slots
 * earlier than now + 15 minutes are skipped. Ids are date-unique
 * ("weekly-YYYY-MM-DD"); labels are "<Weekday> · Week <n>" with the week counted
 * from the first emitted occurrence.
 */
export function buildWeeklyMultiDaySuggestions({
  startDate,
  daysOfWeek,
  time,
  endDate,
  timezone,
}: WeeklyMultiDaySuggestionInput): SuggestedSlotDisplay[] {
  if (!daysOfWeek.length) return [];

  const selected = new Set(daysOfWeek.map((d) => ((d % 7) + 7) % 7));
  const start = parseDate(startDate, timezone); // startOf('day')
  const end = parseDate(endDate, timezone).endOf('day');
  if (!end.isValid || end < start) return [];

  const minimumSlot = DateTime.now().setZone(timezone).plus({ minutes: 15 }).startOf('minute');
  const [hourStr, minuteStr] = normaliseTime(time, DEFAULT_POST_TIME).split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  const occurrences: DateTime[] = [];
  let cursor = start;
  // Hard stop well beyond any realistic end date to guarantee termination.
  let guard = 0;
  while (cursor <= end && guard < 800) {
    guard += 1;
    const jsWeekday = cursor.weekday % 7; // Luxon 1..7 (Sun=7) → JS 0..6 (Sun=0)
    if (selected.has(jsWeekday)) {
      const slot = cursor.set({ hour, minute, second: 0, millisecond: 0 });
      if (slot.isValid && slot >= minimumSlot && slot <= end) {
        occurrences.push(slot);
      }
    }
    cursor = cursor.plus({ days: 1 });
  }

  occurrences.sort((a, b) => a.toMillis() - b.toMillis());
  const anchorWeekStart = occurrences.length ? occurrences[0].startOf('week') : null;

  return occurrences.map((slot) => {
    const weekNum = anchorWeekStart
      ? Math.floor(slot.startOf('week').diff(anchorWeekStart, 'weeks').weeks) + 1
      : 1;
    const dateIso = safeIsoDate(slot) ?? slot.toFormat('yyyy-LL-dd');
    return {
      id: `weekly-${dateIso}`,
      date: dateIso,
      time: slot.toFormat('HH:mm'),
      label: `${slot.toFormat('cccc')} · Week ${weekNum}`,
    } satisfies SuggestedSlotDisplay;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/create/schedule/suggestion-utils.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add src/features/create/schedule/suggestion-utils.ts src/features/create/schedule/suggestion-utils.test.ts
git commit -m "feat: add multi-day weekly suggestion builder"
```

---

## Task 3: Weekly form — day checkboxes, end-date input, live counter

**Files:**
- Modify: `src/features/create/forms/weekly-recurring-fields.tsx` (full replace)

- [ ] **Step 1: Replace the component**

Replace the entire body of `weekly-recurring-fields.tsx` with the version below. It keeps the placement selector, swaps the single-day radio group for a multi-select checkbox group, swaps the "Number of posts" slider for an end-date input, and shows a live occurrence counter (reusing the Task 2 builder). No CTA field yet — that arrives in PR3 Task 16.

```tsx
'use client';

import { useMemo } from 'react';
import type { UseFormReturn, FieldValues } from 'react-hook-form';
import { DateTime } from 'luxon';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { DEFAULT_TIMEZONE } from '@/lib/constants';
import { buildWeeklyMultiDaySuggestions } from '@/features/create/schedule/suggestion-utils';

const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
] as const;

const PLACEMENTS = [
  { value: 'feed', label: 'Feed post' },
  { value: 'story', label: 'Story' },
] as const;

const MAX_OCCURRENCES = 12;

interface WeeklyRecurringFieldsProps {
  form: UseFormReturn<FieldValues>;
}

/**
 * Type-specific fields for weekly recurring content: post type, multi-select
 * days of the week, time, and a calendar end date. Shows a live count of how
 * many posts the current settings produce and flags 0 or >12.
 */
export function WeeklyRecurringFields({ form }: WeeklyRecurringFieldsProps): React.JSX.Element {
  const { register, watch, setValue, formState: { errors } } = form;
  const selectedDays = (watch('daysOfWeek') as number[] | undefined) ?? [];
  const time = (watch('time') as string) ?? '12:00';
  const endDate = (watch('endDate') as string) ?? '';
  const placement = (watch('placement') as 'feed' | 'story') ?? 'feed';

  const today = DateTime.now().setZone(DEFAULT_TIMEZONE).toFormat('yyyy-MM-dd');

  const toggleDay = (day: number) => {
    const next = selectedDays.includes(day)
      ? selectedDays.filter((d) => d !== day)
      : [...selectedDays, day];
    setValue('daysOfWeek', next, { shouldValidate: true });
  };

  const occurrenceCount = useMemo(() => {
    if (!selectedDays.length || !endDate) return 0;
    return buildWeeklyMultiDaySuggestions({
      startDate: today,
      daysOfWeek: selectedDays,
      time,
      endDate,
      timezone: DEFAULT_TIMEZONE,
    }).length;
  }, [selectedDays, time, endDate, today]);

  const countTone =
    occurrenceCount === 0 || occurrenceCount > MAX_OCCURRENCES
      ? 'text-destructive'
      : 'text-muted-foreground';

  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-medium text-foreground">Recurring Schedule</legend>

      <div className="space-y-1.5">
        <Label>Post type</Label>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Post type">
          {PLACEMENTS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={placement === option.value}
              className={`rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ${
                placement === option.value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-foreground hover:border-ring/40 hover:bg-muted'
              }`}
              onClick={() => setValue('placement', option.value, { shouldValidate: true })}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Stories post to Facebook and Instagram only and need one image.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>
          Days of week <span className="text-destructive">*</span>
        </Label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Days of week">
          {DAYS.map((day) => {
            const active = selectedDays.includes(day.value);
            return (
              <button
                key={day.value}
                type="button"
                role="checkbox"
                aria-checked={active}
                className={`rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-foreground hover:border-ring/40 hover:bg-muted'
                }`}
                onClick={() => toggleDay(day.value)}
              >
                {day.label}
              </button>
            );
          })}
        </div>
        {errors.daysOfWeek && (
          <p className="text-sm text-destructive">{String(errors.daysOfWeek.message)}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="recurringTime">
          Time <span className="text-destructive">*</span>
        </Label>
        <Input id="recurringTime" type="time" {...register('time')} aria-invalid={!!errors.time} />
        {errors.time && <p className="text-sm text-destructive">{String(errors.time.message)}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="endDate">
          End date <span className="text-destructive">*</span>
        </Label>
        <Input
          id="endDate"
          type="date"
          min={today}
          {...register('endDate')}
          aria-invalid={!!errors.endDate}
        />
        {errors.endDate && <p className="text-sm text-destructive">{String(errors.endDate.message)}</p>}
        <p className={`text-xs ${countTone}`}>
          {occurrenceCount === 0
            ? 'Pick at least one day and an end date to schedule a post.'
            : occurrenceCount > MAX_OCCURRENCES
              ? `${occurrenceCount} posts — that’s over the limit of ${MAX_OCCURRENCES}. Shorten the range or remove a day.`
              : `${occurrenceCount} ${occurrenceCount === 1 ? 'post' : 'posts'} will be scheduled, one per selected day each week.`}
        </p>
      </div>
    </fieldset>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors in `weekly-recurring-fields.tsx` (other files still error until later tasks).

- [ ] **Step 3: Commit**

```bash
git add src/features/create/forms/weekly-recurring-fields.tsx
git commit -m "feat: weekly form uses day checkboxes + end date with live count"
```

---

## Task 4: Wizard defaults + Brief→Media occurrence gate

**Files:**
- Modify: `src/features/create/create-wizard.tsx:265` (defaults)
- Modify: `src/features/create/create-wizard.tsx:277-303` (Brief→Media gate)

- [ ] **Step 1: Add the builder import**

At the top of `create-wizard.tsx`, add to the existing imports (near the other `@/features/create/...` imports):

```ts
import { buildWeeklyMultiDaySuggestions } from '@/features/create/schedule/suggestion-utils';
```

- [ ] **Step 2: Update the weekly default**

Replace line 265:

```ts
        weekly_recurring: { dayOfWeek: 1, time: '12:00', weeksAhead: 4, placement: 'feed' },
```

with (defaults to Monday + an end date four weeks out, i.e. the same effective four occurrences as before):

```ts
        weekly_recurring: {
          daysOfWeek: [1],
          time: '12:00',
          endDate: DateTime.now().setZone(DEFAULT_TIMEZONE).plus({ weeks: 4 }).toFormat('yyyy-MM-dd'),
          placement: 'feed',
        },
```

(`DateTime` and `DEFAULT_TIMEZONE` are already imported in this file.)

- [ ] **Step 3: Add the occurrence gate on Brief→Media**

In `goNext`, inside the `if (currentStep === 0)` branch, immediately after:

```ts
      const valid = await form.trigger();
      if (!valid) return;
```

insert:

```ts
      // Weekly recurring: block progression when the day/end-date settings
      // produce zero occurrences or more than the 12-post cap (the pure Zod
      // schema can't check this because the count depends on "now").
      if (form.getValues('contentType') === 'weekly_recurring') {
        const v = form.getValues();
        const count = buildWeeklyMultiDaySuggestions({
          startDate: DateTime.now().setZone(DEFAULT_TIMEZONE).toFormat('yyyy-MM-dd'),
          daysOfWeek: (v.daysOfWeek as number[]) ?? [],
          time: (v.time as string) ?? '12:00',
          endDate: (v.endDate as string) ?? '',
          timezone: DEFAULT_TIMEZONE,
        }).length;
        if (count < 1) {
          toast.error('Pick at least one day and an end date that schedules a post.');
          return;
        }
        if (count > 12) {
          toast.error('That’s more than 12 posts. Shorten the date range or remove a day.');
          return;
        }
      }
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: `create-wizard.tsx` clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/create/create-wizard.tsx
git commit -m "feat: weekly wizard defaults to daysOfWeek+endDate and gates occurrence count"
```

---

## Task 5: Schedule step — use the multi-day builder; remove the old builder

**Files:**
- Modify: `src/features/create/steps/schedule-step.tsx:14-19, 158-166`
- Modify: `src/features/create/schedule/suggestion-utils.ts` (delete `buildWeeklySuggestions` + its input interface)

This keeps PR1 shippable: weekly still auto-selects every derived occurrence (the read-only summary and the auto-select effect are untouched here — they are replaced in PR2). Only the source of the occurrences changes to the multi-day builder.

- [ ] **Step 1: Swap the import**

In `schedule-step.tsx`, change the suggestion-utils import block (lines 14-19) from:

```ts
import {
  buildEventSuggestions,
  buildPromotionSuggestions,
  buildWeeklySuggestions,
  deconflictSuggestions,
} from '@/features/create/schedule/suggestion-utils';
```

to:

```ts
import {
  buildEventSuggestions,
  buildPromotionSuggestions,
  buildWeeklyMultiDaySuggestions,
  deconflictSuggestions,
} from '@/features/create/schedule/suggestion-utils';
```

- [ ] **Step 2: Swap the weekly branch in `rawSuggestions`**

Replace the weekly branch (lines 158-166):

```ts
    if (contentBrief.contentType === 'weekly_recurring') {
      return buildWeeklySuggestions({
        startDate: today,
        dayOfWeek: contentBrief.dayOfWeek,
        time: contentBrief.time,
        weeksAhead: contentBrief.weeksAhead,
        timezone,
      });
    }
```

with:

```ts
    if (contentBrief.contentType === 'weekly_recurring') {
      return buildWeeklyMultiDaySuggestions({
        startDate: today,
        daysOfWeek: contentBrief.daysOfWeek,
        time: contentBrief.time,
        endDate: contentBrief.endDate,
        timezone,
      });
    }
```

- [ ] **Step 3: Delete the now-unused old builder**

In `suggestion-utils.ts`, delete the `WeeklySuggestionInput` interface (lines 7-13) and the entire `buildWeeklySuggestions` function (lines 46-80). Leave `buildEventSuggestions`, `buildPromotionSuggestions`, `deconflictSuggestions`, and the new `buildWeeklyMultiDaySuggestions` in place.

- [ ] **Step 4: Verify nothing else references the deleted symbol**

Run: `grep -rn "buildWeeklySuggestions" src`
Expected: no matches.

- [ ] **Step 5: Typecheck + tests**

Run: `npm run typecheck && npx vitest run src/features/create/schedule/suggestion-utils.test.ts`
Expected: clean typecheck for schedule-step + suggestion-utils; builder tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/create/steps/schedule-step.tsx src/features/create/schedule/suggestion-utils.ts
git commit -m "refactor: schedule step derives weekly occurrences from days+end date"
```

---

## Task 6: `createDraft` — persist first selected day

**Files:**
- Modify: `src/app/actions/content.ts:131-134`

`recurring_day_of_week` is a single-int CHECK(0-6) column used only for the mid-wizard planner ghost. Write the first selected day so old draft-ghost rendering keeps working; no migration.

- [ ] **Step 1: Update the weekly branch**

Replace lines 131-134:

```ts
    if (brief.contentType === 'weekly_recurring') {
      row.recurring_day_of_week = brief.dayOfWeek;
      row.auto_confirm = true; // weekly recurring auto-publishes once approved
    }
```

with:

```ts
    if (brief.contentType === 'weekly_recurring') {
      // Single-int column (CHECK 0-6) drives only the mid-wizard planner ghost;
      // store the first selected day. The full day set lives in body_draft.
      row.recurring_day_of_week = brief.daysOfWeek[0] ?? 1;
      row.auto_confirm = true; // weekly recurring auto-publishes once approved
    }
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: this branch clean (`brief` is narrowed to the weekly type here).

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/content.ts
git commit -m "feat: createDraft stores first weekly day for planner ghost"
```

---

## Task 7: Campaign metadata — weekly shape

**Files:**
- Modify: `src/lib/publishing/build-campaign-metadata.ts:57-64`
- Test: `src/lib/publishing/build-campaign-metadata.test.ts` (create if absent)

Metadata keeps `dayOfWeek = daysOfWeek[0]` and `time` so `extractCampaignTiming` and the link-in-bio card work unchanged, and now writes `endDate` so the bio card expires and `daysOfWeek` for future multi-day consumers. `weeksAhead` is dropped.

- [ ] **Step 1: Write failing tests**

Create (or append to) `src/lib/publishing/build-campaign-metadata.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildCampaignMetadata } from './build-campaign-metadata';

describe('buildCampaignMetadata — weekly_recurring', () => {
  const brief = {
    title: 'Quiz Night',
    daysOfWeek: [3, 5],
    time: '19:00',
    endDate: '2026-08-31',
  };

  it('writes daysOfWeek plus a back-compat dayOfWeek (first day) and endDate', () => {
    const meta = buildCampaignMetadata('weekly_recurring', brief, 4);
    expect(meta.daysOfWeek).toEqual([3, 5]);
    expect(meta.dayOfWeek).toBe(3);
    expect(meta.time).toBe('19:00');
    expect(meta.endDate).toBe('2026-08-31');
    expect(meta.brief).toBe(brief);
    expect(meta.slotCount).toBe(4);
    expect('weeksAhead' in meta).toBe(false);
  });

  it('defaults dayOfWeek to 1 when daysOfWeek is empty/missing', () => {
    const meta = buildCampaignMetadata('weekly_recurring', { time: '19:00', endDate: '2026-08-31' }, 1);
    expect(meta.dayOfWeek).toBe(1);
    expect(meta.daysOfWeek).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/publishing/build-campaign-metadata.test.ts`
Expected: FAIL — current weekly branch writes `weeksAhead`, not `daysOfWeek`/`endDate`.

- [ ] **Step 3: Update the weekly branch**

Replace lines 57-64:

```ts
  if (contentType === 'weekly_recurring') {
    return {
      ...base,
      dayOfWeek: brief.dayOfWeek as number,
      time: brief.time as string,
      weeksAhead: (brief.weeksAhead as number | undefined) ?? 4,
    };
  }
```

with:

```ts
  if (contentType === 'weekly_recurring') {
    const daysOfWeek = Array.isArray(brief.daysOfWeek) ? (brief.daysOfWeek as number[]) : [];
    return {
      ...base,
      daysOfWeek,
      // Back-compat: extractCampaignTiming, the link-in-bio card, and the
      // publish-worker banner label all read a single top-level dayOfWeek.
      dayOfWeek: daysOfWeek[0] ?? 1,
      time: brief.time as string,
      // Consumed by extractCampaignTiming (endAt) so the link-in-bio card expires.
      endDate: (brief.endDate as string | undefined) ?? null,
    };
  }
```

Also update the JSDoc reference to `weeksAhead` on lines 4-6 to mention `endDate` instead if present (optional wording fix; no behaviour change).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/publishing/build-campaign-metadata.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/publishing/build-campaign-metadata.ts src/lib/publishing/build-campaign-metadata.test.ts
git commit -m "feat: weekly campaign metadata carries daysOfWeek + endDate"
```

---

## Task 8: AI prompt — render all selected days

**Files:**
- Modify: `src/lib/ai/prompts.ts:553-556`

`buildUserPrompt` narrows `brief` to the weekly type here, so `brief.dayOfWeek` no longer compiles. Render the full day set.

- [ ] **Step 1: Update the weekly prompt branch**

Replace lines 553-557:

```ts
  if (brief.contentType === 'weekly_recurring') {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    sections.push(`Day of week: ${dayNames[brief.dayOfWeek] ?? brief.dayOfWeek}`);
    sections.push(`Time: ${brief.time}`);
  }
```

with:

```ts
  if (brief.contentType === 'weekly_recurring') {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const days = brief.daysOfWeek.map((d) => dayNames[d] ?? String(d));
    sections.push(`Days of week: ${days.join(', ')}`);
    sections.push(`Time: ${brief.time}`);
  }
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: `prompts.ts` clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/prompts.ts
git commit -m "feat: weekly copy prompt lists all selected days"
```

---

## Task 9: Server-side occurrence cap in `createScheduledBatch`

**Files:**
- Modify: `src/app/actions/content.ts` (after the brief re-validation, ~line 671)
- Test: extend `src/app/actions/content.ts` coverage if a suite exists; otherwise this is verified via the batch's existing test harness — see Step 1.

`createScheduledBatch` currently has no cap on `slotCopies.length`. The wizard gate (Task 4) is client-side; this is the authoritative bound.

- [ ] **Step 1: Add the cap**

In `createScheduledBatch`, immediately after the brief validation block that ends:

```ts
    const briefValidation = contentBriefSchema.safeParse({ ...brief, contentType });
    if (!briefValidation.success) {
      return { error: briefValidation.error.issues[0]?.message ?? 'Invalid content brief' };
    }
```

insert:

```ts
    // Authoritative occurrence cap (the wizard also enforces this client-side).
    // Each slot is one upfront AI generation the user reviewed; 12 matches the
    // schedule step's MAX_SLOTS_DEFAULT.
    const MAX_BATCH_SLOTS = 12;
    if (slotCopies.length > MAX_BATCH_SLOTS) {
      return { error: `You can schedule at most ${MAX_BATCH_SLOTS} posts at once. Remove a date or shorten the range.` };
    }
    if (contentType === 'weekly_recurring' && slotCopies.length < 1) {
      return { error: 'Select at least one date to publish.' };
    }
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/content.ts
git commit -m "feat: cap scheduled batch at 12 slots"
```

---

## Task 10: Correct the runbook

**Files:**
- Modify: `docs/runbook.md:75`

- [ ] **Step 1: Fix the stale schedule claim**

Open `docs/runbook.md`, find line ~75 asserting `materialise-weekly runs daily at 05:00 Europe/London via Supabase Scheduler`, and replace that line with:

```md
- `materialise-weekly` is deployed but **not scheduled** in production — pg_cron is not installed in the project, so no Supabase Scheduler job exists. Weekly recurring content is created up-front by the create wizard, not by this function. (Verified 2026-07-09.)
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbook.md
git commit -m "docs: correct materialise-weekly schedule claim in runbook"
```

---

## Task 11: PR1 verification gate

- [ ] **Step 1: Full pipeline**

Run: `npm run ci:verify`
Expected: lint, typecheck, tests, and build all pass.

- [ ] **Step 2: Manual smoke (dev server)**

Start the app, open `/create`, choose Weekly recurring. Confirm: day checkboxes multi-select; end-date picker present (no slider); live counter updates and blocks 0/>12; proceeding through to Generate produces the expected number of occurrences (auto-selected). Create a 2-day × 3-week weekly campaign and confirm the planner shows the concrete posts on the right dates.

- [ ] **Step 3: Open PR1**

```bash
git push -u origin feat/weekly-recurrence-model
gh pr create --title "feat: weekly recurrence — multi-day + end date" --body "Part 1 of 3. Swaps the weekly brief from single-day + post-count to multi-select days + end date. Metadata keeps dayOfWeek=daysOfWeek[0] for back-compat and adds endDate. Schedule step still auto-selects (calendar overlay lands in Part 2). No migration. See tasks/PLAN-weekly-recurrence-cta-and-date-controls.md."
```

---

# PR 2 — Planner overlay / date picking

## Task 12: `ScheduleCalendar` gains `onMonthChange`

**Files:**
- Modify: `src/features/create/schedule/schedule-calendar.tsx:41-58, 120-136, 225-227`

Month navigation is internal-only today, so existing-post overlay goes blind past the initial fetch window. Add a callback so the parent can fetch more months.

- [ ] **Step 1: Add the prop to the interface**

In `ScheduleCalendarProps` (lines 41-58), add after `onRemoveSlot`:

```ts
  /**
   * Called whenever the visible month changes (yyyy-MM). Lets the parent fetch
   * existing planner items for months the user pages to. Also fired once for
   * the initial month on mount.
   */
  onMonthChange?: (monthKey: string) => void;
```

- [ ] **Step 2: Destructure it**

In the component signature (lines 120-131), add `onMonthChange,` to the destructured props.

- [ ] **Step 3: Fire it on mount and on navigation**

Immediately after the existing `useEffect` that syncs `activeMonth` from `initialMonth` (lines 134-136), add:

```ts
  useEffect(() => {
    onMonthChange?.(activeMonth.toFormat('yyyy-MM'));
  }, [activeMonth, onMonthChange]);
```

(The existing `goToMonth` at lines 225-227 already updates `activeMonth`, so this effect covers both Previous/Next and the initial value.)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: clean (prop is optional; existing callers unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/features/create/schedule/schedule-calendar.tsx
git commit -m "feat: ScheduleCalendar reports visible-month changes"
```

---

## Task 13: Schedule step — route weekly through the calendar

**Files:**
- Modify: `src/features/create/steps/schedule-step.tsx`

Un-hide the calendar for weekly, replace the force-sync effect with a seed-once effect (so user edits survive), wire `onMonthChange` to fetch further months, and remove the read-only occurrence list.

- [ ] **Step 1: Add a "dirty" ref and seed-once effect**

Replace the force-sync effect (lines 190-205) — the whole `useEffect` that maps `rawSuggestions` into `desired` and calls `onSlotsChange` — with:

```ts
  // Weekly recurring: seed the calendar once with every derived occurrence, then
  // hand control to the user. After any manual add/remove we stop re-seeding so
  // edits are not overwritten when the brief is unchanged. Re-seeding resumes
  // only if the derived set itself changes (user went back and edited the brief).
  const weeklySeedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isWeeklyRecurring) return;
    const signature = rawSuggestions.map((s) => `${s.date}:${s.time}`).join('|');
    if (weeklySeedRef.current === signature) return; // already seeded this exact set
    weeklySeedRef.current = signature;
    const desired: ScheduleSlot[] = rawSuggestions.map((s) => ({
      key: `suggestion:${s.id}:${s.date}:${s.time}`,
      date: s.date,
      time: s.time,
      label: s.label,
      source: 'suggestion',
      suggestionId: s.id,
    }));
    onSlotsChange(desired);
  }, [isWeeklyRecurring, rawSuggestions, onSlotsChange]);
```

Note: this effect intentionally does not depend on `selectedSlots`, so re-selecting after a manual edit does not re-trigger it; it only re-seeds when the derived occurrence set (`signature`) changes.

- [ ] **Step 2: Wire `onMonthChange` and drop the mount-only fetch**

Replace the mount effect (lines 136-138):

```ts
  // Fetch existing items on mount
  useEffect(() => {
    void loadExistingItems(initialMonth);
  }, [initialMonth, loadExistingItems]);
```

with a handler passed to the calendar instead (the calendar now fires the initial month itself). Add this callback near `loadExistingItems`:

```ts
  const handleMonthChange = useCallback(
    (monthKey: string) => {
      void loadExistingItems(monthKey);
    },
    [loadExistingItems],
  );
```

and delete the mount `useEffect` above (the calendar's own mount fire in Task 12 now drives the first fetch).

- [ ] **Step 3: Un-hide the calendar for weekly**

Replace the `showCalendar` definition (lines 282-284):

```ts
  const showCalendar =
    !isWeeklyRecurring &&
    (contentBrief.contentType !== 'instant_post' || publishMode === 'schedule');
```

with:

```ts
  const showCalendar =
    contentBrief.contentType !== 'instant_post' || publishMode === 'schedule';
```

- [ ] **Step 4: Delete the read-only weekly summary block**

Remove the entire `{isWeeklyRecurring && ( … )}` block (lines 350-376) — the read-only `<ul>` occurrence list. Weekly now uses the calendar like every other type.

- [ ] **Step 5: Pass `onMonthChange` to the calendar**

In the `<ScheduleCalendar … />` element (lines 395-404), add the prop:

```tsx
            onMonthChange={handleMonthChange}
```

- [ ] **Step 6: Confirm the `defaultSlotTime` still suits weekly stories**

The calendar element passes `defaultSlotTime={contentBrief.contentType === 'story' ? STORY_POST_TIME : undefined}`. Weekly story placement keeps its brief-chosen time via suggestions, so no change is needed. Leave as-is.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: clean. `isWeeklyRecurring` is still referenced (seed effect), so no unused-var error.

- [ ] **Step 8: Commit**

```bash
git add src/features/create/steps/schedule-step.tsx
git commit -m "feat: weekly recurring uses the schedule calendar with seed-once occurrences"
```

---

## Task 14: Wizard — require ≥1 slot for weekly

**Files:**
- Modify: `src/features/create/create-wizard.tsx:319-330`

Now that weekly picks real dates, remove the bypass so it is gated on selected slots like every other scheduled type.

- [ ] **Step 1: Remove the weekly bypass**

Replace the block (lines 319-330):

```ts
      // Weekly recurring has no manual date selection — the schedule step derives
      // and auto-selects its occurrences, so it must not be gated on selectedSlots
      // (which the child effect may populate a tick after this handler reads it).
      const isWeeklyRecurring = form.getValues('contentType') === 'weekly_recurring';

      if (!isInstantNow && !isWeeklyRecurring) {
        // Validate at least one slot selected for schedule mode
        if (selectedSlots.length === 0) {
          toast.error('Select at least one schedule slot');
          return;
        }
      }
```

with:

```ts
      if (!isInstantNow) {
        // Validate at least one slot selected for schedule mode
        if (selectedSlots.length === 0) {
          toast.error('Select at least one date to schedule');
          return;
        }
      }
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/features/create/create-wizard.tsx
git commit -m "feat: weekly recurring requires at least one selected date"
```

---

## Task 15: PR2 verification gate

- [ ] **Step 1: Full pipeline**

Run: `npm run ci:verify`
Expected: all green.

- [ ] **Step 2: Manual smoke**

`/create` → Weekly recurring, pick Mon+Thu, end date 6 weeks out. On Schedule: the calendar shows all derived occurrences pre-selected and overlays any existing planner posts. Remove one occurrence, add a custom date, page forward a month and confirm existing posts load for that month. Go back to Brief, change the days, return — confirm the calendar re-seeds to the new set. Proceed and confirm only the finally-selected dates generate copy.

- [ ] **Step 3: Open PR2**

```bash
git push -u origin feat/weekly-schedule-overlay
gh pr create --title "feat: weekly schedule calendar overlay" --body "Part 2 of 3 — depends on Part 1. Weekly recurring now uses the standard schedule calendar: occurrences seed once, then the user adds/removes/moves dates with existing posts overlaid. Adds ScheduleCalendar.onMonthChange for month-by-month fetching. See tasks/PLAN-weekly-recurrence-cta-and-date-controls.md."
```

---

# PR 3 — CTA link + link-in-bio card

## Task 16: Weekly form — CTA link field (feed only)

**Files:**
- Modify: `src/features/create/forms/weekly-recurring-fields.tsx`

The field maps to **both** `ctaLinks.facebook` and `ctaLinks.instagram` (setting only `.facebook` yields no Instagram "link in bio" line — verified). It is disabled for story placement, because story rows carry no composed body and can never produce a bio card; switching to story clears any entered URL.

- [ ] **Step 1: Read the current CTA value and clear-on-story helper**

Inside `WeeklyRecurringFields`, after the existing `const placement = …` line, add:

```tsx
  const ctaLink = (watch('ctaLinks') as { facebook?: string } | undefined)?.facebook ?? '';
  const isStory = placement === 'story';

  const setPlacement = (value: 'feed' | 'story') => {
    setValue('placement', value, { shouldValidate: true });
    if (value === 'story') {
      // Stories can't carry a link (no composed body, feed-only bio card).
      setValue('ctaLinks', undefined, { shouldValidate: true });
    }
  };

  const setCtaLink = (raw: string) => {
    const url = raw.trim();
    // Map to both platforms: Facebook appends the URL to copy; Instagram gets the
    // "link in bio" line (the bio card holds the actual link).
    setValue('ctaLinks', url ? { facebook: url, instagram: url } : undefined, {
      shouldValidate: true,
    });
  };
```

- [ ] **Step 2: Route the placement buttons through `setPlacement`**

In the placement `PLACEMENTS.map(...)` buttons, change the `onClick` from:

```tsx
              onClick={() => setValue('placement', option.value, { shouldValidate: true })}
```

to:

```tsx
              onClick={() => setPlacement(option.value)}
```

- [ ] **Step 3: Add the CTA field at the end of the fieldset**

Immediately before the closing `</fieldset>`, add:

```tsx
      <div className="space-y-1.5">
        <Label htmlFor="ctaLink">Campaign link (optional)</Label>
        <Input
          id="ctaLink"
          type="url"
          inputMode="url"
          placeholder="https://your-booking-link.com"
          value={ctaLink}
          disabled={isStory}
          onChange={(e) => setCtaLink(e.target.value)}
          aria-invalid={!!(errors.ctaLinks as unknown)}
        />
        {isStory ? (
          <p className="text-xs text-muted-foreground">
            Links aren’t available on story campaigns — switch to Feed to use one.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Added to your Facebook posts and shown on your link-in-bio page for the whole run.
          </p>
        )}
        {errors.ctaLinks && (
          <p className="text-sm text-destructive">Enter a valid URL (including https://).</p>
        )}
      </div>
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/create/forms/weekly-recurring-fields.tsx
git commit -m "feat: weekly form captures an optional CTA link (feed only)"
```

---

## Task 17: `createScheduledBatch` — persist `link_in_bio_url`

**Files:**
- Modify: `src/app/actions/content.ts:727-755`

Write the campaign's `link_in_bio_url` from the weekly brief's CTA so the existing link-in-bio card machinery surfaces it. Column exists in prod (v1 baseline); the action already uses the service-role client. Weekly only — event/promotion are out of scope.

- [ ] **Step 1: Compute and write the link**

Inside the `if (needsCampaign) { … }` block, before the `.from('campaigns').insert({...})` call, add:

```ts
      // Weekly campaigns surface their CTA on the link-in-bio page for the run.
      // readPlatformCtaLinks only returns http(s) URLs. First entry in the card's
      // link resolution chain (campaigns.link_in_bio_url → metadata.*).
      const linkInBioUrl =
        contentType === 'weekly_recurring'
          ? (readPlatformCtaLinks(brief).facebook ?? null)
          : null;
```

Then add `link_in_bio_url: linkInBioUrl,` to the insert object:

```ts
      const { data: campaignRow, error: campaignError } = await supabase
        .from('campaigns')
        .insert({
          account_id: accountId,
          name: campaignName,
          campaign_type: campaignType,
          status: 'scheduled',
          metadata,
          link_in_bio_url: linkInBioUrl,
        })
        .select('id')
        .single();
```

(`readPlatformCtaLinks` is already imported at the top of the file.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/content.ts
git commit -m "feat: weekly CTA link populates campaigns.link_in_bio_url"
```

---

## Task 18: Compose-body tests — weekly CTA behaviour

**Files:**
- Test: `src/lib/publishing/compose-body.test.ts` (create if absent; else append a `describe`)

Locks the verified behaviour that forced the both-keys mapping in Task 16.

- [ ] **Step 1: Write the tests**

```ts
import { describe, it, expect } from 'vitest';
import { composePublishBody } from './compose-body';

describe('composePublishBody — weekly CTA link', () => {
  const bothKeys = { facebook: 'https://book.example', instagram: 'https://book.example' };

  it('appends "Book a table: <url>" to Facebook copy', () => {
    const body = composePublishBody(
      'facebook',
      { body: 'Come down this week.', hashtags: [] },
      { ctaLinks: bothKeys, contentType: 'weekly_recurring' },
    );
    expect(body).toBe('Come down this week.\n\nBook a table: https://book.example');
  });

  it('adds an Instagram link-in-bio line (no URL) when the instagram key is set', () => {
    const body = composePublishBody(
      'instagram',
      { body: 'Come down this week.', hashtags: [] },
      { ctaLinks: bothKeys, contentType: 'weekly_recurring' },
    );
    expect(body).toBe('Come down this week.\n\nLink in bio to book a table');
    expect(body).not.toContain('http');
  });

  it('adds NO Instagram line when only the facebook key is set (why Task 16 sets both)', () => {
    const body = composePublishBody(
      'instagram',
      { body: 'Come down this week.', hashtags: [] },
      { ctaLinks: { facebook: 'https://book.example' }, contentType: 'weekly_recurring' },
    );
    expect(body).toBe('Come down this week.');
  });

  it('appends nothing extra to Facebook when no CTA link is set', () => {
    const body = composePublishBody(
      'facebook',
      { body: 'Come down this week.', hashtags: [] },
      { ctaLinks: {}, contentType: 'weekly_recurring' },
    );
    expect(body).toBe('Come down this week.');
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run src/lib/publishing/compose-body.test.ts`
Expected: PASS (this is characterisation — `compose-body.ts` is unchanged). If any fail, STOP: the assumption behind Task 16 is wrong; re-check `compose-body.ts` before proceeding.

- [ ] **Step 3: Commit**

```bash
git add src/lib/publishing/compose-body.test.ts
git commit -m "test: pin weekly CTA composition for both platforms"
```

---

## Task 19: PR3 verification gate

- [ ] **Step 1: Full pipeline**

Run: `npm run ci:verify`
Expected: all green.

- [ ] **Step 2: Manual smoke (feed + link)**

`/create` → Weekly recurring, Feed, add a Campaign link. Generate/approve, schedule. Confirm: every Facebook variant body ends with `Book a table: <url>`; Instagram bodies contain a "link in bio" line and no URL. In the DB (or via the app), confirm `campaigns.link_in_bio_url` is set and `metadata.endDate` is present. Open `/l/<slug>` and confirm the campaign card appears once the first post is live and links to the URL.

- [ ] **Step 3: Manual smoke (story disables link)**

Switch placement to Story: the Campaign link field disables and any entered URL clears. Schedule and confirm the story variant `content_variants.body` is `''` (no CTA leaked) and no bio card appears.

- [ ] **Step 4: Open PR3**

```bash
git push -u origin feat/weekly-cta-link
gh pr create --title "feat: weekly CTA link + link-in-bio card" --body "Part 3 of 3 — soft-depends on Part 1 (uses metadata.endDate for card expiry). Optional CTA link on weekly (feed only) flows into Facebook copy via the existing ctaLinks pipeline and into campaigns.link_in_bio_url so the link-in-bio card shows for the campaign duration. No migration. See tasks/PLAN-weekly-recurrence-cta-and-date-controls.md."
```

---

## Self-review notes (spec coverage)

- Spec Feature 1 (CTA) → Tasks 16, 17, 18 (+ prompt already handles `ctaLinks` unchanged).
- Spec Feature 2 (multi-day + end date) → Tasks 1–9.
- Spec Feature 3 (planner overlay) → Tasks 12–14.
- Spec D8 (`link_in_bio_url` write) → Task 17. D9 (metadata shape) → Task 7. D7 (both-keys, story-disable) → Task 16. D3 (12-cap, server + client) → Tasks 4 + 9. D6 (`onMonthChange`) → Task 12. D5 (seed-once) → Task 13.
- Spec §4.1 "draft back-compat": **descoped by design** — no upgrade code. An old in-flight draft resumed after deploy simply requires the user to re-pick days/end date (the Brief step re-validates against the new schema and self-heals). Documented here so it is not rediscovered as a bug.
- Spec §4 multi-day proximity/next-occurrence label: metadata keeps `dayOfWeek = daysOfWeek[0]`, so the bio card's "next occurrence" label and any banner proximity label point at the **first** selected day for a multi-day campaign. This is a cosmetic approximation, not a correctness bug (weekly feed posts do not auto-overlay). Out of scope for these three PRs; note as an optional follow-up if product wants per-day labels.
- No DB migration in any task (verified: `daysOfWeek`/`endDate` live in JSONB; `recurring_day_of_week` stays a single int; `campaigns.link_in_bio_url` already exists).
- `campaign-timing.ts` and `banner-label.ts` deliberately untouched (they read `metadata.dayOfWeek`/`endDate`, both still written) — no edge-function redeploy required by this plan.
