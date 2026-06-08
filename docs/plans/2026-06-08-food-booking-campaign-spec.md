# Food Booking Campaign Type — Implementation Spec

**Date:** 2026-06-08
**Status:** Ready for review
**Owner:** Peter Pitcher
**Supersedes/extends:** [2026-06-07-food-booking-campaign-design.md](./2026-06-07-food-booking-campaign-design.md) (design handoff)
**Project:** CheersAI 2.0 (Next.js 16 App Router, React 19, Supabase, Meta Marketing API, QStash, Axiom)

---

## 1. Summary

### Plain English
We are adding a new paid-advert campaign type — **Food Booking** — that understands a venue's meal times and the moments diners decide where to eat, and aims everything at getting **tables booked**. Instead of one advert running all day, it runs **short, timed bursts** at the decision moments (e.g. push tonight's dinner late morning and mid-afternoon, then stop when it's too late to be useful). Sunday roast is treated as the hero. The owner sets one budget; Meta spreads it across the windows toward whatever books best. Publishing is blocked until table-booking tracking is ready.

### Technical
Introduce a `food_booking` value of `PaidCampaignKind`. Drive ad-set scheduling from a per-campaign **food service calendar** (prefilled defaults, stored in the campaign's `source_snapshot`). A new window generator derives short, London-local, DST-safe ad-set windows from service hours × decision-stage templates. Publishing gains **intra-day start times** (new `ads_start_time` column mirroring `ads_stop_time`) and **campaign-level budget (Advantage Campaign Budget / CBO)** in the Meta client. The existing conversion-readiness gate, central tracking links, and start/end → Meta scheduling are reused. Delivered in three independently shippable phases: Build, Measure, Tune.

---

## 2. Goals / Non-goals

### Goals
- A `food_booking` campaign type that schedules ads around service times and booking-decision windows and optimises for **table bookings**.
- Force booking-intent copy and the `BOOK_NOW` CTA; block publish until table-booking conversion tracking is ready.
- Segment reporting by food service, day, decision stage, and ad window.
- Ship Phase 1 as a complete, usable feature; layer Phases 2–3 without breaking it.

### Non-goals (v1)
- No per-account, reusable service-hours editor in Settings (schedule lives with the campaign; promotable later).
- No multi-timezone support (Europe/London only, per project constraint).
- No replacement of `event` / `evergreen` kinds — purely additive.
- No hard app-controlled budget split between windows in Phase 1 (Meta/CBO owns allocation; see §10).

---

## 3. Decisions locked (assumptions of record)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Spec scope | All three phases, each independently shippable. Phase 3 builds the mechanism with safe defaults; tuning happens once live data exists. |
| D2 | Schedule config location | In the campaign brief, prefilled with defaults; stored in `source_snapshot`. No new settings table. |
| D3 | Intra-day scheduling | Add `ads_start_time` (HH:MM) column mirroring `ads_stop_time`. **Reject** the design doc's `phase_start_at`/`phase_end_at timestamptz`. |
| D4 | Conversion tracking | Live and reliable today; still gate publish on conversion readiness (reuse existing gate). |
| D5 | Booking destination | One booking URL for all food; segment by `food_intent` + `utm_content`, not by URL. |
| D6 | Budget model | Meta campaign-level budget (CBO). Per-window `budget_weight` is guidance/preview + Phase 3 caps, not a hard Phase 1 split. CBO is new build in the Meta client. |
| D7 | Generation cadence | 2 weeks per generation; Phase 3 cron extends weekly. |
| D8 | Manual window control | User can toggle/remove individual windows before publish. |
| D9 | Friday | Treated as weekday regular menu with a later hard stop (19:00). |
| D10 | Last orders | Default to service end − 30 min unless explicitly entered. |
| D11 | Scarcity copy | Never use "limited availability"/scarcity language unless real availability data is supplied (not in v1). |

---

## 4. Scope & phasing

**Phase 1 — Build (MVP).** Campaign kind, types, additive migration, food schedule config + window generator, AI prompt branch + copy validation, publish changes (intra-day start, CBO budget, conversion gate, `BOOK_NOW`), create form + schedule preview with window toggles and warnings. Independently shippable and usable.

**Phase 2 — Measure.** Food insights module: bookings and cost-per-booking segmented by service, decision stage, and window; Sunday roast reported separately. Depends only on Phase 1 + live conversions.

**Phase 3 — Tune.** Dynamic budget weighting, hybrid CBO spend caps, weekly auto-materialisation cron (QStash), creative-fatigue warnings, cutoff tuning from booking data. Mechanism ships with safe defaults; calibration follows data.

Each phase is its own PR set with its own verification pipeline run.

---

## 5. Architecture overview

```
Brief form (food fields, prefilled hours)
        │  source_snapshot.foodSchedule
        ▼
calculateFoodBookingPhases(brief, weeks=2)      ← src/lib/campaigns/food-booking-phases.ts
        │  FoodAdWindow[]  (service, stage, local start/end, weight, copyIntent)
        ▼
ad_set rows  (phase_start, ads_start_time, ads_stop_time, service_key, decision_stage, budget_weight)
        │
        ├─ generateCampaign() food branch  → ad copy + utm_content per window   ← src/lib/campaigns/generate.ts
        ├─ validateCampaignCopy() food rules                                     ← src/lib/campaigns/quality-score.ts
        ▼
Schedule preview (toggles + warnings)            ← src/features/campaigns/FoodBookingSchedulePreview.tsx
        │  publish
        ▼
publish action: conversion gate → Meta campaign (CBO lifetime budget)           ← src/app/(app)/campaigns/[id]/actions.ts
                → ad sets (start_time from ads_start_time, end_time from ads_stop_time)  ← src/lib/meta/marketing.ts
                → ads (BOOK_NOW) + central tracking links                        ← src/lib/campaigns/management-tracking.ts
        ▼
Conversions  /api/booking-conversions  (bookingType:'table', foodIntent)         ← already supports both
        ▼
Phase 2 insights (segment by service/stage/window)  → Phase 3 optimiser (weights, materialisation cron)
```

---

## 6. Data model & migration

### 6.1 Columns (additive only)
New migration `supabase/migrations/<timestamp>_food_booking_ad_set_fields.sql`:

```sql
alter table public.ad_sets
  add column if not exists ads_start_time text,      -- 'HH:MM' London-local; mirrors ads_stop_time
  add column if not exists service_key text,         -- FoodServiceKey
  add column if not exists decision_stage text,      -- FoodDecisionStage
  add column if not exists budget_weight numeric;    -- 0..100 guidance weight
```

- All nullable → existing `event`/`evergreen` campaigns and the current publish path are unaffected.
- **No** `phase_start_at`/`phase_end_at` (D3). We reuse `phase_start` (date) + `ads_start_time` + `ads_stop_time`.
- No new tables; the food schedule lives in `meta_campaigns.source_snapshot` (existing jsonb).

### 6.2 Safety
- Additive, idempotent (`if not exists`), no drops/renames → zero-downtime, reversible (rollback = ignore columns; optional down-migration drops them).
- RLS: new columns inherit existing `ad_sets` policies; **no policy change**. Verify `ad_sets` has account-scoped RLS before merge.
- No PII added. No function/trigger references these columns, so the drop-audit rule in `.claude/rules/supabase.md` is satisfied.

---

## 7. Types

In `src/types/campaigns.ts` (camelCase, `fromDb<T>` continues to map snake_case):

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
  startsAtLocal: string;          // 'HH:MM'
  endsAtLocal: string;            // 'HH:MM'
  serviceDateOffsetDays: number;  // 0 = same day, 1 = tomorrow, etc.
  budgetWeight: number;           // guidance only in Phase 1
  copyIntent: string;
  enabled: boolean;               // user toggle (D8)
}

