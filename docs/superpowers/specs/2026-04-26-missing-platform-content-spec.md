# Spec: "Missing" Platform Content on Create Page

## Problem Statement

When creating an event campaign (e.g. Cash Bingo), some dates appear to be
missing content for a platform. The user sees a dashed placeholder saying
"No draft for Instagram on this date" — but the content **does exist** in the
database. It's scheduled at a different time on the same day and appears in a
separate row elsewhere in the review list.

## Root Cause

Two systems interact badly:

### 1. `resolveScheduleConflicts` shifts individual platform variants independently

In `src/lib/create/service.ts`, after all variants are built, `resolveScheduleConflicts`
checks each variant against existing `content_items` in the database. The conflict
bucket key is `${platform}|${dayKey}` — per-platform, per-day.

If facebook at 12:00 on May 1 conflicts with an existing facebook post, it shifts
to 12:30. But instagram at 12:00 on May 1 has no conflict, so it stays at 12:00.

Result: facebook and instagram for the same campaign plan end up at different times.

This gets worse with each test campaign. The user created 4 Cash Bingo campaigns
during testing. Each one's draft content_items remain in the database, occupying
more time slots. By the 4th campaign, the slots are pushed far apart:

| Campaign | Apr 27 Facebook | Apr 27 Instagram |
|----------|-----------------|------------------|
| 1st      | 11:00           | (dropped by lint) |
| 2nd      | 11:30           | (dropped by lint) |
| 3rd      | 12:00           | 11:00            |
| 4th      | 12:30           | 11:30            |

### 2. The UI groups items by exact minute-level timestamp

In `src/features/create/generated-content-review-list.tsx` (line 69):

```typescript
const key = scheduled
  ? scheduled.startOf("minute").toISO() ?? item.id
  : `draft-${item.id}`;
```

Items are grouped into review rows by their `scheduledFor` timestamp rounded to
the minute. If facebook is at 12:30 and instagram is at 11:30 on the same day,
they appear in **separate rows**. Each row renders all active platforms, and any
platform not in that row shows a "No draft" placeholder.

The user sees this as missing content, when it's actually present in a different
row.

## What I Got Wrong

I spent three iterations trying to fix content generation (lint severity levels,
advisory-only lint, reference dates) when the generation pipeline was working
correctly for the most recent attempts. The original issue (first two campaigns)
genuinely was lint dropping Instagram. But by the time the user tested again,
my lint fix had resolved that — and the visual symptom they reported was caused
by the schedule conflict / UI grouping interaction described above.

## Proposed Fix

### Option A: Group the review list by campaign + calendar day (recommended)

Change the grouping key in `generated-content-review-list.tsx` from
`startOf("minute")` to `startOf("day")` (or campaign_id + day).

This ensures all platforms for the same campaign on the same day appear in the
same review row, regardless of minor time differences from schedule conflict
resolution.

**Pros:** Simple, correct, matches user mental model.
**Cons:** If a user intentionally creates two posts on the same day for the same
platform at different times, they'd be grouped together. But for campaign-generated
content this is the right behaviour — the form creates one post per platform per day.

**Files:** `src/features/create/generated-content-review-list.tsx` — change the key
computation (one line).

### Option B: Keep platform variants together during schedule conflict resolution

Change `resolveScheduleConflicts` to shift all variants from the same plan
together. If facebook needs to move from 12:00 to 12:30, move instagram and
gbp to 12:30 too.

**Pros:** Scheduled times stay aligned, no UI change needed.
**Cons:** More complex — need to track which variants belong to the same plan.
Might create unnecessary conflicts (moving instagram when only facebook conflicted).

**Files:** `src/lib/create/service.ts` — modify `resolveScheduleConflicts` to
group variants by original timestamp and shift them as a unit.

### Option C: Exclude draft content from schedule conflict checks

`resolveScheduleConflicts` queries all `content_items` in the time window,
including drafts from previous test campaigns. Filtering to only
`status IN ('scheduled', 'queued')` would reduce false conflicts.

**Pros:** Reduces the cascading conflict problem from multiple test campaigns.
**Cons:** Doesn't fully fix the grouping issue — real scheduled content can still
cause platform splits. Should be done alongside Option A or B.

**Files:** `src/lib/create/service.ts` — add `.in("status", ["scheduled", "queued"])`
to the conflict query.

## Recommendation

**Option A + Option C together.**

Option A fixes the user-facing symptom (platforms appearing in separate rows).
Option C fixes the underlying data issue (draft content shouldn't occupy schedule
slots). Both are small, isolated changes.

Option B is unnecessary if A is implemented — the times being different doesn't
matter if the UI groups correctly.

## Changes from previous commits to keep

The following changes from today's commits are still valuable and should stay:

- **Lint severity levels** (`content-rules.ts`) — correct classification even
  though lint is now advisory. Useful for diagnostics.
- **`occurrenceDate` in weekly campaign context** (`service.ts`) — fixes the
  reference date for day-name validation in weekly campaigns.
- **Advisory-only lint** (`service.ts`) — lint should never drop a platform.
- **`hasBlockingIssues` helper** (`content-rules.ts`) — available for future use
  even though not currently called.
- **Diagnostic logging** — lint warnings now log specific issue codes.

## Verification

After implementing:

1. Create a Cash Bingo event campaign with facebook + instagram
2. All dates should show both platforms in the same review row
3. Vercel logs should show no "Platform generation failed" errors
4. Database should have content_items for all platforms at all dates
