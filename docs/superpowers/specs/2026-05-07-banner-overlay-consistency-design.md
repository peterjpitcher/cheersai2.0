# Banner Overlay Consistency — Design

**Date:** 2026-05-07
**Author:** Brainstormed with Peter
**Status:** Design approved (post-codex-qa-review), awaiting implementation plan
**Adversarial review:** [tasks/codex-qa-review/2026-05-07-banner-overlay-consistency-adversarial-review.md](../../tasks/codex-qa-review/2026-05-07-banner-overlay-consistency-adversarial-review.md) — applied 10 material findings

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
): ResolvedConfig;
```

Resolution rules:
- Each field falls through from `postOverrides` to `accountDefaults` if `null`.
- `enabled = false` on the post wins over enabled at account level.
- `textOverride` only applies when `enabled = true`.

Content type (feed vs story) does not affect config resolution — the renderer (`renderBannerServer`) and the overlay component handle aspect-ratio differences themselves by inspecting media dimensions. The resolver is intentionally content-type-agnostic.

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

### `content_variants` — drop columns (Migration 2 only)

- `banner_state`
- `banner_label`
- `banner_source_media_path`
- `bannered_media_path`
- `banner_render_metadata`
- `banner_rendered_for_scheduled_at`

Storage cleanup of the rendered JPEGs is **not** part of the SQL migration — see *Storage cleanup* below.

### `content_variants` — add columns (Migration 1; all nullable; null means inherit account default)

- `banner_enabled boolean`
- `banner_text_override text` with `CHECK (banner_text_override IS NULL OR char_length(banner_text_override) <= 20)`
- `banner_position text` with `CHECK (banner_position IS NULL OR banner_position IN ('top','bottom','left','right'))`
- `banner_bg text` with `CHECK (banner_bg IS NULL OR banner_bg ~ '^#[0-9A-Fa-f]{6}$')`
- `banner_text_colour text` with `CHECK (banner_text_colour IS NULL OR banner_text_colour ~ '^#[0-9A-Fa-f]{6}$')`

### `posting_defaults` — add columns (Migration 1; same CHECK constraints as above)

- `banners_enabled boolean not null default true`
- `banner_position text not null default 'bottom'` — `CHECK (banner_position IN ('top','bottom','left','right'))`
- `banner_bg text not null default '#000000'` — `CHECK (banner_bg ~ '^#[0-9A-Fa-f]{6}$')`
- `banner_text_colour text not null default '#FFFFFF'` — `CHECK (banner_text_colour ~ '^#[0-9A-Fa-f]{6}$')`

### `prompt_context` data copy (Migration 1)

The current `bannerConfig` blob inside `prompt_context` (jsonb) is no longer authoritative.

Migration data step: for each `content_variants` row where `banner_enabled IS NULL` and `prompt_context->'bannerConfig'` exists, copy values into the new override columns **with validation**:

- `banner_enabled` ← `bannerConfig.enabled` if it's a real boolean, else null.
- `banner_text_override` ← `bannerConfig.textOverride` only if it's a string of length ≤ 20, else null.
- `banner_position` ← `bannerConfig.position` only if it's one of `top/bottom/left/right`, else null.
- `banner_bg` ← `bannerConfig.bgColour` only if it matches `^#[0-9A-Fa-f]{6}$`, else null.
- `banner_text_colour` ← `bannerConfig.textColour` only if it matches `^#[0-9A-Fa-f]{6}$`, else null.

Invalid legacy values become null, which means "inherit account default". The migration logs the count of rows where each field was rejected so the team can verify nothing material was lost.

After migration code stops reading the `prompt_context.bannerConfig` blob. The blob itself is left in place (cheap, harmless) and only its read paths are removed.

### Storage cleanup — separate ops script

The bannered JPEGs at `banners/{contentId}/{variantId}.jpg` cannot be deleted by SQL. A dedicated ops script handles them after Migration 2:

- Location: `scripts/ops/cleanup-banner-storage.ts`.
- Uses Supabase Storage API with the service-role key.
- Lists every object under the `banners/` prefix (paginated) and deletes them.
- Idempotent — safe to re-run. Partial failure is acceptable because the DB no longer references these files; the script reports any per-file errors and exits non-zero so the operator can re-run.
- Run once after Migration 2 ships. Documented in the rollout plan.

### Function audit

Per [.claude/rules/supabase.md](.claude/rules/supabase.md), grep all PL/pgSQL functions and triggers for the dropped column names in Migration 2. Update any matches in the same migration.

### Function audit

Per [.claude/rules/supabase.md](.claude/rules/supabase.md), grep all PL/pgSQL functions and triggers for the dropped column names in the same migration. Update any matches.

## Label engine rules

### Picking `target`

| Campaign type | `target` |
|---|---|
| Event | the linked event's `start_at` (event has a fixed real-world date the post is *about*). |
| Promotion | the post's `scheduled_for`. Each phase is one row in `content_items`; the post date is the phase. |
| Weekly | the post's `scheduled_for`. |
| Instant / ad-hoc | the post's `scheduled_for`. |
| Story / story-series | the post's `scheduled_for`. Each frame is its own `content_variant` row and resolves independently. |

Rule: `target = event_start_at` for event posts; `target = scheduled_for` for everything else.

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
config           := bannerConfigResolver(account_defaults, post_overrides)
```

### Resolving label

```
target := event_start_at  (event posts)
       |  scheduled_for    (everything else)
