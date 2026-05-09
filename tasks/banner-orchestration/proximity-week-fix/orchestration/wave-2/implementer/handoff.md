# Wave 2 Handoff: Implementer

## Files Modified
- `src/lib/scheduling/proximity-label.ts` — replaced lines 71–89 of `getEventLabel` with week-aware logic; updated stale comment at line 6 to point at `banner-label.ts`.
- `supabase/functions/publish-queue/banner-label.ts` — replaced lines 182–193 of its `getEventLabel` with matching week-aware logic; preserved 4-space indentation; removed the now-unreachable trailing `return null;`.

## Commits
1. `31d613c` `fix(proximity-label): use calendar-week diff for 7+ day labels`
2. `138179c` `fix(publish-queue): mirror week-aware proximity label in Deno worker`

## Test Results

### After Node fix only
- `tests/lib/scheduling/proximity-label.test.ts`: 44/44 PASS — all 5 previously-failing bug-zone cases now green; the 5 sanity cases stayed green; the 34 pre-existing tests stayed green.
- `tests/lib/scheduling/proximity-label-parity.test.ts`: 20 PASS / 5 FAIL — failures expected for the bug-zone fixtures because Deno copy still wrong.
- Failing parity fixtures (mid-flight, expected):
  - `bug regression: Sun → Sat 13 days` Node: `SAT 23 MAY` Deno: `NEXT SATURDAY`
  - `Sun → Mon 8 days` Node: `MON 18 MAY` Deno: `NEXT MONDAY`
  - `year boundary 13d` Node: `MON 4 JAN` Deno: `NEXT MONDAY`
  - `DST spring-forward 13d` Node: `SAT 4 APR` Deno: `NEXT SATURDAY`
  - `DST fall-back 13d` Node: `SAT 31 OCT` Deno: `NEXT SATURDAY`

### After Deno fix
- `tests/lib/scheduling/proximity-label.test.ts`: 44/44 PASS
- `tests/lib/scheduling/proximity-label-parity.test.ts`: 25/25 PASS
- Combined run: 69/69 PASS, 2 test files passed.

## Assumptions Made
1. **Deno comment style.** The Node copy got 4 lines of comment explaining the rationale (calendar-week, Luxon `startOf("week")`, DST handling). The Deno file uses sparser comments per the agent_brief, so I kept just one short comment: `// 7+ days → use calendar-week difference, not raw days`. The full rationale lives in the canonical Node copy that the Deno file is documented to mirror.
2. **Trailing comma in `Math.round` argument.** Inside the Deno copy I added a trailing comma after `eventWeekStart.diff(refWeekStart, "weeks").weeks,` to match the Deno file's existing style (e.g. lines 144, 149 already use trailing commas in multi-line calls). The Node copy does not use a trailing comma.
3. **Removed the unreachable `return null;` in the Deno copy** because every preceding code path in `getEventLabel` now returns. The agent_brief said "the new code path always returns" — confirmed by inspection: post-event returns null on line 162, `daysDiff <= 0`, `=== 1`, `>= 2 && <= 6`, `weekDiff === 1`, and the unconditional date-format branch at the end all return. No remaining fall-through.

## Issues Encountered
None. Each step matched the PLAN's predicted state:
- After Node-only fix, Node tests turned all-green and parity tests showed the predicted 5 mid-flight failures.
- After Deno fix, parity went all-green.

## Diff Stats
- `src/lib/scheduling/proximity-label.ts`: +16 -11
- `supabase/functions/publish-queue/banner-label.ts`: +11 -8

## What The Orchestrator Should Verify
- Run `npm run ci:verify` — full pipeline (lint → typecheck → test → build). No production code outside the two helpers was touched, so no caller changes are needed.
- Manual smoke test on the planner detail view for the Jessica Lovelock 10-May story → banner overlay should now read `SAT 23 MAY` (Saturday 23 May) instead of the buggy `NEXT SATURDAY`.
- `git status` shows only the two commits made by this wave on the working tree (plus pre-existing untracked planning artefacts).
