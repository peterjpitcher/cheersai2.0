# Task: Calendar-aware scheduling for event/promotion campaigns

## Steps
- [x] 1. Export `toDayKey` and `isSameCalendarDay` from spread.ts (needed by deconflict)
- [x] 2. Create `deconflictCampaignPlans()` in a new file `src/lib/scheduling/deconflict.ts`
- [x] 3. Apply engagement-optimised times to `createEventCampaign()` offset scheduling
- [x] 4. Apply engagement-optimised times to `createPromotionCampaign()` phase scheduling
- [x] 5. Call `deconflictCampaignPlans()` after building plans in both campaign types
- [x] 6. Write tests for deconflict + engagement time application
- [x] 7. Run full test suite, lint, typecheck — all green

---

# Task: Pack A — repair 10 confirmed adversarial-review findings (food auto-spend core)

Branch: feat/food-booking-campaign. Regression test per fix, ci:verify green, dry-run-only migration.

## Steps
- [x] F9: clamp maxBudget >= minBudget in computeAdSetSpendCaps + test
- [x] F10: gate cap computation on the CBO condition in publishCampaign + test
- [x] F1: worker kill-switch check (flag off => 200 skipped, no DB/Meta) + test
- [x] F8: cron 500 on total dispatch failure (partial stays 200) + tests
- [x] Test-fake upgrade: stateful ad_sets/ads updates + deletes + error injection (keeps existing tests green)
- [x] F4: conversion-gate re-check before any creation; never fall back + tests
- [x] F6: derive existing service dates from ad-set rows via DECISION_STAGE_TEMPLATES; drop horizon + test
- [x] F3: check every post-Meta DB write; throw on error + tests
- [x] F5: only activate ad sets with >=1 ad; else PAUSED + skippedNoMedia + test
- [x] F2: completeness rule (meta_adset_id AND >=1 ad); cleanup + recreate incomplete target windows + tests
- [x] F7: partial unique index migration + 23505 graceful skip + test
- [x] ci:verify green + db push --dry-run shows pending + commits

## Assumptions
- F1 "audit-log a skip": the worker payload has no accountId and the acceptance test forbids DB calls when the flag is off, so the skip is recorded via structured logger only (mirrors the cron flag-off pure no-op contract).
- F5 leaves the already-created Meta ad set PAUSED (creation order is DB row -> Meta ad set -> ads), matching "leave PAUSED locally+Meta".
