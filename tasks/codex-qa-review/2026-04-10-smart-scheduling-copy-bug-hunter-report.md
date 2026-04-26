# Bug Hunter Report: Smart Scheduling & Copy Improvements

**Date:** 2026-04-10
**Spec:** `docs/superpowers/specs/2026-04-10-smart-scheduling-and-copy-improvements-design.md`
**Reviewer:** Bug Hunter Agent (QA Specialist)
**Scope:** Existing code + proposed spec logic

---

## Existing Code Bugs

### BUG-001: `findResolution` in conflicts.ts never checks against OTHER occupied slots -- always returns +15 minutes

- **File:** `src/lib/scheduling/conflicts.ts:50-64`
- **Severity:** Critical
- **Category:** Logic
- **Description:** The `findResolution` function receives only the single `conflict` slot and tries offsets from that conflict's time. The check on line 57 (`Math.abs(candidate.getTime() - conflict.scheduledFor.getTime()) <= RESOLUTION_WINDOW_MINUTES * 60 * 1000`) compares the candidate against the *same conflict it was derived from*. Since `candidate = baseTime + offset` and `baseTime = conflict.scheduledFor`, the absolute difference is just `|offset * 60000|`. For the first offset of +15 minutes, this is 900000ms, which is always less than `RESOLUTION_WINDOW_MINUTES (120) * 60000 = 7200000ms`. This means `findResolution` **always returns the first candidate (+15 minutes)** regardless of whether that time is already occupied by another slot. It never sees the `occupied` array from `resolveConflicts`.
- **Impact:** Two posts on the same platform that are both scheduled at 12:00 and 12:15 will both resolve to 12:15. The conflict resolution is illusory -- it shifts by +15 minutes but never validates the new time is actually free. In practice, posts stack up at +15 minute offsets from the first conflict, even if those offsets are themselves occupied.
- **Suggested fix:** Pass the full `occupied` array into `findResolution` and check each candidate against all occupied slots, not just the one conflict. Alternatively, remove `findResolution` entirely and use the `reserveSlotOnSameDay` approach from `service.ts` which correctly maintains an occupied set.

### BUG-002: `reserveSlotOnSameDay` only searches forward past midnight -- throws instead of wrapping

- **File:** `src/lib/create/service.ts:165-190`
- **Severity:** High
- **Category:** Edge Case
- **Description:** The while loop at line 179 increments `minuteOfDay` by `SLOT_INCREMENT_MINUTES` (30) until it finds a free slot. If it reaches `MINUTES_PER_DAY` (1440), it throws an error. It never tries times *before* the requested time. If a user requests a 23:30 post and that slot is taken, the function tries 00:00 (minute 1440) and immediately throws, even though 23:00, 22:30, etc. might be free. The function has no backward search.
- **Impact:** For late-evening posts (after ~22:00) on a busy day, users will get an error claiming "no open schedule slots remain" when earlier times are available. This becomes more likely as more campaigns are created for the same day.
- **Suggested fix:** After forward search exhausts, search backward from the original `minuteOfDay` in `SLOT_INCREMENT_MINUTES` decrements. Only throw if both directions are exhausted.

### BUG-003: Two parallel `resolveConflicts` paths exist with incompatible logic

- **File:** `src/lib/scheduling/conflicts.ts` and `src/lib/create/service.ts:192-272`
- **Severity:** High
- **Category:** Logic
- **Description:** `service.ts` has its own conflict resolution via `resolveScheduleConflicts` + `reserveSlotOnSameDay` which correctly queries existing DB rows and maintains an occupied set. Meanwhile, `materialise.ts` uses `resolveConflicts` from `conflicts.ts` which has the broken `findResolution` (BUG-001). These two systems make different guarantees: `service.ts` prevents real conflicts; `conflicts.ts` does not. Posts created via recurring campaign materialisation use the broken path.
- **Impact:** Recurring campaigns materialised by `materialise.ts` can schedule posts that conflict with each other (within 30 minutes on the same platform). The conflict resolution gives a false sense of safety.
- **Suggested fix:** Unify the conflict resolution logic. Either have `materialise.ts` use the `resolveScheduleConflicts` approach from `service.ts`, or fix `conflicts.ts` to actually work correctly. The spec says conflict resolution "remains unchanged" -- this should be reconsidered.

### BUG-004: `materialise.ts` does not check for conflicts against existing DB posts from OTHER campaigns