export interface FoodBookingBrief {
  services: FoodServiceHours[];
  bookingUrl: string;
  foodHooks: string[];            // proof points / hero dishes for AI context
  weeks: 1 | 2 | 4;               // default 2
  dayWeighting: 'even' | 'boost_quiet' | 'manual';
  manualDayWeights?: Partial<Record<RunDay, number>>;
}
```

`AdSet` interface gains optional `adsStartTime`, `serviceKey`, `decisionStage`, `budgetWeight`.

---

## 8. Food schedule config & window generation (engine)

### 8.1 Default schedule + templates
New `src/lib/campaigns/food-schedule.ts` holds the source-of-truth constants (from the design doc), exported as typed objects:

- **Default service hours** — weekday dinner Tue–Fri 16:00–21:00; Saturday 12:00–19:00; Sunday roast 13:00–18:00 (last orders 17:30).
- **Decision-stage window templates** per service (start/end + weight + copy intent), e.g. weekday `lunch_decision` 11:00–13:30 (55), `afternoon_commit` 15:00–17:15 (35), `last_minute` 17:15–18:30 (10).
- **Hard cutoffs** — weekday 18:30 (Friday 19:00); Saturday 17:30; Sunday roast 16:00–16:30.
- **Service budget guidance** — Sunday roast 45–55%, weekday 30–40%, Saturday 15–25%.

The form prefills from these; the user can edit hours and toggle services (D2).

### 8.2 Generator
New `src/lib/campaigns/food-booking-phases.ts`:

```ts
export function calculateFoodBookingPhases(
  brief: FoodBookingBrief,
  campaignStartDate: string,
): FoodAdWindow[]
```

- Expands each enabled service across `weeks` into dated windows using the decision-stage templates, clamped to the service hours and hard cutoffs.
- Computes London-local `startsAtLocal`/`endsAtLocal` and the real service date via `serviceDateOffsetDays`.
- Carries `budgetWeight` and `copyIntent`; sets `enabled: true`.
- **DST-safe**: all local→UTC conversion goes through existing `src/lib/campaigns/time-utils.ts` (Luxon, Europe/London). The generator emits local HH:MM + dates only; UTC is resolved at publish.
- Pure and deterministic (no `Date.now()` inside) → unit-testable with fixed inputs.

### 8.3 Window count — leaner default (risk mitigation)
The doc's full model is ~13 windows/week (~26 per fortnight). Under conversion optimisation, Meta needs ~50 optimisation events per ad set per week to exit the learning phase — unachievable for many tiny windows at a typical pub budget. Therefore:

- **Phase 1 default = lean window set**: the lowest-weight rescue windows (weekday `last_minute` 10%, Saturday `saturday_final_nudge` 10%) are still generated but **disabled by default** (`enabled: false`); all other windows are on. Sunday `last_tables` stays on (roast is the hero).
- The full window set is one toggle away (D8). A **budget-adequacy warning** (see §15, §19.3) shows when `budget ÷ active windows` falls below Meta's minimum-derived threshold.
- We do **not** silently drop windows — every window appears in the preview with its on/off state.

---

## 9. AI generation & copy rules

In `src/lib/campaigns/generate.ts`, add a `food_booking` branch alongside the existing `event`/`evergreen` branching:

- **Per-window generation**: one creative per ad set; supply window context (service name, service date, service hours, last orders if Sunday day-of, decision stage, copy intent, food hooks, venue name/location, booking URL).
- **Forced fields**: CTA `BOOK_NOW`; objective `OUTCOME_SALES` / optimisation `OFFSITE_CONVERSIONS` are already applied at publish when conversion setup exists (reused, not re-implemented).
- Reuse the existing `requireBookingIntent`/`requireBookNow` validation options (currently event-only) for `food_booking`.

---

## 10. Validation / quality-score rules

Extend `src/lib/campaigns/quality-score.ts` `validateCampaignCopy` with `campaignKind === 'food_booking'` rules (hard = blocks generation/publish; soft = warning):

**Hard:**
- Must contain booking intent (book / reserve / table / booking).
- CTA must be `BOOK_NOW`.
- No raw URLs.
- Sunday roast copy must not say "tonight"; must not mention last orders **except** Sunday day-of windows.
- Weekday/Saturday copy must not mention Sunday roast (unless an intentional cross-sell window).
- Banned generic phrases (reuse existing list: "don't miss out", "amazing", "exciting", etc.).

**Soft:**
- Encourage service-hours mention ("served 4pm–9pm") and after-work/"tonight" (same-day only) framing.

Violations surface through the existing critical→`blocked` / warning→`needs_attention` mechanism.

---

## 11. Publish flow changes

In `src/app/(app)/campaigns/[id]/actions.ts` and `src/lib/meta/marketing.ts`:

1. **Intra-day start.** Add `resolveAdSetStartTime(adSet, campaign)` mirroring the existing `resolveAdSetEndTime`: when `ads_start_time` is present, start = `toLondonDateTime(phase_start, ads_start_time)`; otherwise fall back to the current `toMidnightLondon(...)` (backward compatible for event/evergreen).
2. **CBO budget (new).** Extend `createMetaCampaign` to accept an optional campaign-level budget + budget-sharing flag. For `food_booking`: set one campaign **lifetime** budget across the flight, `is_adset_budget_sharing_enabled: true`, and **skip** per-ad-set budgets (`allocateAdSetBudgets` not applied for this kind). Lifetime suits short scheduled windows and satisfies Meta's "lifetime requires end_time" rule (the flight has an end).
3. **CTA.** Extend the existing event-only `BOOK_NOW` force to include `food_booking` (Meta normalises `BOOK_NOW`→`BOOK_TRAVEL` internally — unchanged).
4. **Conversion gate (reuse).** Extend `shouldRequireBookingConversionSetup` to include `food_booking`, so `validateBookingConversionPreflight` blocks publish until `conversion-readiness.ts` reports ready (enabled + pixel + Purchase event). No new gate code.
5. **Preflight additions.** Budget-adequacy check (§15) and "window ends after service/last orders" check run before publish.
6. **Cache + audit.** `revalidatePath` the campaigns list and the campaign detail route after publish; `logAuditEvent` on create/publish/materialise (existing pattern). Structured Axiom logs at generate/publish/materialise boundaries.

`budget_weight` is persisted on ad sets for preview + Phase 3 but is **not** sent to Meta in Phase 1 (D6).

---

## 12. Tracking & attribution

- **One booking URL** (D5). Each window gets a unique `utm_content` (existing quality rule already enforces uniqueness) via the central tracking links in `src/lib/campaigns/management-tracking.ts`.
- `/api/booking-conversions` already accepts `bookingType: 'table'` + `foodIntent` and forwards to Meta CAPI — **no endpoint change**.
- **Attribution by service is derived, not dependent on the external booking site**: Phase 2 joins `utm_content` → ad set → `service_key`/`decision_stage`. If the booking site also sends `foodIntent`, we use it as a cross-check, but reporting does not require it.
- Attribution fields used: `utm_campaign` (parent slug), `utm_content` (window key), `short_code`, `booking_type='table'`, `food_intent` (best-effort).

---

## 13. UX (Phase 1)

### 13.1 Create form — `src/features/campaigns/CampaignBriefForm.tsx`
- Add `Food Booking` to the kind selector (currently a 2-option event/evergreen toggle).
- Conditional `food_booking` fields: service pickers (weekday/Saturday/Sunday) each with prefilled days + hours + last orders; booking URL; food hooks; budget + budget type; weeks (default 2); day-weighting choice (`even` / `boost_quiet` / `manual`).
- React Hook Form + Zod; inline errors; disabled/loading on submit; no double-submit (per `ui-patterns.md`).

### 13.2 Schedule preview — new `src/features/campaigns/FoodBookingSchedulePreview.tsx`
- Table: window | local start–end | service | decision stage | weight | copy intent | **on/off toggle** (D8).
- **Warnings** (colour + icon + text, not colour alone): window runs past the service/last-orders cutoff; conversion tracking not ready; budget-adequacy below threshold.
- Loading / empty / error states (per `ui-patterns.md`); proper table semantics (`<thead>`, `<th scope>`); keyboard-operable toggles with `aria-label`.

### 13.3 Campaign tree — `src/features/campaigns/CampaignTree.tsx`
- Show service, decision stage, and local start–end on each food ad set; otherwise unchanged.

Design tokens only; responsive (`sm:`/`md:`/`lg:`).

---

## 14. Phase 2 — measurement

- New `src/lib/campaigns/food-booking-insights.ts` (or broaden `event-booking-insights.ts`): query `booking_type='table'` conversions, segment by service/decision stage/window (via the `utm_content`→ad-set join), report **cost per table booking**, best service-day window, and **Sunday roast separately** from regular menu.
- Surface a `foodBookingInsights` block in `src/lib/campaigns/dashboard.ts`'s `CampaignDashboardModel`.
- Empty/loading/error states for the dashboard panels.

---

## 15. Phase 3 — optimisation

- **Dynamic weighting** in `src/lib/campaigns/optimisation.ts`: `weight = service_priority × day_need × phase_urgency × booking_gap` (booking_gap from first-party table bookings; safe default 1.0 when data is thin).
- **Hybrid CBO caps**: translate weights into per-ad-set min/max spend limits under CBO (the controlled-allocation upgrade flagged in D6).
- **Weekly materialisation cron** (QStash, per project constraint — not Vercel Cron): materialise the next week of windows for active rolling food campaigns. **Idempotent** (skip periods already materialised; unique per campaign+window+date), authenticated via `CRON_SECRET`, retry-safe through QStash backoff, structured Axiom logs. Well within the platform function timeout.
- **Creative-fatigue warnings** and **cutoff tuning** from booking data (advisory; no silent auto-changes).

---

## 16. Deployment safety & rollout

- **Migration**: additive/idempotent/reversible (§6.2); run `npx supabase db push --dry-run` first.
- **Feature flag**: gate the `food_booking` option (env-driven, validated in `src/env.ts`) so it can ship dark and be enabled per environment.
- **Backward compatibility**: every change is behind `kind === 'food_booking'` or `ads_start_time != null`; event/evergreen publish paths are byte-for-byte unchanged when those are null.
- **Cache scoping**: `revalidatePath` only the campaigns list + affected campaign detail route on create/publish/materialise — no broad invalidation.
- **Observability**: Axiom structured logs at generate/publish/materialise; `redactId` for IDs.
- **Rollback**: disable the flag (instant); columns are inert if unused; optional down-migration drops the four columns.

---

## 17. Testing plan (Vitest; mock Meta/OpenAI/Supabase)

**Phase 1**
- `tests/lib/campaigns/food-booking-phases.test.ts`: Tue–Fri windows with correct London-local times; weekday stop 18:30 / Friday 19:00; Saturday windows; Sunday Fri/Sat/Sun windows; Sunday stop before last orders; **DST (GMT↔BST) correctness**; lean-default vs full-window toggle.
- `tests/lib/campaigns/generate.test.ts`: food branch produces per-window copy with required context; honours forced CTA.
- `tests/lib/campaigns/quality-score.test.ts`: fails missing booking language; fails non-`BOOK_NOW` CTA; fails Sunday "tonight"; fails last-orders outside Sunday day-of; fails weekday roast mention.
- `tests/lib/campaigns/publish.test.ts`: uses `ads_start_time` for Meta `start_time`; sets CBO campaign lifetime budget + budget sharing; skips per-ad-set budgets for food; requires conversion setup; `BOOK_NOW`; budget-adequacy preflight blocks when too low.

**Phase 2**
- `tests/lib/campaigns/food-booking-insights.test.ts`: attributes `booking_type='table'`; segments by service/stage/window via `utm_content` join; roast reported separately.

**Phase 3**
- `tests/lib/campaigns/optimisation.test.ts`: weight formula; hybrid caps; materialisation idempotency (no duplicate windows on re-run).

Each PR must pass `npm run ci:verify` (lint → typecheck → test → build) with zero warnings.

---

## 18. Build sequence (PR breakdown)

| PR | Title | Phase | Complexity |
|----|-------|------:|-----------:|
| 1 | Migration + types + food-schedule constants | 1 | M (3) |
| 2 | `calculateFoodBookingPhases` generator + tests | 1 | M (3) |
| 3 | AI food branch + copy validation + tests | 1 | M (3) |
| 4 | Publish: intra-day start + CBO budget + conversion gate + tests | 1 | L (4) |
| 5 | Create form + schedule preview + campaign tree | 1 | L (4) |
| 6 | Food insights + dashboard panel + tests | 2 | M (3) |
| 7 | Dynamic weighting + hybrid caps + tests | 3 | M (3) |
| 8 | Weekly materialisation cron (QStash) + tests | 3 | M (3) |

PRs 1→5 land Phase 1 (each independently deployable behind the flag); 6 = Phase 2; 7–8 = Phase 3. Target 300–500 lines each.

---

## 19. Key risks & things to validate live

1. **Learning phase vs many windows** (primary): conversion-optimised ad sets need ~50 events/week each; many tiny windows will stay learning-limited at low budget. Mitigated by the lean default + budget-adequacy warning (§8.3, §15); **validate with a real low-budget test** before recommending the full 13-window model.
2. **CBO + many short ad sets**: Meta may concentrate spend; keep ad-set count modest and monitor distribution in the first live flights.
3. **Meta minimum budgets**: validate the campaign budget against Meta's current minimums × active days at preflight (figures vary — check live, don't hardcode).
4. **DST transitions**: covered by tests, but spot-check a flight spanning a clock change.
5. **`utm_content` uniqueness across many windows**: existing quality rule enforces it; confirm it holds at ~26 windows/fortnight.

---

## 20. Open items

- Confirm `ad_sets` has account-scoped RLS (assumed; verify before PR 1).
- Confirm Meta API version in use supports the CBO fields as written (verify in `src/lib/meta` when implementing PR 4).
- Day-weighting numbers for `boost_quiet` (Tue/Wed emphasis) — start from the doc's 32/28/22/18 split; tune in Phase 3.
