# Adversarial Review: proximity-label week-aware fix

**Date:** 2026-05-09
**Mode:** A (Adversarial Challenge)
**Scope:** Spec at `tasks/banner-orchestration/proximity-week-fix/SPEC.md`, plus the two duplicated label implementations (`src/lib/scheduling/proximity-label.ts`, `supabase/functions/publish-queue/banner-label.ts`) and existing tests
**Pack:** `tasks/codex-qa-review/2026-05-09-proximity-label-week-fix-review-pack.md` (58 KB)
**Reviewers run:** Assumption Breaker (lead), Workflow & Failure-Path, Integration & Architecture
**Reviewers skipped:** Security (no auth/data path), Spec Trace (Mode A), Performance (constant-time), Standards (not asked)

---

## Executive Summary

The core week-aware logic is correct and the bug case (Sun → Sat 13 days = `SAT 23 MAY`) is fixed by the proposed rule. **All three reviewers independently converged on the same two gaps:** the spec under-specifies DST-boundary tests, and the proposed parity test for the Node/Deno duplicates is too narrow to actually prevent drift. Two findings are marked blocking. There is also a separate, pre-existing weekly-campaign bug that the reviewers surfaced — not caused by this fix, but worth scoping.

## What Appears Solid

Three findings the reviewers explicitly endorsed (do **not** rewrite these):

1. **0–6 day branch preserved.** Keeping `THIS [WEEKDAY]` for daysDiff 2–6 — including cross-week gaps like Fri → Mon — is architecturally consistent with the existing test at [proximity-label.test.ts:48](tests/lib/scheduling/proximity-label.test.ts:48).
2. **Both implementations targeted.** Spec correctly identifies the canonical [proximity-label.ts:76](src/lib/scheduling/proximity-label.ts:76) AND the Deno duplicate [banner-label.ts:182](supabase/functions/publish-queue/banner-label.ts:182).
3. **Bug case classification is right.** Sun 10 May → Sat 23 May = weekDiff 2 → date format. The proposed rule produces `SAT 23 MAY`, which is unambiguous.

## Critical Risks (blocking)

### ARCH-001 — Drift-prevention test is too narrow (parity, severity High, blocking)

The worker (which **bakes labels into the published PNG**) is a release-critical path, but the spec makes the parity test optional and limits it to `getEventLabel` body equality. Three problems:

- **Comments differ between copies.** The Node copy at [proximity-label.ts:52](src/lib/scheduling/proximity-label.ts:52) and [proximity-label.ts:76](src/lib/scheduling/proximity-label.ts:76) carries inline comments the Deno copy lacks at [banner-label.ts:147](supabase/functions/publish-queue/banner-label.ts:147). Naïve byte-equality (even with whitespace-stripping) will fail immediately.
- **Wrong unit.** The duplicated surface is the whole bundle: `extractCampaignTiming`, `getNextWeeklyOccurrence`, `EVENING_THRESHOLD_HOUR`, `WEEKDAY_NAMES`, `MONTH_SHORT`, `getEventLabel`, `getPromotionLabel`, `getProximityLabel`. Diffing one function leaves the rest free to drift.
- **Optional in spec.** Q3 in the spec leaves it as a sign-off question. ARCH-001 promotes it to a required acceptance criterion.

**Fix:** require a behavioural parity test (not byte-equality). Exercise both exported `getProximityLabel` implementations against a shared fixture table (event + weekly + promotion cases, including the new bug regression and DST cases). Asserting `nodeImpl(input) === denoImpl(input)` for ~30 fixtures would catch any drift in any duplicated function.

### ARCH-002 / WF-002 — DST-boundary tests not required (severity Medium → blocking)

`weekDiff = eventDay.startOf("week").diff(refDay.startOf("week"), "weeks").weeks` is plausibly correct, but the spec asserts no test covers Europe/London DST transitions. A 23-hour week (29 Mar 2026, BST start) or 25-hour week (25 Oct 2026, GMT start) could plausibly produce a fractional `weekDiff` — and silently fall through to `null`.

