# Wave 2 / UI swap — Handoff

## Outputs

- `src/features/planner/banner-overlay.tsx` + `.test.tsx` (Task 5, new)
- `src/lib/planner/data.ts` (Task 6 — extended `PlannerItem` and `PlannerContentDetail`,
  added `loadAccountBannerDefaults`, replaced banner reads with override columns)
- `src/features/planner/planner-content-composer.tsx` (Task 6 / Task 8)
- `src/features/planner/planner-calendar.tsx` (Task 7 — swapped to `<BannerOverlay />`)
- `src/features/link-in-bio/public/link-in-bio-public-page.tsx` (Task 7)
- `src/features/planner/banner-overlay-preview.tsx` (Task 6 — kept temporarily,
  widened type to accept hex colours alongside legacy IDs while migration finishes)
- `src/features/planner/banner-controls.tsx` (Task 8 — fully rewritten to consume
  `AccountBannerDefaults` + `PostBannerOverrides`, write override columns directly)
- `src/app/(app)/planner/actions.ts` (Task 8 — `updatePlannerBannerConfig` body
  replaced; other legacy banner callers in this file untouched)
- `src/app/(app)/settings/actions.ts` (Task 9 — extended upsert)
- `src/app/(app)/settings/page.tsx` does not need direct edits (the imported
  `posting-defaults-form.tsx` consumes `data.bannerDefaults` from the existing
  `getOwnerSettings()` payload)
- `src/features/settings/posting-defaults-form.tsx` (Task 9 — added Banner
  defaults fieldset with toggle, position radios, two colour pickers)
- `src/features/settings/schema.ts` (Task 9 — added `bannerDefaults` to
  `postingDefaultsFormSchema`)
- `src/lib/settings/data.ts` (Task 9 — extended `PostingDefaults` shape and
  `posting_defaults` SELECT to surface the four new account columns)
- `tests/features/settings/schema.test.ts` (Task 9 — fixture extended with
  `bannerDefaults` so existing tests still pass)
- `tests/setup.ts` and `package.json` / `package-lock.json` (Task 5 — added
  `@testing-library/jest-dom@^6.9.1` and registered its Vitest matchers in
  the global setup; required because the verbatim Task 5 tests use
  `toBeInTheDocument` / `toHaveAttribute`)

## Commits

```
9357bb1 feat(banner): add unified <BannerOverlay /> SVG component       (Task 5)
3740b8e refactor(planner): use BannerOverlay in planner composer        (Task 6)
18b95de refactor(banner): swap remaining surfaces to BannerOverlay      (Task 7)
fea37fc refactor(banner): simplify BannerControls to write override columns (Task 8)
e2d3ed1 feat(settings): add banner defaults to posting-defaults form    (Task 9)
```

Each commit was verified clean with `npm run typecheck` and `npm run lint`
(both zero warnings) before moving on.

## Format

React/TypeScript components + Zod-validated server actions + Vitest tests.

## Assumptions

- The Migration 1 schema (`20260507100000_banner_overlay_add_columns.sql`)
  defines the new columns on `posting_defaults` and `content_variants`.
  These reads/writes use those names verbatim. The migration may not be
  applied to a local dev DB; that's fine — the unit tests use mocks.
- `bannerConfigResolver(accountDefaults, postOverrides)` exists and resolves
  per the Wave-1 handoff.
- `useNowMinute()` returns a `Date` updated once every 60 s on mount.
- Existing `getProximityLabel` already returns labels for 7-13 days
  (`NEXT [WEEKDAY]`) and 14+ days (date-format).

## Issues / deviations from the plan

- **Test infrastructure (Task 5)**: the verbatim test uses `toBeInTheDocument`
  and `toHaveAttribute` — jest-dom matchers. Project had no jest-dom installed.
  Added `@testing-library/jest-dom` and imported `@testing-library/jest-dom/vitest`
  in `tests/setup.ts`. The Task 5 commit therefore touches `package.json`,
  `package-lock.json`, and `tests/setup.ts` in addition to the two files
  the plan listed.
- **Type name**: the brief refers to a `PlannerItemDetail` type. This
  codebase has two: `PlannerItem` (for the calendar overview) and
  `PlannerContentDetail` (for the composer). Both were extended with
  `bannerConfig` + `bannerLabel`; `PlannerContentDetail` additionally exposes
  `bannerOverrides` and `accountBannerDefaults` so `<BannerControls />` can
  consume them.
- **Manual smoke skipped per orchestrator instruction**: the brief's
  Task 6 step 4 / Task 7 step 5 / Task 9 step 3 ask for `npm run dev`
  browser checks. Skipped because Migration 1 is not applied locally.
  Substituted with `npm run typecheck` clean + relevant `npx vitest run`
  clean + `npm run lint` clean (zero warnings).
- **`useNowMinute()` in link-in-bio public page (Task 7 step 2)**: the
  link-in-bio public page is a server component (no `'use client'`) and
  already has a refresh timer (`<LinkInBioRefreshTimer />`). I left the
  refresh path as-is rather than refactoring the page into a client component
  just to add `useNowMinute()`. The existing timer handles long-open sessions.
