# Food Booking Campaign — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan covers **Phase 1 only** (PRs 1–5) of [the spec](./2026-06-08-food-booking-campaign-spec.md).

**Goal:** Add an independently-shippable `food_booking` paid campaign type that schedules short, London-local ad windows around service/decision times and optimises for table bookings, gated behind a feature flag.

**Architecture:** Additive DB columns + new types; a pure window generator derives ad-set windows from a per-campaign food schedule; publish gains intra-day start times and Meta campaign-level (CBO) budget; AI/validation/UX get `food_booking` branches. Every change is guarded by `kind === 'food_booking'` / `ads_start_time != null` so existing `event`/`evergreen` campaigns are untouched.

**Tech Stack:** TypeScript (strict), Next.js 16 App Router, React 19, Supabase (Postgres + RLS), Luxon (Europe/London), Zod, React Hook Form, Vitest, Meta Marketing API, QStash, Axiom.

---

## Execution constraints (read first)

- **Branch:** all work on `feat/food-booking-campaign`. Never commit feature code to `main`. There is an unrelated pre-existing change in `src/app/(app)/connections/actions-ads.ts` — **do not stage it**.
- **Migration safety:** create and test the migration, run `npx supabase db push --dry-run`, but **DO NOT** run `npx supabase db push` against the live database — that requires Peter's explicit approval (workspace rule).
- **No live publishing:** do not publish a real campaign to Meta during implementation. Publish-path work is verified by unit tests with a mocked Meta client only.
- **Feature flag:** the `food_booking` option ships dark behind `NEXT_PUBLIC_ENABLE_FOOD_BOOKING` (validated in `src/env.ts`).
- **Conventions:** named exports only; explicit return types on exported functions; `fromDb<T>` for snake_case→camelCase; `logAuditEvent` on mutations; `revalidatePath` scoped to affected routes; design tokens only; no `any` without a justifying comment.
- **Verification per task:** `npx vitest run <file>` for the task's tests; the full `npm run ci:verify` (lint → typecheck → test → build) must pass before the PR is considered done.

---

## File structure (Phase 1)

**Create**
- `src/lib/campaigns/food-schedule.ts` — default service hours, decision-stage window templates, hard cutoffs, budget guidance, helpers. Pure data + pure functions.
- `src/lib/campaigns/food-booking-phases.ts` — `calculateFoodBookingPhases` window generator. Pure.
- `src/features/campaigns/FoodBookingSchedulePreview.tsx` — preview table with per-window toggles + warnings.
- `supabase/migrations/<timestamp>_food_booking_ad_set_fields.sql` — additive columns.
- Tests: `tests/lib/campaigns/food-schedule.test.ts`, `tests/lib/campaigns/food-booking-phases.test.ts`, `tests/lib/campaigns/food-booking-publish.test.ts`, `tests/lib/campaigns/quality-score.food.test.ts`, `tests/lib/campaigns/generate.food.test.ts`, `tests/features/campaigns/food-booking-schedule-preview.test.tsx`.

**Modify**
- `src/types/campaigns.ts` — add kind, food types, `AdSet` fields.
- `src/env.ts` — add `NEXT_PUBLIC_ENABLE_FOOD_BOOKING` boolean.
- `src/lib/campaigns/generate.ts` — `food_booking` generation branch + context.
- `src/lib/campaigns/quality-score.ts` — `food_booking` copy rules.
- `src/lib/meta/marketing.ts` — campaign-level budget (CBO) on `createMetaCampaign`; intra-day `start_time`.
- `src/app/(app)/campaigns/[id]/actions.ts` — `resolveAdSetStartTime`, CBO budget for food, conversion gate for food, `BOOK_NOW` for food.
- `src/app/(app)/campaigns/actions.ts` — accept the food brief on create; persist food ad-set fields + schedule snapshot.
- `src/features/campaigns/CampaignBriefForm.tsx` — `food_booking` form fields.
- `src/features/campaigns/CampaignTree.tsx` — show service/stage/local times on food ad sets.

---

## PR 1 — Migration, types, feature flag, schedule constants

### Task 1.1: Feature flag in env

**Files:** Modify `src/env.ts`

- [ ] **Step 1:** Add a public boolean `NEXT_PUBLIC_ENABLE_FOOD_BOOKING` to the client schema, defaulting to `false`. Follow the existing pattern for `NEXT_PUBLIC_*` booleans (coerce `'true'`/`'1'` → true). If no existing boolean-coercion helper exists, use `z.string().optional().transform(v => v === 'true' || v === '1')`.
- [ ] **Step 2:** Add `NEXT_PUBLIC_ENABLE_FOOD_BOOKING` to `.env.example` with a one-line comment.
- [ ] **Step 3:** `npm run typecheck` → clean.
- [ ] **Step 4:** Commit: `feat: add food booking feature flag env var`.

### Task 1.2: Types

**Files:** Modify `src/types/campaigns.ts`

- [ ] **Step 1:** Extend the kind union and add food types:

