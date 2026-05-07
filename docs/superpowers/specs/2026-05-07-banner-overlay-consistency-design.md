# Banner Overlay Consistency — Design

**Date:** 2026-05-07
**Author:** Brainstormed with Peter
**Status:** Design approved, awaiting implementation plan

## Problem

Banner overlays (the small edge strip carrying labels like `THIS WEDNESDAY`) are inconsistent across the app. Today they are:

- Applied unevenly across post types (instant, event, promotion, weekly, story).
- Treated as snapshots that go stale when schedules change, content is rewritten, or simply when the clock advances.
- Surfaced through two divergent preview components (canvas-based vs SVG/CSS).
- Bounded to ≤6 days out — anything further never gets a banner.
- Cached in DB columns and Supabase Storage with manual invalidation rules and a `"stale"` state declared in schema but never set.

The user wants the banner to be consistent across every post type and every surface, and to always reflect the correct context.

## Goals

- Banner is **always** correct relative to the current schedule and current time.
- Same rules apply to every post type (instant, event, promotion, weekly) and every placement (feed post, story).
- One source of truth for label and config — computed from data on every read.
- Account-level default with per-post override, enforced uniformly.
- Smaller surface area (less DB, less code, fewer states).

## Non-goals

- Per-platform branding (separate Instagram-only or Facebook-only styles). Same look everywhere.
- User-controlled banner shape or animation. Strip on one of four edges, that's it.
- Multilingual labels. English only, matching the rest of the app.
- A/B testing or analytics on banner performance.

## Locked decisions (from brainstorming)

| # | Decision | Choice |
|---|---|---|
| Q1 | Label set | Full horizon. Day-name labels for current and next week, then date format. |
| Q2 | Drift handling | Always auto-rerender silently. Banner is derived data. |
| Q3 | Stories vs feed posts | Same rules everywhere. Renderer adapts to aspect ratio proportionally. |
| Q4 | Label boundaries | `THIS [WEEKDAY]` (2–6d) → `NEXT [WEEKDAY]` (7–13d) → date format `FRI 13 JUN` (14d+). |
| Q5 | Toggle scope | Account default with per-post override. |

## Architecture

Five pieces. Two pure functions (used by both client and server), one server-only renderer, two UI components.

### 1. `labelEngine`

Pure function. Lives at [src/lib/scheduling/proximity-label.ts](src/lib/scheduling/proximity-label.ts) (extend the existing module).

```ts
type LabelKind = 'time' | 'date' | 'none';
type LabelResult = { label: string | null; kind: LabelKind };

function labelEngine(
  target: Date,
  now: Date,
  timezone: string,    // 'Europe/London'
  eventEnd?: Date,     // optional, for post-event detection
): LabelResult;
```

Used by:
- The `<BannerOverlay />` component (browser clock).
- `renderBannerServer` (server clock at publish).

### 2. `bannerConfigResolver`

Pure function. New file: `src/lib/banner/config.ts`.

```ts
type ResolvedConfig = {
  enabled: boolean;
  position: 'top' | 'bottom' | 'left' | 'right';
  bgColour: string;     // hex
  textColour: string;   // hex
  textOverride: string | null;  // ≤20 chars
};

function bannerConfigResolver(
  accountDefaults: AccountBannerDefaults,
  postOverrides: PostBannerOverrides,
  contentType: 'feed' | 'story',
): ResolvedConfig;
```

Resolution rules:
- Each field falls through from `postOverrides` to `accountDefaults` if `null`.
- `enabled = false` on the post wins over enabled at account level.
- `textOverride` only applies when `enabled = true`.

### 3. `<BannerOverlay />`

Single React component. New file: `src/features/planner/banner-overlay.tsx`.

Replaces both [BannerRenderedPreview](src/features/planner/banner-rendered-preview.tsx) (canvas) and [BannerOverlayPreview](src/features/planner/banner-overlay-preview.tsx) (SVG).

Props: `mediaUrl`, `config: ResolvedConfig`, `label: string | null`, optional `aspectClass` for tuning strip size.

Renders an SVG strip absolutely positioned over the image. No canvas, no DB call, no async work.

### 4. `renderBannerServer`

Server-only. New file: `src/lib/banner/render-server.ts`. Consolidates [banner-canvas.ts](src/lib/scheduling/banner-canvas.ts) server logic and the `/api/internal/render-banner` route.

```ts
async function renderBannerServer(
  source: ReadableStream | Buffer,   // source image
  config: ResolvedConfig,
  label: string,
): Promise<Buffer>;                    // JPEG buffer
```

Sharp-based. Inspects source dimensions and applies proportional strip width (8% short side for square/4:5/4:3, 6% for 9:16). Output is byte-stable for the same inputs.

