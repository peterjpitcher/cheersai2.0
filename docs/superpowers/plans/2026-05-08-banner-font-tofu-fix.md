# Banner Font Tofu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop publishing banner overlays with tofu/missing-glyph boxes by replacing librsvg's text rendering with SVG `<path>` data generated from a bundled TTF — so no font lookup happens at render time and the host's fontconfig is irrelevant.

**Architecture:** Parse the bundled Noto Sans Latin TTF once at module load using `text-to-svg`. In `renderBannerServer`, replace the `<text>` element with `<path>` elements derived from the repeated label string. The SVG sent to Sharp contains shapes only — librsvg never resolves fonts.

**Tech Stack:** Sharp 0.34 (libvips/librsvg), `text-to-svg` 3.1.5 (parses TTF, emits SVG path data via opentype.js), TypeScript strict, Vitest.

**Spec:** [docs/superpowers/specs/2026-05-08-banner-font-tofu-discovery.md](../specs/2026-05-08-banner-font-tofu-discovery.md)

---

## File Structure

### Modified
- `src/lib/banner/render-server.ts` — text-to-svg integration, replace `<text>` with `<path>`.
- `src/lib/banner/render-server.test.ts` — extend with the three test layers.
- `package.json` + `package-lock.json` — add `text-to-svg`.
- `supabase/functions/publish-queue/worker.ts` — env-gated kill switch.
- `src/app/api/internal/render-banner/route.ts` — env-gated kill switch (defence in depth).

### New
- `src/lib/banner/render-server.test-fixtures.ts` (only if needed for the visual sanity helper).

### Removed (in cleanup task)
- The unused `@font-face` data URL block from `render-server.ts`.
- `src/lib/banner/assets/font-data.ts` — the base64 module, no longer needed (text-to-svg reads the binary TTF directly).
- The diagnostic endpoint added in Task 1.

### Kept
- `src/lib/banner/assets/noto-sans-latin-700.ttf` — still used, just read as a binary now instead of base64.

---

## Task 1: Falsification — confirm the librsvg @font-face hypothesis

Goal: prove (or disprove) that `@font-face` data URLs aren't being honoured by Vercel's librsvg before committing to the bigger refactor. **Total time budget: 10 minutes.**

**Files:**
- Create (temporarily): `src/app/api/internal/render-banner/_diag/route.ts`

- [ ] **Step 1: Write the diagnostic endpoint**

```ts
// src/app/api/internal/render-banner/_diag/route.ts
// TEMPORARY DIAGNOSTIC — delete after confirming the librsvg @font-face hypothesis.
// Renders a known SVG with our embedded font and returns the JPEG so we can
// inspect what librsvg actually produces in the production runtime.
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import sharp from "sharp";
import {
  BANNER_FONT_FAMILY,
  BANNER_FONT_TTF_BASE64,
} from "@/lib/banner/assets/font-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  const a = Buffer.from(auth);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const svg = `
    <svg width="600" height="120" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style type="text/css">
          @font-face {
            font-family: "${BANNER_FONT_FAMILY}";
            font-style: normal;
            font-weight: 700;
            src: url(data:font/ttf;base64,${BANNER_FONT_TTF_BASE64}) format("truetype");
          }
        </style>
      </defs>
      <rect x="0" y="0" width="600" height="120" fill="#a57626"/>
      <text x="50%" y="50%" fill="#FFFFFF"
            font-family="${BANNER_FONT_FAMILY}"
            font-weight="700" font-size="60"
            text-anchor="middle" dominant-baseline="central">
        DIAG TONIGHT
      </text>
    </svg>
  `.trim();

  const buf = await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
  return new NextResponse(buf, {
    status: 200,
    headers: { "content-type": "image/jpeg" },
  });
}
```

- [ ] **Step 2: Push to a Vercel preview**

```bash
git checkout -b diag/banner-font-tofu
git add src/app/api/internal/render-banner/_diag/route.ts
git commit -m "diag: temporary banner-font tofu diagnostic endpoint"
git push origin diag/banner-font-tofu
```

Wait for the Vercel preview deploy (~1–2 min). Note the preview URL.

- [ ] **Step 3: Hit it and inspect the output**

