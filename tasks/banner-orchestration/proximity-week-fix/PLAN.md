# Implementation Plan: proximity-label week-aware fix

**Spec:** [SPEC.md](tasks/banner-orchestration/proximity-week-fix/SPEC.md)
**Spec status:** revised after Codex adversarial review on 2026-05-09; all blocking findings addressed.
**Project:** cheersai-app
**Branch:** `claude/loving-antonelli-8797d7` (worktree)
**Risk:** Medium — touches two duplicated runtimes (Node + Deno), but logic is local and well-bounded.
**Approach:** Test-first (TDD). All new tests written first and confirmed to fail; both implementations are then fixed; parity test confirms they stay in lockstep.

---

## Phases

### Phase 1 — Add all new tests to `tests/lib/scheduling/proximity-label.test.ts`

**Goal:** prove the bug exists and define the contract before any implementation change.

**File:** `tests/lib/scheduling/proximity-label.test.ts`

Add these test cases (all required, ordered for readability — group inside the existing `describe("getProximityLabel — extended bands", ...)` block):

| # | Test name | Reference (Europe/London) | Event date+time | daysDiff | Expected | Notes |
|---|-----------|---------------------------|-----------------|---------:|----------|-------|
| 1 | bug regression: Sun → Sat 13 days | `2026-05-10T06:00:00` | `2026-05-23` 19:00 | 13 | `SAT 23 MAY` | THE BUG. Replaces the broken `NEXT SATURDAY`. |
| 2 | Sat → Sat 14 days exact | `2026-05-09T10:00:00` | `2026-05-23` 19:00 | 14 | `SAT 23 MAY` | Sanity, unchanged from current behaviour. |
| 3 | Sun → Mon 8 days | `2026-05-10T10:00:00` | `2026-05-18` 19:00 | 8 | `MON 18 MAY` | Currently returns `NEXT MONDAY` — must change. |
| 4 | Sun → Sat 6 days (proximity wins) | `2026-05-10T10:00:00` | `2026-05-16` 19:00 | 6 | `THIS SATURDAY` | Sanity: 0–6 day branch unchanged. |
| 5 | year boundary 7d | `2026-12-22T10:00:00` (Tue) | `2026-12-29` 19:00 (Tue) | 7 | `NEXT TUESDAY` | weekDiff = 1, normal. |
| 6 | year boundary 13d | `2026-12-22T10:00:00` (Tue) | `2027-01-04` 19:00 (Mon) | 13 | `MON 4 JAN` | weekDiff = 2, crosses year-end. |
| 7 | DST spring-forward, 7d | `2026-03-22T10:00:00` (Sun) | `2026-03-29` 19:00 (Sun, DST day) | 7 | `NEXT SUNDAY` | The week itself is 23 hours. Must still produce weekDiff=1. |
| 8 | DST spring-forward, 13d | `2026-03-22T10:00:00` (Sun) | `2026-04-04` 19:00 (Sat) | 13 | `SAT 4 APR` | Spans BST start. weekDiff must be 2. |
| 9 | DST fall-back, 7d | `2026-10-18T10:00:00` (Sun) | `2026-10-25` 19:00 (Sun, DST day) | 7 | `NEXT SUNDAY` | The week itself is 25 hours. Must still produce weekDiff=1. |
| 10 | DST fall-back, 13d | `2026-10-18T10:00:00` (Sun) | `2026-10-31` 19:00 (Sat) | 13 | `SAT 31 OCT` | Spans GMT start. weekDiff must be 2. |

**Acceptance:** run `npm test -- tests/lib/scheduling/proximity-label.test.ts`. **All 10 new tests fail. All existing tests still pass.** That confirms (a) the bug exists, (b) the new tests are wired correctly, (c) Phase 2 has somewhere to land.

If any **existing** test fails, stop — that means the test-add step accidentally broke something else.

**Commit:** `test(proximity-label): add bug regression, DST and year-boundary cases (red)`

---

### Phase 2 — Fix the canonical Node copy

**Goal:** make the Node implementation pass the new tests using calendar-week-aware logic.

**File:** `src/lib/scheduling/proximity-label.ts`

#### Step 2a — Replace lines 71–87 of `getEventLabel`

Current code:

```ts
if (daysDiff >= 2 && daysDiff <= 6) {
  const weekdayName = WEEKDAY_NAMES[targetInTz.weekday];
  return `THIS ${weekdayName}`;
}

// 7–13 days → NEXT [WEEKDAY]
if (daysDiff >= 7 && daysDiff <= 13) {
  const weekdayName = WEEKDAY_NAMES[targetInTz.weekday];
  return `NEXT ${weekdayName}`;
}

// 14+ days → date format e.g. "FRI 19 JUN"
if (daysDiff >= 14) {
  const weekdayShort = WEEKDAY_NAMES[targetInTz.weekday].slice(0, 3);
  const monthShort = MONTH_SHORT[targetInTz.month - 1];
  return `${weekdayShort} ${targetInTz.day} ${monthShort}`;
}

return null;
```

