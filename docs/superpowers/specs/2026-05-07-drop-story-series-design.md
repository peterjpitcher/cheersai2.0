# Drop `story_series` campaign type — Design

**Date:** 2026-05-07
**Author:** Brainstormed with Peter
**Status:** Design draft, awaiting codex-qa-review

## Problem

`story_series` is a campaign type, but it is functionally identical to `event` — the only difference is that `story_series` produces story-placement posts and `event` produces feed-placement posts. The `extractCampaignTiming` and `getProximityLabel` code paths for `story_series` already fall through to the event-label logic.

This conflates two orthogonal axes:
- **Campaign intent** (event vs promotion vs weekly vs one-off) — drives label semantics.
- **Placement** (feed vs story) — drives post format.

The current model forces users to pick "Story Series" when they really want "an event with story posts". The user-facing UI carries five top-level campaign types when four would express the same surface. The user has flagged the create UI as more complex than they would like.

## Goal

Remove `story_series` as a campaign type. Stories become a placement choice on `event`, `promotion`, and `weekly` campaigns. Same expressiveness, fewer concepts.

## Non-goals

- Changing label rules. Stories continue to use the campaign-intent label set (event-style for events, promotion-style for promotions, weekly-style for weekly).
- Adding new campaign types.
- Reworking the entire create wizard. Only the type-picker and the per-type forms change.
- Touching the `placement` column on `content_items` — it already exists and is correct.

## Locked decisions

| # | Decision |
|---|---|
| 1 | Drop `story_series` from `campaigns.campaign_type` allowed values. |
| 2 | Existing `story_series` campaigns are migrated to `event` (campaign_type only — content_items keep `placement = 'story'`). |
| 3 | The "Story Series" option in the create wizard is removed. Event and promotion forms gain a placement multi-select (Feed / Story / Both). |
| 4 | `instant` and `weekly` posts default to feed-only for now (no UI change for those). Future work can extend if needed. |
| 5 | No new column on `campaigns`. Placement stays on `content_items`. The form just controls which content_items get generated. |

## Architecture

The fix is mostly subtractive. Five shapes change:

### 1. Schema (Migration 1)

Replace the existing `campaigns_campaign_type_check` constraint to drop `story_series`. Atomic with the data migration: `UPDATE campaigns SET campaign_type = 'event' WHERE campaign_type = 'story_series'` runs first; constraint is then re-created without `story_series`.

```sql
UPDATE campaigns SET campaign_type = 'event' WHERE campaign_type = 'story_series';
ALTER TABLE campaigns DROP CONSTRAINT campaigns_campaign_type_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_campaign_type_check
  CHECK (campaign_type IN ('event','promotion','weekly','instant'));
```

### 2. `CampaignTiming` type

In both copies (`src/lib/scheduling/campaign-timing.ts` and `supabase/functions/publish-queue/banner-label.ts`), drop `'story_series'` from the union. The fall-through assignment `campaign.campaign_type === "story_series" ? "story_series" : "event"` becomes just `'event'` — i.e., the line is deleted.

### 3. `getProximityLabel`

In both copies (`src/lib/scheduling/proximity-label.ts` and `supabase/functions/publish-queue/banner-label.ts`), delete the `case "story_series"` branch. Already redundant — both branches called `getEventLabel`.

### 4. Campaign creation

In `src/lib/create/service.ts`:
- Delete `createStorySeries` and its `StorySeriesInput` type.
- Extend `createEventCampaign` to accept an optional `placements: Array<'feed' | 'story'>` (default `['feed']`).
- For each chosen placement, generate the corresponding `content_items` with `placement` set accordingly.

The plan generation logic that's currently duplicated between `createEventCampaign` and `createStorySeries` collapses into one path that branches on placement at the content_items insert.

### 5. UI

In `src/features/create/`:
- Delete `story-series-form.tsx`.
- Remove the StorySeriesForm import and route from `create-wizard.tsx`.
- Remove the "Story Series" option from the type picker.
- Add a placement multi-select to `event-campaign-form.tsx` and `promotion-campaign-form.tsx`. Default: Feed only.
- The picker label might read "Where should this post?" with two checkboxes: "Feed" and "Stories" (Stories implies both Instagram and Facebook stories where the channels are connected; matches existing per-platform behaviour).

