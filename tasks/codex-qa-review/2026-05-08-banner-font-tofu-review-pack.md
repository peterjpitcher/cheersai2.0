# Review Pack: banner-font-tofu

**Generated:** 2026-05-08
**Mode:** C (A=Adversarial / B=Code / C=Spec Compliance)
**Project root:** `/Users/peterpitcher/Cursor/OJ-CheersAI2.0/.claude/worktrees/loving-antonelli-8797d7`
**Base ref:** `HEAD~1`
**HEAD:** `9e8c79b`
**Diff range:** `HEAD~1...HEAD`
**Stats:**  2 files changed, 44 insertions(+), 1 deletion(-)

> This pack is the sole input for reviewers. Do NOT read files outside it unless a specific finding requires verification. If a file not in the pack is needed, mark the finding `Needs verification` and describe what would resolve it.

## Changed Files

```
src/lib/ai/content-rules.ts
tests/lib/ai/content-rules.test.ts
```

## User Concerns

Production banner overlay is rendering tofu/missing-glyph boxes despite a recent @font-face base64 data URL fix. Live endpoint confirmed reachable + responding 200 but still tofu. Spec analyses possible causes and recommends switching to text-to-SVG-path rendering (text-to-svg / opentype.js) so librsvg never needs to load a font at all. Concerns: (a) is the librsvg @font-face data URL hypothesis correct or are we missing a simpler cause?; (b) is text-to-svg the right tool, or should we use a different approach (e.g. satori, node-canvas, pre-rendering)?; (c) any cause not listed in the spec?; (d) is the temporary disable suggestion safe and reversible?

## Spec

Source: `/Users/peterpitcher/Cursor/OJ-CheersAI2.0/.claude/worktrees/loving-antonelli-8797d7/docs/superpowers/specs/2026-05-08-banner-font-tofu-discovery.md`

```markdown
# Banner font tofu — Discovery + cause analysis

**Date:** 2026-05-08
**Status:** Awaiting your review before any further code changes
**Branch HEAD:** `9e8c79b` on `origin/main`

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
```

## Diff (`HEAD~1...HEAD`)

```diff
diff --git a/src/lib/ai/content-rules.ts b/src/lib/ai/content-rules.ts
index 473d18d..ec2b799 100644
--- a/src/lib/ai/content-rules.ts
+++ b/src/lib/ai/content-rules.ts
@@ -406,7 +406,11 @@ export function lintContent({
     issues.push({ code, message: "Link-in-bio language is only allowed on Instagram.", severity: resolveSeverity(code) });
   }
 
-  if (platform === "instagram") {
+  // Stories are image-only and have an intentionally empty body. The
+  // Instagram body-content rules (link-in-bio handling, word limit) only
+  // make sense for feed captions; applied to a story they would always
+  // fire link_in_bio_missing whenever the campaign carries a ctaUrl.
+  if (platform === "instagram" && placement === "feed") {
     if (!contract.allowLinkInBio && hasLinkInBio) {
       const code = "link_in_bio_unapproved";
       issues.push({ code, message: "Instagram link-in-bio used without a link.", severity: resolveSeverity(code) });
diff --git a/tests/lib/ai/content-rules.test.ts b/tests/lib/ai/content-rules.test.ts
index bcbb10a..2b63323 100644
--- a/tests/lib/ai/content-rules.test.ts
+++ b/tests/lib/ai/content-rules.test.ts
@@ -23,6 +23,45 @@ describe("content rules", () => {
     PROOF_POINTS.push(SAMPLE_PROOF_POINT);
   };
 
+  it("does not require Instagram link-in-bio in body for stories (empty body is intentional)", () => {
+    const result = lintContent({
+      body: "",
+      platform: "instagram",
+      placement: "story",
+      context: { ctaUrl: "https://example.com/book" },
+      advanced: { includeHashtags: false, includeEmojis: false },
+    });
+
+    expect(result.pass).toBe(true);
+    expect(result.issues.find((issue) => issue.code === "link_in_bio_missing")).toBeUndefined();
+  });
+
+  it("still requires Instagram link-in-bio line in body for feed posts when a link is present", () => {
+    const result = lintContent({
+      body: "Join us tonight for live music.",
+      platform: "instagram",
+      placement: "feed",
+      context: { ctaUrl: "https://example.com/book" },
+      advanced: { includeHashtags: false, includeEmojis: false },
+    });
+
+    expect(result.pass).toBe(false);
+    expect(result.issues.some((issue) => issue.code === "link_in_bio_missing")).toBe(true);
+  });
+
+  it("passes story lint for all three platforms with an empty body and a campaign cta", () => {
+    for (const platform of ["facebook", "instagram", "gbp"] as const) {
+      const result = lintContent({
+        body: "",
+        platform,
+        placement: "story",
+        context: { ctaUrl: "https://example.com/book", linkInBioUrl: "https://example.com/menu" },
+        advanced: { includeHashtags: true, includeEmojis: true },
+      });
+      expect(result.pass, `${platform} story should pass lint with empty body`).toBe(true);
+    }
+  });
+
   it("does not require Facebook CTA URL in body for stories (empty body is intentional)", () => {
     const result = lintContent({
       body: "",
```

