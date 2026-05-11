# Wave 2 Handoff: Frontend Implementer

Date: 2026-05-10
Branch: `main` (no worktree)

## Files Modified

- `src/features/create/instant-post-form.tsx`
  - **Imports added (lines 32–37):** `BannerDefaultsPicker` from `@/features/create/banner-defaults-picker`; `DEFAULT_BANNER_DEFAULTS` and `BannerDefaults` from `@/lib/scheduling/banner-config`. Added a small local `BannerSelection` interface alongside the existing module-level types.
  - **Local state (line 95):** `const [banner, setBanner] = useState<BannerSelection>({ enabled: false })`. Defaults to OFF on every mount and after every successful submit.
  - **Submit payload (line 224):** `body: JSON.stringify({ ...values, banner })` — appends the banner field to the existing form values being POSTed to `/api/create/generate-stream`. Shape matches `bannerInputSchema` exported from `@/lib/create/schema`.
  - **Reset on success (line 308):** `setBanner({ enabled: false })` runs after `form.reset(...)` so the next post starts from the safe default.
  - **New "Banner overlay" stage (lines 677–723):** inserted between the existing `creative` (media attachments) stage and the `generate` (generate & review) stage. Uses the existing accordion stage shape; the picker only renders when the toggle is ON. The toggle is a native checkbox (consistent with other booleans in the campaign forms).
  - **Story caption-preview swap (lines 740–755):** when `placement === "story"`, the `<StreamingPreview />` component is replaced with a small slate-500 paragraph: "Stories don't need a caption — your image is the post." The message only renders while generation is active or after the result is set, so the panel doesn't appear before the user clicks Generate.

## Commits

1. `ba08d75` — `feat(create): add banner overlay picker stage to instant post form`

## What Changed in the UI

- New "Banner overlay" stage in the instant-post accordion, sitting between "Creative choices" and "Generate & review".
- Toggle labelled exactly **"Add a banner overlay"** with a sub-label explaining what it does. Defaults to OFF.
- When ON, the existing `BannerDefaultsPicker` appears (position + bg colour + text colour with a live preview swatch).
- For story placements, the streaming caption preview panel is hidden. In its place, a small message appears once the user clicks Generate: **"Stories don't need a caption — your image is the post."**
- Submit payload now carries `banner: { enabled: boolean; defaults?: BannerDefaults }` to the route, which already accepts and forwards it (Wave 2 backend is in place).

## Verification

- `npx tsc --noEmit` — clean (exit 0).
- `npm run lint:ci` — clean, zero warnings.
- `CI=1 npx vitest run tests/lib/create/service.test.ts tests/api/generate-stream-route.test.ts` — **21 / 21 PASS** (all 6 contract tests still GREEN; no regressions in the service or route test files).
- `git log --oneline -1` — top commit is `ba08d75 feat(create): add banner overlay picker stage to instant post form`.

## Assumptions Made

- **Stage placement.** The brief said "between channels & timing and generate & review". The form has a `creative` (media) stage between channels and generate, so I placed Banner immediately after `creative` (i.e. it's the second-to-last stage). This keeps the order natural: choose media → choose banner → generate. Inserting Banner before `creative` would have separated channel selection from media in an unexpected way.
- **Toggle primitive.** The brief said to use whatever boolean control the form already uses. The form itself uses radios for publishMode and `<Button>` toggles for placement/platforms — neither is an obvious fit for a single boolean. The campaign-form siblings (`event-campaign-form.tsx`, `promotion-campaign-form.tsx`, `weekly-campaign-form.tsx`) all use native `<input type="checkbox">` for booleans, so I followed that pattern. Native checkbox + `<label>` wrapper preserves screen-reader behaviour, focus styles via Tailwind ring, and `aria-expanded` reflects the disclosure state for the picker panel.
- **`aria-expanded` on the toggle.** Set to `banner.enabled` because the toggle controls whether the picker disclosure is rendered. This is how the rest of the project signals collapsible disclosure state on toggles.
- **State persistence on toggle off.** When the user toggles OFF, I clear `defaults` (set state to `{ enabled: false }`). Re-toggling ON re-uses `DEFAULT_BANNER_DEFAULTS`. The alternative (preserve last-chosen defaults across toggle cycles) was tempting but adds state complexity and could confuse users into thinking the picker remembered settings from a prior post. Safer to start fresh; the user can re-pick in 2 clicks.
- **Story caption-preview render condition.** I gated the friendly message on `progressActive || result` so it only appears once the user has clicked Generate. Showing it always (even before Generate) would clutter the panel with a message that doesn't apply to the user's current intent. The non-story path is unchanged — `StreamingPreview` handles its own visibility internally.
- **Reset on submit success.** Added `setBanner({ enabled: false })` in the success branch so subsequent posts in the same session start from the safe default. Without this the banner state would persist across submissions, which would surprise users.
- **`controls.goToNext()` instead of typed-fields validation.** The Banner stage has no react-hook-form fields, so the existing `goToNextWhenValid` helper isn't needed. A direct `controls.goToNext()` matches the "Generate & review" stage's pattern of skipping validation when the stage owns no form fields.
- **No "Back" button on the Banner stage.** None of the existing stages render a Back button — they rely on the accordion's native click-to-toggle for backwards navigation. I followed the same pattern for consistency.

## Issues Encountered

- None. The schema (Wave 1) and backend (Wave 2 backend implementer) were already wired to receive `banner`, so the form change is genuinely additive — no boundary work was needed beyond adding the field to the JSON body.
- The TodoWrite-tool reminders fired multiple times during the task; ignored as instructed because the work was small enough to track inline.

## Diff Stats

- `src/features/create/instant-post-form.tsx`: +78 -7 (one file, one commit)

## What The Orchestrator Should Verify

- Run `npm run ci:verify` (full lint + typecheck + test + build) to confirm the wider build still passes — the 6 contract tests are green but the broader suite hasn't been re-run from this seat.
- Manual smoke (dev server) per PLAN §Phase 6 step 5:
  - Open the instant-post form → confirm "Add a banner overlay" toggle is OFF by default.
  - Toggle ON → BannerDefaultsPicker appears.
  - Submit a story without enabling banner → posts publish to FB & IG with NO overlay; caption-preview message reads "Stories don't need a caption…".
  - Submit a story with banner enabled → posts publish WITH overlay using chosen colours.
  - Submit a feed post without enabling banner → caption is generated normally; no overlay.
- Trigger codex-qa-review on the diff if desired — the form change is small (+78 -7) but the picker stage is the only user-visible part of the wider fix, so an extra eye on UX wouldn't hurt.
