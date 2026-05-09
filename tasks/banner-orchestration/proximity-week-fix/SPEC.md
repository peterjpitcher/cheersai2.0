# Proximity-label "next weekday" fix — discovery + spec

**Date:** 2026-05-09
**Severity:** High — customer-facing wrong dates
**Affects:** All event-type stories and posts where the gap between `scheduled_for` and the event date falls in the 7–13 day band but spans two calendar weeks
**Owner:** TBD

---

## 1. Bug report (reproducible)

A story for **Jessica Lovelock Live at The Anchor** is scheduled to publish Sun 10 May 2026 at 06:00, advertising an event on Sat 23 May 2026. The banner overlay reads **"NEXT SATURDAY"**. Customers will read this on Sunday and assume the event is six days away (Sat 16 May). It is actually thirteen days away. **Customers will turn up on the wrong date.**

Same campaign has 5 stories spanning 13.5d, 11.5d, 6.5d, 5.5d, 1.5d to the event — so the same campaign hits both sides of the boundary.

## 2. Root cause

In `src/lib/scheduling/proximity-label.ts:71-79` and the byte-for-byte duplicate at `supabase/functions/publish-queue/banner-label.ts:177-185`:

```ts
if (daysDiff >= 2 && daysDiff <= 6) return `THIS ${weekday}`;
if (daysDiff >= 7 && daysDiff <= 13) return `NEXT ${weekday}`;  // ← too crude
if (daysDiff >= 14) return `${weekdayShort} ${day} ${month}`;
```

`daysDiff = 13` from a Sunday lands on the Saturday in the **week after next**, but the rule labels it `NEXT SATURDAY`. The label is computed against `scheduled_for` (publish time), not against the viewer's clock — but that does not save us, because the viewer sees the same wrong text whenever they look.

### Why "next" is wrong here

Calendar weeks (Mon–Sun, ISO 8601) for the failing case:

| Week | Range | Contains |
|------|-------|----------|
| Week N | Mon 4 May – Sun 10 May | reference Sunday |
| Week N+1 | Mon 11 May – Sun 17 May | (no relevance) |
| Week N+2 | Mon 18 May – Sun 24 May | event Saturday |

The event Saturday is in **N+2**, not N+1. "Next Saturday" should mean the Saturday in N+1 (i.e. 16 May, six days away), which the same algorithm independently labels `THIS SATURDAY`. Two of our own labels point at the same date — broken.

## 3. Where the bug fires

| Surface | File | Reference time | Notes |
|---------|------|----------------|-------|
| Planner list view | `src/lib/planner/data.ts:623` | `content_items.scheduled_for` | Computes label for preview |
| Planner detail view | `src/lib/planner/data.ts:810` | `content_items.scheduled_for` | Same |
| Composer preview | `src/features/planner/planner-content-composer.tsx:137` | varies | Uses passed-in `refAt` |
| Public link-in-bio | `src/lib/link-in-bio/public.ts:410` | Per-tile | Renders label on public profile |
| Publish-queue worker (renders the banner image) | `supabase/functions/publish-queue/worker.ts:229` (calls `getProximityLabel` from `banner-label.ts`) | `content_items.scheduled_for`, falls back to `now()` | This is the one whose output is **baked into the published image** |

All five surfaces share the same logic. The Deno worker uses a duplicated copy by design (Deno cannot resolve `@/` aliases) — the duplicate has the same bug.

## 4. Database state

Live query against `cheersai2.0` (project `nbkjciurhvkfpcpatbnt`):

- `campaigns.metadata.eventStart` = `"2026-05-23T19:00:00.000Z"` for Jessica
- All 5 Jessica stories have `content_variants.banner_text_override = NULL` → label is fully computed at render
- Zero rows across the whole `content_variants` table have weekday strings ("saturday", "next ", "this ") in `banner_text_override`. **Nothing is cached. Nothing is stale. The DB is innocent.**
- One incidental observation: there are two duplicate Jessica campaigns (`20e79b88…` and `4823713d…`). The newer one is the active set. Not in scope for this fix but worth flagging to the user.

## 5. The fix — calendar-week-aware bucket

Replace the days-diff bucket for 7+ days with a calendar-week-difference test, **keeping the 0–6 day rules unchanged** so existing behaviour for short cross-week gaps (e.g. Fri → Mon = `THIS MONDAY`) is preserved.

### New rule set for `getEventLabel`

```
daysDiff <= 0                                   → TODAY / TONIGHT (unchanged)
daysDiff == 1                                   → TOMORROW / TOMORROW NIGHT (unchanged)
daysDiff in [2..6]                              → THIS [WEEKDAY]   (unchanged — proximity wins over week boundary)
daysDiff >= 7  AND  weekDiff == 1               → NEXT [WEEKDAY]
daysDiff >= 7  AND  weekDiff >= 2               → [WEEKDAY_SHORT] [DAY] [MONTH_SHORT]   (date format)
```