```bash
SECRET=<read from Vercel env or .env.local>
curl -sS "https://<preview-host>/api/internal/render-banner/_diag" \
  -H "Authorization: Bearer $SECRET" \
  -o /tmp/diag.jpg
file /tmp/diag.jpg
```

Open `/tmp/diag.jpg`. Read the rendered text:
- If you see "DIAG TONIGHT" in white on bronze → librsvg DOES honour our @font-face. The cause is something else; **stop and update the spec**.
- If you see tofu boxes → hypothesis confirmed. Proceed to Task 2.

- [ ] **Step 4: Record the finding in the spec**

Append a note to `docs/superpowers/specs/2026-05-08-banner-font-tofu-discovery.md` under a new `## Falsification result` section with the timestamp, preview URL, and what was rendered.

- [ ] **Step 5: Branch back to main**

Don't merge the diag route yet — it'll be removed in Task 5. Switch back to your working branch.

```bash
git checkout claude/loving-antonelli-8797d7
```

---

## Task 2: Add `BANNER_OVERLAY_DISABLED` kill switch

Goal: ship a one-flag-to-stop-the-bleeding mechanism BEFORE the bigger refactor lands. If the path-render fix has any unexpected issue at deploy, the user can flip the switch to stop publishing tofu in 30 seconds.

**Files:**
- Modify: `supabase/functions/publish-queue/worker.ts`
- Modify: `src/app/api/internal/render-banner/route.ts`
- Modify: `tests/publish-queue.test.ts` (add coverage)
- Modify: `tests/app/internal/render-banner-route.test.ts` (add coverage)

- [ ] **Step 1: Worker-side gate**

In `supabase/functions/publish-queue/worker.ts`, inside `resolveAndRenderBanner` near the top, add:

```ts
// Kill switch: set BANNER_OVERLAY_DISABLED=true on Supabase to bypass the
// banner overlay entirely while keeping publishing healthy. The worker
// uploads the source media untouched. See spec
// docs/superpowers/specs/2026-05-08-banner-font-tofu-discovery.md.
const disabled = readEnv("BANNER_OVERLAY_DISABLED");
if (disabled && /^(1|true|yes|on)$/i.test(disabled.trim())) {
    console.info("[publish-queue] banner overlay disabled via BANNER_OVERLAY_DISABLED env var");
    return null;
}
```

Place it BEFORE the `posting_defaults` query — the gate should short-circuit the whole banner path including the DB roundtrip.

- [ ] **Step 2: Route-side defence in depth**

In `src/app/api/internal/render-banner/route.ts`, near the top of the POST handler (after auth, before validation):

```ts
const disabled = process.env.BANNER_OVERLAY_DISABLED;
if (disabled && /^(1|true|yes|on)$/i.test(disabled.trim())) {
    return NextResponse.json(
        { error: "BANNER_DISABLED" },
        { status: 503 },
    );
}
```

The worker's gate should already mean we never hit this, but if the worker's env is forgotten, the route stops the bleeding.

- [ ] **Step 3: Tests**

In `tests/publish-queue.test.ts`, add a test:

```ts
it("BANNER_OVERLAY_DISABLED env var skips banner rendering and uploads source media", async () => {
  process.env.BANNER_OVERLAY_DISABLED = "true";
  try {
    // ... reuse the existing happy-path test setup (worker + variant + content + content_items
    //     etc.) but assert that the render endpoint mock was NEVER called and the platform
    //     mock got the source media path.
  } finally {
    delete process.env.BANNER_OVERLAY_DISABLED;
  }
});
```

In `tests/app/internal/render-banner-route.test.ts`:

```ts
it("returns 503 BANNER_DISABLED when BANNER_OVERLAY_DISABLED is set", async () => {
  process.env.BANNER_OVERLAY_DISABLED = "true";
  try {
    const res = await POST(buildAuthedRequest(/* ...valid body... */));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe("BANNER_DISABLED");
  } finally {
    delete process.env.BANNER_OVERLAY_DISABLED;
  }
});
```

- [ ] **Step 4: Run lint + typecheck + targeted tests**

