# Task: Calendar-aware scheduling for event/promotion campaigns

## Steps
- [x] 1. Export `toDayKey` and `isSameCalendarDay` from spread.ts (needed by deconflict)
- [x] 2. Create `deconflictCampaignPlans()` in a new file `src/lib/scheduling/deconflict.ts`
- [x] 3. Apply engagement-optimised times to `createEventCampaign()` offset scheduling
- [x] 4. Apply engagement-optimised times to `createPromotionCampaign()` phase scheduling
- [x] 5. Call `deconflictCampaignPlans()` after building plans in both campaign types
- [x] 6. Write tests for deconflict + engagement time application
- [x] 7. Run full test suite, lint, typecheck — all green
