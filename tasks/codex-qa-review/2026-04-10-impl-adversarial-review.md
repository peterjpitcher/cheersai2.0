# Adversarial Review: Smart Scheduling & Copy Engagement Implementation

**Date:** 2026-04-10
**Mode:** Spec Compliance + Code Review (Adversarial)
**Engines:** Claude (2 reviewers) + Codex (2 reviewers)
**Scope:** 34 changed files on feat/smart-scheduling-and-copy branch
**Spec:** docs/superpowers/specs/2026-04-10-smart-scheduling-and-copy-improvements-design.md

## What Appears Solid

- Hook strategy module: clean design, Zod validation, lookback-3 rotation
- Pillar inference: word-boundary regex, score-based matching, pre-compiled patterns
- Platform guidance sharpening: correctly added to existing switch cases
- Spread algorithm: clean separation in spread.ts, good test coverage for happy paths
- Schema validation: Zod schemas with superRefine, CHECK constraints match TS enums
- Auth scoping: all queries correctly scoped to authenticated accountId
- Bug fixes (Phase 1): reserveSlotOnSameDay backward search, describeEventTimingCue recap, materialise cross-campaign query
- Test coverage: 393 tests, CI pipeline green

## Must Fix Before Merge

### 1. DST bug in spread.ts (Codex — NEW)
**Severity:** HIGH
spread.ts uses native `Date.getDay()`/`getDate()` which read the process timezone, not Europe/London. A London midnight date in UTC becomes the wrong calendar day. Codex verified: `TZ=UTC`, London midnight April 1 2026 becomes March 31 in the spread logic.
**Fix:** Pass timezone into SpreadConfig and use Luxon for all day arithmetic.

### 2. Hook/pillar history ordering is reversed (Codex — NEW)
**Severity:** HIGH
`fetchRecentCopyHistory()` queries DESC (newest first), but `selectHookStrategy()` uses `slice(-3)` which takes the LAST 3 items (oldest). Same bug for pillar nudge with `slice(-2)`. The avoidance logic targets the wrong posts.
**Fix:** Reverse the arrays after fetching, or change the slice to `slice(0, 3)`.

### 3. Promise.all discards good content on single failure (Claude + Codex)
**Severity:** HIGH
If one platform's OpenAI call fails, Promise.all rejects and discards successful siblings.
**Fix:** Use Promise.allSettled.

### 4. venueLocation never reaches prompt context (Claude + Codex)
**Severity:** MEDIUM
getOwnerSettings() fetches it, prompts.ts reads it, but service.ts never passes it through.
**Fix:** Add venueLocation to enrichedContext in buildVariants/generateVariants.

### 5. describeEventTimingCue not extended per spec (Codex — NEW)
**Severity:** MEDIUM
Spec says return `{ description, toneCue, label }` with 6 brackets including morning/afternoon split. Implementation still returns a single string. temporalProximity is never produced or persisted.
**Fix:** Extend return type, add toneCue generation, wire into prompt context.

### 6. Spread staggering can drop platforms (Codex — NEW)
**Severity:** MEDIUM
When `postsPerWeek < platform count`, later platforms are dropped entirely instead of being grouped onto the least-busy chosen day. Min 1-day same-platform gap not implemented.
**Fix:** Ensure all platforms are assigned even when days run out.

### 7. findResolution still incomplete (Codex — NEW)
**Severity:** MEDIUM
The fix checks already-processed slots in the `occupied` array, but not slots that haven't been processed yet. The spec's exact test case (12:00 + 12:30 -> 13:00) works in the test but could fail with different insertion orders.
**Fix:** Pass the full set of ALL occupied slots (existing + new) into findResolution.

### 8. UI not implemented (Codex — NEW)
**Severity:** MEDIUM (expected — noted in spec as future work)
Weekly campaign form doesn't expose spread/stagger controls. Posting defaults form doesn't expose defaultPostingTime/venueLocation. These are known gaps from the plan.

## Should Fix

### 9. Unsafe cast for schedule metadata (Claude)
**Severity:** LOW — use typed input access directly.

### 10. No duplicate prevention in concurrent materialise (Claude)
**Severity:** LOW — add unique constraint.

### 11. Missing return types on service.ts and materialise.ts exports (Codex)
**Severity:** LOW — spec requires explicit return types.

### 12. No runtime Zod parse before content_items insert (Codex)
**Severity:** LOW — DB CHECK catches it, but app-layer validation is cleaner.

## Fix Priority

1. **Hook/pillar history ordering** (#2) — one-liner, currently producing wrong results
2. **DST in spread.ts** (#1) — use Luxon instead of native Date
3. **Promise.allSettled** (#3) — prevent data loss on transient failures
4. **venueLocation wiring** (#4) — activate dead feature
5. **describeEventTimingCue extension** (#5) — complete Part 5 of spec
6. **Spread staggering platform grouping** (#6) — prevent platform dropping
7. **findResolution completeness** (#7) — edge case hardening