Replacement:

```ts
if (daysDiff >= 2 && daysDiff <= 6) {
  const weekdayName = WEEKDAY_NAMES[targetInTz.weekday];
  return `THIS ${weekdayName}`;
}

// 7+ days → use calendar-week difference, not raw days, to disambiguate
// "next Saturday" (1 week ahead) from "Saturday week-after-next" (2 weeks ahead).
// Luxon's startOf("week") returns Monday 00:00; rounding the diff handles
// DST-shortened (23h) and DST-lengthened (25h) weeks correctly.
const refWeekStart = refDay.startOf("week");
const eventWeekStart = eventDay.startOf("week");
const weekDiff = Math.round(
  eventWeekStart.diff(refWeekStart, "weeks").weeks
);

if (weekDiff === 1) {
  const weekdayName = WEEKDAY_NAMES[targetInTz.weekday];
  return `NEXT ${weekdayName}`;
}

// weekDiff >= 2 → unambiguous date format
const weekdayShort = WEEKDAY_NAMES[targetInTz.weekday].slice(0, 3);
const monthShort = MONTH_SHORT[targetInTz.month - 1];
return `${weekdayShort} ${targetInTz.day} ${monthShort}`;
```

Note the `Math.round()` wrapping the weeks diff — this defends against DST weeks producing fractional values (23/24 ≈ 0.958 or 25/24 ≈ 1.042). All real weeks will round to integers; only catastrophically long gaps would produce something else, and those fall through `weekDiff >= 2` correctly anyway.

#### Step 2b — Fix the stale comment at line 6

Current: `// Duplicated in supabase/functions/publish-queue/proximity.ts — keep in sync`
Replace with: `// Duplicated in supabase/functions/publish-queue/banner-label.ts — keep in sync`

**Acceptance:** run `npm test -- tests/lib/scheduling/proximity-label.test.ts`. **All 10 new tests pass. All existing tests still pass.** No other test file touched yet.

**Commit:** `fix(proximity-label): use calendar-week diff for 7+ day labels`

---

### Phase 3 — Fix the Deno copy

**Goal:** apply the identical logic change to the Deno duplicate so the worker bakes correct labels into PNGs.

**File:** `supabase/functions/publish-queue/banner-label.ts`

Apply the **same replacement** as Phase 2a, at the corresponding location (lines 177–193 of `getEventLabel`). The Deno file uses 4-space indentation (Node uses 2-space) — preserve the file's existing indentation. Do not copy comments verbatim from the Node file; the Deno file's comment style is sparse.

**Acceptance:** Phase 4 introduces the test that proves this. Until Phase 4 runs, no new automated check covers the Deno change directly. Manually re-read the diff to confirm the new logic matches Phase 2a byte-for-byte (modulo whitespace and comments).

**Commit:** `fix(publish-queue): mirror week-aware proximity label in Deno worker`

---

### Phase 4 — Add the parity test

**Goal:** make divergence between the Node and Deno copies impossible to ship silently.

**File:** `tests/lib/scheduling/proximity-label-parity.test.ts` (new file).

Vitest config already aliases `https://esm.sh/luxon@.*` → `luxon` ([vitest.config.ts:23](vitest.config.ts:23)), so the Deno file imports cleanly under Node's test runtime.

Test structure:

