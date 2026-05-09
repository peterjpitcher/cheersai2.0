# Tofu fix — Handoff

## Commits
- 9f9064f Task 2: feat(banner): add BANNER_OVERLAY_DISABLED kill switch
- 89f5561 Task 3: fix(banner): generate SVG <path> data from bundled TTF
- 3852a65 Task 4: test(banner): SVG <path> shape + visual sanity assertions
- 04e80a5 Task 5: chore(banner): remove diagnostic endpoint and unused base64 font module

## What was deleted
- `src/lib/banner/assets/font-data.ts` — base64-embedded font module from the previous (failed) e336b7b attempt; `text-to-svg` reads the binary TTF directly so this is no longer needed.
- (Task 1 diag endpoint — was not added this round; Task 1 falsification was skipped per the brief because the path-rendering refactor in Task 3 bypasses font lookup entirely and fixes the symptom regardless of the exact librsvg cause.)

## What was added
- `text-to-svg@^3.1.5` regular dependency (parses TTF via opentype.js, emits SVG path data).
- `BANNER_OVERLAY_DISABLED` kill switch — gated in both `supabase/functions/publish-queue/worker.ts` (short-circuits `resolveAndRenderBanner` before the `posting_defaults` query) and `src/app/api/internal/render-banner/route.ts` (returns `503 BANNER_DISABLED` after auth, before validation). Decided to keep the gate per the brief — it's tested, low-cost defence in depth.
- Inline TypeScript ambient declaration for `text-to-svg` in `src/types/esm-shims.d.ts` (the package ships no `.d.ts`).
- Three test layers in `src/lib/banner/render-server.test.ts`:
  1. Unit — `buildBannerSvg` emits `<path>` not `<text>`, no `@font-face`.
  2. Integration — existing JPEG / dimensions / byte-stability tests preserved.
  3. Visual sanity — vertical strip pixel histogram has >8 distinct luma buckets (tofu produces ~3–4; real glyphs produce 20+).
- Kill-switch tests:
  - `tests/app/internal/render-banner-route.test.ts` — `returns 503 BANNER_DISABLED when BANNER_OVERLAY_DISABLED is set`.
  - `tests/publish-queue.test.ts` — `BANNER_OVERLAY_DISABLED env var skips banner rendering and uploads source media`.

## What changed in render-server.ts
- Replaced the `<text>` SVG element + `@font-face` data-URL block with a `<path>` element whose `d=` attribute comes from `text-to-svg`'s `getD()` (anchored at strip centre with `anchor: 'center middle'`, fontSize tuned to strip thickness).
- Vertical (left/right) strips wrap the path in a `transform="rotate(±90 cx cy)"` so the natural horizontal layout becomes vertical reading direction.
- Extracted `buildBannerSvg(...)` as a pure helper (no Sharp / IO) so tests can assert SVG shape directly.

## CI verify
PASS. `npm run ci:verify` — lint + typecheck + vitest (full suite) + production build all green. Used `.env.local` copied from `/Users/peterpitcher/Cursor/OJ-CheersAI2.0/.env.local` for the build step only; removed afterwards.

## Local visual verification
Rendered a story (1080×1920) with `position: 'right'`, bg `#a57626`, label `TONIGHT`, then cropped the right strip to PNG.

- Output: `/tmp/banner-verify/local.jpg` (50KB JPEG)
- Cropped strip: `/tmp/banner-verify/local-strip.png` (600×16696 upscaled PNG)
- Result: clearly reads "TONIGHT · TONIGHT · TONIGHT · …" rotated 90° (vertical reading direction). Real glyph shapes — NOT tofu boxes.

## Open items / surprises
- `text-to-svg`'s `getD()` API matched the plan's "Change C" exactly — `anchor: 'center middle'` with `x`, `y`, `fontSize` worked first try. No fallback to `getSVG()` parsing was needed.
- `npm install text-to-svg` reports 10 vulnerabilities (3 moderate, 7 high) in transitive deps (likely `opentype.js` chain). The brief's accepted risks call this out — flagging here so the orchestrator decides whether to chase `npm audit fix` or accept.
- Build emits a Next.js workspace-root inference warning ("To silence this warning, set `outputFileTracingRoot`"). Pre-existing; unrelated to this work.
- Worker change is small but DOES require a redeploy of the `publish-queue` Edge Function for the kill switch to take effect on Supabase. Per the brief this is the orchestrator's job (Task 6).

## Self-check
- [x] Four commits with the exact plan messages.
- [x] `npm run ci:verify` clean at the final commit.
- [x] No `<text>` element in `render-server.ts`.
- [x] No `@font-face` block in `render-server.ts` (only references in comments / test assertions).
- [x] No `font-data.ts` file.
- [x] No `_diag` route (Task 1 skipped).
- [x] `BANNER_OVERLAY_DISABLED` env gate present in worker + route, tested.
- [x] Locally rendered "TONIGHT" on a story fixture shows the actual word, not tofu boxes.
- [x] Handoff written.