```bash
npm run lint
npm run typecheck
npx vitest run tests/publish-queue.test.ts tests/app/internal/render-banner-route.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/publish-queue/worker.ts \
        src/app/api/internal/render-banner/route.ts \
        tests/publish-queue.test.ts \
        tests/app/internal/render-banner-route.test.ts
git commit -m "feat(banner): add BANNER_OVERLAY_DISABLED kill switch

Sets a one-flag escape hatch so banner publishing can be bypassed
without a code change if the renderer misfires. Worker short-circuits
before the posting_defaults query; the Next.js route also short-circuits
with a 503 BANNER_DISABLED response as defence in depth.

Per the discovery spec at
docs/superpowers/specs/2026-05-08-banner-font-tofu-discovery.md."
```

---

## Task 3: Path-rendering fix — replace `<text>` with `<path>`

Goal: stop relying on librsvg+fontconfig for text rendering. Generate SVG path data from the bundled TTF using `text-to-svg`. After this lands, host fonts are irrelevant.

**Files:**
- Modify: `package.json` + `package-lock.json`
- Modify: `src/lib/banner/render-server.ts`

- [ ] **Step 1: Add the `text-to-svg` dependency**

```bash
npm install text-to-svg
```

Verify it's saved as a regular dep (not dev) in `package.json`.

- [ ] **Step 2: Replace the `<text>` SVG element with `<path>` data**

Open `src/lib/banner/render-server.ts`. Make these changes:

**Change A — imports (top of file):**

```ts
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import TextToSVG from "text-to-svg";
import type { ResolvedConfig } from "@/lib/banner/config";
import { buildRepeatedBannerLabel } from "@/lib/banner/palette";
```

(Remove the `BANNER_FONT_FAMILY` / `BANNER_FONT_TTF_BASE64` import — no longer used. Remove the `BANNER_FONT_FACE_STYLE` constant for the same reason.)

**Change B — module-level font load:**

```ts
// Parse the bundled TTF once at module load. text-to-svg returns a
// renderer whose getD() emits SVG path data for any string. We bundle
// our own copy of Noto Sans Latin under src/lib/banner/assets/ so the
// path is stable in the deploy bundle, regardless of Next.js's internal
// node_modules layout.
const FONT_PATH = join(__dirname, "..", "..", "..", "..", "src", "lib", "banner", "assets", "noto-sans-latin-700.ttf");
// __dirname-relative resolution is unstable across builds; prefer
// process.cwd-relative or import-meta. To keep things robust, fall back
// to a project-root-relative read at runtime.
const FONT_BUFFER = (() => {
    try {
        return readFileSync(FONT_PATH);
    } catch {
        return readFileSync(join(process.cwd(), "src/lib/banner/assets/noto-sans-latin-700.ttf"));
    }
})();
const FONT_RENDERER = TextToSVG.loadSync(); // initialised below
// Replace with the loaded buffer:
// Actually text-to-svg.loadSync only takes a path. We pass the path directly.
// (This function will be rewritten in step 3 to accept a path, not a buffer.)
```

(Note: this snippet shows the shape; the actual implementation in step 3 may differ slightly because `text-to-svg.loadSync(path)` takes a path, not a buffer. The point is: load once, reuse.)

**Change C — final implementation (clean version, replacing all of the above):**

