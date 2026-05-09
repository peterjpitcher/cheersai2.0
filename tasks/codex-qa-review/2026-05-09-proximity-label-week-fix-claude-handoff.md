# Claude Hand-Off Brief: proximity-label week-aware fix

**Generated:** 2026-05-09
**Review mode:** A (Adversarial)
**Overall risk:** Medium — core logic sound, two blocking gaps in test coverage / parity strategy

## DO NOT REWRITE

These elements of the spec are correct and should be preserved as-is:

- The core `weekDiff`-based rule for daysDiff ≥ 7 (replace the 7–13 bucket).
- Keeping the daysDiff 0–6 branches untouched (TODAY / TOMORROW / THIS [WEEKDAY]).
- The list of files to change: [proximity-label.ts](src/lib/scheduling/proximity-label.ts) + [banner-label.ts](supabase/functions/publish-queue/banner-label.ts).
- Reference-time policy unchanged (`scheduled_for`, fallback `now()`).
- The "no DB backfill / no published-PNG re-render" rollout claim — confirmed by [worker.ts:226-229](supabase/functions/publish-queue/worker.ts:226) baking labels at publish time.
- The five-surface call-site list in §3.

## SPEC REVISION REQUIRED

- [ ] **Promote Q3 (parity test) to a required acceptance criterion.** Drop "byte equality of `getEventLabel` body modulo whitespace" — won't work because the Node copy has comments the Deno copy lacks. Replace with: "A behavioural parity test that imports both `getProximityLabel` exports and asserts identical outputs across a fixture table covering event (incl. the bug regression + DST), promotion, and weekly cases." Reason: ARCH-001 (blocking, severity High).
- [ ] **Add DST-boundary test cases as required, not optional.** Concrete fixtures (Europe/London):
  - Sun 22 Mar 2026 → Sun 29 Mar 2026 (7d, DST starts) → expect `NEXT SUNDAY`
  - Sun 22 Mar 2026 → Sat 4 Apr 2026 (13d, spans BST) → expect `SAT 4 APR`
  - Sun 18 Oct 2026 → Sun 25 Oct 2026 (7d, DST ends) → expect `NEXT SUNDAY`
  - Sun 18 Oct 2026 → Sat 31 Oct 2026 (13d, spans GMT) → expect `SAT 31 OCT`
  Reason: ARCH-002 / WF-002 (both blocking).
- [ ] **State explicitly that weekly campaigns are unaffected.** Add to §5: "Weekly campaigns synthesise `startAt` to the next 0–6 day occurrence via `getNextWeeklyOccurrence`. They never enter the new weekDiff branch and their behaviour is unchanged." Reason: ARCH-003.
- [ ] **Add a year-boundary case in the 7–13 day band** to the test plan. E.g. `referenceAt=2026-12-22T10:00Z` → `event=2026-12-29` (7d) → expect `NEXT TUESDAY`; and `event=2027-01-04` (13d) → expect `MON 4 JAN`. Reason: AB-004.
- [ ] **Cite the worker evidence directly** in §8 to harden the rollout claim. Add: "Worker bakes the label at publish time — see `supabase/functions/publish-queue/worker.ts:226-229`. Fix lands → next worker run uses new logic. Already-published PNGs on Facebook/Instagram are not retroactively replaced; product accepts this." Reason: AB-003.

## IMPLEMENTATION CHANGES REQUIRED

(None yet — no code has been written. The spec must be revised first, then implementation can proceed.)

When implementation does begin:

- [ ] [src/lib/scheduling/proximity-label.ts](src/lib/scheduling/proximity-label.ts:71-87) — replace the 7–13 day bucket with the week-aware rule.
- [ ] [supabase/functions/publish-queue/banner-label.ts](supabase/functions/publish-queue/banner-label.ts:177-191) — same change in the Deno duplicate.
- [ ] [tests/lib/scheduling/proximity-label.test.ts](tests/lib/scheduling/proximity-label.test.ts) — add the bug regression + DST + year-boundary fixtures listed above.
- [ ] New test file (e.g. `tests/lib/scheduling/proximity-label-parity.test.ts`) — fixture-based parity between the two implementations. The Deno copy uses `https://esm.sh/luxon@3.7.2`, so Vitest will need to be configured to resolve it — or extract the function bodies via dynamic import / source-string parsing. Easiest path: copy the Deno file into a Vitest-compatible local module via a build step, or transpile-and-eval at test-time.
- [ ] Update the stale comment at [proximity-label.ts:6](src/lib/scheduling/proximity-label.ts:6) — "Duplicated in supabase/functions/publish-queue/proximity.ts" → `banner-label.ts`.

## ASSUMPTIONS TO RESOLVE

These are questions the user (Peter) should answer before implementation:

- [ ] **Q1 (date format): keep `SAT 23 MAY`?** My recommendation: yes. Three existing tests assert this format. Don't churn it. → If yes, no change needed.
- [ ] **Q2 (Sun → Mon 8 days = date format): accept the new behaviour?** My recommendation: yes. From Sun, "next Monday" is tomorrow; calling Mon 8 days out "NEXT MONDAY" would clash. → If yes, ensure a test asserts `MON 18 MAY` for that case.
- [ ] **Q3 (parity test): now mandatory per ARCH-001 — does the user accept this?** My recommendation: yes, this is the only sane way to keep two duplicated bundles in sync.
- [ ] **Q4 (WF-001 weekly post-start gap): track as separate bug?** Recommendation: yes — log a follow-up issue, do NOT bundle into this fix. Out of scope.

## REPO CONVENTIONS TO PRESERVE

- The intentional Node/Deno duplication pattern (Deno cannot resolve `@/` aliases). The fix maintains both copies; do not collapse them.
- Vitest as the test runner, using the project's existing `tests/lib/scheduling/` structure.
- British English wording in user-facing strings stays uppercase (`SAT 23 MAY`, not `Sat 23 May`).
- `Europe/London` timezone explicit in every test fixture (matches the rest of [proximity-label.test.ts](tests/lib/scheduling/proximity-label.test.ts)).

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] **ARCH-001:** re-review after the parity test exists — confirm it imports both copies and runs ≥20 fixtures.
- [ ] **ARCH-002 / WF-002:** re-review after DST tests are added — confirm all four DST fixtures pass against the implementation.
- [ ] **AB-004:** re-review after year-boundary test added.
- No re-review needed for AB-003 (worker reference now cited) or ARCH-003 (one-line clarification).

## REVISION PROMPT

Ready-to-paste prompt for the next revision pass:

> Update `tasks/banner-orchestration/proximity-week-fix/SPEC.md` with the changes from `tasks/codex-qa-review/2026-05-09-proximity-label-week-fix-claude-handoff.md` §"SPEC REVISION REQUIRED": (1) replace Q3 with a required behavioural parity-test acceptance criterion across both `getProximityLabel` exports; (2) make the four DST fixtures listed in the brief required test cases; (3) add an explicit "weekly campaigns unchanged" sentence to §5; (4) add the year-boundary 7–13 day case to §7; (5) cite `supabase/functions/publish-queue/worker.ts:226-229` directly in §8. Then surface the four open questions in §10 to the user and wait for sign-off before implementation.