label  := labelEngine(target, now, 'Europe/London', event_end_at?)
```

`now` is whatever clock the surface uses — browser clock for UI, server clock at render time for publish. The browser clock is sampled by a one-minute ticker (see *UI clock refresh* below) so a long-lived planner view crosses the 17:00 / midnight boundary correctly.

### Surface 1: Planner UI (composer, calendar, link-in-bio public page)

1. Read `content_variants` and `posting_defaults` from server.
2. Resolve config + label client-side.
3. Render `<BannerOverlay />` over source media.
4. Re-render whenever the user edits inputs (schedule, override, position, colours).
5. Re-render every minute via the shared `useNowMinute()` hook so labels cross 17:00 / midnight boundaries while the page stays open.

No banner data persisted from this surface.

### UI clock refresh — `useNowMinute()`

A small shared hook in `src/lib/hooks/use-now-minute.ts`:

- Returns a `Date` aligned to the start of the current minute, in `Europe/London`.
- Updates exactly once per wall-clock minute (uses a `setTimeout` aligned to the next minute boundary, then `setInterval(60_000)`).
- All `<BannerOverlay />` instances on a page share the same value, so they tick together with one timer per page.
- Cleared on unmount.

The hook is also used by any other surface that needs to display relative-time UI (planner cards' "in 2 hours" labels, scheduling badges, etc. — out of scope for this spec but built generically).

### Surface 2: Account preferences

Read/write `posting_defaults`. Standard form.

### Surface 3: Publish worker ([supabase/functions/publish-queue/worker.ts](supabase/functions/publish-queue/worker.ts))

The render must happen **before** the platform upload begins so a render failure does not leave a half-published post. Order of operations inside one job attempt:

1. Pick up due `publish_jobs` row (status `queued` → `processing`).
2. Load `content_variants` and `posting_defaults`.
3. Resolve config + label using server clock.
4. **Preflight render**: if `config.enabled` and label is non-null:
   - Stream source image from `media_assets.storage_path` into Sharp.
   - `renderBannerServer(stream, config, label)` → JPEG buffer (held in memory).
   - On failure: set `publish_jobs.status = 'failed'`, populate `last_error` with a stable error code (`BANNER_RENDER_FAILED`) and a human-readable message, schedule the next retry per existing retry policy (`next_attempt_at`), and **return without touching the platform API**. No partial publish.
5. **Platform upload**: pass either the rendered buffer (if step 4 produced one) or the source image (if banner disabled / label null / no override) to the platform API.
6. On platform-API failure, follow existing retry semantics (unchanged by this design).
7. Buffer is held in memory only and goes out of scope after upload. Never persisted.

### Account-default changes while jobs are queued

Account-default writes take effect immediately for *every* surface, including jobs that are already in the queue. This is by design — banners are derived data, not snapshots. If the user changes their default colour at 09:00 and a post publishes at 10:00, the post uses the new colour.

The trade-off is intentional and was approved during brainstorming (Q2). Documented here to prevent future debate. If the team ever wants snapshot-at-approval semantics, that is a separate spec.

### Where banner state changes (write paths)

- Account preferences page → `posting_defaults` (account-wide).
- `<BannerControls />` in planner composer → `content_variants` overrides.

Both write paths are server actions that follow the standard pattern from [.claude/rules/supabase.md](.claude/rules/supabase.md): server-side `getUser()` re-verify, ownership join through `accounts`, Zod validation of the input, audit log via `logAuditEvent()`, `revalidatePath()` on success. No new auth machinery; just lean on the existing convention.

No other write paths.

## Edge cases and error handling

| Case | Handling |
|---|---|
| Sharp render failure at publish | Caught in publish worker preflight (Surface 3 step 4). Job goes to `failed`, `last_error = "BANNER_RENDER_FAILED: …"`, `next_attempt_at` set per existing retry policy. **No platform API call is made.** Post stays unpublished. |
| Source image missing from storage | Same as render failure. Same error code so dashboards aggregate cleanly. |
| Override text > 20 chars | Three-layer defence: client-side input validation in `<BannerControls />`; Zod validation in the server action; DB CHECK constraint. Anything that bypasses all three is a programming error worth crashing on. |
| Post-event timing (event was 19:00, publish runs 19:30) | Computed label is `null`. If override set → publish with override. If no override → publish without banner. Don't fail the publish. |
| DST transition days | Luxon handles. Tested for both annual transitions. |
| Per-platform aspect ratios | `renderBannerServer` inspects dimensions and uses proportional strip sizing. No per-platform branches. |
| `enabled = false` + override set | Disabled wins. No banner. |
| Story-series multi-frame partial failure | Each story frame is its own `content_variants` row with its own `publish_jobs` row. Frames render and publish independently. One frame's render failure does not block the others — partial success is the expected outcome and matches the existing publish-queue semantics. |
| In-flight posts at Migration 1 time | Migration 1 is additive. Old code paths still work. |
| In-flight posts at Migration 2 time | By Migration 2, all reads of the dropped columns have been removed (Commits B–F land first). Drop is safe. |
| Existing `prompt_context.bannerConfig` blobs | Migration 1 data step copies validated values into new override columns; invalid legacy values fall back to account defaults. Read paths removed in Commit F. |
| Existing accounts with no `posting_defaults.banners_enabled` | Default is `true`. All existing accounts get banners enabled — matches the goal of consistency. |
| Account-default change while jobs are queued | Documented behaviour, not a bug. See *Account-default changes while jobs are queued* in the data-flow section. Always-current is the trade-off chosen in brainstorming Q2. |
| UI page open across 17:00 / midnight | `useNowMinute()` ticks every wall-clock minute; labels recompute and re-render automatically. |

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

### Unit — `useNowMinute()`

- Returns a value at the start of the current minute on first render.
- Updates exactly once per minute (use Vitest fake timers).
- All consumers on a page see the same value.
- Cleans up its timer on unmount (no leaks).

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
- **`renderBannerServer` throws** → job ends in `status = 'failed'`, `last_error` populated with `BANNER_RENDER_FAILED`, `next_attempt_at` set, **no platform-client call is made**. Verified by asserting the platform-client mock was not called.

### Migration check (manual, local)

- `npx supabase db push --dry-run` against both migration files.
- Apply Migration 1 locally against a snapshot with seeded posts that include:
  - rows where `prompt_context.bannerConfig` has fully valid values,
  - rows where it has invalid hex colours / invalid positions / overlong override text,
  - rows where the blob is missing entirely.
- Verify each row's new override columns are correct (valid → copied; invalid → null; missing → null) and that the migration log reports the right rejection counts.
- Verify CHECK constraints reject hand-rolled invalid INSERTs.
- Apply Migration 2 locally and verify dropped columns are gone and the function-audit step touched the expected functions.
- Run `scripts/ops/cleanup-banner-storage.ts` against a local Supabase Storage seed; verify objects under `banners/` are gone and the script is idempotent on a second run.

### Coverage targets

- 90% on `labelEngine` and `bannerConfigResolver` (pure functions).
- 80% on `renderBannerServer`.
- Behavioural tests on the publish worker.

## Files affected

### New

- `src/lib/banner/config.ts` — `bannerConfigResolver` + types.
- `src/lib/banner/render-server.ts` — `renderBannerServer` (consolidates banner-canvas server logic and the API route).
- `src/features/planner/banner-overlay.tsx` — single `<BannerOverlay />` component.
- `src/lib/hooks/use-now-minute.ts` — shared minute-aligned clock hook for relative-time UI.
- `supabase/migrations/{timestamp1}_banner_overlay_add_columns.sql` — Migration 1 (additive): new columns, CHECK constraints, validated data copy from `prompt_context.bannerConfig`.
- `supabase/migrations/{timestamp2}_banner_overlay_drop_columns.sql` — Migration 2 (cleanup): drop old `banner_*` columns, function-audit fixes.
- `scripts/ops/cleanup-banner-storage.ts` — ops script to delete leftover JPEGs from Supabase Storage (run once after Migration 2).

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

**Migration 1 — additive (one SQL file, one commit).**
- Add the new override columns to `content_variants` with CHECK constraints (position enum, hex regex, length).
- Add the four account-default columns to `posting_defaults` with CHECK constraints and `NOT NULL` defaults.
- Data step: validated copy from `prompt_context.bannerConfig` into the new override columns. Invalid legacy values become null. Migration logs per-field rejection counts.
- No drops. No storage cleanup. Old columns remain populated.

**Commit A — `labelEngine` extension + `bannerConfigResolver` + `useNowMinute`.** Pure functions and the clock hook. No call sites yet. Tested in isolation.

**Commit B — `<BannerOverlay />` component.** New component using the new hook. No call sites swap yet. Tested in isolation.

**Commit C — swap UI call sites.** Replace `BannerRenderedPreview` and `BannerOverlayPreview` usage with `<BannerOverlay />` everywhere. Delete the two old components. Verify planner, calendar, link-in-bio public page.

**Commit D — `renderBannerServer` + publish worker swap.** New server renderer wired into [supabase/functions/publish-queue/worker.ts](supabase/functions/publish-queue/worker.ts) using the publish-time order of operations spelled out in *Surface 3*. Worker stops reading `bannered_media_path` and stops checking `banner_rendered_for_scheduled_at`.

**Commit E — account preferences UI.** Add a section to the existing settings page for the four account-default fields. (The settings location is identified during implementation by reading the existing app routes.)

**Migration 2 — cleanup (one SQL file, one commit).**
- Drop the old `banner_*` columns from `content_variants`.
- Function audit per [.claude/rules/supabase.md](.claude/rules/supabase.md): grep for the dropped column names in PL/pgSQL functions and triggers; update any matches in the same migration.

**Commit F — delete dead code.**
- Delete [src/lib/scheduling/banner-canvas.ts](src/lib/scheduling/banner-canvas.ts) and its test.
- Delete [src/lib/scheduling/banner-renderer.server.ts](src/lib/scheduling/banner-renderer.server.ts).
- Delete `src/app/api/internal/render-banner/route.ts`.
- Delete `scripts/ops/repair-banner-overlays.ts` and its `package.json` script entry.
- Strip remaining reads of `prompt_context.bannerConfig`.

**Post-cleanup ops step — storage deletion.**
- Run `scripts/ops/cleanup-banner-storage.ts` once after Migration 2 + Commit F have shipped to all environments where they apply. Documented in the script header and the team's deployment runbook. Idempotent.

## Out of scope

- Banner copy A/B testing.
- Per-platform banner styling.
- Multilingual labels.
- User-uploaded banner backgrounds.
- Animated banners.
- Banner click tracking.