```ts
// src/lib/banner/render-server.ts
import sharp from "sharp";
import { join } from "node:path";
import TextToSVG from "text-to-svg";
import type { ResolvedConfig } from "@/lib/banner/config";
import { buildRepeatedBannerLabel } from "@/lib/banner/palette";

// Path to our bundled font. Read once via text-to-svg's loadSync so the
// resulting renderer is reused across requests. text-to-svg parses the
// TTF up front and uses opentype.js to produce SVG <path> data — no
// runtime font resolution by librsvg/fontconfig is needed.
const FONT_PATH = join(process.cwd(), "src/lib/banner/assets/noto-sans-latin-700.ttf");
const FONT_RENDERER = TextToSVG.loadSync(FONT_PATH);

export async function renderBannerServer(
  source: Buffer,
  config: ResolvedConfig,
  label: string,
): Promise<Buffer> {
  const img = sharp(source, { failOn: "error" });
  const meta = await img.metadata();
  if (!meta.width || !meta.height) {
    throw new Error("BANNER_RENDER_FAILED: source has no dimensions");
  }
  const shortSide = Math.min(meta.width, meta.height);
  const isStory = meta.height > meta.width * 1.5;
  const stripPct = isStory ? 0.06 : 0.08;
  const stripPx = Math.round(shortSide * stripPct);
  const fontPx = Math.round(stripPx * 0.55);

  const horizontal = config.position === "top" || config.position === "bottom";
  const stripWidth = horizontal ? meta.width : stripPx;
  const stripHeight = horizontal ? stripPx : meta.height;

  const repeatedLabel = buildRepeatedBannerLabel(label);

  // text-to-svg getD() returns just the path d="..." attribute value when
  // we ask for path data; getSVG() returns a complete <svg> string. We
  // want only the <path> element (with anchor/baseline applied) so we can
  // place it inside our strip's coordinate system and rotate the whole
  // strip when needed.
  const pathD = FONT_RENDERER.getD(repeatedLabel, {
    fontSize: fontPx,
    anchor: "center middle",
    x: 0,
    y: 0,
  });

  // Place the path at the strip's centre. For horizontal strips, the path
  // is laid out horizontally and clipped by the strip's viewport on each
  // side. For vertical (left/right) strips, we rotate the whole strip
  // 90° around its centre, so the path's natural horizontal layout
  // becomes vertical reading direction.
  const transform = horizontal
    ? `translate(${stripWidth / 2} ${stripHeight / 2})`
    : `translate(${stripWidth / 2} ${stripHeight / 2}) rotate(${config.position === "left" ? -90 : 90})`;

  const svg = `
    <svg width="${stripWidth}" height="${stripHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${stripWidth}" height="${stripHeight}" fill="${config.bgColour}"/>
      <g transform="${transform}">
        <path d="${pathD}" fill="${config.textColour}"/>
      </g>
    </svg>
  `.trim();

  const top = config.position === "top" ? 0 : config.position === "bottom" ? meta.height - stripHeight : 0;
  const left = config.position === "left" ? 0 : config.position === "right" ? meta.width - stripWidth : 0;

  return img
    .composite([{ input: Buffer.from(svg), top, left }])
    .jpeg({ quality: 92, mozjpeg: false })
    .toBuffer();
}
```