**Fix:** require these explicit fixtures:
- **Spring-forward week:** `referenceAt=2026-03-22T10:00Z` (Sunday) → event `2026-03-29` (Sunday, 7 days, the DST day itself). Expected: `NEXT SUNDAY`.
- **Spring-forward + 1:** `referenceAt=2026-03-22T10:00Z` → event `2026-04-04` (Saturday, 13 days). Expected: `SAT 4 APR`.
- **Fall-back week:** `referenceAt=2026-10-18T10:00Z` → event `2026-10-25` (Sunday, 7 days). Expected: `NEXT SUNDAY`.
- **Fall-back + 1:** `referenceAt=2026-10-18T10:00Z` → event `2026-10-31` (Saturday, 13 days). Expected: `SAT 31 OCT`.

If any of these come back null or wrong, the implementation must use `daysDiff`-based week classification (i.e. `Math.floor((daysDiff + refWeekdayMon) / 7)` or similar) instead of Luxon's `weeks` diff, which can return floats across DST.

## Architecture & Integration Defects

### ARCH-003 — Weekly campaign semantics not stated (severity Medium, non-blocking)

The spec says weekly campaigns are unaffected, but doesn't explicitly state that the new week-aware bucket is **unreachable** for weekly campaigns (because `getNextWeeklyOccurrence` always returns the next 0–6 day occurrence). Future devs reading "weekly is fine" might assume `NEXT [WEEKDAY]` works for weekly content — it doesn't.

**Fix:** add one sentence to §5: "Weekly campaigns are unchanged. Their synthesised `startAt` is always 0–6 days out, so they never enter the weekDiff branch."

## Workflow & Failure-Path Defects

### WF-001 / AB-001 — Pre-existing weekly post-start gap (severity Medium, non-blocking, **not caused by this fix**)

Both reviewers independently spotted a separate bug in [campaign-timing.ts:111](src/lib/scheduling/campaign-timing.ts:111) `getNextWeeklyOccurrence`:

```ts
let daysUntil = dayOfWeek - currentWeekday;
if (daysUntil < 0) daysUntil += 7;  // ← only handles past, not "today already started"
```

For a weekly Thursday event at 19:00 with `referenceAt = Thursday 20:00`: `daysUntil = 0`, occurrence resolves to today, `getEventLabel` sees `referenceAt >= eventTimestamp` and returns `null`. **Banner disappears for ~24 hours** until midnight rolls into Friday, when `daysUntil = 6` → `THIS THURSDAY` reappears.

**This is a separate bug, not in scope for the current fix.** Flagging here so it can be ticketed.

## Unproven Assumptions

| ID | Assumption | What would confirm |
|----|------------|--------------------|
| AB-003 | "No backfill needed; nothing caches the rendered label." | The worker code at [worker.ts:226-229](supabase/functions/publish-queue/worker.ts:226) renders just-in-time, which the appended pack confirms. The DB query confirmed `banner_text_override` is `NULL` for all 5 Jessica stories. **Resolved by evidence already gathered, but spec should cite this directly.** |
| AB-004 | Year-boundary case at 7–13 days behaves correctly. | Existing test covers 16-day Dec → Jan (date-format band). Add one case for 8–13 day Dec → Jan in the new weekDiff=1 branch. |

## Minor Observations

- **AB-002:** the spec's stale-comment fix in [proximity-label.ts:6](src/lib/scheduling/proximity-label.ts:6) says the duplicate lives at `proximity.ts` — actual filename is `banner-label.ts`. Already noted in §6 of the spec; just confirming the reviewer caught the same.

## Recommended Fix Order

1. **Spec revision (before any code change):** apply ARCH-001 (require fixture-based parity test), ARCH-002/WF-002 (require DST tests), ARCH-003 (state weekly-unaffected explicitly), AB-004 (year-boundary 7–13 day case).
2. **Implementation:** edit both label files, add tests including the DST fixtures, run parity test against both copies.
3. **Verify on the actual Jessica story:** before merging, run the planner detail view against the live data and confirm the banner reads `SAT 23 MAY`.
4. **Separate ticket (out of scope):** track WF-001 (weekly post-start gap) for follow-up.

## Reviewer Output Files (for audit)

- [assumption-breaker-findings.json](tasks/codex-qa-review/assumption-breaker-findings.json) — 4 findings
- [workflow-failure-path-findings.json](tasks/codex-qa-review/workflow-failure-path-findings.json) — 3 findings
- [integration-architecture-findings.json](tasks/codex-qa-review/integration-architecture-findings.json) — 3 findings
- 10 findings total, deduped → 6 distinct issues plus 1 confirmation of an already-noted item

No `EMPTY_OUTPUT` or `INVALID_JSON`; all three runs returned schema-valid JSON on first attempt.