```ts
export type PaidCampaignKind = 'event' | 'evergreen' | 'food_booking';

export type FoodServiceKey = 'weekday_dinner' | 'saturday_food' | 'sunday_roast';

export type FoodDecisionStage =
  | 'planning' | 'lunch_decision' | 'afternoon_commit'
  | 'tomorrow' | 'morning_commit' | 'last_tables' | 'last_minute';

export type RunDay =
  | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export interface FoodServiceHours {
  serviceKey: FoodServiceKey;
  enabled: boolean;
  days: RunDay[];
  startLocal: string;        // 'HH:MM'
  endLocal: string;          // 'HH:MM'
  lastOrdersLocal?: string;  // defaults to endLocal − 30min
}

export interface FoodAdWindow {
  serviceKey: FoodServiceKey;
  decisionStage: FoodDecisionStage;
  runDay: RunDay;
  runDate: string;                // 'YYYY-MM-DD' London-local
  startsAtLocal: string;          // 'HH:MM'
  endsAtLocal: string;            // 'HH:MM'
  serviceDate: string;            // 'YYYY-MM-DD'
  serviceDateOffsetDays: number;  // serviceDate − runDate, in days
  budgetWeight: number;
  copyIntent: string;
  windowKey: string;              // stable utm_content key, e.g. 'sun_roast_morning'
  enabled: boolean;
}

export interface FoodBookingBrief {
  services: FoodServiceHours[];
  bookingUrl: string;
  foodHooks: string[];
  weeks: 1 | 2 | 4;
  dayWeighting: 'even' | 'boost_quiet' | 'manual';
  manualDayWeights?: Partial<Record<RunDay, number>>;
}
```

- [ ] **Step 2:** Add optional fields to the existing `AdSet` interface: `adsStartTime?: string | null;`, `serviceKey?: FoodServiceKey | null;`, `decisionStage?: FoodDecisionStage | null;`, `budgetWeight?: number | null;`.
- [ ] **Step 3:** `npm run typecheck` → clean.
- [ ] **Step 4:** Commit: `feat: add food booking campaign types`.

### Task 1.3: Additive migration

**Files:** Create `supabase/migrations/<timestamp>_food_booking_ad_set_fields.sql` (generate timestamp via `npx supabase migration new food_booking_ad_set_fields`)

- [ ] **Step 1:** Write the migration:

```sql
-- Food booking: intra-day start + service metadata on ad sets. Additive, nullable, reversible.
alter table public.ad_sets
  add column if not exists ads_start_time text,
  add column if not exists service_key text,
  add column if not exists decision_stage text,
  add column if not exists budget_weight numeric;

comment on column public.ad_sets.ads_start_time is 'HH:MM London-local intra-day start (mirrors ads_stop_time); food_booking only';
comment on column public.ad_sets.service_key is 'FoodServiceKey for food_booking ad sets';
comment on column public.ad_sets.decision_stage is 'FoodDecisionStage for food_booking ad sets';
comment on column public.ad_sets.budget_weight is 'Guidance/preview weight (0..100); not sent to Meta in Phase 1';
```

- [ ] **Step 2:** Verify `ad_sets` RLS is account-scoped (open item §20 of spec). Run `npx supabase migration list` and inspect existing `ad_sets` policies in earlier migrations. If account-scoped policies exist, the new columns inherit them — **no policy change needed**. If NOT, STOP and report to Peter before proceeding.
- [ ] **Step 3:** `npx supabase db push --dry-run` → review SQL, confirm no destructive operations. **Do not** run the real `db push`.
- [ ] **Step 4:** Commit: `feat: add food booking ad set columns migration`.

### Task 1.4: Schedule constants + tests

**Files:** Create `src/lib/campaigns/food-schedule.ts`, `tests/lib/campaigns/food-schedule.test.ts`