`weekDiff` is computed as `eventDay.startOf("week").diff(refDay.startOf("week"), "weeks").weeks`, where Luxon's `startOf("week")` returns the Monday at 00:00.

### Why this works

| Scenario | daysDiff | weekDiff | Label | Right? |
|----------|---------:|---------:|-------|:------:|
| **The bug:** Sun 10 May → Sat 23 May | 13 | 2 | `SAT 23 MAY` | ✓ |
| Sat 9 May → Sat 16 May (next-week same weekday) | 7 | 1 | `NEXT SATURDAY` | ✓ |
| Wed → next Wed (7 days) | 7 | 1 | `NEXT WEDNESDAY` | ✓ |
| Wed → Sat 10 days out | 10 | 1 | `NEXT SATURDAY` | ✓ |
| Wed → Fri 16 days out | 16 | 2 | `FRI 19 JUN` | ✓ |
| Fri → Mon, 3 days, cross-week | 3 | (n/a, ≤6) | `THIS MONDAY` | ✓ (unchanged) |
| Sun → Mon 8 days out | 8 | 2 | date format | ✓ (because Mon 11 May would have been TOMORROW; the next-after-that Monday is genuinely "Mon 18 May", not "next Monday") |

The fix removes the ambiguity: `NEXT [WEEKDAY]` only ever points at the immediately following calendar week.

### Reference-time policy (unchanged)

`scheduled_for` remains the right reference for label computation. Re-rendering on viewer clock would be a much bigger change and would break the published-image case (the worker bakes the label into a PNG). Out of scope.

### Weekly campaigns are unaffected

Weekly campaigns synthesise `startAt` to the next 0–6 day occurrence via `getNextWeeklyOccurrence` ([campaign-timing.ts:100-114](src/lib/scheduling/campaign-timing.ts:100)). They never enter the new weekDiff branch. Their behaviour is unchanged by this fix. (A separate, pre-existing bug in `getNextWeeklyOccurrence` for the same-weekday-after-event-time case is flagged in §9 as out of scope.)

## 6. Files to change

1. `src/lib/scheduling/proximity-label.ts` — replace lines 76–87 with week-aware logic; keep the rest.
2. `supabase/functions/publish-queue/banner-label.ts` — same change at lines 182–191. Keep the file in sync (it's an intentional duplicate; Deno can't resolve `@/` aliases). Update the in-file comment that still says "Duplicated in supabase/functions/publish-queue/proximity.ts" — the actual filename is `banner-label.ts`. (Stale comment is at `proximity-label.ts:6`.)
3. `tests/lib/scheduling/proximity-label.test.ts` — add cases (all required):
   - **Bug regression:** Sun 10 May → Sat 23 May = `SAT 23 MAY`
   - Sat 9 May → Sat 23 May (14 days exactly) = `SAT 23 MAY` (sanity, unchanged)
   - Sun 10 May → Mon 18 May (8 days) = `MON 18 MAY` (currently would say `NEXT MONDAY` — must change)
   - Sun 10 May → Sat 16 May (6 days) = `THIS SATURDAY` (sanity, unchanged)
   - Verify `THIS MONDAY` for Fri→Mon (3 days) still works (existing test — must stay green)
   - **Year boundary 7-13d:** Tue 22 Dec 2026 → Tue 29 Dec 2026 (7d) = `NEXT TUESDAY`; Tue 22 Dec 2026 → Mon 4 Jan 2027 (13d) = `MON 4 JAN`
   - **DST spring-forward (29 Mar 2026):**
     - Sun 22 Mar 2026 → Sun 29 Mar 2026 (7d, DST day itself) = `NEXT SUNDAY`
     - Sun 22 Mar 2026 → Sat 4 Apr 2026 (13d, spans BST start) = `SAT 4 APR`
   - **DST fall-back (25 Oct 2026):**
     - Sun 18 Oct 2026 → Sun 25 Oct 2026 (7d, DST day itself) = `NEXT SUNDAY`
     - Sun 18 Oct 2026 → Sat 31 Oct 2026 (13d, spans GMT start) = `SAT 31 OCT`
4. **`tests/lib/scheduling/proximity-label-parity.test.ts`** (new file, **required**). Imports both `getProximityLabel` exports — Node from `@/lib/scheduling/proximity-label`, Deno from `../../supabase/functions/publish-queue/banner-label` (Vitest already aliases the `https://esm.sh/luxon@.*` URL → `luxon` in [vitest.config.ts](vitest.config.ts:23), so the Deno file imports cleanly under Node). For each fixture in a shared 25-30 case table — covering events (incl. the bug regression and DST cases above), promotions, and weekly campaigns — assert `nodeImpl(input) === denoImpl(input)`. This is behavioural, not text-based, so it's robust to comment drift between the two copies and catches divergence in any duplicated symbol (`extractCampaignTiming`, `getNextWeeklyOccurrence`, `getEventLabel`, `getPromotionLabel`).

## 7. Test plan