```ts
import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { getProximityLabel as nodeImpl } from "@/lib/scheduling/proximity-label";
import { getProximityLabel as denoImpl, type CampaignTiming } from
  "../../supabase/functions/publish-queue/banner-label";

const TZ = "Europe/London";

interface Fixture {
  name: string;
  ref: string;          // ISO
  campaignType: "event" | "promotion" | "weekly";
  startAt: string;      // ISO
  endAt?: string;       // ISO, promotion only
  startTime?: string;   // "HH:MM"
  weeklyDayOfWeek?: number;
}

const FIXTURES: Fixture[] = [
  // Event — bug regression and band boundaries
  { name: "bug: Sun → Sat 13d",       ref: "2026-05-10T06:00", campaignType: "event", startAt: "2026-05-23", startTime: "19:00" },
  { name: "Sat → Sat 14d",            ref: "2026-05-09T10:00", campaignType: "event", startAt: "2026-05-23", startTime: "19:00" },
  { name: "Sun → Mon 8d",             ref: "2026-05-10T10:00", campaignType: "event", startAt: "2026-05-18", startTime: "19:00" },
  { name: "Sun → Sat 6d",             ref: "2026-05-10T10:00", campaignType: "event", startAt: "2026-05-16", startTime: "19:00" },
  { name: "Sat → Sat 7d",             ref: "2026-05-02T10:00", campaignType: "event", startAt: "2026-05-09", startTime: "19:00" },
  { name: "Fri → Mon 3d cross-week",  ref: "2026-05-08T10:00", campaignType: "event", startAt: "2026-05-11", startTime: "19:00" },
  { name: "today, evening",           ref: "2026-05-07T08:00", campaignType: "event", startAt: "2026-05-07", startTime: "19:00" },
  { name: "tomorrow, daytime",        ref: "2026-05-06T10:00", campaignType: "event", startAt: "2026-05-07", startTime: "14:00" },
  { name: "post-event",               ref: "2026-05-08T10:00", campaignType: "event", startAt: "2026-05-07", startTime: "19:00" },
  // Event — DST and year boundary
  { name: "DST spring 7d",            ref: "2026-03-22T10:00", campaignType: "event", startAt: "2026-03-29", startTime: "19:00" },
  { name: "DST spring 13d",           ref: "2026-03-22T10:00", campaignType: "event", startAt: "2026-04-04", startTime: "19:00" },
  { name: "DST fall 7d",              ref: "2026-10-18T10:00", campaignType: "event", startAt: "2026-10-25", startTime: "19:00" },
  { name: "DST fall 13d",             ref: "2026-10-18T10:00", campaignType: "event", startAt: "2026-10-31", startTime: "19:00" },
  { name: "year boundary 7d",         ref: "2026-12-22T10:00", campaignType: "event", startAt: "2026-12-29", startTime: "19:00" },
  { name: "year boundary 13d",        ref: "2026-12-22T10:00", campaignType: "event", startAt: "2027-01-04", startTime: "19:00" },
  // Promotion
  { name: "promo before start 5d",    ref: "2026-05-05T10:00", campaignType: "promotion", startAt: "2026-05-10", endAt: "2026-05-20" },
  { name: "promo on first day",       ref: "2026-05-10T10:00", campaignType: "promotion", startAt: "2026-05-10", endAt: "2026-05-20" },
  { name: "promo mid",                ref: "2026-05-15T10:00", campaignType: "promotion", startAt: "2026-05-10", endAt: "2026-05-20" },
  { name: "promo end day",            ref: "2026-05-20T10:00", campaignType: "promotion", startAt: "2026-05-10", endAt: "2026-05-20" },
  { name: "promo ends tomorrow",      ref: "2026-05-19T10:00", campaignType: "promotion", startAt: "2026-05-10", endAt: "2026-05-20" },
  { name: "promo 4 weeks left",       ref: "2026-05-08T10:00", campaignType: "promotion", startAt: "2026-05-08", endAt: "2026-06-10" },
  { name: "promo legacy no end",      ref: "2026-05-10T10:00", campaignType: "promotion", startAt: "2026-05-08" },
  // Weekly
  { name: "weekly Mon → Thu",         ref: "2026-05-04T10:00", campaignType: "weekly", startAt: "2026-05-04", weeklyDayOfWeek: 4, startTime: "19:00" },
  { name: "weekly Wed → Thu (1d)",    ref: "2026-05-06T10:00", campaignType: "weekly", startAt: "2026-05-06", weeklyDayOfWeek: 4, startTime: "19:00" },
  { name: "weekly Fri after Thu",     ref: "2026-05-08T10:00", campaignType: "weekly", startAt: "2026-05-08", weeklyDayOfWeek: 4, startTime: "19:00" },
];

function buildTiming(f: Fixture): CampaignTiming {
  return {
    campaignType: f.campaignType,
    startAt: DateTime.fromISO(f.startAt, { zone: TZ }),
    endAt: f.endAt ? DateTime.fromISO(f.endAt, { zone: TZ }) : undefined,
    startTime: f.startTime,
    weeklyDayOfWeek: f.weeklyDayOfWeek,
    timezone: TZ,
  };
}

describe("proximity-label parity (Node ↔ Deno worker copy)", () => {
  for (const f of FIXTURES) {
    it(`agrees on: ${f.name}`, () => {
      const referenceAt = DateTime.fromISO(f.ref, { zone: TZ });
      const timing = buildTiming(f);
      const nodeResult = nodeImpl({ referenceAt, campaignTiming: timing });
      const denoResult = denoImpl({ referenceAt, campaignTiming: timing });
      expect(denoResult).toBe(nodeResult);
    });
  }
});
```