### 5. `<BannerControls />` (kept, simplified)

[src/features/planner/banner-controls.tsx](src/features/planner/banner-controls.tsx). Drops the "render banner" mechanics — they no longer exist. Just edits the override fields on `content_variants`.

## Schema changes

One migration file under `supabase/migrations/`.

### `content_variants` — drop columns

- `banner_state`
- `banner_label`
- `banner_source_media_path`
- `bannered_media_path`
- `banner_render_metadata`
- `banner_rendered_for_scheduled_at`

Also delete existing JPEGs at `banners/{contentId}/{variantId}.jpg` from Supabase Storage as part of the migration.

### `content_variants` — add columns (all nullable; null means inherit account default)

- `banner_enabled boolean`
- `banner_text_override text` (≤20 chars, validated app-side)
- `banner_position text` (top/bottom/left/right)
- `banner_bg text` (hex)
- `banner_text_colour text` (hex)

### `posting_defaults` — add columns

- `banners_enabled boolean not null default true`
- `banner_position text not null default 'bottom'`
- `banner_bg text not null default '#000000'`
- `banner_text_colour text not null default '#FFFFFF'`

### `prompt_context` cleanup

The current `bannerConfig` blob inside `prompt_context` (jsonb) is no longer authoritative. Migration data step: where `content_variants.banner_enabled IS NULL` and `prompt_context.bannerConfig` exists, copy values into the new override columns. After migration, code stops reading the blob.

### Function audit

Per [.claude/rules/supabase.md](.claude/rules/supabase.md), grep all PL/pgSQL functions and triggers for the dropped column names in the same migration. Update any matches.

## Label engine rules

### Picking `target`

| Campaign type | `target` |
|---|---|
| Event | event start time |
| Promotion | the post's phase date |
| Weekly | post's `scheduled_for` |
| Instant / ad-hoc | post's `scheduled_for` |
| Story / story-series | post's `scheduled_for` |

### Boundaries (all in `Europe/London`)

| Days from `now` to `target` | Label |
|---|---|
| `target` < `now` | `null` |
| Same calendar day, `target` time < 17:00 | `TODAY` |
| Same calendar day, `target` time ≥ 17:00 | `TONIGHT` |
| Next calendar day, `target` time < 17:00 | `TOMORROW` |
| Next calendar day, `target` time ≥ 17:00 | `TOMORROW NIGHT` |
| 2–6 days, same Mon–Sun calendar week | `THIS [WEEKDAY]` |
| 7–13 days | `NEXT [WEEKDAY]` |
| 14+ days | `[WEEKDAY] [DAY] [MONTH]` (e.g. `FRI 13 JUN`) |

### Disambiguation

- **Same weekday, future post**: today = Wednesday, target = Wednesday 7 days later → `NEXT WEDNESDAY`. The day-band always wins over the weekday-name match.
- **Calendar week boundary**: `THIS [WEEKDAY]` requires the target to be in the same Mon–Sun week as `now`. A Saturday post about Tuesday 4 days later sits in next week → `NEXT TUESDAY`.
- **DST and TZ**: all comparisons via Luxon `DateTime.setZone('Europe/London')`. Calendar-day diff, not 24h-millisecond diff. The two DST-change Sundays each year are tested.

### Custom override

- If `banner_text_override` is non-empty, banner shows that text regardless of computed label.
- If override is set and computed label would be `null` (post-event, or event already happened by publish), banner still shows with override text.
- If override is empty/null, computed label is used. If computed label is `null`, no banner is shown.

### Banner visibility decision tree

```
config.enabled = false                     → no banner
config.enabled = true,  override set       → banner with override text
config.enabled = true,  override empty,
                        label != null      → banner with computed label
config.enabled = true,  override empty,
                        label == null      → no banner
```

## Data flow

Three surfaces. Same two pure computations on each.

### Resolving config

```
account_defaults := posting_defaults row for the account
post_overrides   := banner_* columns on content_variants row
config           := bannerConfigResolver(account_defaults, post_overrides, contentType)
```

### Resolving label

```
target := event_start_at | phase_date | scheduled_for   (per campaign type)
label  := labelEngine(target, now, 'Europe/London', event_end_at?)
```

`now` is whatever clock the surface uses — browser clock for UI, server clock at render time for publish.

### Surface 1: Planner UI (composer, calendar, link-in-bio public page)

1. Read `content_variants` and `posting_defaults` from server.
2. Resolve config + label client-side.
3. Render `<BannerOverlay />` over source media.
4. Re-render whenever the user edits inputs (schedule, override, position, colours).

