# Drop `story_series` campaign type — Design

**Date:** 2026-05-07
**Author:** Brainstormed with Peter
**Status:** Design approved (post-codex-qa-review), awaiting implementation plan
**Adversarial review:** [tasks/codex-qa-review/story-series-*-findings.json](../../tasks/codex-qa-review) — applied 3 material findings (G1 weekly contradiction, G2 complete grep audit, G3 stale-client handling)

## Problem

`story_series` is a campaign type, but it is functionally identical to `event` — the only difference is that `story_series` produces story-placement posts and `event` produces feed-placement posts. The `extractCampaignTiming` and `getProximityLabel` code paths for `story_series` already fall through to the event-label logic.

This conflates two orthogonal axes:
- **Campaign intent** (event vs promotion vs weekly vs one-off) — drives label semantics.
- **Placement** (feed vs story) — drives post format.

The current model forces users to pick "Story Series" when they really want "an event with story posts". The user-facing UI carries five top-level campaign types when four would express the same surface. The user has flagged the create UI as more complex than they would like.

## Goal

Remove `story_series` as a campaign type. Stories become a placement choice on `event` and `promotion` campaigns. Same expressiveness, fewer concepts. (`weekly` and `instant` stay feed-only — see locked decision #4 below.)

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
| User in mid-flight create flow on the Story Series step (browser tab opened pre-deploy) | The UI removes that step. Any in-flight session loses progress on that screen. Acceptable: the create wizard is short and re-runnable. |
| Stale browser tab posts `campaign_type: 'story_series'` to the create server action after deploy | Server action validates campaign type via Zod. Once `'story_series'` is removed from the schema enum, the request fails Zod parsing with a 400 and a clear error message ("Story series campaigns have been replaced — please refresh and choose Event with Story placement"). The user sees the toast/error in the UI; no DB write attempted. |
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
3. Replace `createStorySeries` with placement-aware `createEventCampaign`. Drop `storySeries*` Zod schema in `src/lib/create/schema.ts`. Update server action in `src/app/(app)/create/actions.ts` (Zod will now reject stale `story_series` payloads with a clear error). Update affected tests.
4. UI: remove StorySeriesForm, add placement multi-select to event + promotion forms.
5. Delete `story-series-form.tsx` and dead test fixtures.

## Files affected

This list was produced by the grep `story_series\|StorySeries\|story-series` across `*.ts/*.tsx/*.sql`, excluding `node_modules`, `tasks/`, and `docs/`. **All hits below are accounted for** — no other file in the codebase references the deprecated type.

### New
- `supabase/migrations/{ts}_drop_story_series_campaign_type.sql`

### Modified
- `src/lib/scheduling/campaign-timing.ts` — drop story_series from union and from `resolvedType` ternary (becomes plain `"event"`).
- `src/lib/scheduling/proximity-label.ts` — delete `case "story_series"` (line 117).
- `supabase/functions/publish-queue/banner-label.ts` — drop story_series from union, from `resolvedType`, and the `case "story_series"` branch.
- `src/lib/create/service.ts` — delete `createStorySeries` and `StorySeriesInput`; add `placements: Array<'feed' | 'story'>` arg to `createEventCampaign` (default `['feed']`).
- `src/lib/create/schema.ts` — remove the `storySeries*` Zod schema(s).
- `src/app/(app)/create/actions.ts` — remove the server-action(s) wrapping `createStorySeries`. Add stale-payload validation per *Stale-client handling* below.
- `src/features/create/create-wizard.tsx` — drop StorySeriesForm import + route + selector entry.
- `src/features/create/event-campaign-form.tsx` — add placement multi-select.
- `src/features/create/promotion-campaign-form.tsx` — add placement multi-select.
- `tests/app/create/actions.test.ts` — replace story_series test cases with event-with-story-placement equivalents.
- `tests/app/create/management-actions.test.ts` — same.
- `tests/lib/create/schema.test.ts` — drop storySeries schema tests.

### Deleted
- `src/features/create/story-series-form.tsx`.

### Migrations referenced (not modified)
- `supabase/migrations/20250203120000_initial.sql` — original CHECK constraint with `story_series`. Untouched (history is preserved); the new migration replaces the constraint.
- `supabase/migrations/20251021143000_update_campaign_type_check.sql` — updated CHECK constraint with `story_series`. Untouched (history is preserved); the new migration replaces the constraint.

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