### Unit
- All existing `proximity-label.test.ts` cases stay green. The `Fri→Mon (3 days, cross-week) = THIS MONDAY` case is the load-bearing one — week-aware logic must NOT touch the ≤6 day branch.
- New cases above.

### Integration
- Render the Jessica story in the planner detail view with mocked `scheduled_for = 2026-05-10T06:00Z` and `metadata.eventStart = 2026-05-23T19:00Z`. Assert `bannerLabel === "SAT 23 MAY"`.
- Run the publish-queue worker against the same fixture and assert the label passed to the render endpoint is `SAT 23 MAY`.

### Manual smoke (after deploy)
- Open planner for Jessica → confirm tomorrow's story banner reads `SAT 23 MAY`.
- Open the same story's composer preview → same label.
- Trigger banner re-render (or wait for cron) on the 10 May story → confirm baked PNG shows `SAT 23 MAY`.

## 8. Rollout & risk

- **Reversible:** yes, single-commit code change. No DB migration. No data backfill.
- **Re-rendering published banners:** banners on already-published posts (in the past) won't change because the platforms hold the bytes. Banners for stories not yet published will pick up the new label automatically when the worker next renders. **No action needed for past posts.**
- **Stories already queued for today/tomorrow with the wrong label baked in:** the worker computes the label and renders the PNG just before publishing each job, not at scheduling time. See [supabase/functions/publish-queue/worker.ts:226-229](supabase/functions/publish-queue/worker.ts:226):
  ```ts
  const referenceAt = content.scheduled_for
      ? DateTime.fromISO(content.scheduled_for, { zone: BANNER_TIMEZONE })
      : DateTime.now().setZone(BANNER_TIMEZONE);
  computedLabel = getProximityLabel({ referenceAt, campaignTiming: timing });
  ```
  So the fix lands → the worker uses the new logic → correct label is rendered into the image when the job actually runs.
- **Risk of regression:** low. The change is local to one branch in one function (duplicated twice). The 0–6 day rules are not touched. Existing test coverage is reasonable; we add explicit cases including DST and year-boundary fixtures.

## 9. Out of scope (flagging for the user)

- **Duplicate Jessica campaigns** in the DB (`20e79b88…` active, `4823713d…` orphan). Cleanup is separate.
- **Pre-existing weekly post-start gap** ([campaign-timing.ts:108-112](src/lib/scheduling/campaign-timing.ts:108)): for a weekly Thursday event at 19:00 with `referenceAt = Thu 20:00`, `getNextWeeklyOccurrence` returns today's already-started occurrence (`daysUntil = 0`), `getEventLabel` then sees `referenceAt >= eventTimestamp` and returns `null`. Banner disappears for ~24 hours until midnight rolls into Friday. **Pre-existing — not caused by this fix.** Track as a separate ticket.
- **Deduplicating the Node/Deno copies** of the proximity logic. The behavioural parity test in §6.4 catches drift but the duplication itself remains; collapsing it requires a build step (Deno can't resolve `@/` aliases). Out of scope.
- **Reference-time policy** (compute against viewer clock vs publish time). Currently publish-time. Changing it is a bigger conversation.
- **Body copy** in posts/stories that mention "next Saturday" — this spec only fixes the **banner overlay** label. If the AI-generated body text has the same problem, that's a separate prompt fix.

## 10. Decisions (resolved with the user)

These were open questions in v1 of this spec; resolved on 2026-05-09 after Codex adversarial review:

1. **Date format wording: keep `SAT 23 MAY`.** Three existing tests already assert this format and it's unambiguous in any future month.
2. **Sun → Mon 8 days = date format (`MON 18 MAY`).** From Sunday, "next Monday" means tomorrow; calling Mon 8 days out "NEXT MONDAY" would clash. Date format is unambiguous.
3. **Behavioural parity test required, not optional.** Promoted from open question to mandatory acceptance criterion per Codex review (ARCH-001, blocking). Approach: fixture-based equality between the two `getProximityLabel` exports, not text-based body diffing. Implementation detail in §6.4.
4. **WF-001 weekly post-start gap → separate ticket.** Pre-existing bug surfaced by Codex review, not in scope for this fix. Logged in §9.

## 11. Codex adversarial review record

This spec was reviewed on 2026-05-09 by three Codex specialist agents (Assumption Breaker, Workflow & Failure-Path, Integration & Architecture). All blocking findings have been addressed in this revision:

- **ARCH-001** (parity test must be required + behavioural, not text-based) → §6.4
- **ARCH-002 / WF-002** (DST tests must be required) → §7
- **ARCH-003** (state weekly campaigns unaffected) → §5 trailing paragraph
- **AB-003** (cite worker code directly) → §8
- **AB-004** (year-boundary 7-13 day case) → §7
- **WF-001** (weekly post-start gap, separate bug) → §9

Full review at [tasks/codex-qa-review/2026-05-09-proximity-label-week-fix-adversarial-review.md](tasks/codex-qa-review/2026-05-09-proximity-label-week-fix-adversarial-review.md).
