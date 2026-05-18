# Claude Hand-Off Brief: Promotion Timing & Deconfliction Drift Fix

**Generated:** 2026-05-18
**Review mode:** B (Code Review)
**Overall risk:** Low

## DO NOT REWRITE

- `getPromotionEndDay()` / `getPromotionEffectiveEnd()` — correct end-of-day semantics
- `describePromotionTimingCue()` — calendar-day logic with proper cue buckets
- `VariantTimingContext` discriminated union — clean in-memory-only metadata
- `replaceGeneratedFocusLine()` — last-line replacement logic is correct
- `refreshTimingForPlan()` / `refreshTimingAfterScheduleChanges()` — post-deconfliction refresh is well-placed
- Auto promotion phase date fix using `effectiveEnd` — correct
- All 10 promotion cue tests, 3 focus-line tests, 7 refresh tests, 1 phase-date regression, 1 service-level deconfliction test

## SPEC REVISION REQUIRED

None.

## IMPLEMENTATION CHANGES REQUIRED

None. All findings were dismissed as false positives, non-issues, or intentionally out-of-scope.

## ASSUMPTIONS TO RESOLVE

- [ ] **Timezone scope**: Verify `posting.timezone` never differs from `DEFAULT_TIMEZONE` in production via `SELECT DISTINCT timezone FROM account_posting_preferences`. If it can differ, create a follow-up task to thread timezone through timing helpers.

## REPO CONVENTIONS TO PRESERVE

- `DEFAULT_TIMEZONE` usage throughout timing helpers (consistent with rest of codebase)
- `__testables` export pattern for private function testing
- `calendarDayDiff` from `src/lib/scheduling/spread.ts` for calendar-day arithmetic
- Explicit column whitelisting in `createCampaignFromPlans` insert payloads

## RE-REVIEW REQUIRED AFTER FIXES

None — no fixes required.

## REVISION PROMPT

No code revisions needed. The implementation is clean and all reviewer findings were either false positives or intentionally out-of-scope per the spec.
