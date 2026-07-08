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

## Awaiting owner approval (risky batch — see defect-log.md)
- [ ] A. Publishing reliability — R1 creative reuse on resume, R11 rollback deletes creatives
- [ ] B. Attribution accuracy — R9 multi-campaign inflation, R8 mgmt-fallback value, R5 wrong pause
- [ ] C. Food budget weighting — R2 normalise weights, R7 wire dayWeighting, R6 £1 floor invariant
- [ ] D. RecurringControls — remove dead feature (or build recurring paid campaigns)
- [ ] E. Ingest hygiene — R10 clamp/reject stale/future occurredAt