- [ ] **Step 1: Write failing tests** (`tests/lib/campaigns/food-schedule.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FOOD_SERVICE_HOURS,
  DECISION_STAGE_TEMPLATES,
  lastOrdersOrDefault,
  hardStopFor,
} from '@/lib/campaigns/food-schedule';

describe('food-schedule defaults', () => {
  it('provides the three default services with doc hours', () => {
    expect(DEFAULT_FOOD_SERVICE_HOURS.weekday_dinner.startLocal).toBe('16:00');
    expect(DEFAULT_FOOD_SERVICE_HOURS.weekday_dinner.endLocal).toBe('21:00');
    expect(DEFAULT_FOOD_SERVICE_HOURS.weekday_dinner.days).toEqual(
      ['tuesday', 'wednesday', 'thursday', 'friday'],
    );
    expect(DEFAULT_FOOD_SERVICE_HOURS.saturday_food.endLocal).toBe('19:00');
    expect(DEFAULT_FOOD_SERVICE_HOURS.sunday_roast.lastOrdersLocal).toBe('17:30');
  });

  it('defaults last orders to service end minus 30 minutes', () => {
    expect(lastOrdersOrDefault({ ...DEFAULT_FOOD_SERVICE_HOURS.saturday_food, lastOrdersLocal: undefined }))
      .toBe('18:30');
  });

  it('marks rescue windows disabled by default', () => {
    const weekday = DECISION_STAGE_TEMPLATES.weekday_dinner;
    expect(weekday.find(w => w.windowKey === 'weekday_last_minute')?.defaultEnabled).toBe(false);
    const saturday = DECISION_STAGE_TEMPLATES.saturday_food;
    expect(saturday.find(w => w.windowKey === 'saturday_final_nudge')?.defaultEnabled).toBe(false);
  });

  it('applies a later Friday hard stop for weekday dinner', () => {
    expect(hardStopFor('weekday_dinner', 'friday')).toBe('19:00');
    expect(hardStopFor('weekday_dinner', 'tuesday')).toBe('18:30');
    expect(hardStopFor('sunday_roast', 'sunday')).toBe('16:30');
  });
});
```

- [ ] **Step 2:** Run `npx vitest run tests/lib/campaigns/food-schedule.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** `src/lib/campaigns/food-schedule.ts`:

```ts
import type { FoodServiceHours, FoodServiceKey, FoodDecisionStage, RunDay } from '@/types/campaigns';

export const DEFAULT_FOOD_SERVICE_HOURS: Record<FoodServiceKey, FoodServiceHours> = {
  weekday_dinner: {
    serviceKey: 'weekday_dinner', enabled: true,
    days: ['tuesday', 'wednesday', 'thursday', 'friday'],
    startLocal: '16:00', endLocal: '21:00',
  },
  saturday_food: {
    serviceKey: 'saturday_food', enabled: true,
    days: ['saturday'], startLocal: '12:00', endLocal: '19:00',
  },
  sunday_roast: {
    serviceKey: 'sunday_roast', enabled: true,
    days: ['sunday'], startLocal: '13:00', endLocal: '18:00', lastOrdersLocal: '17:30',
  },
};

export interface DecisionStageTemplate {
  windowKey: string;
  decisionStage: FoodDecisionStage;
  serviceDateOffsetDays: number;   // serviceDate − runDate
  startLocal: string;
  endLocal: string;
  weight: number;
  copyIntent: string;
  defaultEnabled: boolean;
}

export const DECISION_STAGE_TEMPLATES: Record<FoodServiceKey, DecisionStageTemplate[]> = {
  weekday_dinner: [
    { windowKey: 'weekday_lunch_decision', decisionStage: 'lunch_decision', serviceDateOffsetDays: 0, startLocal: '11:00', endLocal: '13:30', weight: 55, copyIntent: "Get tonight's dinner decided during the lunch break.", defaultEnabled: true },
    { windowKey: 'weekday_afternoon_commit', decisionStage: 'afternoon_commit', serviceDateOffsetDays: 0, startLocal: '15:00', endLocal: '17:15', weight: 35, copyIntent: 'Finalise after-work plans; book a table before heading home.', defaultEnabled: true },
    { windowKey: 'weekday_last_minute', decisionStage: 'last_minute', serviceDateOffsetDays: 0, startLocal: '17:15', endLocal: '18:30', weight: 10, copyIntent: 'Low-weight rescue: still deciding dinner? Book for this evening.', defaultEnabled: false },
  ],
  saturday_food: [
    { windowKey: 'saturday_planning', decisionStage: 'planning', serviceDateOffsetDays: 1, startLocal: '16:00', endLocal: '20:00', weight: 25, copyIntent: 'Plan Saturday lunch or early dinner.', defaultEnabled: true },
    { windowKey: 'saturday_lunch_commit', decisionStage: 'lunch_decision', serviceDateOffsetDays: 0, startLocal: '08:30', endLocal: '11:30', weight: 35, copyIntent: 'Book lunch from 12pm.', defaultEnabled: true },
    { windowKey: 'saturday_afternoon_food', decisionStage: 'afternoon_commit', serviceDateOffsetDays: 0, startLocal: '12:30', endLocal: '16:30', weight: 30, copyIntent: 'Tables for food until 7pm.', defaultEnabled: true },
    { windowKey: 'saturday_final_nudge', decisionStage: 'last_minute', serviceDateOffsetDays: 0, startLocal: '16:30', endLocal: '17:30', weight: 10, copyIntent: 'Low-weight late demand: still time to book early dinner.', defaultEnabled: false },
  ],
  sunday_roast: [
    { windowKey: 'sunday_roast_planning', decisionStage: 'planning', serviceDateOffsetDays: 2, startLocal: '09:00', endLocal: '14:00', weight: 20, copyIntent: 'Book Sunday roast before the weekend fills.', defaultEnabled: true },
    { windowKey: 'sunday_roast_tomorrow', decisionStage: 'tomorrow', serviceDateOffsetDays: 1, startLocal: '09:00', endLocal: '18:00', weight: 35, copyIntent: 'Sunday roast tomorrow — reserve your table.', defaultEnabled: true },
    { windowKey: 'sunday_roast_morning', decisionStage: 'morning_commit', serviceDateOffsetDays: 0, startLocal: '08:30', endLocal: '11:30', weight: 30, copyIntent: 'Roasts served from 1pm today.', defaultEnabled: true },
    { windowKey: 'sunday_roast_last_tables', decisionStage: 'last_tables', serviceDateOffsetDays: 0, startLocal: '11:30', endLocal: '16:00', weight: 15, copyIntent: 'Last orders 5:30pm — book while tables remain.', defaultEnabled: true },
  ],
};

export const SERVICE_BUDGET_GUIDANCE: Record<FoodServiceKey, number> = {
  sunday_roast: 50, weekday_dinner: 35, saturday_food: 15,
};

const HARD_STOPS: Record<FoodServiceKey, { default: string; friday?: string }> = {
  weekday_dinner: { default: '18:30', friday: '19:00' },
  saturday_food: { default: '17:30' },
  sunday_roast: { default: '16:30' },
};

export function hardStopFor(serviceKey: FoodServiceKey, runDay: RunDay): string {
  const stop = HARD_STOPS[serviceKey];
  if (serviceKey === 'weekday_dinner' && runDay === 'friday' && stop.friday) return stop.friday;
  return stop.default;
}

export function lastOrdersOrDefault(hours: FoodServiceHours): string {
  if (hours.lastOrdersLocal) return hours.lastOrdersLocal;
  const [h, m] = hours.endLocal.split(':').map(Number);
  const total = h * 60 + m - 30;
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
```

- [ ] **Step 4:** Run `npx vitest run tests/lib/campaigns/food-schedule.test.ts` → PASS.
- [ ] **Step 5:** Commit: `feat: add food schedule defaults and templates`.

### Task 1.5: PR1 verification

- [ ] Run `npm run ci:verify` → all green. Open PR "feat: food booking data model + schedule constants". Complexity M.

---

## PR 2 — Window generator (`calculateFoodBookingPhases`)

### Task 2.1: Generator tests

**Files:** Create `tests/lib/campaigns/food-booking-phases.test.ts`

- [ ] **Step 1: Write failing tests.** Use a fixed Tuesday start date so weekday windows appear; assert the contract:

```ts
import { describe, it, expect } from 'vitest';
import { calculateFoodBookingPhases } from '@/lib/campaigns/food-booking-phases';
import { DEFAULT_FOOD_SERVICE_HOURS } from '@/lib/campaigns/food-schedule';
import type { FoodBookingBrief } from '@/types/campaigns';

const brief = (over: Partial<FoodBookingBrief> = {}): FoodBookingBrief => ({
  services: [
    DEFAULT_FOOD_SERVICE_HOURS.weekday_dinner,
    DEFAULT_FOOD_SERVICE_HOURS.saturday_food,
    DEFAULT_FOOD_SERVICE_HOURS.sunday_roast,
  ],
  bookingUrl: 'https://book.example.com',
  foodHooks: ['Hand-carved roast'],
  weeks: 2,
  dayWeighting: 'even',
  ...over,
});

describe('calculateFoodBookingPhases', () => {
  // 2026-06-09 is a Tuesday.
  it('generates Tue-Fri weekday windows with London-local times', () => {
    const windows = calculateFoodBookingPhases(brief(), '2026-06-09');
    const tueLunch = windows.find(w => w.runDate === '2026-06-09' && w.windowKey === 'weekday_lunch_decision');
    expect(tueLunch?.startsAtLocal).toBe('11:00');
    expect(tueLunch?.endsAtLocal).toBe('13:30');
    expect(tueLunch?.serviceKey).toBe('weekday_dinner');
  });

  it('applies the Friday 19:00 hard stop and 18:30 on other weekdays', () => {
    const windows = calculateFoodBookingPhases(brief(), '2026-06-09');
    const friLM = windows.find(w => w.runDay === 'friday' && w.windowKey === 'weekday_last_minute');
    const tueLM = windows.find(w => w.runDay === 'tuesday' && w.windowKey === 'weekday_last_minute');
    expect(friLM?.endsAtLocal).toBe('19:00');
    expect(tueLM?.endsAtLocal).toBe('18:30');
  });

  it('disables rescue windows by default but still emits them', () => {
    const windows = calculateFoodBookingPhases(brief(), '2026-06-09');
    expect(windows.find(w => w.windowKey === 'weekday_last_minute')?.enabled).toBe(false);
    expect(windows.find(w => w.windowKey === 'saturday_final_nudge')?.enabled).toBe(false);
    expect(windows.find(w => w.windowKey === 'sunday_roast_last_tables')?.enabled).toBe(true);
  });

  it('schedules Sunday roast planning on the prior Friday and tomorrow on Saturday', () => {
    const windows = calculateFoodBookingPhases(brief(), '2026-06-09');
    const planning = windows.find(w => w.windowKey === 'sunday_roast_planning');
    expect(planning?.runDay).toBe('friday');
    expect(planning?.serviceDateOffsetDays).toBe(2);
    const tomorrow = windows.find(w => w.windowKey === 'sunday_roast_tomorrow');
    expect(tomorrow?.runDay).toBe('saturday');
    expect(tomorrow?.serviceDateOffsetDays).toBe(1);
  });

  it('stops Sunday roast windows before last orders', () => {
    const windows = calculateFoodBookingPhases(brief(), '2026-06-09');
    const last = windows.find(w => w.windowKey === 'sunday_roast_last_tables');
    expect(last?.endsAtLocal).toBe('16:00'); // ≤ 16:30 hard stop, < 17:30 last orders
  });

  it('omits windows whose run date is before the campaign start', () => {
    // Start on Saturday 2026-06-13: the Friday planning windows for that weekend are in the past.
    const windows = calculateFoodBookingPhases(brief(), '2026-06-13');
    const pastPlanning = windows.find(w => w.runDate === '2026-06-12');
    expect(pastPlanning).toBeUndefined();
  });

  it('respects weeks=1 vs weeks=2 window counts', () => {
    const one = calculateFoodBookingPhases(brief({ weeks: 1 }), '2026-06-09');
    const two = calculateFoodBookingPhases(brief({ weeks: 2 }), '2026-06-09');
    expect(two.length).toBeGreaterThan(one.length);
  });

  it('only includes enabled services', () => {
    const windows = calculateFoodBookingPhases(
      brief({ services: [{ ...DEFAULT_FOOD_SERVICE_HOURS.sunday_roast }] }),
      '2026-06-09',
    );
    expect(windows.every(w => w.serviceKey === 'sunday_roast')).toBe(true);
  });

  it('handles the BST→GMT transition without shifting local times', () => {
    // Clocks go back on 2026-10-25. A Sunday roast that week keeps 08:30 local start.
    const windows = calculateFoodBookingPhases(brief(), '2026-10-23'); // Friday
    const morning = windows.find(w => w.runDate === '2026-10-25' && w.windowKey === 'sunday_roast_morning');
    expect(morning?.startsAtLocal).toBe('08:30');
  });
});
```

- [ ] **Step 2:** Run `npx vitest run tests/lib/campaigns/food-booking-phases.test.ts` → FAIL (module not found).

### Task 2.2: Generator implementation

**Files:** Create `src/lib/campaigns/food-booking-phases.ts`

- [ ] **Step 1: Implement.** Use Luxon in Europe/London for date stepping; clamp each window's end to the hard stop; map weekday names; emit a `FoodAdWindow` per template per matching service day across `weeks`.

```ts
import { DateTime } from 'luxon';
import type { FoodAdWindow, FoodBookingBrief, RunDay } from '@/types/campaigns';
import {
  DECISION_STAGE_TEMPLATES,
  hardStopFor,
  lastOrdersOrDefault,
} from '@/lib/campaigns/food-schedule';

const ZONE = 'Europe/London';
const WEEKDAY_INDEX: Record<RunDay, number> = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7,
};
const INDEX_WEEKDAY: Record<number, RunDay> = Object.fromEntries(
  Object.entries(WEEKDAY_INDEX).map(([k, v]) => [v, k as RunDay]),
) as Record<number, RunDay>;

function minOfHHMM(a: string, b: string): string {
  return a <= b ? a : b;
}

/**
 * Derive short, London-local ad windows from a food brief. Pure and deterministic.
 * @param brief enabled services + scheduling preferences
 * @param campaignStartDate 'YYYY-MM-DD' London-local; windows before this are dropped
 */
export function calculateFoodBookingPhases(
  brief: FoodBookingBrief,
  campaignStartDate: string,
): FoodAdWindow[] {
  const start = DateTime.fromISO(campaignStartDate, { zone: ZONE }).startOf('day');
  const windows: FoodAdWindow[] = [];

  for (const service of brief.services) {
    if (!service.enabled) continue;
    const templates = DECISION_STAGE_TEMPLATES[service.serviceKey];

    for (let week = 0; week < brief.weeks; week++) {
      for (const dayName of service.days) {
        // The service date for this service-day in this week.
        const serviceDate = nthWeekdayOnOrAfter(start, WEEKDAY_INDEX[dayName]).plus({ weeks: week });

        for (const t of templates) {
          const runDate = serviceDate.minus({ days: t.serviceDateOffsetDays });
          if (runDate < start) continue;
          const runDay = INDEX_WEEKDAY[runDate.weekday];
          const endsAtLocal = minOfHHMM(t.endLocal, hardStopFor(service.serviceKey, runDay));
          // Skip degenerate windows where the hard stop is at/before the start.
          if (endsAtLocal <= t.startLocal) continue;

          windows.push({
            serviceKey: service.serviceKey,
            decisionStage: t.decisionStage,
            runDay,
            runDate: runDate.toISODate()!,
            startsAtLocal: t.startLocal,
            endsAtLocal,
            serviceDate: serviceDate.toISODate()!,
            serviceDateOffsetDays: t.serviceDateOffsetDays,
            budgetWeight: t.weight,
            copyIntent: t.copyIntent,
            windowKey: t.windowKey,
            enabled: service.enabled && t.defaultEnabled,
          });
        }
      }
    }
  }

  windows.sort((a, b) => (a.runDate + a.startsAtLocal).localeCompare(b.runDate + b.startsAtLocal));
  return windows;
}

function nthWeekdayOnOrAfter(from: DateTime, weekdayIndex: number): DateTime {
  const delta = (weekdayIndex - from.weekday + 7) % 7;
  return from.plus({ days: delta });
}
```

- [ ] **Step 2:** Run `npx vitest run tests/lib/campaigns/food-booking-phases.test.ts` → PASS. If the last-orders test needs it, note `lastOrdersOrDefault` is available for copy context (used in PR3), not for clamping here (hard stops already clamp).
- [ ] **Step 3:** Commit: `feat: add food booking window generator`.

### Task 2.3: PR2 verification

- [ ] `npm run ci:verify` → green. PR "feat: food booking window generator". Complexity M.

---

## PR 3 — AI generation branch + copy validation

> Read `src/lib/campaigns/generate.ts` and `src/lib/campaigns/quality-score.ts` first. Reuse the existing event branching points (Explore findings: kind checks around `generate.ts:286/301/383/397/407`; copy rules in `quality-score.ts:176-272`). Do not duplicate the banned-phrase list — reuse it.

### Task 3.1: Food copy validation rules (test-first)

**Files:** Create `tests/lib/campaigns/quality-score.food.test.ts`; Modify `src/lib/campaigns/quality-score.ts`

- [ ] **Step 1: Write failing tests.** Call the exported copy validator (`validateCampaignCopy`) with `campaignKind: 'food_booking'` and a `decisionStage`/`serviceKey` context, asserting:

```ts
import { describe, it, expect } from 'vitest';
import { validateCampaignCopy } from '@/lib/campaigns/quality-score';

const base = {
  campaignKind: 'food_booking' as const,
  cta: 'BOOK_NOW' as const,
};

describe('food_booking copy validation', () => {
  it('passes copy with booking intent and BOOK_NOW', () => {
    const res = validateCampaignCopy({ ...base, serviceKey: 'weekday_dinner', decisionStage: 'lunch_decision',
      primaryText: 'Book a table for dinner tonight, served from 4pm.' });
    expect(res.hardIssues).toHaveLength(0);
  });
  it('fails copy with no booking/table language', () => {
    const res = validateCampaignCopy({ ...base, serviceKey: 'weekday_dinner', decisionStage: 'lunch_decision',
      primaryText: 'Come and try our delicious food.' });
    expect(res.hardIssues.some(i => /booking intent/i.test(i.message))).toBe(true);
  });
  it('fails when CTA is not BOOK_NOW', () => {
    const res = validateCampaignCopy({ ...base, cta: 'LEARN_MORE', serviceKey: 'weekday_dinner', decisionStage: 'lunch_decision',
      primaryText: 'Book a table tonight.' });
    expect(res.hardIssues.some(i => /BOOK_NOW/i.test(i.message))).toBe(true);
  });
  it('fails Sunday roast copy that says "tonight"', () => {
    const res = validateCampaignCopy({ ...base, serviceKey: 'sunday_roast', decisionStage: 'morning_commit',
      primaryText: 'Book your roast tonight.' });
    expect(res.hardIssues.some(i => /tonight/i.test(i.message))).toBe(true);
  });
  it('fails last-orders mention outside Sunday day-of', () => {
    const res = validateCampaignCopy({ ...base, serviceKey: 'sunday_roast', decisionStage: 'tomorrow',
      primaryText: 'Last orders 5:30pm — reserve a table.' });
    expect(res.hardIssues.some(i => /last orders/i.test(i.message))).toBe(true);
  });
  it('fails weekday copy mentioning Sunday roast', () => {
    const res = validateCampaignCopy({ ...base, serviceKey: 'weekday_dinner', decisionStage: 'lunch_decision',
      primaryText: 'Book a table for our Sunday roast.' });
    expect(res.hardIssues.some(i => /sunday roast/i.test(i.message))).toBe(true);
  });
  it('reuses the existing banned-phrase rule', () => {
    const res = validateCampaignCopy({ ...base, serviceKey: 'weekday_dinner', decisionStage: 'lunch_decision',
      primaryText: "Book a table — don't miss out!" });
    expect(res.hardIssues.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2:** Run the test → FAIL (food rules absent / signature mismatch). Adjust the test's input shape to match the real `validateCampaignCopy` signature you see in the file; keep the assertions.
- [ ] **Step 3: Implement** the `food_booking` branch in `validateCampaignCopy`: require booking-intent words (reuse the existing event word set); require `cta === 'BOOK_NOW'`; for `serviceKey === 'sunday_roast'` forbid `tonight`; forbid `last orders` unless `serviceKey === 'sunday_roast' && (decisionStage === 'morning_commit' || decisionStage === 'last_tables')`; for non-roast services forbid `sunday roast`; reuse banned-phrase + no-raw-URL checks. Add issues to the existing `hardIssues` array with clear `message`s containing the keywords asserted above.
- [ ] **Step 4:** Run the test → PASS.
- [ ] **Step 5:** Commit: `feat: add food booking copy validation rules`.

### Task 3.2: Food generation branch (test-first)

**Files:** Create `tests/lib/campaigns/generate.food.test.ts`; Modify `src/lib/campaigns/generate.ts`

- [ ] **Step 1: Write failing tests** with the OpenAI client mocked (follow the existing generate test's mock). Assert that for `campaignKind: 'food_booking'`: the per-window prompt context includes service name, service date, decision window, booking URL and food hooks; the generated ad's `cta` is `BOOK_NOW`; and generation fails when the model returns copy that breaks a food hard rule (e.g. roast "tonight").
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** the `food_booking` branch in `generate.ts`: build the food context block per window (service hours, decision stage/copy intent, hooks, booking URL, last orders only when Sunday day-of via `lastOrdersOrDefault`); force `cta: 'BOOK_NOW'`; reuse `requireBookingIntent`/`requireBookNow` validation options for this kind.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat: add food booking AI generation branch`.

### Task 3.3: PR3 verification

- [ ] `npm run ci:verify` → green. PR "feat: food booking AI generation + copy rules". Complexity M.

---

## PR 4 — Publish: intra-day start + CBO budget + conversion gate

> Read `src/lib/meta/marketing.ts` (`CreateCampaignParams` ~20-27, `createMetaCampaign` ~109-120, `createMetaAdSet` ~286-330) and `src/app/(app)/campaigns/[id]/actions.ts` (`resolveAdSetEndTime` ~509-525, budget control ~755-780, `shouldRequireBookingConversionSetup` ~207-227, `allocateAdSetBudgets` ~463-507) first.

### Task 4.1: Meta client — campaign-level budget (CBO)

**Files:** Modify `src/lib/meta/marketing.ts`; Create `tests/lib/campaigns/food-booking-publish.test.ts` (Meta client mocked / fetch stubbed per existing meta tests)

- [ ] **Step 1: Write failing test** asserting that when `createMetaCampaign` is called with a `lifetimeBudget` and `useCampaignBudgetOptimization: true`, the request body to Meta includes `lifetime_budget` (in minor units) and `is_adset_budget_sharing_enabled: true`; and when omitted, body keeps the current default (`is_adset_budget_sharing_enabled: false`, no budget).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement:** extend `CreateCampaignParams` with optional `dailyBudget?`, `lifetimeBudget?`, `useCampaignBudgetOptimization?`. In `createMetaCampaign`, when CBO is requested, set `is_adset_budget_sharing_enabled: true` and the chosen budget field (×100, `Math.round`); otherwise leave existing behaviour untouched. Keep the existing "lifetime requires end_time" rule semantics at the ad-set level.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat: support campaign-level CBO budget in meta client`.

### Task 4.2: Publish — intra-day start + food budget routing + gate + CTA

**Files:** Modify `src/app/(app)/campaigns/[id]/actions.ts`; extend `tests/lib/campaigns/food-booking-publish.test.ts`

- [ ] **Step 1: Write failing tests** (mock the Meta client module): for a `food_booking` campaign, publish (a) computes ad-set `start_time` from `ads_start_time` via `toLondonDateTime(phase_start, ads_start_time)` rather than midnight; (b) calls `createMetaCampaign` with `useCampaignBudgetOptimization: true` and a campaign `lifetimeBudget`, and does **not** pass per-ad-set budgets; (c) is blocked by `validateBookingConversionPreflight` when conversion setup is not ready; (d) forces `BOOK_NOW`. Also assert event/evergreen publish is unchanged (start still midnight; per-ad-set budgets still applied).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement:**
  - Add `resolveAdSetStartTime(adSet, campaign)`: `adSet.ads_start_time ? toLondonDateTime(adSet.phase_start ?? campaign.start_date, adSet.ads_start_time) : toMidnightLondon(adSet.phase_start ?? campaign.start_date)`. Use it for the ad-set `startTime`.
  - Branch budget: if `campaign.campaign_kind === 'food_booking'`, call `createMetaCampaign` with `useCampaignBudgetOptimization: true` + campaign `lifetimeBudget = campaign.budget_amount`, and skip `allocateAdSetBudgets`/per-ad-set budget fields. Else keep current path.
  - Extend `shouldRequireBookingConversionSetup` to return true for `campaign.campaign_kind === 'food_booking'`.
  - Extend the existing event-only `BOOK_NOW` force to include `food_booking`.
  - `revalidatePath` the campaign detail + list routes (existing pattern); `logAuditEvent` on publish.
- [ ] **Step 4:** Run → PASS (including the unchanged event/evergreen assertions).
- [ ] **Step 5:** Commit: `feat: food booking publish — intra-day start, CBO budget, conversion gate`.

### Task 4.3: Create action — persist food fields + schedule snapshot

**Files:** Modify `src/app/(app)/campaigns/actions.ts`; extend the publish test or add a create test

- [ ] **Step 1: Write failing test** that creating a `food_booking` campaign from a `FoodBookingBrief` calls `calculateFoodBookingPhases`, writes one ad-set row per **enabled** window with `phase_start = runDate`, `ads_start_time`/`ads_stop_time` from the window, plus `service_key`/`decision_stage`/`budget_weight`, and stores the food schedule + booking URL in `source_snapshot`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** the `food_booking` create branch: validate the brief with a new Zod schema; generate windows; map enabled windows → ad-set rows (snake_case); persist `source_snapshot.foodSchedule`, `source_snapshot.bookingUrl`, `source_snapshot.bookingConversionOptimised = true`; `logAuditEvent`; `revalidatePath('/campaigns')`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat: persist food booking campaign on create`.

### Task 4.4: PR4 verification

- [ ] `npm run ci:verify` → green. PR "feat: food booking publish + create". Complexity L.

---

## PR 5 — UX: brief form, schedule preview, campaign tree

> Read `src/features/campaigns/CampaignBriefForm.tsx` (kind toggle ~78/293-303; conditional rendering ~169/213/289) and `src/features/campaigns/CampaignTree.tsx` (ad-set rendering ~147-161). Follow `.claude/rules/ui-patterns.md`: loading/empty/error states, design tokens, a11y.

### Task 5.1: Schedule preview component (test-first)

**Files:** Create `src/features/campaigns/FoodBookingSchedulePreview.tsx`, `tests/features/campaigns/food-booking-schedule-preview.test.tsx`

- [ ] **Step 1: Write failing tests** (Testing Library): given a `FoodAdWindow[]`, it renders a table row per window with local start–end, service, stage, and weight; a window with `enabled: false` renders its toggle off; toggling a window calls `onToggle(windowKey, next)`; a window whose `endsAtLocal` exceeds the service last orders shows a visible "runs late" warning (text, not colour alone); a `conversionReady={false}` prop shows a "tracking not ready" warning; a low budget-per-active-window shows a budget-adequacy warning.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** the component: typed `FoodBookingSchedulePreviewProps`; semantic table (`<thead>`, `<th scope="col">`); per-row toggle with `aria-label`; warnings rendered with icon + text using design tokens; pure presentational (state lifted to parent via `onToggle`). Include empty state ("No windows generated").
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat: add food booking schedule preview`.

### Task 5.2: Brief form food fields

**Files:** Modify `src/features/campaigns/CampaignBriefForm.tsx`

- [ ] **Step 1: Write failing test** that selecting the `Food Booking` kind (only visible when `NEXT_PUBLIC_ENABLE_FOOD_BOOKING`) reveals: service pickers prefilled from `DEFAULT_FOOD_SERVICE_HOURS`, booking URL, food hooks, budget + type, weeks (default 2), day-weighting choice; and that submitting builds a valid `FoodBookingBrief`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement:** add `food_booking` to the kind selector behind the flag; add a Zod-validated (`@hookform/resolvers`) food sub-form; render `FoodBookingSchedulePreview` from `calculateFoodBookingPhases` with live toggles; inline errors; disabled/loading submit; design tokens; responsive.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat: add food booking fields to campaign brief form`.

### Task 5.3: Campaign tree food metadata

**Files:** Modify `src/features/campaigns/CampaignTree.tsx`

- [ ] **Step 1: Write failing test** that a food ad set renders its service, decision stage, and local start–end; non-food ad sets render unchanged.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement:** when `adSet.serviceKey` is present, show service + stage + `startsAtLocal–endsAtLocal`; otherwise existing rendering.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat: show food metadata in campaign tree`.

### Task 5.4: PR5 verification + manual smoke

- [ ] `npm run ci:verify` → green.
- [ ] Manual smoke (dev server, flag on): create a `food_booking` campaign, confirm the preview table + toggles + warnings render and a valid brief is produced. Do **not** publish to Meta.
- [ ] PR "feat: food booking create UX". Complexity L.

---

## Self-review (completed by author)

**Spec coverage:** kind/types (§7 → 1.2), migration (§6 → 1.3), schedule config + generator + lean default (§8 → 1.4/2.x), AI branch (§9 → 3.2), validation (§10 → 3.1), publish/CBO/start/gate/CTA (§11 → 4.1/4.2), tracking reuse (§12 → create writes `utm_content` via existing variant logic at publish; window `windowKey` feeds `utm_content`), UX + preview + warnings (§13 → 5.x), deployment safety (§16 → constraints + 1.1 flag), tests (§17 → each task). Phases 2–3 intentionally excluded (separate plans).

**Placeholder scan:** new pure modules have full code; modification tasks specify exact files, integration points (file:line), full test code, and concrete implementation steps. No "add validation"/"TBD" left.

**Type consistency:** `FoodAdWindow`, `FoodBookingBrief`, `windowKey`, `serviceDateOffsetDays`, `calculateFoodBookingPhases(brief, campaignStartDate)`, `hardStopFor`, `lastOrdersOrDefault`, `resolveAdSetStartTime`, and the new `createMetaCampaign` params are named identically across all tasks.

**Note for executor:** `utm_content` per window is produced by the existing central tracking-link logic at publish; map each ad's `utmContentKey` from the window's `windowKey` in Task 4.3 so attribution segments cleanly in Phase 2.