No banner data persisted from this surface.

### Surface 2: Account preferences

Read/write `posting_defaults`. Standard form.

### Surface 3: Publish worker ([supabase/functions/publish-queue/worker.ts](supabase/functions/publish-queue/worker.ts))

1. Pick up due `publish_jobs` row.
2. Load `content_variants` and `posting_defaults`.
3. Resolve config + label using server clock.
4. If `config.enabled` and label is non-null:
   - Stream source image from `media_assets.storage_path` into Sharp.
   - `renderBannerServer(stream, config, label)` → JPEG buffer.
   - Upload buffer to platform.
5. Otherwise: send source image as-is.
6. JPEG buffer is held in memory only. Not persisted.

### Where banner state changes (write paths)

- Account preferences page → `posting_defaults` (account-wide).
- `<BannerControls />` in planner composer → `content_variants` overrides.

No other write paths.

## Edge cases and error handling

| Case | Handling |
|---|---|
| Sharp render failure at publish | Job marked `failed` with `last_error`. Post does **not** publish. Loud failure beats silently shipping unbranded. |
| Source image missing from storage | Same as render failure. |
| Override text > 20 chars | Validated client-side in `<BannerControls />`. Server action validates again and truncates if it slips through. |
| Post-event timing (event was 19:00, publish runs 19:30) | Computed label is `null`. If override set → publish with override. If no override → publish without banner. Don't fail the publish. |
| DST transition days | Luxon handles. Tested for both annual transitions. |
| Per-platform aspect ratios | `renderBannerServer` inspects dimensions and uses proportional strip sizing. No per-platform branches. |
| `enabled = false` + override set | Disabled wins. No banner. |
| In-flight posts at migration time | Drop of `banner_rendered_for_scheduled_at` removes the publish-blocked-because-stale gate. Previously blocked posts unblock and render fresh on next attempt. |
| Existing `prompt_context.bannerConfig` blobs | Data step in migration copies values into new override columns. Code stops reading the blob after migration. |
| Existing accounts with no `posting_defaults.banners_enabled` | Default is `true`. All existing accounts get banners enabled — matches the goal of consistency. |

## Testing strategy

Per [.claude/rules/testing.md](.claude/rules/testing.md). Vitest. Mock external services.

### Unit — `labelEngine`

Heavy coverage, every band, every boundary:
- Each label band produces the right text.
- 17:00 boundary (16:59 vs 17:00).
- Same-weekday-7-days case → `NEXT [WEEKDAY]`.
- Calendar-week boundary (Saturday → next Tuesday).
- Both 2026 DST transition Sundays.
- `target < now` → `null`.

### Unit — `bannerConfigResolver`

- All-null override → account defaults.
- Partial override (e.g. position set, colours null) → mixed.
- `banner_enabled = false` on post → off, regardless of override.
- Override text + `enabled = false` → still off.

### Component — `<BannerOverlay />`

Render with fixture inputs:
- Each position places strip correctly.
- Long override text doesn't overflow.
- `enabled = false` renders nothing.

### Integration — `renderBannerServer`

Three image fixtures: 1080×1080, 1080×1350, 1080×1920.

For each:
- Output is valid JPEG.
- Strip on the configured edge.
- Output dimensions match input dimensions.
- Output is byte-stable across runs.

### Integration — publish worker

Mocked platform clients.
- Post with banner enabled and label non-null → worker calls `renderBannerServer` and uploads buffer.
- Post with `banner_enabled = false` → worker uploads source path directly.
- Post with `label = null` and no override → worker uploads source path directly.

### Migration check (manual, local)

- `npx supabase db push --dry-run` first.
- Apply locally against a snapshot with seeded posts in each old `banner_state`.
- Verify dropped columns gone, new columns populated from `prompt_context.bannerConfig` where present.
- Verify `posting_defaults` rows have new columns with defaults.
- Verify storage cleanup of `bannered_media_path` JPEGs.

### Coverage targets

- 90% on `labelEngine` and `bannerConfigResolver` (pure functions).
- 80% on `renderBannerServer`.
- Behavioural tests on the publish worker.

## Files affected

### New

- `src/lib/banner/config.ts` — `bannerConfigResolver` + types.
- `src/lib/banner/render-server.ts` — `renderBannerServer` (consolidates banner-canvas server logic and the API route).
- `src/features/planner/banner-overlay.tsx` — single `<BannerOverlay />` component.
- `supabase/migrations/{timestamp}_banner_overlay_consistency.sql` — schema migration + storage cleanup.

### Modified