- **File:** `src/lib/scheduling/materialise.ts:72-89`
- **Severity:** High
- **Category:** Logic
- **Description:** `materialiseCampaign` at line 72 only queries existing `content_items` for the *same* campaign (`eq("campaign_id", campaignId)`). It checks for duplicate materialisation of the same campaign, but it does not check whether other campaigns already have posts at those times. The `resolveConflicts` call on line 83 only operates on `newSlots` from this single campaign, not all posts for the account on those days.
- **Impact:** Recurring campaign materialisation can create posts that overlap with other campaigns' posts on the same platform within the same 30-minute window. This is the exact clustering problem the spec aims to solve.
- **Suggested fix:** Query all `content_items` for the account (not just the current campaign) within the materialisation window, and feed those into the conflict resolution as pre-existing occupied slots.

### BUG-005: `describeEventTimingCue` returns misleading cue when post is scheduled AFTER the event

- **File:** `src/lib/create/service.ts:290-327`
- **Severity:** Medium
- **Category:** Logic
- **Description:** When `diffMs <= 0` (line 302), meaning `scheduledFor` is at or after the event, the function returns "Make it clear the event is underway right now." But `diffMs <= 0` covers two very different cases: (a) the post is scheduled during the event, and (b) the post is scheduled days after the event ended. A post scheduled a week after a quiz night would still get "the event is underway right now" messaging.
- **Impact:** Post-event recap posts would get inappropriate urgency messaging telling people the event is happening now, when it already happened.
- **Suggested fix:** The spec proposes a `recap` bracket for after-event posts. The existing code conflates "during event" with "after event." Split the `diffMs <= 0` case: if `diffMs < -3 * HOUR_MS` (or similar threshold), return recap-style messaging instead of "underway right now."

---

## Spec Design Bugs

### BUG-006: Spread algorithm has no guard against `postsPerWeek = 0`

- **File:** Spec, Part 1 (Spread Algorithm)
- **Severity:** Medium
- **Category:** Edge Case
- **Description:** The spec defines `postsPerWeek?: number` as optional with no minimum. If `postsPerWeek` is 0 or undefined in `spread_evenly` mode, the algorithm would attempt to distribute zero posts per week, potentially creating an empty campaign or entering a divide-by-zero scenario when calculating distribution.
- **Impact:** A campaign with `scheduleMode: "spread_evenly"` and `postsPerWeek: 0` would silently produce nothing, or worse, cause a runtime division error if the algorithm divides available days by posts per week.
- **Suggested fix:** Schema validation should enforce `postsPerWeek` as required and >= 1 when `scheduleMode` is `spread_evenly`. Add `.min(1).max(7)` to the Zod schema with a `superRefine` conditional on `scheduleMode`.

### BUG-007: Spread algorithm -- more posts than days causes undefined behaviour

- **File:** Spec, Part 1, step 7
- **Severity:** Medium
- **Category:** Edge Case
- **Description:** The spec says "If all 7 days are occupied, double up on the least-busy day." But it does not address the case where `postsPerWeek > 7`. If a user sets 7 posts/week on 3 platforms with staggering, that is 21 placements needed per week. The algorithm needs to place multiple posts on the same day, but the spec only describes doubling up when all days are full, not deliberate multi-post-per-day distribution.
- **Impact:** Campaigns requesting more posts per week than available days would either fail to schedule or cluster unpredictably. The "1-day gap" rule (step 6) becomes impossible to satisfy.
- **Suggested fix:** Define explicit behaviour for `postsPerWeek * platformCount > 7`: relax the 1-day gap rule when mathematically impossible, and distribute evenly even when doubling up (round-robin across days by occupancy).

### BUG-008: Platform staggering with fewer empty days than platforms creates silent data loss

- **File:** Spec, Part 1 (Platform Staggering)
- **Severity:** High
- **Category:** Edge Case
- **Description:** The spec says each platform version goes on a different day. If there are 3 platforms (Instagram, Facebook, GBP) but only 1 empty day in the week, the spec does not define what happens to the 2nd and 3rd platform versions. Do they go on occupied days? Are they dropped? The "double up on least busy" rule from the spread algorithm might apply, but the staggering section does not reference it.
- **Impact:** If only 1 empty day exists, either 2 platform posts are silently dropped (data loss) or they stack on the same day (defeating the purpose of staggering). Either way, the user's intent is violated without notification.
- **Suggested fix:** When fewer empty days than platforms exist: (a) place platforms on the emptiest days (even if occupied), maintaining inter-platform spacing, and (b) surface a warning to the user in the campaign creation response that staggering was partially achieved.

### BUG-009: Race condition -- concurrent campaign creation reads stale "empty days"

