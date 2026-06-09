# Food Booking — Phase 3 (Optimisation) Spec

**Date:** 2026-06-09
**Status:** Ready for review
**Owner:** Peter Pitcher
**Depends on:** Phase 1 ([spec](./2026-06-08-food-booking-campaign-spec.md), PR #14) merged + live; Phase 2 ([spec](./2026-06-08-food-booking-phase-2-measurement-spec.md)) for the booking signals it tunes against.
**Project:** CheersAI 2.0

---

## 1. Summary

### Plain English
Phase 3 makes food campaigns *self-improving*: it shifts budget toward the services/days/windows that are actually booking tables, keeps the rolling 2-week schedule topped up automatically each week, and warns when an ad has been seen too often and is going stale. Because this spends real money and creates live ads automatically, it ships in **"recommend → dry-run → apply"** stages, gated and idempotent.

### Technical
Five capabilities, each independently shippable: (3a) a pure dynamic-weighting module that computes per-window weights from service priority × day need × phase urgency × booking gap and writes them to the existing `ad_sets.budget_weight`; (3b) hybrid CBO **per-ad-set spend caps** (`min_budget`/`max_budget`) derived from those weights; (3c) a **weekly materialisation cron** (Vercel cron → QStash fan-out) that extends each active rolling food campaign by one week, idempotently; (3d) **creative-fatigue** detection backed by a new `ad_metrics_history` time-series table; (3e) advisory **cutoff tuning** from booking data. Reuses the existing cron-auth, QStash dispatch, and `meta_optimisation_runs/actions` machinery.

---

## 2. Goals / Non-goals

### Goals
- Allocate budget by real demand: weight windows by service priority, quieter-day need, decision-stage urgency, and booking gap.
- Keep the rolling schedule materialised a week ahead without manual regeneration.
- Detect creative fatigue and surface it as an actionable warning.
- Do all of the above **safely**: gated, staged (recommend/dry-run/apply), idempotent, observable.

### Non-goals (Phase 3)
- No fully-autonomous spend with no human gate by default — `apply` mode is opt-in per account.
- No ML/forecasting; weighting is a transparent, explainable formula.
- No change to Phase 1's publish-time behaviour for non-food kinds.

---

## 3. Decisions (assumptions of record)

| # | Decision | Choice |
|---|----------|--------|
| P3-1 | Rollout model | Reuse `meta_optimisation_runs.mode` = `recommend` → `dry_run` → `apply`. Default `recommend`; `apply` is opt-in per account. |
| P3-2 | Weighting | Pure formula `service_priority × day_need × phase_urgency × booking_gap`; `booking_gap` defaults to 1.0 until enough first-party table bookings exist. Output written to existing `ad_sets.budget_weight` (no new column). |
| P3-3 | Budget mechanism | Hybrid CBO: keep one campaign budget (Phase 1) and add per-ad-set `min_budget`/`max_budget` derived from weights (the D6 upgrade). Validate against Meta minimums; never below floor. |
| P3-4 | Materialisation | Vercel cron → enqueue one QStash job per active rolling food campaign (dedup key = `campaign_id + ISO-week`); the worker extends that campaign by one week. Idempotent via existing-ad-set detection (skip `service_date`s already present). No new "materialisation log" table. |
| P3-5 | Creative fatigue | Requires time-series; add `ad_metrics_history` (append-only, per-sync). Flag when frequency ≥ 3 OR CTR drops ≥ 25% week-over-week on sufficient impressions. Surfaced as a new `creative_fatigue` optimisation action (warning, never auto-paused). |
| P3-6 | Cutoff tuning | Advisory only: report which windows convert; recommend cutoff changes. No automatic schedule edits. |
| P3-7 | Gating | New server flag `FOOD_AUTO_MATERIALISE_ENABLED` (validated in `src/env.ts`) gates the cron's *writes*; `featureFlags.foodBooking` still gates the feature. Cron is a no-op when off. |

---

## 4. Architecture

```
Vercel cron (weekly)  → /api/cron/materialise-food-windows         ← verifyCronAuth (CRON_SECRET)
   enumerate active rolling food campaigns (flag on)
        │ dispatchToQStash({ jobId, deduplicationId: `${campaignId}:${isoWeek}` })   ← src/lib/publishing/dispatch.ts pattern
        ▼
/api/webhooks/qstash-food-materialise  (verify QStash signature)   ← src/lib/qstash + qstash-publish pattern
   for the campaign:
     computeFoodWindowWeights(...)            ← NEW src/lib/campaigns/food-budget-weighting.ts (pure, 3a)
     calculateFoodBookingPhases(next week)    ← Phase 1 generator (reused)
     skip service_dates already materialised  ← idempotency (3c)
     create ad sets on Meta with min/max caps ← createMetaAdSet + minBudget/maxBudget (3b)
        │ revalidatePath(campaign) ; logPublishAuditEvent ; Axiom run summary
        ▼
Daily optimiser (existing optimise-meta-campaigns cron)
   + detectCreativeFatigue(...)               ← reads ad_metrics_history (3d) → meta_optimisation_actions('creative_fatigue')
   + cutoffTuningReport(...)                   ← advisory (3e)
performance-sync → also append ad_metrics_history row per ad (3d)
```

---

## 5. Capability specs

### 3a — Dynamic weighting (pure)
- New `src/lib/campaigns/food-budget-weighting.ts`: `computeFoodWindowWeights(input): Map<adSetId, number>` where weight = `SERVICE_BUDGET_GUIDANCE[service] × dayNeed(brief, day) × phaseUrgency(decisionStage) × bookingGap(serviceKey)`.
- `bookingGap` from Phase-2 first-party table bookings vs a per-service target; clamp to [0.5, 2.0]; default 1.0 when bookings < N (cold start).
- Normalise weights to sum 100; write to `ad_sets.budget_weight`. Pure + deterministic → unit-testable.

### 3b — Hybrid CBO spend caps
- Extend `CreateAdSetParams` (marketing.ts:38) with optional `minBudget?`, `maxBudget?`; in `createMetaAdSet` (marketing.ts:327) emit `min_budget`/`max_budget` (minor units, `Math.round(x*100)`) **only when the parent campaign has CBO enabled**.
- Caps derived from `budget_weight`: `target = weight% × campaignBudget`; `min = max(metaFloor, target × 0.5)`, `max = target × 1.5` (tunable). **Preflight** validates `sum(min) ≤ campaignBudget` and each `min ≥ Meta's current minimum` — surface a clear error, don't silently clamp.
- Applied at publish (Phase 1 path) and at materialisation (3c) for food campaigns in `apply` mode.

### 3c — Weekly materialisation cron
- New `src/app/api/cron/materialise-food-windows/route.ts`: `verifyCronAuth`; if `!FOOD_AUTO_MATERIALISE_ENABLED` return `{skipped:true}`; load active rolling food campaigns; for each, `dispatchToQStash` with `deduplicationId = campaign_id:isoWeek`.
- New worker `src/app/api/webhooks/qstash-food-materialise/route.ts`: verify QStash signature; recompute next-week windows; **skip any `service_date` already represented in the campaign's ad sets** (idempotency); create the missing ad sets (with 3b caps); return 500 on failure so QStash retries (5m/15m/45m).
- `vercel.json` cron entry, e.g. `{ "path": "/api/cron/materialise-food-windows", "schedule": "0 1 * * 0" }` (Sun 01:00 UTC).

### 3d — Creative fatigue
- New migration: `ad_metrics_history (id, account_id, ad_id, captured_on date, impressions, clicks, ctr, frequency numeric, spend, created_at)`, unique `(ad_id, captured_on)`; RLS scoped to `account_id` (mirror `ads`/booking-events policies).
- `performance-sync.ts`: after updating the snapshot, **upsert** today's row into `ad_metrics_history` (append-only history).
- `optimisation.ts`: `detectCreativeFatigue(adId)` compares this week vs last (frequency ≥ 3 OR CTR drop ≥ 25% on ≥ MIN_IMPRESSIONS) → record a `creative_fatigue` warning action. **Never auto-pauses.**
- Migration also extends the `meta_optimisation_actions.action_type` CHECK to add `'creative_fatigue'` (and `'budget_adjust'` for 3b/3a audit trail).

### 3e — Cutoff tuning (advisory)
- `cutoffTuningReport(accountId)`: for each service, compare bookings by decision stage to spot windows that convert poorly/late; emit advisory recommendations (e.g., "Sunday `last_tables` converts <2% — consider an earlier hard stop"). Surfaced in the dashboard/optimiser output as info, no automatic change.

---

## 6. Deployment safety

- **Migrations** (3d only): additive — new `ad_metrics_history` table + a CHECK-constraint widening on `meta_optimisation_actions.action_type` (additive, non-destructive). RLS on the new table scoped to `account_id`. 3a/3b/3c need **no** schema change.
- **Outward-facing writes** are the core risk (auto-creating ads, auto-setting budgets). Mitigations: per-account `apply` opt-in (default `recommend`); `FOOD_AUTO_MATERIALISE_ENABLED` server flag gating the cron; **idempotency** (dedup key + existing-ad-set detection) so retries never double-create; per-campaign QStash jobs keep each unit small and within function timeout; QStash retry/backoff + failure callback.
- **Auth**: cron via `verifyCronAuth` (timing-safe `CRON_SECRET`); worker via QStash signature verification — same as the publish pipeline.
- **Cache**: workers `revalidatePath` the affected campaign + list after materialisation; the read-only optimiser does not.
- **Observability**: every run writes a `meta_optimisation_runs` summary + Axiom structured logs (`redactId`); no silent caps — log any window/budget skipped and why.
- **Rollback**: disable the flag (cron no-ops instantly); per-account back to `recommend`; new table/CHECK are inert if unused.

## 7. Testing (Vitest)

- `food-budget-weighting.test.ts`: formula correctness; cold-start default 1.0; normalisation to 100; clamps.
- `marketing.test.ts`: `min_budget`/`max_budget` emitted only under CBO; minor-units; preflight rejects `sum(min) > campaignBudget` and sub-floor mins.
- `food-materialise.test.ts`: cron no-ops when flag off / auth fails; dispatches one dedup'd job per active campaign; worker skips already-materialised `service_date`s (idempotent on re-run); creates only missing ad sets.
- `creative-fatigue.test.ts`: flags frequency/CTR-decline cases; ignores low-impression noise; records `creative_fatigue` action; never pauses.
- `cutoff-tuning.test.ts`: produces advisory items from booking distributions.
- Each PR passes `npm run ci:verify`.

## 8. Build sequence (PRs)

| PR | Title | Migration | Complexity |
|----|-------|:---------:|-----------:|
| 8 | Dynamic weighting module + write `budget_weight` + tests (3a) | No | M (3) |
| 9 | Hybrid CBO `min/max` caps in Meta client + publish + preflight + tests (3b) | No | M (3) |
| 10 | Weekly materialisation cron + QStash worker (idempotent) + flag + tests (3c) | No | L (4) |
| 11 | `ad_metrics_history` + sync append + fatigue detection + CHECK widen + tests (3d) | Yes | L (4) |
| 12 | Cutoff-tuning advisory report + dashboard surfacing (3e) | No | S (2) |

Recommended order 8 → 9 → 10, then 11, then 12. Each is independently deployable; 10's writes stay gated until you flip `apply` per account.

## 9. Risks & things to validate live

1. **Auto-spend safety** (highest): materialisation + budget caps create/alter live ads. Ship in `recommend`/`dry_run` first; only flip an account to `apply` after reviewing a few dry-run summaries.
2. **Meta min/max constraints**: per-ad-set caps under CBO have Meta-side minimums and sum rules — validate at preflight against current limits (don't hardcode); over-tight caps can starve delivery.
3. **Fatigue cold start**: `ad_metrics_history` needs ~2 weeks of data before week-over-week detection is meaningful — until then, detection abstains rather than false-positives.
4. **Booking-gap signal quality**: `booking_gap` is only as good as Phase-2 attribution coverage; keep the cold-start default until volumes are credible.
5. **Cron/worker idempotency**: the existing-ad-set skip is the safety net against double-creation on QStash retries — cover it explicitly in tests.

## 10. Open items (for review)
- Per-service **booking targets** for `booking_gap` (manual per account, or derived from capacity?) — start manual/config, refine later.
- Whether budget caps apply at **publish** (Phase 1 path) too, or only via the weekly cron — recommend both, behind `apply` mode.
- `apply`-mode UX: where the per-account opt-in toggle lives (Settings vs campaign detail).
