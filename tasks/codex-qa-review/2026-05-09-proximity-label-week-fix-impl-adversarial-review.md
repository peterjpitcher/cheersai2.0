# Adversarial Review (Stage 2 — Implementation): proximity-label week-aware fix

**Date:** 2026-05-09
**Mode:** B (Code Review)
**Scope:** 4 commits ahead of `ce23e71` — tests added, parity test, Node fix, Deno fix
**Pack:** `tasks/codex-qa-review/2026-05-09-proximity-label-week-fix-impl-review-pack.md` (45 KB)
**Reviewers run:** Assumption Breaker, Workflow & Failure-Path
**Reviewers skipped:** Security (no auth/data path), Integration & Architecture (no architectural change), Performance (constant-time), Standards (not asked)

## Executive Summary

**Both reviewers returned zero findings.** The implementation matches the revised spec exactly; the bug regression, DST cases, and year-boundary cases are all covered; the Node/Deno copies behave identically across 25 parity fixtures. No blocking issues, no repair agents required.

## What Both Reviewers Endorsed

- Bug regression `Sun 10 May 2026 → Sat 23 May 2026 = SAT 23 MAY` is explicitly tested and the implementation produces it.
- Week-difference logic is identical in both copies ([proximity-label.ts:77](src/lib/scheduling/proximity-label.ts:77) and [banner-label.ts:180](supabase/functions/publish-queue/banner-label.ts:180)).
- DST-shortened (29 Mar 2026) and DST-lengthened (25 Oct 2026) weeks each have 7-day and 13-day fixtures.
- Year-boundary 7-day and 13-day cases are present.
- Post-event short-circuit is preserved in both copies — banners disappear correctly after the event starts.
- Parity test covers events, promotions, weekly campaigns, post-event, DST, and year boundary — drift surface comprehensively monitored.

## Findings

None of either severity. Both findings JSONs returned `"findings": []`.

## Soft Observations (not findings, captured for transparency)

- Assumption Breaker: "remaining risk is mainly that parity is fixture-based rather than mechanically enforcing source equivalence." Not a defect — explicitly acknowledged as "reducing drift risk." This was a deliberate spec decision (mechanical equivalence would over-fit on whitespace and comments and was rejected at spec stage in ARCH-001).

## Recommended Fix Order

None required. Ready to deliver.

## Reviewer Output Files

- [assumption-breaker-impl-findings.json](tasks/codex-qa-review/assumption-breaker-impl-findings.json) — 0 findings
- [workflow-failure-path-impl-findings.json](tasks/codex-qa-review/workflow-failure-path-impl-findings.json) — 0 findings