## Changed File Contents

### `src/lib/ai/content-rules.ts`

```
import { DateTime } from "luxon";

import { applyProofPoints, lintProofPoints, type ProofPointUsage } from "@/lib/ai/proof-points";
import { detectBannedPhrases, reduceHype, scrubBannedPhrases } from "@/lib/ai/voice";
import type { InstantPostAdvancedOptions } from "@/lib/create/schema";
import { DEFAULT_TIMEZONE } from "@/lib/constants";

export type Platform = "facebook" | "instagram" | "gbp";
export type Placement = "feed" | "story";

export type LintSeverity = "error" | "warning";

export interface LintIssue {
  code: string;
  message: string;
  severity: LintSeverity;
}

export interface LintResult {
  pass: boolean;
  issues: LintIssue[];
  metrics: {
    wordCount: number;
    charCount: number;
    hashtagCount: number;
    emojiCount: number;
    hasLinkInBio: boolean;
    hasUrl: boolean;
  };
}

/** Hard-failure lint codes — content would look broken or violate brand rules. */
const BLOCKING_LINT_CODES = new Set(["blocked_tokens", "banned_phrases"]);

function resolveSeverity(code: string): LintSeverity {
  return BLOCKING_LINT_CODES.has(code) ? "error" : "warning";
}

/** Returns true if any lint issue is a hard failure (severity "error"). */
export function hasBlockingIssues(result: LintResult): boolean {
  return result.issues.some((issue) => issue.severity === "error");
}

export interface ContractContext {
  platform: Platform;
  placement: Placement;
  advanced?: Partial<InstantPostAdvancedOptions> | null;
  context?: Record<string, unknown> | null;
  scheduledFor?: Date | null;
}

export interface ContractResolution {
  platform: Platform;
  placement: Placement;
  includeHashtags: boolean;
  includeEmojis: boolean;
  maxHashtags: number;
  maxEmojis: number;
  maxWords?: number;
  maxChars?: number;
  allowLinkInBio: boolean;
  hasLink: boolean;
}

export interface ChannelRuleResult {
  body: string;
  repairs: string[];
  proofPoint: ProofPointUsage | null;
}

const DEFAULT_ADVANCED: InstantPostAdvancedOptions = {
  toneAdjust: "default",
  lengthPreference: "standard",
  includeHashtags: true,
  includeEmojis: true,
  ctaStyle: "default",
};

const URL_PATTERN = /https?:\/\/\S+/gi;
const HASHTAG_PATTERN = /#[\p{L}\p{N}_]+/gu;
const EMOJI_PATTERN = /\p{Extended_Pictographic}/gu;
const LINK_IN_BIO_PATTERN = /\blink in (?:our|the)?\s*bio\b/gi;
const DAY_PATTERN = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\b/gi;

const BLOCKED_WORDS = ["undefined", "null", "nan"];
const BLOCKED_PATTERNS: RegExp[] = [
  /\{\{[^}]*\}\}/g,
  /\[\[[^\]]*\]\]/g,
  /<\s*[a-z][^>]*>/gi,
  /\[object\s+object\]/gi,
  /\bas an ai language model\b/gi,
  /\bas a language model\b/gi,
];

const CLAIM_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  // Price patterns removed to allow user-specified prices to pass through
  // { code: "price", ... } regexes were too aggressive
  { code: "capacity", pattern: /\blimited (?:spaces|spots|seats|tables)\b/gi },
  { code: "capacity", pattern: /\bspaces are limited\b/gi },
  { code: "capacity", pattern: /\bselling fast\b/gi },
  { code: "capacity", pattern: /\bonly \d+ (?:spaces|spots|seats|tables)\b/gi },
  { code: "capacity", pattern: /\blast (?:few|remaining) (?:spaces|spots|seats|tables)\b/gi },
  { code: "capacity", pattern: /\bnearly sold out\b/gi },
  { code: "capacity", pattern: /\bsold out\b/gi },
  { code: "end_time", pattern: /\buntil\s+\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/gi },
  { code: "end_time", pattern: /\btill\s+\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/gi },
  { code: "end_time", pattern: /\buntil late\b/gi },
  { code: "end_time", pattern: /\btill late\b/gi },
  { code: "end_time", pattern: /\blate[- ]night\b/gi },
  { code: "end_time", pattern: /\bopen late\b/gi },
  { code: "food_time", pattern: /\bfood (?:served|serving|service|available)\b[^.]*\b(?:from|until|till|at)\b/gi },
  { code: "food_time", pattern: /\bkitchen (?:open|serving)\b[^.]*\b(?:from|until|till|at)\b/gi },
  { code: "food_time", pattern: /\bserving (?:food|dinner|lunch)\b[^.]*\b(?:from|until|till|at)\b/gi },
  { code: "age", pattern: /\b18\+\b/gi },
  { code: "age", pattern: /\b21\+\b/gi },
  { code: "age", pattern: /\bover\s+18s?\b/gi },
  { code: "age", pattern: /\badults? only\b/gi },
  { code: "age", pattern: /\bkids? (?:welcome|allowed)\b/gi },
  { code: "age", pattern: /\bfamily friendly\b/gi },
  { code: "age", pattern: /\ball ages\b/gi },
];

export function resolveAdvancedOptions(
  overrides?: Partial<InstantPostAdvancedOptions> | null,
): InstantPostAdvancedOptions {
  return {
    ...DEFAULT_ADVANCED,
    ...(overrides ?? {}),
  };
}

export function resolveContract({
  platform,
  placement,
  advanced,
  context,
}: ContractContext): ContractResolution {
  const resolvedAdvanced = resolveAdvancedOptions(advanced ?? context?.advanced as Partial<InstantPostAdvancedOptions>);
  const includeHashtags = Boolean(resolvedAdvanced.includeHashtags);
  const includeEmojis = Boolean(resolvedAdvanced.includeEmojis);
  const hasLink = Boolean(getContextString(context, "linkInBioUrl") || getContextString(context, "ctaUrl"));

  const maxHashtags =
    platform === "gbp"
      ? 0
      : platform === "instagram"
        ? includeHashtags ? 6 : 0
        : includeHashtags ? 3 : 0;

  const maxEmojis =
    platform === "gbp"
      ? includeEmojis ? 2 : 0
      : includeEmojis ? 3 : 0;

  return {
    platform,
    placement,
    includeHashtags,
    includeEmojis,
    maxHashtags,
    maxEmojis,
    maxWords: platform === "instagram" ? 80 : undefined,
    maxChars: platform === "gbp" ? 900 : undefined,
    allowLinkInBio: platform === "instagram" && hasLink,
    hasLink,
  };
}

export function applyChannelRules({
  body,
  context,
  advanced,
  platform,
  placement,
  scheduledFor,
}: {
  body: string;
  platform: Platform;
  placement: Placement;
  context?: Record<string, unknown> | null;
  advanced?: Partial<InstantPostAdvancedOptions> | null;
  scheduledFor?: Date | null;
}): ChannelRuleResult {
  const repairs: string[] = [];
  const contract = resolveContract({ platform, placement, advanced, context, scheduledFor });
  if (placement === "story") {
    if (body.trim().length) {
      repairs.push("story_caption_removed");
    }
    return { body: "", repairs, proofPoint: null };
  }

  let output = body.replace(/\r\n/g, "\n").trim();

  const blockedFound = findBlockedTokens(output);
  if (blockedFound.length) {
    output = stripBlockedTokens(output);
    repairs.push("blocked_tokens_removed");
  }


[truncated at line 200 — original has 848 lines]
```

