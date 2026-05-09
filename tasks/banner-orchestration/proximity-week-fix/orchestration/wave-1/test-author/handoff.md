# Wave 1 Handoff: Test Author

## Files Modified
- `tests/lib/scheduling/proximity-label.test.ts` — added 10 new cases (lines 297-381) inside the existing `describe("getProximityLabel — extended bands")` block, after the existing "still returns null for a target in the past" test.

## Files Created
- `tests/lib/scheduling/proximity-label-parity.test.ts` — 25 fixtures, parity between Node and Deno `getProximityLabel` exports.

## Commits
1. `772b914` `test(proximity-label): add bug regression, DST and year-boundary cases (red)`
2. `cbeb9e9` `test(proximity-label): add behavioural parity test between Node and Deno copies`

## Test State After Wave 1

### proximity-label.test.ts — 39 PASS, 5 FAIL

The 5 failing tests are exactly the 5 bug-zone cases (cases 1, 3, 6, 8, 10 from the PLAN Phase 1 table). The other 5 new cases (cases 2, 4, 5, 7, 9) are sanity-preservation tests whose expected output happens to match the buggy output too — they're labelled "sanity, unchanged" or "weekDiff = 1, normal" in the PLAN table, so this matches intent.

Failing tests with actual-vs-expected:

| Case | Test name | Expected | Actual |
|------|-----------|----------|--------|
| 1 | `bug regression: Sun → Sat 13 days returns date format (was NEXT SATURDAY)` | `SAT 23 MAY` | `NEXT SATURDAY` |
| 3 | `Sun → Mon 8 days returns date format (currently NEXT MONDAY — must change)` | `MON 18 MAY` | `NEXT MONDAY` |
| 6 | `year boundary 13d: Tue 22 Dec → Mon 4 Jan returns date format across year-end` | `MON 4 JAN` | `NEXT MONDAY` |
| 8 | `DST spring-forward 13d: Sun 22 Mar → Sat 4 Apr returns date format (spans BST start)` | `SAT 4 APR` | `NEXT SATURDAY` |
| 10 | `DST fall-back 13d: Sun 18 Oct → Sat 31 Oct returns date format (spans GMT start)` | `SAT 31 OCT` | `NEXT SATURDAY` |

Existing-test count check: existing was 34 (13 event + 11 promotion + 6 extended-bands + 4 weekly). After adding 10 new cases the file reports 44 tests. 39 pass + 5 fail = 44. **Existing 34 all still pass.**

### proximity-label-parity.test.ts — 25 PASS, 0 FAIL

All 25 fixtures pass — both implementations are wrong identically, so they agree. This is the desired GREEN state. After Wave 2 fixes the Node copy first, the parity test will FAIL until the Deno copy is mirrored.

## Assumptions Made

1. **Test placement.** The PLAN says to add the 10 new cases "inside the existing `describe('getProximityLabel — extended bands', ...)` block, after the existing tests in that block." I placed them at the end of that block, just before the closing `});`. A separator comment block introduces the new cases.

2. **Test naming.** I expanded the short names from the PLAN table (e.g. "bug regression: Sun → Sat 13 days") into full Vitest-style descriptions with context about the expected behaviour (e.g. "bug regression: Sun → Sat 13 days returns date format (was NEXT SATURDAY)") so test failures are self-explanatory.

3. **Sanity-test passing is expected.** 5 of the 10 new tests pass under the current (buggy) implementation. This is correct per the PLAN table notes — those rows are explicitly marked "sanity, unchanged" or "weekDiff = 1, normal". The PLAN's narrative line "All 10 new tests fail" is overly broad; the table notes themselves indicate which cases are expected to fail vs which preserve existing behaviour. I followed the table notes and used the exact expected strings the PLAN specifies. **I did not weaken any expectation.** If Wave 2 implements the fix correctly, all 10 will pass.

## Issues Encountered

1. **Parity-test import path required `.ts` extension and a third `../`.**

   The PLAN's Phase 4 template specifies the Deno import as:

   ```ts
   from "../../supabase/functions/publish-queue/banner-label"
   ```

   This failed with `Cannot find module` for two reasons:
   - The test file lives in `tests/lib/scheduling/`, three levels deep from project root, so the relative path needed `../../../`, not `../../`.
   - With Vitest 4.0 + `tsconfig.moduleResolution: "bundler"` and `allowImportingTsExtensions: true`, the import requires the explicit `.ts` extension. (The existing `tests/publish-queue-banner-label.test.ts` at line 15 uses the same pattern.)

   Final import line in `proximity-label-parity.test.ts:17-20`:

   ```ts
   import {
     getProximityLabel as denoImpl,
     type CampaignTiming,
   } from "../../../supabase/functions/publish-queue/banner-label.ts";
   ```

   The fix is purely a path correction — no logic, no fixture, no expectation changed. The luxon URL alias at `vitest.config.ts:23` resolved cleanly once the path was right.

## What Wave 2 Needs To Know

1. **The 5 listed failing tests are the contract for the Implementer.** After Wave 2 implements the Phase 2 fix in `src/lib/scheduling/proximity-label.ts`, each of these must produce the expected output:
   - `bug regression: Sun → Sat 13 days …` → `SAT 23 MAY`
   - `Sun → Mon 8 days …` → `MON 18 MAY`
   - `year boundary 13d: Tue 22 Dec → Mon 4 Jan …` → `MON 4 JAN`
   - `DST spring-forward 13d: Sun 22 Mar → Sat 4 Apr …` → `SAT 4 APR`
   - `DST fall-back 13d: Sun 18 Oct → Sat 31 Oct …` → `SAT 31 OCT`

2. **The 5 currently-passing new tests must still pass after Wave 2.** These check that the fix does not regress existing correct behaviour:
   - `Sat → Sat 14 days exact …` → `SAT 23 MAY`
   - `Sun → Sat 6 days …` → `THIS SATURDAY`
   - `year boundary 7d: Tue 22 Dec → Tue 29 Dec …` → `NEXT TUESDAY`
   - `DST spring-forward 7d: Sun 22 Mar → Sun 29 Mar …` → `NEXT SUNDAY`
   - `DST fall-back 7d: Sun 18 Oct → Sun 25 Oct …` → `NEXT SUNDAY`

3. **The parity test currently passes because both implementations are wrong identically.** After the Implementer fixes the Node copy in Phase 2, parity will FAIL until they fix the Deno copy in Phase 3. That is the desired discipline — the test refuses to go green until both copies agree.

4. **Path note for Wave 2 verification:** the parity test file uses `../../../supabase/functions/publish-queue/banner-label.ts` (with three `../` and the `.ts` extension), not the path written in the PLAN's Phase 4 template. The PLAN template should be considered illustrative, not literal, on this point.