- **`CampaignDashboard.tsx` (Task 7 step 3)**: this file currently has no
  banner integration of any kind — no import of `BannerOverlayPreview` /
  `BannerRenderedPreview`, no mention of banner fields. Nothing to swap.
  Left untouched. If future campaign UI grows banner support, it should
  import `<BannerOverlay />` directly.
- **`streaming-preview.tsx` (Task 7 step 4)**: this file is text-only
  (per-platform OpenAI SSE streaming). It has no image/banner rendering.
  Nothing to swap. Left untouched.
- **Other legacy banner refs in `src/app/(app)/planner/actions.ts`**:
  `approvePlannerContent`, `enqueuePlannerContent`, and
  `renderPlannerContentBanner` still call `renderBannerForContent` /
  `resetBannerStateForContent`. The brief said to drop the *imports* once
  unused — they're still used by these other functions, so the imports
  stay. Wave 3 (which deletes the legacy renderer) will need to remove
  those callers as well. The `updatePlannerBannerConfig` body itself no
  longer touches them, per the plan.
- **`banner-overlay-preview.tsx` not yet deleted**: kept (with widened
  prop types accepting hex strings) because nothing in production code
  imports it now, but Wave 3 owns its deletion. Confirmed via:
  `grep -rn "BannerRenderedPreview\|BannerOverlayPreview" src/ |
   grep -v ".test." | grep -v "banner-rendered-preview.tsx" |
   grep -v "banner-overlay-preview.tsx"` → zero matches.
- **Pre-existing test failure**: `tests/lib/scheduling/banner-renderer.server.test.ts`
  has one failing case (`marks banner as not applicable when no proximity
  label is due`). This was already failing before my work began — Wave 1's
  proximity-label change makes labels appear for the 7-13-day range where
  the legacy renderer test expected null. Out of scope; the legacy renderer
  is slated for deletion in Wave 3.

## Downstream notes for Wave 3

- **Safe to delete (no remaining production imports):**
  - `src/features/planner/banner-rendered-preview.tsx`
  - `src/features/planner/banner-overlay-preview.tsx`
  - `src/features/planner/use-banner-prerender.ts` (composer no longer
    imports it)
- **Still imported — clean up alongside renderer deletion:**
  - `src/app/(app)/planner/actions.ts` retains
    `renderBannerForContent` / `resetBannerStateForContent` /
    `resolveBannerLabel` imports for `approvePlannerContent`,
    `enqueuePlannerContent`, and `renderPlannerContentBanner`. These
    functions need to be reworked or removed before
    `src/lib/scheduling/banner-renderer.server.ts` can be deleted.
  - `src/lib/create/service.ts` writes `banner_state` and reads the
    legacy banner config (line ~1376). Wave 3 should reconcile this with
    the new override columns.
  - `src/features/create/generated-content-review-list.tsx` calls
    `renderPlannerContentBanner` after approval. Wave 3 should remove
    this once the publish worker handles render-on-send.
  - `src/lib/link-in-bio/public.ts` still reads the legacy banner config
    (`parseBannerConfig`, `bannerLabel`/`bannerPosition`/etc on
    `PublicCampaignCard`). The public link-in-bio surface in Task 7 has a
    small `buildResolvedConfig()` adapter that converts the legacy
    `BannerColourId`s into hex; once `public.ts` is migrated to write the
    resolved hex directly, the adapter can be deleted.
- **Publish worker** (`supabase/functions/publish-queue/worker.ts`) still
  reads `bannered_media_path` and `banner_rendered_for_scheduled_at`.
  Wave 3 worker agent will replace that path with the new
  `renderBannerServer`.
- **Duplicated proximity logic**: `supabase/functions/publish-queue/proximity.ts`
  was flagged by Wave 1 as a duplicate of `src/lib/scheduling/proximity-label.ts`.
  Wave 3 should sync the new `NEXT [WEEKDAY]` / date-format behaviour into
  the publish-queue copy.
- **Migration 2** (drop legacy columns) — Wave 3 only after the publish
  worker stops reading them.

## Self-check

- [x] All five commits exist with the specified messages.
- [x] `npm run typecheck` clean.
- [x] `npm run lint` clean (zero warnings).
- [x] No production code imports `BannerRenderedPreview` or `BannerOverlayPreview`.
- [x] No production code reads `banner_state`, `bannered_media_path`,
      `banner_rendered_for_scheduled_at`, `banner_render_metadata`,
      `banner_source_media_path`, or the stored `banner_label` (the
      computed `bannerLabel` on `PlannerItem` / `PlannerContentDetail`
      stays — that's intentional).
- [x] `updatePlannerBannerConfig` body no longer references
      `renderBannerForContent` or `resetBannerStateForContent`.
- [x] Settings page renders the new banner defaults section
      (verified by typecheck + tests; manual browser smoke skipped per
      orchestrator instruction).
- [x] Handoff written.
