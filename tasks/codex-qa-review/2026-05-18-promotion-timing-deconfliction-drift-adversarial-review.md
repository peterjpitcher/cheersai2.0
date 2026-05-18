# Adversarial Review: Promotion Timing & Deconfliction Drift Fix

**Date:** 2026-05-18
**Mode:** B (Code Review)
**Scope:** `src/lib/create/service.ts`, `tests/lib/create/service.test.ts` — 3 commits (4fce3d4, e20e985, ee687f4)
**Pack:** `tasks/codex-qa-review/2026-05-18-promotion-timing-deconfliction-drift-review-pack.md`

## Executive Summary

Three Codex reviewers (Assumption Breaker, Integration & Architecture, Workflow & Failure-Path) examined the promotion timing rewrite and post-deconfliction timing refresh. The implementation is sound for the stated product constraint (Europe/London only). All three reviewers independently flagged the same timezone concern — `DEFAULT_TIMEZONE` in timing helpers vs `posting.timezone` in deconfliction — which is a real architectural gap but intentionally out of scope per the spec. One reviewer flagged a potential data leak of `timing` metadata to Supabase, which is a false positive (the insert path explicitly whitelists columns).

**Overall assessment:** No blocking defects. One advisory item for future work.

## What Appears Solid

- Promotion end dates correctly treated as effective through end-of-day via `getPromotionEffectiveEnd` (confirmed by same-day and 23:30 tests)
- `timing` metadata kept in-memory only on `VariantPlan` — never persisted to DB (verified: `createCampaignFromPlans` whitelists insert columns explicitly at lines 1609-1624)
- Post-deconfliction refresh applied only for auto-scheduled campaigns; manual schedules untouched
- `replaceGeneratedFocusLine` replaces the last Focus line (not first), preserving user-supplied focus text
- Calendar-day arithmetic via `calendarDayDiff` instead of elapsed-hour division

## Implementation Defects

None found.

## Workflow & Failure-Path Defects

### WF-001 — `timing` metadata DB leak (FALSE POSITIVE)

**Severity:** N/A — dismissed after verification
**Flagged by:** Workflow & Failure-Path reviewer

All three reviewers assumed `timing` might leak to the database. Verified false: `createCampaignFromPlans` at line 1607-1624 maps `variants` (output of `buildVariants()`) to explicit column objects. The `timing` field lives on `VariantPlan` (the input to `buildVariants`), not on the output variant type. It never reaches the insert payload.

### WF-003 — Plan `title` not refreshed after deconfliction (NON-ISSUE)

**Severity:** Low
**Flagged by:** Workflow & Failure-Path reviewer

Plan titles ("Launch", "Build momentum", "Last chance") are phase labels, not timing-dependent copy. They describe the campaign phase, not the calendar relationship. Refreshing them would be misleading — a "Last chance" phase shifted one day earlier is still the last-chance phase.

## Architecture & Integration Defects

### ARCH-001 / AB-001 / WF-002 — Timezone contract split (ADVISORY)

**Severity:** Medium | **Confidence:** High (3/3 reviewers agree) | **Blocking:** No

`describePromotionTimingCue`, `getPromotionEndDay`, and `describeEventTimingCue` all use `DEFAULT_TIMEZONE` (Europe/London), while `deconflictCampaignPlans` receives `posting.timezone`. For accounts with a non-London posting timezone, a deconfliction shift across a local midnight could produce a stale timing cue.

**Why this is advisory, not blocking:**
- The spec explicitly lists "Broad account-timezone propagation beyond the existing `DEFAULT_TIMEZONE` behaviour" as out of scope
- The entire pre-existing timing system (`formatWeekday`, `formatDayMonth`, `resolveStoryScheduledFor`, all engagement-hour optimisation) already hardcodes `DEFAULT_TIMEZONE`
- The product currently only supports UK-based hospitality venues

**Recommended follow-up:** When multi-timezone support is added, thread `posting.timezone` through all timing helpers. Track as a separate task.

## Unproven Assumptions

| # | Assumption | What would confirm/deny |
|---|-----------|------------------------|
| 1 | `posting.timezone` never differs from `DEFAULT_TIMEZONE` in production | Query `SELECT DISTINCT timezone FROM account_posting_preferences` |
| 2 | `startDate` for promotions is already normalised by engagement-hour optimisation downstream | Confirmed: lines 1129-1131 apply `getEngagementOptimisedHour` to all automatic phase slots |

## Minor Observations

- AB-002: `startDate` not normalised like `endDate` — confirmed safe because engagement-time optimisation at lines 1129-1131 adjusts all automatic phase slots to posting hours before persistence.
