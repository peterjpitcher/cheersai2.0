# Banner font tofu — Discovery + cause analysis

**Date:** 2026-05-08
**Status:** Awaiting your review before any further code changes (post-codex-qa-review revisions applied)
**Branch HEAD:** `9e8c79b` on `origin/main`
**Codex review:** `tasks/codex-qa-review/tofu-*-findings.json` — applied 3 material findings (SPEC-002 test strategy, SPEC-003 disable-mitigation precision, falsification test for the librsvg hypothesis)

## Symptom

Posts that publish via the production pipeline still show **tofu / missing-glyph boxes** down the right-edge banner strip. The most recent confirmed instance: Gavin & Stacey Quiz Night feed posts (Instagram + Facebook) published 2026-05-08 ~10:55 UTC — about an hour AFTER my font-fix push (`e336b7b`). The user's screenshot at 12:32 BST shows the same boxes on the public IG post (37 minutes after publish).

## Evidence collected

1. **Production endpoint is live and reachable.**
   - `POST https://www.cheersai.uk/api/internal/render-banner` with valid `CRON_SECRET`, valid Supabase signed source URL, valid config + label `"TONIGHT"` returned **HTTP 200** with a 475 KB JPEG.
   - So the route is up; it's not 404, not 401, not 500.

2. **Live endpoint output still renders as tofu.** I cropped the right strip from the just-rendered JPEG. Same vertical column of `□` characters as the published banners. Confirmed via the saved file at `/tmp/bcheck2/live-render-strip.png`.

3. **The endpoint produces SVG-composited output** (via Sharp `composite([{ input: <svg buffer> }])` → libvips → librsvg). This is the exact same code path I tried to fix.

4. **My local `npx tsx` test rendered correctly** (white "TONIGHT" on bronze, properly shaped letters). So the same source code, same Sharp version, on macOS produces correct text. On Vercel's Linux runtime, it produces tofu.

5. **The deploy almost certainly went out.** Vercel auto-deploys from `main` push; `e336b7b` was pushed > 60 minutes ago and the endpoint is responding. The behaviour we see is what my `@font-face data: URL` approach produces in librsvg builds that don't support that mechanism.

## What's actually happening (best hypothesis)

`librsvg` (the SVG renderer libvips uses, which is what `sharp.composite` invokes for SVG inputs) **does not load `@font-face` declarations from data: URLs in production** on Vercel's runtime. It silently falls through to fontconfig, which has no usable Latin font on Vercel's serverless image, and renders every glyph as the missing-glyph box.

The `@font-face` block I added is being parsed but not honoured. The text element's `font-family="CheersAIBannerFont"` resolves to "no such font" → fallback to system → no system font with Latin glyphs → tofu.

## Possible causes — ranked by likelihood

### Cause 1 — librsvg doesn't honour `@font-face` data URLs in this build (HIGH likelihood)

**What:** librsvg's CSS support is intentionally limited. Many builds support basic @font-face but only with `url(http://...)` or local file paths, not with `data:` URIs. The base64 path I used works locally (different librsvg) but not on Vercel.

**Evidence:**
- My local test passed; production still tofu.
- This is a known limitation of certain librsvg + Cairo + Pango stacks.
- @vercel/og deliberately avoids librsvg by using satori (which converts text to SVG `<path>`s before rendering) precisely because of this issue.

**Verification:** check the librsvg version Sharp ships for `linux-x64`, OR run a tiny test that just embeds `@font-face` + a single `<text>` element and looks at the byte output (if the font is loaded, output is non-trivial; if not, tofu).

**Fix path:** Stop relying on librsvg to load the font. Convert text to SVG `<path>` data ahead of time using opentype.js / text-to-svg, then composite. No font loading at render time.

### Cause 2 — librsvg only resolves fonts via fontconfig, not via `<style>` (MEDIUM-HIGH likelihood)

**What:** Even if @font-face is parsed, librsvg/Pango only consult **fontconfig** when looking up font names. fontconfig knows about fonts on disk in known directories (`/usr/share/fonts/...`, etc.). A font defined inline via `<style>@font-face{}` won't appear to fontconfig.