### `tests/lib/ai/content-rules.test.ts`

```
import { describe, expect, it } from "vitest";

import { applyChannelRules, lintContent, removeTrailingEllipses } from "@/lib/ai/content-rules";
import { PROOF_POINTS, type ProofPoint } from "@/lib/ai/proof-points";

const ORIGINAL_PROOF_POINTS = [...PROOF_POINTS];
const SAMPLE_PROOF_POINT: ProofPoint = {
  id: "parking",
  variants: ["Free parking available."],
  allowedChannels: ["facebook", "instagram", "gbp"],
  allowedUseCases: ["event", "promotion", "weekly", "instant"],
  intentTags: ["convenience"],
};

describe("content rules", () => {
  const resetProofPoints = () => {
    PROOF_POINTS.length = 0;
    PROOF_POINTS.push(...ORIGINAL_PROOF_POINTS);
  };

  const installProofPoint = () => {
    PROOF_POINTS.length = 0;
    PROOF_POINTS.push(SAMPLE_PROOF_POINT);
  };

  it("does not require Instagram link-in-bio in body for stories (empty body is intentional)", () => {
    const result = lintContent({
      body: "",
      platform: "instagram",
      placement: "story",
      context: { ctaUrl: "https://example.com/book" },
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(result.pass).toBe(true);
    expect(result.issues.find((issue) => issue.code === "link_in_bio_missing")).toBeUndefined();
  });

  it("still requires Instagram link-in-bio line in body for feed posts when a link is present", () => {
    const result = lintContent({
      body: "Join us tonight for live music.",
      platform: "instagram",
      placement: "feed",
      context: { ctaUrl: "https://example.com/book" },
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(result.pass).toBe(false);
    expect(result.issues.some((issue) => issue.code === "link_in_bio_missing")).toBe(true);
  });

  it("passes story lint for all three platforms with an empty body and a campaign cta", () => {
    for (const platform of ["facebook", "instagram", "gbp"] as const) {
      const result = lintContent({
        body: "",
        platform,
        placement: "story",
        context: { ctaUrl: "https://example.com/book", linkInBioUrl: "https://example.com/menu" },
        advanced: { includeHashtags: true, includeEmojis: true },
      });
      expect(result.pass, `${platform} story should pass lint with empty body`).toBe(true);
    }
  });

  it("does not require Facebook CTA URL in body for stories (empty body is intentional)", () => {
    const result = lintContent({
      body: "",
      platform: "facebook",
      placement: "story",
      context: { ctaUrl: "https://example.com/book" },
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(result.pass).toBe(true);
    expect(result.issues.find((issue) => issue.code === "cta_url_missing")).toBeUndefined();
  });

  it("still requires Facebook CTA URL in body for feed posts", () => {
    const result = lintContent({
      body: "Join us tonight for live music.",
      platform: "facebook",
      placement: "feed",
      context: { ctaUrl: "https://example.com/book" },
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(result.pass).toBe(false);
    expect(result.issues.some((issue) => issue.code === "cta_url_missing")).toBe(true);
  });

  it("removes link-in-bio language when no link exists on Instagram", () => {
    const { body } = applyChannelRules({
      body: "Join us tonight. Link in bio for details.",
      platform: "instagram",
      placement: "feed",
      context: {},
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(body.toLowerCase()).not.toContain("link in bio");
  });

  it("adds link-in-bio line when a link exists on Instagram", () => {
    const { body } = applyChannelRules({
      body: "Join us tonight for live music.",
      platform: "instagram",
      placement: "feed",
      context: { ctaUrl: "https://example.com/book", ctaLabel: "Book now" },
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(body).toContain("Book now via the link in our bio.");
  });

  it("enforces GBP hard rules (no hashtags, no link-in-bio, max length)", () => {
    const longBody = `${"Great food and drink. ".repeat(60)} Link in bio for details. #pubnight`;
    const { body } = applyChannelRules({
      body: longBody,
      platform: "gbp",
      placement: "feed",
      context: { ctaUrl: "https://example.com/book" },
      advanced: { includeHashtags: true, includeEmojis: true },
    });

    expect(body.toLowerCase()).not.toContain("link in bio");
    expect(body).not.toContain("#");
    expect(body.length).toBeLessThanOrEqual(900);
  });

  it("flags blocked tokens in lint", () => {
    const lint = lintContent({
      body: "Come down tonight. undefined",
      platform: "facebook",
      placement: "feed",
      context: {},
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(lint.pass).toBe(false);
    expect(lint.issues.some((issue) => issue.code === "blocked_tokens")).toBe(true);
  });

  it("removes disallowed claims for missing fields", () => {
    const { body } = applyChannelRules({
      body: "Limited spaces left, tickets are £10 and we go until 2am.",
      platform: "facebook",
      placement: "feed",
      context: {},
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(body.toLowerCase()).not.toContain("limited spaces");
    // £10 (price claim) is intentionally not removed — price patterns were removed to allow
    // user-specified prices to pass through (see content-rules.ts CLAIM_PATTERNS comment)
    expect(body.toLowerCase()).not.toContain("until 2am");
  });

  it("removes proof points when mode is off", () => {
    installProofPoint();
    const { body } = applyChannelRules({
      body: "Free parking available.\nJoin us tonight.",
      platform: "facebook",
      placement: "feed",
      context: { useCase: "event", proofPointMode: "off" },
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(body.toLowerCase()).not.toContain("free parking");
    resetProofPoints();
  });

  it("adds selected proof points when enabled", () => {
    installProofPoint();
    const { body } = applyChannelRules({
      body: "Join us tonight.",
      platform: "facebook",
      placement: "feed",
      context: { useCase: "event", proofPointMode: "selected", proofPointsSelected: ["parking"] },
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(body).toContain("Free parking available.");
    resetProofPoints();
  });

  it("does not auto-insert proof points when none are present", () => {
    installProofPoint();
    const { body } = applyChannelRules({
      body: "Join us tonight.",
      platform: "facebook",
      placement: "feed",
      context: { useCase: "event", proofPointMode: "auto", proofPointIntentTags: ["convenience"] },
      advanced: { includeHashtags: false, includeEmojis: false },
    });

    expect(body).not.toContain("Free parking available.");
    resetProofPoints();
  });

  it("flags disallowed proof points in lint", () => {

[truncated at line 200 — original has 473 lines]
```

## Related Files (grep hints)

These files reference the basenames of changed files. They are hints for verification — not included inline. Read them only if a specific finding requires it.

```
Obsidian/OJ-CheersAI2.0/Features/Content Creation & Campaigns.md
docs/redesign-plan/01-product-and-workflow.md
docs/redesign-plan/02-nextjs-architecture.md
docs/redesign-plan/08-qa-and-test-strategy.md
docs/redesign-plan/09-ai-and-content-strategy.md
docs/superpowers/plans/2026-04-10-A-prerequisite-fixes.md
docs/superpowers/specs/2026-04-10-smart-scheduling-and-copy-improvements-design.md
docs/superpowers/specs/2026-04-26-missing-platform-content-spec.md
src/lib/create/service.ts
src/lib/publishing/preflight.ts
```

## Project Conventions (`CLAUDE.md`)

```markdown
# CLAUDE.md — CheersAI 2.0

This file provides project-specific guidance. See the workspace-level `CLAUDE.md` one directory up for shared conventions.

## Quick Profile

- **Framework**: Next.js 16.1, React 19.2
- **Test runner**: Vitest
- **Database**: Supabase (PostgreSQL + RLS)
- **Key integrations**: OpenAI, Resend Email, Framer Motion animations, React Query, Social media APIs (Instagram, Facebook, Google My Business)
- **Size**: ~158 files in src/

## Commands

```bash
npm run dev              # Start development server
npm run build            # Production build
npm run start            # Start production server
npm run lint             # ESLint check (max-warnings=0 in CI)
npm run test             # Vitest run (single pass)
npm run test:watch       # Vitest watch mode
npm run typecheck        # TypeScript check (tsc --noEmit)
npm run ci:verify        # Full CI pipeline: lint + typecheck + test + build
npm run ops:*            # Operational scripts (backfill, link-auth, regenerate derivatives)
```

## Architecture

**Route Structure**: App Router with next.js 16 conventions. Key sections:
- `/auth` — Sign in, sign up, password reset (Supabase JWT + cookies)
- `/dashboard` — Main workspace for authenticated users
- `/api/` — Webhooks and integrations (Instagram, Facebook callbacks)

**Auth**: Supabase Auth with JWT + HTTP-only cookies. Auth context in `src/lib/auth/` provides user state and permissions. All server actions re-verify auth server-side.

**Database**: Supabase PostgreSQL with RLS enabled. Service-role operations for system tasks only (backfills, crons). Client operations use anon-key client.

**Key Integrations**:
- **OpenAI**: `src/lib/` — content generation and AI features
- **Social APIs**: Instagram (webhooks), Facebook (Graph API), Google My Business integrations
- **Resend**: Email notifications and transactional email
- **React Query**: Data fetching with custom hooks in `src/lib/`
- **Framer Motion**: Page transitions and animations

**Data Flow**: Server actions handle mutations (auth, content operations). Client components use React Query for fetching. All responses validated with Zod.

## Key Files

| Path | Purpose |
|------|---------|
| `src/types/` | TypeScript definitions (database, API contracts) |
| `src/lib/auth/` | Authentication, server-side auth helpers, rate limiting |
| `src/lib/publishing/` | Publishing queue and preflight checks |
| `src/lib/scheduling/` | Event conflict detection, scheduling logic |
| `src/lib/planner/` | Data fetching for planner features |
| `src/lib/settings/` | Settings data and user preferences |
| `src/env.ts` | Environment variable validation (Zod) |
| `src/app/api/` | Webhooks (Instagram, Facebook, email) |
| `src/features/` | Feature-specific components and logic |
| `supabase/migrations/` | Database schema migrations |
| `vitest.config.ts` | Vitest configuration |

## Environment Variables

| Var | Purpose |
|-----|---------|
| `OPENAI_API_KEY` | OpenAI API key for content generation |
| `RESEND_API_KEY` | Resend email service key |
| `RESEND_FROM` | Email sender address |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server-only) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public) |
| `NEXT_PUBLIC_SITE_URL` | App base URL for redirects/links |
| `FACEBOOK_APP_ID` | Facebook app ID (public) |
| `FACEBOOK_APP_SECRET` | Facebook app secret (server-only) |
| `INSTAGRAM_APP_ID` | Instagram app ID (public) |
| `INSTAGRAM_APP_SECRET` | Instagram app secret (server-only) |
| `INSTAGRAM_VERIFY_TOKEN` | Instagram webhook verification token |
| `GOOGLE_MY_BUSINESS_CLIENT_ID` | Google My Business OAuth client ID |
| `GOOGLE_MY_BUSINESS_CLIENT_SECRET` | Google My Business OAuth secret |
| `ALERTS_SECRET` | Internal webhook secret for alerts |
| `CRON_SECRET` | Internal webhook secret for cron jobs |
| `ENABLE_CONNECTION_DIAGNOSTICS` | Enable debug logging for integrations |
| `VERCEL_OIDC_TOKEN` | Vercel deployment OIDC (for Vercel functions) |

## Project-Specific Rules / Gotchas

### Env Validation
- `src/env.ts` uses Zod to validate all environment variables at startup
- Missing required vars will throw at build/start time
- Always add new vars to `src/env.ts` before using in code

### Social Media Integrations
- Instagram, Facebook, Google My Business require OAuth tokens and refresh logic
- Webhook verification tokens must match config exactly
- Rate limits enforced per platform — check `src/lib/auth/rate-limit.ts`

### Publishing Queue
- `src/lib/publishing/preflight.ts` validates posts before scheduling
- `src/lib/publishing/queue.ts` manages async publishing
- Always check preflight results before queuing posts

### Scheduling Logic
- `src/lib/scheduling/conflicts.ts` prevents double-booking
- `src/lib/scheduling/materialise.ts` expands recurring events
- Timezone handling uses Luxon library (see workspace CLAUDE.md)

### Testing with Vitest
- Test files coexist with source: `src/**/*.test.ts(x)`
- Mock external services (OpenAI, Resend, Supabase)
- Use factories for test data, not inline object literals
- Minimum 80% coverage on business logic

### Framer Motion Usage
- Used for page transitions and micro-interactions
- Keep animations performant (prefer transform, opacity)
- Test animations disabled in unit tests

### Supabase RLS
- All queries respect RLS — use service-role only for system operations
- Service-role operations documented with comments: `// admin operation: [reason]`
- Never disable RLS "temporarily"

### Resend Email
- All transactional email goes through Resend
- Email templates should be tested with `RESEND_API_KEY` set
- From address format: `"Name (email@domain)"`

### Operational Scripts
- `ops:backfill-connections` — sync social connections
- `ops:backfill-link-in-bio-url` — update profile links
- `ops:link-auth-user` — link Supabase auth to business profile
- `ops:regenerate-story-derivatives` — rebuild cached story variants
- Run in test environment first, then production with caution

### CI Pipeline
- `npm run ci:verify` runs full suite: lint → typecheck → test → build
- All four steps must pass before merge
- No console warnings allowed in CI

### Next.js 16 Specifics
- Using latest App Router patterns
- Server actions with 'use server' directive
- Streaming responses supported but not heavily used
- Build optimization enabled by default
```

---

_End of pack._