- **File:** Spec, Part 1 (Spread Algorithm step 2-5)
- **Severity:** High
- **Category:** Async / Data Integrity
- **Description:** The spread algorithm fetches existing scheduled posts (step 2), builds an occupancy map (step 3), then places new posts on the emptiest days (step 5). Two concurrent campaign creations would both read the same occupancy snapshot, both identify the same "empty" days as optimal, and both schedule posts there. There is no locking, no optimistic concurrency check, and no re-validation after insert. The existing `resolveScheduleConflicts` in `service.ts` (line 192) has the same vulnerability -- it reads existing rows, then schedules without any transaction-level protection.
- **Impact:** Two simultaneous campaign creations could schedule posts on the same day, defeating the spread-evenly goal. In a multi-user or multi-tab scenario, this silently undermines the scheduling intelligence.
- **Suggested fix:** Use a Supabase advisory lock or serialise campaign creation per account. Alternatively, use `INSERT ... ON CONFLICT` with a unique constraint on `(account_id, platform, scheduled_for)` and retry on conflict. At minimum, wrap the read-then-write in a Supabase RPC transaction.

### BUG-010: `describeTemporalProximity` spec does not handle events with no start time

- **File:** Spec, Part 5 (Temporal Proximity)
- **Severity:** Medium
- **Category:** Null Safety
- **Description:** The spec defines `describeTemporalProximity(scheduledFor: Date, eventStart: Date)` with both parameters as required `Date` objects. But events may not always have a start time -- promotions have `startDate` and `endDate` but no time, and existing `eventStart` values in `context` can be null (as handled in `prompts.ts` line 266). The spec does not say what happens when `eventStart` is null or represents a date-only value (midnight).
- **Impact:** If called with a midnight `eventStart` (date-only), the same-day brackets split at 2pm would be wrong -- a post at 3pm for a "midnight" event would get `today_imminent` when the event might actually be at 7pm (time just was not specified). For promotions, the function would not be applicable at all, but the spec does not exclude them.
- **Suggested fix:** (a) Make `eventStart` optional and return null/no-cue when missing. (b) When `eventStart` has a midnight time (indicating date-only), skip the same-day AM/PM split and use a generic "today" bracket. (c) Clarify that this function only applies to events with explicit start times, not promotions.

### BUG-011: Hook rotation -- fewer than 3 prior posts returns random from all 8, but scope is ambiguous

- **File:** Spec, Part 2 (Hook Selection Logic, step 4)
- **Severity:** Low
- **Category:** Edge Case
- **Description:** The spec says "If the campaign has fewer than 3 prior posts, just pick at random from all 8." But the condition says "the campaign" while step 1 says "Fetch the last 3 hook strategies used for this account." These are different scopes. A new campaign for an account with 50 prior posts from other campaigns would have "fewer than 3 prior posts" in the campaign but 50 at the account level. The spec is ambiguous about which scope to check.
- **Impact:** Either the rotation is too aggressive (excluding hooks used by other campaigns) or not aggressive enough (allowing hook repetition across campaigns). Minor UX issue but creates confusion for implementers.
- **Suggested fix:** Clarify: use account-level scope for both the exclusion list and the "fewer than 3" fallback check. The goal is variety across all posts the audience sees, not per-campaign variety.

### BUG-012: Hook rotation -- batch generation bypasses rotation entirely

- **File:** Spec, Part 2 (Hook Selection Logic)
- **Severity:** Low
- **Category:** Edge Case
- **Description:** The spec excludes the last 3 hooks and picks from the remaining 5. But if someone generates multiple posts in rapid succession (e.g., a 7-post spread-evenly campaign), the exclusion window slides. During batch generation, earlier posts in the batch have not yet been persisted to `content_items.hook_strategy`, so the "last 3" query returns stale data. All 7 posts in the batch could get the same hook.
- **Impact:** Batch campaign creation (which this spec introduces via spread-evenly) would bypass hook rotation entirely, since all posts are generated before any are persisted.
- **Suggested fix:** Maintain an in-memory set of hooks selected during the current batch generation. After each post in the batch, add the selected hook to the in-memory exclusion list. Query the DB for the initial exclusion, then extend with in-memory selections.

### BUG-013: Pillar inference -- keyword matching order causes misclassification

- **File:** Spec, Part 3 (Pillar Inference Logic, step 2)
- **Severity:** Medium
- **Category:** Logic
- **Description:** The spec says "First match wins" with a specific check order: seasonal, events, customer_love, behind_scenes, people, food_drink. The keyword lists overlap: "chef" appears in both `food_drink` and `people`, "music" and "live" appear in `events`. A post titled "Chef's New Summer Menu" would match `seasonal` first (due to "summer") rather than `food_drink` (due to "chef" and "menu"), even though the content is fundamentally about food. Similarly, "Christmas quiz night" matches `seasonal` first, missing `events`.
- **Impact:** Content pillar tracking would be systematically biased toward `seasonal` (checked first) during holiday periods, and the nudge system would incorrectly warn about "too many seasonal posts" when the actual content varies between food, events, etc.
- **Suggested fix:** (a) Use a scoring system: count keyword matches per pillar and pick the one with the most matches. (b) If tied, use the priority order as tiebreaker. (c) Alternatively, allow multiple pillars per post (primary + secondary) and only nudge when the primary pillar repeats.