## Data flow

Unchanged. `content_items.placement` already drives the publish path. The publish worker reads placement and the renderer adapts accordingly. No schema changes outside the campaigns CHECK constraint.

## Edge cases

| Case | Handling |
|---|---|
| Existing `story_series` campaign with active content | Migrated to `event`. content_items retain their existing `placement = 'story'`. Banner labels are unchanged because story_series already used event-label logic. |
| Existing `story_series` campaign with `metadata.startDate` | Already shaped like an event campaign. No metadata transformation needed. |
| Existing `story_series` campaign with `metadata.placement = 'story'` | Field is left in place — harmless. After cleanup pass, can be removed. |
| Existing `story_series` campaign with no story content_items yet (drafts only) | Migrated to `event`. The user can regenerate with placement of choice. |
| User in mid-flight create flow on the Story Series step | The UI removes that step. Any in-flight session loses progress on that screen. Acceptable: the create wizard is short and re-runnable. |
| Tests using `campaign_type: 'story_series'` fixtures | Updated to `campaign_type: 'event'` with `placement: 'story'` content_items. |
| Code that explicitly switches on `campaign_type === 'story_series'` | Removed (only two such call sites — both fall through to event today). |

## Migration plan

Single migration. No dual-write window because `story_series` and `event` already produce identical output today.

**Migration:** `supabase/migrations/{ts}_drop_story_series_campaign_type.sql`
- Data step: `UPDATE campaigns SET campaign_type = 'event' WHERE campaign_type = 'story_series'`
- Schema step: drop and recreate `campaigns_campaign_type_check` without `story_series`
- Idempotent: `IF EXISTS` on the constraint drop; the UPDATE is a no-op when no rows match.

**Code commits** (each green at HEAD):
1. Migration only — applied later by orchestrator.
2. Drop `story_series` from `CampaignTiming` union and `getProximityLabel` (both Node and Deno copies).
3. Replace `createStorySeries` with placement-aware `createEventCampaign`. Update tests.
4. UI: remove StorySeriesForm, add placement multi-select to event + promotion forms.
5. Delete `story-series-form.tsx` and dead test fixtures.

## Files affected

### New
- `supabase/migrations/{ts}_drop_story_series_campaign_type.sql`

### Modified
- `src/lib/scheduling/campaign-timing.ts` — drop story_series from union and resolveType.
- `src/lib/scheduling/proximity-label.ts` — drop case story_series.
- `supabase/functions/publish-queue/banner-label.ts` — drop story_series from union, resolveType, and case branch.
- `src/lib/create/service.ts` — delete createStorySeries; add `placements` arg to createEventCampaign; (optionally) extend createPromotionCampaign similarly.
- `src/features/create/create-wizard.tsx` — drop StorySeriesForm route.
- `src/features/create/event-campaign-form.tsx` — add placement multi-select.
- `src/features/create/promotion-campaign-form.tsx` — add placement multi-select.
- Any tests under `tests/lib/create/`, `tests/lib/scheduling/`, `tests/supabase/publish-queue/` that reference `'story_series'` — update to `'event'` with story content_items where appropriate.

### Deleted
- `src/features/create/story-series-form.tsx` and any sibling test file.

## Testing strategy

- **Unit — `extractCampaignTiming`**: existing tests updated; one new test asserts an event campaign with no `metadata.startTime` produces the expected timing.
- **Unit — `getProximityLabel`**: existing tests covering events stay; story_series-specific tests removed.
- **Integration — `createEventCampaign`**: new tests for `placements: ['story']` (story-only) and `placements: ['feed','story']` (both). Asserts the right number of `content_items` rows with the right `placement`.
- **Migration test (manual)**: seed a `story_series` row, run migration, assert it's now `event` with story content_items intact.
- **CI verify**: `npm run ci:verify` clean.

## Out of scope

- Adding placement to `weekly` and `instant` (defer; current behaviour stays).
- Reworking the campaign-creation wizard navigation.
- Removing `metadata.placement` from migrated rows (cosmetic; leave for a later cleanup).
- Updating Obsidian/architecture docs (regenerated by the next session-setup pass).