- [src/lib/scheduling/proximity-label.ts](src/lib/scheduling/proximity-label.ts) — extend label set, add `NEXT [WEEKDAY]` and date format.
- [src/lib/create/service.ts](src/lib/create/service.ts) — drop banner_state writes, drop `prompt_context.bannerConfig` writes (config goes to override columns directly).
- [src/app/(app)/planner/actions.ts](src/app/(app)/planner/actions.ts) — drop the approve-time banner re-render dance and the staleness check. Keep the `updatePlannerContentBody` and reschedule actions but remove banner work — banner is now derived.
- [src/lib/scheduling/banner-renderer.server.ts](src/lib/scheduling/banner-renderer.server.ts) — delete (logic moves to `render-server.ts`).
- [src/lib/scheduling/banner-canvas.ts](src/lib/scheduling/banner-canvas.ts) — delete (replaced by `render-server.ts` + the `<BannerOverlay />` SVG component).
- [src/lib/scheduling/banner-canvas.test.ts](src/lib/scheduling/banner-canvas.test.ts) — delete (replaced).
- `src/app/api/internal/render-banner/route.ts` — delete (no longer called).
- `scripts/ops/repair-banner-overlays.ts` — delete (no banners to repair when banners are derived).
- [src/features/planner/banner-rendered-preview.tsx](src/features/planner/banner-rendered-preview.tsx) — delete.
- [src/features/planner/banner-overlay-preview.tsx](src/features/planner/banner-overlay-preview.tsx) — delete (replaced by new `<BannerOverlay />`).
- [src/features/planner/banner-controls.tsx](src/features/planner/banner-controls.tsx) — drop "render now" UI; just edit overrides.
- [src/features/planner/planner-content-composer.tsx](src/features/planner/planner-content-composer.tsx) — swap to new overlay component.
- [src/features/planner/planner-calendar.tsx](src/features/planner/planner-calendar.tsx) — swap to new overlay component.
- [src/features/link-in-bio/public/link-in-bio-public-page.tsx](src/features/link-in-bio/public/link-in-bio-public-page.tsx) — swap to new overlay component.
- [supabase/functions/publish-queue/worker.ts](supabase/functions/publish-queue/worker.ts) — call `renderBannerServer` inline; drop staleness check; drop `bannered_media_path` substitution.
- [src/lib/planner/data.ts](src/lib/planner/data.ts) — select new override columns; drop reads of dropped columns.
- Account preferences page — add a banner-defaults section. The exact settings page is identified during implementation by reading existing app routes.

## Migration / rollout plan

Two-phase: add-and-coexist first, drop-and-cleanup last. Every commit keeps the build green and tests passing.

**Migration 1 — additive only.**
- Add the new columns to `content_variants` and `posting_defaults`.
- Data step: copy values from `prompt_context.bannerConfig` into the new override columns where present.
- No drops. No storage cleanup. Old columns remain populated.

**Commit A — `labelEngine` + `bannerConfigResolver`.** Pure functions, no call sites yet. Tested in isolation.

**Commit B — `<BannerOverlay />` component.** New component, but no call sites swap yet. Tested in isolation.

**Commit C — swap UI call sites.** Replace `BannerRenderedPreview` and `BannerOverlayPreview` usage with `<BannerOverlay />` everywhere. Delete the two old components. Verify planner, calendar, link-in-bio public page.

**Commit D — `renderBannerServer` + publish worker swap.** New server renderer wired into [supabase/functions/publish-queue/worker.ts](supabase/functions/publish-queue/worker.ts). Worker stops reading `bannered_media_path` and stops checking `banner_rendered_for_scheduled_at`.

**Commit E — account preferences UI.** Add a section to the existing settings page for the four account-default fields. (The settings location is identified during implementation by reading the existing app routes.)

**Migration 2 — drop and cleanup.**
- Drop the old `banner_*` columns from `content_variants`.
- Delete bannered JPEGs from Supabase Storage.
- Function audit per [.claude/rules/supabase.md](.claude/rules/supabase.md): grep for the dropped column names in PL/pgSQL functions and triggers; update any matches.

**Commit F — delete dead code.**
- Delete [src/lib/scheduling/banner-canvas.ts](src/lib/scheduling/banner-canvas.ts) and its test.
- Delete [src/lib/scheduling/banner-renderer.server.ts](src/lib/scheduling/banner-renderer.server.ts).
- Delete `src/app/api/internal/render-banner/route.ts`.
- Delete `scripts/ops/repair-banner-overlays.ts` and its `package.json` script entry.
- Strip remaining reads of `prompt_context.bannerConfig`.

## Out of scope

- Banner copy A/B testing.
- Per-platform banner styling.
- Multilingual labels.
- User-uploaded banner backgrounds.
- Animated banners.
- Banner click tracking.