### BUG-014: Pillar inference -- partial word matching causes false positives

- **File:** Spec, Part 3 (Content Pillars keyword list)
- **Severity:** Medium
- **Category:** Logic
- **Description:** The spec lists keywords like "sun", "rain", "band", "live", "prep", "new". Without word-boundary matching, these will match partial words: "Sunday" matches "sun" (seasonal), "husband" matches "band" (events), "alive" matches "live" (events), "prepare" matches "prep" (behind_scenes), "renewal" matches "new" (people context for "new starter"). The spec does not specify whether matching should be whole-word or substring.
- **Impact:** Posts about "Sunday roast" would be misclassified as `seasonal` instead of `food_drink`. Posts mentioning "husband" would be tagged as `events`. This corrupts pillar tracking data and generates incorrect nudges.
- **Suggested fix:** Use word-boundary matching (`\b` regex) for all keyword checks. For multi-word phrases like "behind the scenes", match the full phrase. Short keywords (3 characters or fewer) should require exact word boundaries.

### BUG-015: Time selection defaults ignore timezone / DST transitions

- **File:** Spec, Part 1 (Time Selection)
- **Severity:** Medium
- **Category:** Edge Case
- **Description:** The spec defines default posting times as "12pm" and "5pm" but does not specify timezone handling. The existing code uses `DEFAULT_TIMEZONE` (Europe/London). During BST transition (last Sunday in March, last Sunday in October), a "12pm" post could end up at 11am or 1pm if the time is computed in UTC and then displayed in local time, or vice versa. The `combineDateAndTime` function in `service.ts` (line 1521) correctly uses Luxon with the timezone, but the proposed spread algorithm's time selection is not yet implemented and the spec does not mandate using the same pattern.
- **Impact:** Posts scheduled during DST transition weekends could publish at unexpected times. A "5pm after-work" post could go out at 4pm (still working hours) or 6pm (missing the target window).
- **Suggested fix:** Explicitly state in the spec that all time selections must use `DEFAULT_TIMEZONE` via Luxon (matching the existing `combineDateAndTime` pattern). Add a test case for DST transition dates.

### BUG-016: Spec claims `conflicts.ts` is "not affected" but the spread algorithm needs cross-day conflict awareness

- **File:** Spec, "Files NOT Affected" table
- **Severity:** High
- **Category:** Logic
- **Description:** The spec explicitly lists `src/lib/scheduling/conflicts.ts` as "unchanged" with the reason "Conflict resolution within a day unchanged." However, the spread algorithm fundamentally changes the scheduling paradigm: instead of fixed-day cadences, it dynamically picks days based on occupancy. The existing within-day conflict resolution (which is broken per BUG-001) is insufficient. The spread algorithm needs to know about cross-day conflicts, inter-campaign occupancy, and platform staggering constraints -- none of which `conflicts.ts` supports.
- **Impact:** If `conflicts.ts` remains unchanged, the materialisation path (`materialise.ts`) cannot support `spread_evenly` campaigns. The spec says `materialise.ts` will "support spread_evenly mode" but the conflict resolution it depends on cannot handle the new requirements.
- **Suggested fix:** Either (a) mark `conflicts.ts` as affected and redesign it to support occupancy-aware resolution, or (b) have the spread algorithm bypass `conflicts.ts` entirely and use the `resolveScheduleConflicts` approach from `service.ts` which is closer to correct (though still has BUG-009).

---

## Summary

| Severity | Count | IDs |
|----------|-------|-----|
| Critical | 1 | BUG-001 |
| High | 5 | BUG-002, BUG-003, BUG-004, BUG-008, BUG-009, BUG-016 |
| Medium | 6 | BUG-005, BUG-006, BUG-007, BUG-010, BUG-013, BUG-014, BUG-015 |
| Low | 2 | BUG-011, BUG-012 |

**Top 3 risks to address before implementation:**

1. **BUG-001 + BUG-003 + BUG-016:** The conflict resolution in `conflicts.ts` is fundamentally broken and the spec plans to build on top of it without fixing it. This is the highest-risk area. The `findResolution` function provides no actual conflict protection.

2. **BUG-009:** The race condition in concurrent campaign creation is architectural. Without transactional protection, the spread algorithm's core value proposition (spreading posts across empty days) can be defeated by normal usage patterns (opening two browser tabs).

3. **BUG-012 + BUG-008:** Batch generation (creating 7 posts at once for spread-evenly) interacts badly with hook rotation (which queries persisted data) and platform staggering (which may not have enough days). These are the most common usage patterns for the new feature.
