# Adversarial Review: Food Booking Phase 1 (core logic)

**Date:** 2026-06-08
**Mode:** B (code review) + C (spec compliance)
**Scope:** logic diff of `feat/food-booking-campaign` vs `main` (UI excluded — separately tested)
**Pack:** tasks/codex-qa-review/2026-06-08-food-booking-logic-review-pack.md
**Reviewers:** Assumption Breaker, Workflow & Failure-Path, Spec Trace Auditor (Codex/OpenAI)

## Executive Summary
The feature is well-structured and reuses the existing conversion gate, CTA forcing, additive-migration, and midnight-fallback patterns correctly. However, three independent reviewers converged on **three publish-blocking defects** and several spec-compliance gaps. As written, a normal multi-window food campaign would **fail to publish** (duplicate `utm_content`) and, even past that, **fail Meta campaign creation** (lifetime budget without an `end_time`). User-edited service hours are also silently ignored.

## What Appears Solid (do not rewrite)
- Conversion gate reuse for `food_booking` (`[id]/actions.ts` `shouldRequireBookingConversionSetup`).
- `BOOK_NOW` forced consistently in generation + publish.
- Additive, nullable migration; `ad_sets` RLS inherited.
- `resolveAdSetStartTime` falls back to London midnight → event/evergreen unchanged (no regression).
- Server-side feature gating of `createFoodBookingCampaign` behind `featureFlags.foodBooking`.
- Friday 19:00 hard stop; per-window budget skipped (budget kept on campaign).

## Critical Risks (blocking)
1. **CR-1 — Duplicate `utm_content` ⇒ unpublishable** (`actions.ts:1178`). Each ad gets `utm_content_key = window.windowKey`, but the same `windowKey` repeats across run-dates. `duplicate_ad_utm` is critical and publish preflight requires uniqueness. *Confirmed by all 3 reviewers + manual trace.* Fix: make it unique per occurrence (`windowKey + runDate`); keep `service_key`/`decision_stage` on the ad set for Phase-2 segmentation.
2. **CR-2 — Lifetime CBO budget without campaign `end_time`** (`[id]/actions.ts:766`, `marketing.ts:217`). Food always sends a campaign lifetime budget (even when `budget_type='DAILY'`) and no `end_time`; Meta requires `end_time` for lifetime budgets. Fix: respect `budget_type` at campaign level under CBO, and when lifetime, set a campaign `end_time` from the flight end (last enabled window's run date + 1 day).
3. **CR-3 — User-edited service hours ignored** (`food-booking-phases.ts:51`, `generate.ts:598`). The generator and copy use `DECISION_STAGE_TEMPLATES`/`DEFAULT_FOOD_SERVICE_HOURS`, never the brief's `startLocal`/`endLocal`/`lastOrdersLocal`. Violates D2/D10 — ads can state wrong times for any venue not on the default schedule. Fix: thread `brief.services` into copy context and into the generator's end-clamping.

## Spec Defects / Implementation Defects
- **D11 scarcity copy** (`food-schedule.ts:43,46`): default `copyIntent`s seed scarcity ("before the weekend fills", "while tables remain"). Reword to neutral booking language.
- **source_snapshot loses the brief** (`actions.ts:1064`): only derived enabled windows are stored, not the original brief/overrides — Phase 3 auto-materialisation will need them. Store the full brief + `windowOverrides`.
- **`lastOrdersOrDefault` day-wrap** (`food-schedule.ts:68`): subtracts 30 min with no guard; malformed for services ending before 00:30 (custom hours only). Add a clamp.

## Design Decisions (for the user — not unilaterally changed)
- **windowOverrides granularity** (`SPEC-002`): toggles key by `windowKey`, so turning a window off drops all its date-occurrences. The preview groups by `windowKey`, so UI↔backend are consistent — but D8 ("individual windows") could mean per-date. Recommend: keep window-type granularity for v1.
- **weeks 1/2/4 vs D7** (`AB-006`/`SPEC-006`): schema allows 1/2/4 (default 2), matching spec §7's type; D7's "2 weeks" reads as the default. Recommend: keep, clarify spec wording.
- **budget_type**: spec §11 preferred lifetime; fix CR-2 respects the user's `budget_type` instead. Recommend confirm.

## Workflow / Failure-Path
- **Partial draft on create failure** (`actions.ts:1108`, `WF-001`): campaign inserted, then ad-set/ad inserts loop with no transaction/cleanup → orphaned partial drafts on mid-loop failure. Appears to match the existing non-food create pattern (pre-existing), and publish preflight (≥1 ad/set) would block a broken draft. Recommend a transactional/RPC create as a separate hardening task.

## Recommended Fix Order
1. CR-1 utm_content uniqueness (unblocks publish + attribution).
2. CR-2 CBO end_time + budget_type (unblocks Meta create).
3. CR-3 service hours → copy + generator.
4. D11 reword; store brief in snapshot; lastOrders guard.
5. Re-run `ci:verify`; re-review CR-1/CR-2.

## Minor Observations
- `food_intent` is not emitted as a URL param; Phase 2 is specced to derive service via `utm_content`→ad-set join, which needs CR-1 fixed first. No Phase-1 action.
