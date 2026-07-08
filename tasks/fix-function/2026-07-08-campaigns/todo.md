# Campaigns Remediation — Todo

## Done (verified, pipeline green)
- [x] FF-001 — /campaigns/[id] blends first-party bookings (reported bug)
- [x] FF-002 — dashboard buttons surface server-action errors
- [x] FF-003 — booking-conversion ingest secret constant-time compare
- [x] FF-004 — optimiser nightly dedup key (low_ctr/high_cpc)
- [x] FF-005 — blend regression test (dashboard.test.ts)
- [x] FF-006 — conversion rate clamped to 100%
- [x] FF-007 — CAPI status update guarded against retry regression
- [x] FF-008 — food-booking startDate validation
- [x] FF-009 — cron routes fail with 500 on total failure
- [x] FF-010 — remove phantom campaign_type/auto_confirm columns
- [x] FF-011 — campaigns error boundary
- [x] lint / typecheck / test (1697) / build all pass

## Risky batch — approved (all clusters) and implemented, pipeline green
- [x] A. Publishing reliability — R1 creative reuse on resume; R11 creatives excluded from rollback pause loop
- [x] B. Attribution accuracy — R9 single-owner event dedup; R5/R8 suppress pause when campaign has unattributed first-party bookings; detail page (getCampaignWithTree) now dedups against all account campaigns for list/detail consistency
- [x] C. Food budget weighting — R2/R7 normalise weights via withNormalisedBudgetWeights (create + materialise); R6 pence-consistent budget allocation with reserved minimums
- [x] D. RecurringControls — removed dead feature (component + actions file deleted, page block removed)
- [x] E. Ingest hygiene — R10 reject future / clamp stale occurredAt into Meta's CAPI window
- [x] Tests added: optimisation.test.ts (R9/R5), food-budget-weighting.test.ts (R2/R7), dashboard.test.ts (FF-001)
- [x] lint / typecheck / test (1706) / build all pass

## Git state (needs owner action)
- A parallel commit `6ca970d` (not made by me) captured wave-1 + part of wave-2, plus the owner's own retry-CAPI changes.
- **That commit is INCOMPLETE**: cluster B (R9/R5/R8) and the B5 consistency fix are still UNCOMMITTED, plus 2 new test files (untracked).
- Uncommitted: `src/app/(app)/campaigns/actions.ts`, `src/lib/campaigns/optimisation.ts`, `src/lib/campaigns/optimisation.test.ts`, `src/lib/campaigns/food-budget-weighting.test.ts`.
- Recommend committing these to complete the approved remediation before any deploy.