The `CampaignTiming` type is structurally compatible between the two files (same field names, same `DateTime` from luxon). If TypeScript complains about the import (e.g. about the URL alias), import the type from the Node copy and rely on structural typing — both implementations accept the same shape at runtime.

**Acceptance:** run `npm test -- tests/lib/scheduling/proximity-label-parity.test.ts`. **All 25+ fixtures pass.** Run the full proximity test suite to confirm Phase 1 cases also still pass.

**Commit:** `test(proximity-label): add behavioural parity test between Node and Deno copies`

---

### Phase 5 — Full CI verification

**Goal:** confirm nothing else broke.

Commands (from `.claude/rules/verification-pipeline.md`):

```bash
npm run lint:ci      # zero warnings
npm run typecheck    # tsc --noEmit
npm run test:ci      # CI=1 vitest run
npm run build        # next build
```

If any step fails, **fix the underlying issue** — do not skip or `--no-verify`.

The build step is included because Next.js 16 catches dynamic-import / type-resolution issues that lint and typecheck miss.

**Acceptance:** all four green.

**No commit** for this phase — verification only.

---

### Phase 6 — Manual smoke test

**Goal:** confirm the fix works against the live Jessica Lovelock story.

1. Start dev server: `npm run dev`.
2. Navigate to the planner detail view for the Jessica Lovelock story scheduled `2026-05-10T06:00`.
3. Confirm the banner overlay reads `SAT 23 MAY` (not `NEXT SATURDAY`).
4. Open the planner list view for the same campaign. Verify all 5 stories show correct labels:
   - `2026-05-10` (13d) → `SAT 23 MAY`
   - `2026-05-12` (11d) → `SAT 23 MAY`
   - `2026-05-17` (6d) → `THIS SATURDAY`
   - `2026-05-18` (5d) → `THIS SATURDAY`
   - `2026-05-22` (1d) → `TOMORROW NIGHT`
5. Open the public link-in-bio profile for the account (if any) and confirm consistent labels.

**No code change.** If labels are wrong, return to Phase 2/3 and debug — the unit and parity tests should have caught any logic divergence already, so a manual failure here implies a missed call-site or rendering issue.

**Acceptance:** all 5 labels correct on the planner. The published-PNG case is exercised when the worker next runs; cannot easily be smoke-tested without triggering a job.

---

## Acceptance Summary

A reviewer should sign off only when ALL of the below are true:

- [ ] All 10 new unit tests in `proximity-label.test.ts` pass
- [ ] All 25+ parity tests in `proximity-label-parity.test.ts` pass
- [ ] All previously-existing tests still pass
- [ ] `npm run lint:ci`, `typecheck`, `test:ci`, `build` all green
- [ ] Manual smoke shows `SAT 23 MAY` on the Jessica 10-May story
- [ ] Stale comment fix at `proximity-label.ts:6` is included
- [ ] No code outside `proximity-label.ts`, `banner-label.ts`, the two test files is touched

## Files Touched (final list)

1. `src/lib/scheduling/proximity-label.ts` — replace 7–13 day bucket; fix stale comment
2. `supabase/functions/publish-queue/banner-label.ts` — mirror the same change
3. `tests/lib/scheduling/proximity-label.test.ts` — add 10 new test cases
4. `tests/lib/scheduling/proximity-label-parity.test.ts` — new file (~25 fixtures)

Total: 2 source files, 2 test files. Estimated diff size: ~200 lines.

## What This Plan Deliberately Does NOT Touch

- Any caller of `getProximityLabel` (planner, composer, link-in-bio, worker call sites). The fix lives entirely in the helper.
- `getPromotionLabel` or `getNextWeeklyOccurrence`. The bug is event-only.
- DB migrations or backfills.
- The duplicate Jessica campaigns in the DB (separate cleanup).
- The pre-existing weekly post-start gap (separate ticket — see SPEC §9).

## Failure Modes To Watch For

- **Phase 2 succeeds but Phase 3 lags** → planner shows correct label but published PNGs still wrong. Mitigated by Phase 4's parity test refusing to pass until both copies agree.
- **DST tests fail with `null` instead of expected label** → Luxon's week-diff is fractional across DST. The `Math.round()` in the proposed implementation should handle this; if it doesn't, fall back to `Math.floor((daysDiff + (refDay.weekday - 1)) / 7)` which uses calendar-day arithmetic only.
- **Vitest cannot resolve the Deno import** → confirm the alias regex in `vitest.config.ts:23` actually matches the URL string in `banner-label.ts:10` (it should — `https://esm.sh/luxon@.*` matches `https://esm.sh/luxon@3.7.2`).
- **Existing test "Fri→Mon = THIS MONDAY" goes red** → the change accidentally moved the daysDiff <= 6 branch. This is the load-bearing existing case; if it breaks, revert and re-do.