**Verification:** Check Sharp/libvips/Pango font resolution path documentation. Try registering the font on disk + running `fc-cache` at module load (not possible on read-only Vercel runtime).

**Fix path:** Same as Cause 1 — bypass font lookup entirely by converting text to paths.

### Cause 3 — The Vercel build dropped the base64 string from the bundle (LOW likelihood)

**What:** Next.js / webpack might tree-shake or minify the 37 KB base64 string in unexpected ways (deduplication, externalization to chunks, etc.). The deployed function might have an empty or corrupted base64.

**Evidence against:** my SVG would fail-soft — even with broken base64, the @font-face would fail and we'd see tofu (which we do). So this isn't distinguishable from cause 1/2 by the symptom alone.

**Verification:** download the deployed function's compiled code (via Vercel CLI `vercel inspect` or by examining the response shape under known conditions) and check if `BANNER_FONT_TTF_BASE64` is intact.

**Fix path:** if confirmed, switch to a different font-shipping mechanism (e.g. `import` the file as a binary asset, or register the font on disk at deploy time).

### Cause 4 — There's a CDN cache between the worker and the route (LOW likelihood)

**What:** `publish-queue` Edge Function calls the Vercel route via HTTP. Vercel's edge cache or a regional cache might be returning the OLD function build for a while.

**Evidence against:** my live endpoint test (just now) produced fresh tofu output. If it were cached, we'd expect either the OLD broken output OR the NEW fixed output, not consistently broken-but-with-my-current-input. Also the response is a unique JPEG keyed to my exact payload, so it can't be cache-served.

**Fix path:** N/A — cause is ruled out for now.

### Cause 5 — The render-banner route is somehow reading a stale imported font module (LOW likelihood)

**What:** Module caching: Next.js may have hot-loaded the route from an older build before the font-fix deploy completed.

**Evidence against:** Vercel's serverless functions are cold-started per deploy, so the module graph is rebuilt on each deploy. Unlikely to have stale caches for a route this hot.

**Fix path:** force a clean redeploy (push an empty commit, or trigger a redeploy in Vercel dashboard).

### Cause 6 — Worker is calling a different render path (VERY LOW likelihood)

**What:** the publish-queue Edge Function might still be importing a stale module copy of the renderer or hitting a different URL.

**Evidence against:** the Deno worker calls the HTTP endpoint we just tested (200, tofu output). Same path.

**Fix path:** N/A.

### Cause 7 — Sharp's libvips on Vercel doesn't compile in librsvg SVG support at all (VERY LOW likelihood)

**What:** if libvips were built without librsvg, `sharp.composite` with SVG input would either fail or fall back to a different SVG renderer (resvg, etc.) with different font behaviour.

**Evidence against:** the rect element renders correctly (we see the bronze strip), proving SVG IS being rendered. Only the text glyphs are broken. So librsvg IS working — just without our font.

**Fix path:** N/A.

## Falsification test (do this BEFORE the bigger fix)

Before committing to the path-rendering refactor, prove the hypothesis with a 5-minute test. Land a tiny scratch endpoint (or a one-off shell call) that takes the EXACT same SVG produced by `renderBannerServer` today and renders it via Sharp on a Vercel preview deploy. If the output is tofu, librsvg-on-Vercel-doesn't-honour-our-@font-face is confirmed — and we can confidently commit to the path-render refactor. If the output is correct, we have a different cause and the refactor isn't justified.

Concretely:
1. Add a temporary `GET /api/internal/render-banner/_diag` route that renders a known SVG with our embedded font and returns the JPEG.
2. Hit it on a Vercel preview deployment.
3. Crop the right strip and compare to my local rendering.

Whichever way the test goes, the result IS the answer. Strip the diagnostic route afterwards.

## Test strategy for the production fix

The reviewer (codex SPEC-002) flagged that no current test would catch the production failure mode. The path-rendering fix needs three layers of test:

1. **Unit — SVG shape**: assert `renderBannerServer`'s emitted SVG contains `<path>` (one path per repeated label glyph) and zero `<text>` elements. This locks in the architectural change so a future contributor can't accidentally regress.
2. **Integration — byte stability**: same as today's tests (3 fixture sizes), checking valid JPEG output with correct dimensions. Assert byte-stability across runs to lock determinism.
3. **Visual sanity (manual but documented)**: a tiny vitest helper that pulls a vertical line of pixels from the strip's centre and asserts a non-trivial pixel-colour distribution (i.e. text shapes are present, not a flat colour). This catches "tofu" without needing OCR — tofu produces nearly-uniform thin strokes; real glyphs produce varied stroke patterns.

Together they would have caught the Vercel font-fallback regression that slipped through.

## Recommended fix path

**Don't try to fix `@font-face` on librsvg. Stop relying on librsvg for text rendering.**

The cleanest approach used by every serverless image-render library at this scale is:

> **Convert text to SVG `<path>` elements at render time, using a TTF parsed by `opentype.js` (or `text-to-svg`).** The resulting SVG contains shapes, not text — so librsvg doesn't need a font, fontconfig doesn't matter, and the output is identical regardless of host environment.

Steps:
1. Add `text-to-svg` (or `opentype.js`) as a dependency.
2. At module load, parse the bundled Noto Sans TTF.
3. In `renderBannerServer`, replace the `<text>` element with `<path d="..." fill="..."/>` generated from the label string + font.
4. Keep the strip rect, position, and rotation logic unchanged.

This pattern is what `satori` (used by `@vercel/og`) does internally. It's robust against any librsvg/fontconfig variation and produces byte-identical output across Linux/macOS/Windows.

**Estimated effort:** 30–60 minutes to land a clean fix with tests. Single file change in `render-server.ts`, plus one tiny `package.json` dep.

## Temporary mitigation — precise specification

Reviewer (codex SPEC-003) flagged the disable suggestion was too fuzzy. Here's the precise version, ready to land in 5–10 minutes if you want it:

**Mechanism:** environment variable `BANNER_OVERLAY_DISABLED=true`. Read at module load in two places:
1. `supabase/functions/publish-queue/worker.ts` — if set, `resolveAndRenderBanner` short-circuits and returns `null` (the existing "no banner" return path). The worker uploads the source media untouched.
2. `src/app/api/internal/render-banner/route.ts` — if the worker's gate ever misfires, the route also short-circuits with a 503 response code `BANNER_DISABLED`. Defence in depth.

**Scope:** account-wide via env var, not per-account. Fastest possible disable.

**Fallback behaviour when disabled:**
- Worker uploads source media as-is. Posts publish without banner overlay.
- Logged: `console.info("[publish-queue] banner overlay disabled via BANNER_OVERLAY_DISABLED env var")` once per worker boot.
- No retries, no failed jobs — the publish just continues without the bannered step.

**Revert:** unset the env var on Vercel + Supabase, redeploy is not needed (env var read at every request). Effectively instant.

**Observability:** count of `BANNER_OVERLAY_DISABLED` log lines per hour gives a rough check that the gate fired during the period it was on.

**Test:** unit tests for both the worker (env set → returns null without calling render endpoint) and the route (env set → returns 503).

## Alternative paths (each comes with tradeoffs)

1. **Use `@vercel/og`'s satori directly** — heavyweight, brings in JSX rendering machinery; we'd still need to wrap our SVG in JSX.
2. **Render text via `node-canvas`** — adds native deps, larger bundle, build issues on serverless.
3. **Pre-render banners ahead of time and store in storage** — defeats the spec's "derived data, no caching" decision.
4. **Switch the renderer to use Sharp's `sharp({ text: ... })` constructor** — uses Pango+fontconfig, same root problem on Vercel.
5. **Disable the banner overlay entirely** — clean rollback; no broken posts; cost: no banners at all until fixed.

## Open questions for you to decide

1. **Are you OK with the path-rendering fix (text-to-svg / opentype.js)?** This is my recommendation.
2. **Do you want banners disabled in the meantime so no more broken posts go out at the next scheduled time?** I can land a one-line gate that returns "no banner" until the path-render fix is in.
3. **Any preference between text-to-svg vs opentype.js?** They do the same thing; text-to-svg is a thinner wrapper.

I'll wait for your direction before touching code.