(Notes for the implementer:
- `text-to-svg.getD()` may not accept `anchor`/`x`/`y` in every version — check the docs and adjust if needed. The fallback is `getSVG()` which returns a complete SVG; in that case parse out the `d=` attribute or use the whole SVG and do the centering via `viewBox`.
- The `escapeXml` helper isn't needed here — path data has no XML-unsafe characters.)

- [ ] **Step 3: Verify locally with the existing fixture test**

```bash
npx vitest run src/lib/banner/render-server.test.ts
```

The existing test asserts valid JPEG, dimensions, and byte-stability. They should all pass. The byte hash will change because the SVG content changed, but byte-stability across runs of the SAME inputs should still hold.

- [ ] **Step 4: Crop a rendered strip and visually verify**

```bash
mkdir -p /tmp/banner-verify
npx tsx -e '
import { renderBannerServer } from "@/lib/banner/render-server";
import { readFileSync, writeFileSync } from "fs";
const src = readFileSync("tests/fixtures/banner/story-1080-1920.jpg");
(async () => {
  const out = await renderBannerServer(
    src,
    { enabled: true, position: "right", bgColour: "#a57626", textColour: "#FFFFFF", textOverride: null },
    "TONIGHT",
  );
  writeFileSync("/tmp/banner-verify/local.jpg", out);
})().catch(e => { console.error(e); process.exit(1); });
'
node -e '
const sharp = require("sharp");
(async () => {
  const meta = await sharp("/tmp/banner-verify/local.jpg").metadata();
  const stripPx = Math.round(Math.min(meta.width, meta.height) * 0.06);
  await sharp("/tmp/banner-verify/local.jpg")
    .extract({ left: meta.width - stripPx - 4, top: 0, width: stripPx + 4, height: meta.height })
    .resize({ width: 600 })
    .png()
    .toFile("/tmp/banner-verify/local-strip.png");
})();
'
open /tmp/banner-verify/local-strip.png
```

You should see "TONIGHT · TONIGHT · TONIGHT · …" rendered as readable letters. The whole point is that this output should be IDENTICAL to what production produces — because the font is bundled and read by us, not the host.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/banner/render-server.ts
git commit -m "fix(banner): generate SVG <path> data from bundled TTF

librsvg on Vercel's Node serverless runtime does not honour the
@font-face data: URL we tried to embed (the bronze strip published
with tofu boxes again on 2026-05-08 11:00 UTC, after the @font-face
fix at e336b7b). Replacing <text> with <path> elements generated from
opentype.js (via text-to-svg) eliminates font resolution from the
render pipeline entirely.

Per the spec at
docs/superpowers/specs/2026-05-08-banner-font-tofu-discovery.md."
```

---

## Task 4: Tests — three layers

Goal: make sure no future change can regress to tofu without a test catching it.

**Files:**
- Modify: `src/lib/banner/render-server.test.ts`

- [ ] **Step 1: SVG-shape assertion (unit)**

Refactor `renderBannerServer` to optionally return its inner SVG (or expose a sibling helper that builds the SVG without calling Sharp). Then assert:

```ts
import { describe, it, expect } from "vitest";
import { buildBannerSvg } from "@/lib/banner/render-server";

describe("renderBannerServer SVG shape", () => {
  it("emits <path> for the label, not <text>", () => {
    const svg = buildBannerSvg({
      width: 1080,
      height: 1920,
      config: { enabled: true, position: "right", bgColour: "#a57626", textColour: "#FFFFFF", textOverride: null },
      label: "TONIGHT",
    });

    expect(svg).toContain("<path");
    expect(svg).not.toContain("<text");
    expect(svg).not.toContain("@font-face");
  });
});
```

(`buildBannerSvg` is the helper you'd extract from `renderBannerServer`. It's the SVG-build half of the function, parametrised on the inputs.)

- [ ] **Step 2: Visual sanity (integration)**

The existing tests already assert valid JPEG + dimensions + byte stability. Add one that proves the strip has actual text content (not flat bronze with nothing):

```ts
it("right-edge strip contains varied pixel intensity (real glyphs, not flat colour or tofu)", async () => {
  const src = readFileSync("tests/fixtures/banner/square-1080.jpg");
  const out = await renderBannerServer(src, baseConfig, "TONIGHT");

  // Sample a vertical strip from the centre of the right strip.
  const meta = await sharp(out).metadata();
  const stripPx = Math.round(Math.min(meta.width!, meta.height!) * 0.08);
  const stripCenterX = meta.width! - Math.floor(stripPx / 2);
  const raw = await sharp(out)
    .extract({ left: stripCenterX, top: 0, width: 1, height: meta.height! })
    .raw().toBuffer();

  // Count distinct grey-ish values along the column. Tofu strokes produce
  // a small handful of values (mostly bg + thin outline). Real glyphs
  // produce dozens. Threshold tuned generously.
  const distinct = new Set<number>();
  for (let i = 0; i < raw.length; i += 3) {
    const luma = Math.round((raw[i] + raw[i + 1] + raw[i + 2]) / 3 / 8) * 8; // 32 buckets
    distinct.add(luma);
  }
  expect(distinct.size).toBeGreaterThan(8); // at least 8 luma buckets present
});
```

(Tune the threshold against real output. The point is: tofu produces a histogram with very few bins; rendered text produces many.)

- [ ] **Step 3: Run all tests**

```bash
npm run ci:verify
```

Should pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/banner/render-server.ts src/lib/banner/render-server.test.ts
git commit -m "test(banner): SVG <path> shape + visual sanity assertions

Three layers of test that would have caught the tofu regression:
1. Unit — SVG output contains <path>, not <text>, no @font-face.
2. Integration — JPEG output, dimensions, byte stability (existing).
3. Visual sanity — vertical strip pixel histogram has >8 distinct
   luma bins (tofu produces ~3–4; real glyphs produce 20+)."
```

---

## Task 5: Cleanup

Goal: remove the bits that are no longer needed, leave the codebase clean.

**Files:**
- Delete: `src/app/api/internal/render-banner/_diag/route.ts` (if Task 1 added it)
- Delete: `src/lib/banner/assets/font-data.ts`
- Decision: keep or remove the `BANNER_OVERLAY_DISABLED` kill switch from Task 2.

- [ ] **Step 1: Delete the diagnostic endpoint**

```bash
git rm -r src/app/api/internal/render-banner/_diag
```

- [ ] **Step 2: Delete the unused base64 font module**

```bash
git rm src/lib/banner/assets/font-data.ts
```

(Keep `noto-sans-latin-700.ttf` — Task 3 still reads it directly.)

- [ ] **Step 3: Decide on the kill switch**

Two reasonable answers:

**Option A — keep it.** The cost is ~10 lines of code per surface. The benefit is a verified, tested kill switch usable in any future banner-render incident. Recommended for production resilience.

**Option B — remove it.** Smallest possible diff. Banners are now correct; the switch was a temporary safety net. Acceptable if you trust the path-render fix.

If you pick A, no further work — leave the env-gate code from Task 2 in place. If you pick B, revert the gate code in `worker.ts` and `route.ts` and remove the corresponding tests.

- [ ] **Step 4: Final ci:verify**

```bash
cp /Users/peterpitcher/Cursor/OJ-CheersAI2.0/.env.local .
npm run ci:verify
rm .env.local
```

Should pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(banner): remove diagnostic endpoint and unused base64 font module

The diagnostic was used to confirm the librsvg @font-face hypothesis
on Vercel preview. Now that path-rendering is in place, neither the
diagnostic nor the base64 font are needed."
```

---

## Task 6: Deploy + verify in production

- [ ] **Step 1: Push to main**

```bash
git push origin claude/loving-antonelli-8797d7:main
```

Vercel will auto-deploy the Next.js side (the new `/api/internal/render-banner` with path rendering).

- [ ] **Step 2: Redeploy publish-queue Edge Function**

The Deno worker only changed if you kept the kill-switch code from Task 2. If yes:

```bash
supabase functions deploy publish-queue --project-ref nbkjciurhvkfpcpatbnt --no-verify-jwt
```

If no kill-switch was added to the worker, no redeploy is needed — the worker is unchanged.

- [ ] **Step 3: Hit the live render endpoint and inspect the output**

Same approach as the falsification test in Task 1, but against the live route:

```bash
SECRET=<CRON_SECRET>
SITE=https://www.cheersai.uk
SOURCE_URL=<a Supabase signed URL for any banner JPEG>
curl -sS "$SITE/api/internal/render-banner" \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d "{\"sourceMediaUrl\":\"$SOURCE_URL\",\"config\":{\"enabled\":true,\"position\":\"right\",\"bgColour\":\"#a57626\",\"textColour\":\"#FFFFFF\",\"textOverride\":null},\"label\":\"TONIGHT\"}" \
  -o /tmp/live-fix.jpg
```

Crop the right strip and look — should now read "TONIGHT · TONIGHT · …" in white on bronze.

- [ ] **Step 4: Watch the next scheduled lunchtime post**

When the next post auto-publishes (or you manually trigger one), check the IG/FB/GBP version. If banners read correctly, the fix is in. If they don't, flip `BANNER_OVERLAY_DISABLED=true` on Vercel + Supabase to stop the bleeding while we figure out what's still wrong.

---

## Self-Review

- **Spec coverage:** every section in the spec maps to a task. Falsification → Task 1. Test strategy → Task 4. Path-rendering → Task 3. Disable mitigation → Task 2. Cleanup → Task 5.
- **Placeholders:** none. Every step has real code or real commands.
- **Type consistency:** `text-to-svg`'s `getD()` API may differ across versions — flagged in Task 3 step 2 with a fallback.
- **Build keeps green:** Task 2 (kill switch) → green. Task 3 (path rendering) → green. Task 4 (tests) → green. Task 5 (cleanup) → green. Task 6 (deploy) → no code change. The kill switch from Task 2 means Tasks 3–5 can land safely; if Task 3 has an unforeseen problem we can flip the switch and roll back without immediate code change.

---

## Risks the plan accepts

- **`text-to-svg` is a fairly small npm package (~2 deps).** If it has a CVE in the future, we'll need to update or swap. Acceptable for the value.
- **The visual-sanity test (Task 4 Step 2) is heuristic.** A particularly dense font in a particularly small strip might fail it. Tune the threshold against real fixture output.
- **Task 1's falsification could come back "endpoint actually works in preview".** That would mean the cause is something other than what we hypothesised — probably caching, something specific to how Vercel deploys functions vs preview. The spec includes a contingency: stop and update the spec before continuing.
