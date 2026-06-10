# Claude Hand-Off Brief: Food Booking Phase 1

**Generated:** 2026-06-08
**Review mode:** B + C (Codex)
**Overall risk:** High (3 publish-blocking defects; feature not shippable until CR-1/CR-2 fixed)

## DO NOT REWRITE
- Conversion gate reuse, `BOOK_NOW` forcing, additive migration, `resolveAdSetStartTime` midnight fallback, server-side feature flag gating, Friday 19:00 hard stop, per-window budget skipped. All correct.

## IMPLEMENTATION CHANGES REQUIRED (blocking)
- [ ] **CR-1 utm_content uniqueness** — `src/app/(app)/campaigns/actions.ts:~1178`: set `utm_content_key` to a per-occurrence key (e.g. `` `${window.windowKey}-${window.runDate}` ``). Keep `service_key`/`decision_stage` on the ad set. Add a create test asserting all ads across the campaign have distinct `utm_content_key`.
- [ ] **CR-2 CBO end_time + budget_type** — `src/app/(app)/campaigns/[id]/actions.ts:~766` + `src/lib/meta/marketing.ts`: under CBO, send the budget field matching `campaign.budget_type` at campaign level (`daily_budget` for DAILY, `lifetime_budget` for LIFETIME). When lifetime, pass a campaign `endTime` (flight end = last enabled ad set's `phase_end`/run date + 1 day, London→UTC). Extend `CreateCampaignParams` with an optional campaign `endTime`/`stopTime` and emit `end_time`. Add a test: lifetime CBO body includes `end_time`; daily CBO body uses `daily_budget` and no campaign `end_time`.
- [ ] **CR-3 service hours honoured** — `src/lib/campaigns/food-booking-phases.ts` + `src/lib/campaigns/generate.ts`: pass `brief.services` into `calculateFoodBookingPhases` usage and into `formatFoodWindowsForPrompt`. Generator: clamp each window end to `min(templateEnd, hardStop, lastOrdersOrDefault(service))` so user-shortened hours pull cutoffs in (keep strategic decision-window START times). Copy: compute service hours + last orders from the brief's `FoodServiceHours`, not `DEFAULT_FOOD_SERVICE_HOURS`. Add tests with custom hours (e.g. roast 12:00–16:00, last orders 15:30).

## IMPLEMENTATION CHANGES REQUIRED (should-fix, cheap)
- [ ] **D11 reword** — `src/lib/campaigns/food-schedule.ts:43,46`: replace scarcity `copyIntent`s ("before the weekend fills", "while tables remain") with neutral booking language ("Book Sunday roast for this weekend", "Book your table for Sunday roast"). Optionally add a scarcity-phrase check to the food copy validator.
- [ ] **Store brief in snapshot** — `src/app/(app)/campaigns/actions.ts:~1064`: add `brief` and `windowOverrides` to `source_snapshot` (Phase 3 materialisation needs them).
- [ ] **lastOrders guard** — `src/lib/campaigns/food-schedule.ts:~68`: clamp/guard so `lastOrdersOrDefault` never returns a negative/invalid `HH:MM`.

## ASSUMPTIONS TO RESOLVE (ask the user)
- [ ] windowOverrides granularity: window-type (current) vs per-date. Recommend window-type for v1.
- [ ] weeks: keep 1/2/4 (default 2) vs force 2. Recommend keep + clarify spec.
- [ ] budget_type: respect user choice (this fix) vs force lifetime per spec §11. Recommend respect choice.

## REPO CONVENTIONS TO PRESERVE
- No `logAuditEvent` (does not exist in repo). `revalidatePath` after mutations. `fromDb`/snake_case mapping. Named exports, explicit return types, no `any`. Reuse existing banned-phrase/booking-intent lists.

## RE-REVIEW REQUIRED AFTER FIXES
- [ ] CR-1: re-confirm campaign-wide `utm_content` uniqueness across a 2-week multi-window campaign.
- [ ] CR-2: re-confirm lifetime CBO body has `end_time`; daily path correct.

## REVISION PROMPT
"On branch feat/food-booking-campaign, fix the Codex-confirmed defects in this order: CR-1 (unique utm_content per window occurrence), CR-2 (CBO budget respects budget_type + lifetime sets campaign end_time), CR-3 (generator + copy honour the brief's service hours), then reword scarcity copyIntents (D11), store the brief+overrides in source_snapshot, and guard lastOrdersOrDefault. TDD each, keep event/evergreen unchanged, do not stage actions-ads.ts, keep ci:verify green, commit per fix with the Co-Authored-By trailer."
