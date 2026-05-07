# Review Pack: banner-overlay-server-impl

**Generated:** 2026-05-07
**Mode:** B (A=Adversarial / B=Code / C=Spec Compliance)
**Project root:** `/Users/peterpitcher/Cursor/OJ-CheersAI2.0/.claude/worktrees/loving-antonelli-8797d7`
**Base ref:** `8f67a9d`
**HEAD:** `9c0588c`
**Diff range:** `8f67a9d...HEAD`
**Stats:**  18 files changed, 1240 insertions(+), 1705 deletions(-)

> This pack is the sole input for reviewers. Do NOT read files outside it unless a specific finding requires verification. If a file not in the pack is needed, mark the finding `Needs verification` and describe what would resolve it.

## Changed Files

```
package.json
scripts/ops/repair-banner-overlays.ts
src/app/api/internal/render-banner/route.ts
src/lib/create/service.ts
src/lib/scheduling/banner-canvas.test.ts
src/lib/scheduling/banner-canvas.ts
src/lib/scheduling/banner-renderer.server.ts
src/lib/settings/data.ts
supabase/functions/materialise-weekly/worker.ts
supabase/functions/publish-queue/banner-config.ts
supabase/functions/publish-queue/banner-label.ts
supabase/functions/publish-queue/worker.ts
supabase/migrations/20260507100100_banner_overlay_drop_columns.sql
tests/app/internal/render-banner-route.test.ts
tests/features/settings/schema.test.ts
tests/lib/scheduling/banner-renderer.server.test.ts
tests/publish-queue.test.ts
tests/setup.ts
```

## User Concerns

Server-side critical path of the banner overlay implementation. Highest-risk pieces are: (1) the Deno publish-queue worker at supabase/functions/publish-queue/worker.ts that calls a Next.js render endpoint over HTTP because Sharp cannot run in Deno; (2) the duplicated Deno-side helpers at supabase/functions/publish-queue/banner-config.ts and banner-label.ts (must stay in sync with src/lib/banner/config.ts + src/lib/scheduling/proximity-label.ts); (3) the new Next.js POST route at src/app/api/internal/render-banner/route.ts (CRON_SECRET timing-safe auth, source media fetch, Sharp render); (4) Migration 1 (additive + CHECK constraints + validated data copy from prompt_context.bannerConfig) and Migration 2 (drop legacy banner_state machinery). Specific concerns: fail-loud on render endpoint error, no platform call on failure, malformed legacy data in copy step, function audit completeness.

## Diff (`8f67a9d...HEAD`)

```diff
diff --git a/package.json b/package.json
index f5836d7..0190988 100644
--- a/package.json
+++ b/package.json
@@ -18,7 +18,6 @@
     "ops:invoke": "tsx scripts/ops/invoke-function.ts",
     "ops:link-auth-user": "tsx scripts/ops/link-auth-user.ts",
     "ops:regenerate-story-derivatives": "tsx scripts/ops/regenerate-story-derivatives.ts",
-    "ops:repair-banners": "tsx scripts/ops/repair-banner-overlays.ts",
     "ops:search-meta-interests": "tsx scripts/ops/search-meta-interests.ts"
   },
   "dependencies": {
@@ -53,6 +52,7 @@
   "devDependencies": {
     "@eslint/eslintrc": "^3",
     "@tailwindcss/postcss": "^4",
+    "@testing-library/jest-dom": "^6.9.1",
     "@testing-library/react": "^16.3.2",
     "@types/luxon": "^3.7.1",
     "@types/node": "^25",
diff --git a/scripts/ops/repair-banner-overlays.ts b/scripts/ops/repair-banner-overlays.ts
deleted file mode 100644
index 2f18e48..0000000
--- a/scripts/ops/repair-banner-overlays.ts
+++ /dev/null
@@ -1,133 +0,0 @@
-import { config as loadEnv } from "dotenv";
-import { existsSync } from "node:fs";
-import { resolve } from "node:path";
-import { createClient } from "@supabase/supabase-js";
-
-const envFiles = [".env", ".env.local"];
-for (const file of envFiles) {
-  const fullPath = resolve(process.cwd(), file);
-  if (existsSync(fullPath)) {
-    loadEnv({ path: fullPath, override: false });
-  }
-}
-
-const apply = process.argv.includes("--apply");
-const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
-const limit = limitArg ? Number(limitArg.split("=")[1]) : 500;
-
-const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
-if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
-  throw new Error("Missing Supabase credentials. Provide NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
-}
-
-const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
-  auth: { persistSession: false },
-});
-
-type CandidateRow = {
-  id: string;
-  account_id: string;
-  status: string;
-  scheduled_for: string | null;
-  prompt_context: Record<string, unknown> | null;
-  content_variants: Array<{
-    id: string;
-    banner_state: string | null;
-    bannered_media_path: string | null;
-  }> | {
-    id: string;
-    banner_state: string | null;
-    bannered_media_path: string | null;
-  } | null;
-};
-
-function normaliseVariants(row: CandidateRow["content_variants"]) {
-  if (!row) return [];
-  return Array.isArray(row) ? row : [row];
-}
-
-async function main() {
-  const { renderBannerForContent } = await import("../../src/lib/scheduling/banner-renderer.server");
-  const nowIso = new Date().toISOString();
-
-  const { data, error } = await supabase
-    .from("content_items")
-    .select("id, account_id, status, scheduled_for, prompt_context, content_variants(id, banner_state, bannered_media_path)")
-    .in("status", ["scheduled", "queued"])
-    .gte("scheduled_for", nowIso)
-    .is("deleted_at", null)
-    .order("scheduled_for", { ascending: true })
-    .limit(Number.isFinite(limit) && limit > 0 ? limit : 500)
-    .returns<CandidateRow[]>();
-
-  if (error) throw error;
-
-  const candidates = (data ?? []).filter((row) => {
-    const banner = row.prompt_context?.banner;
-    const bannerEnabled = Boolean(banner && typeof banner === "object" && (banner as { enabled?: unknown }).enabled === true);
-    if (!bannerEnabled) return false;
-    const variant = normaliseVariants(row.content_variants)[0];
-    return !variant || variant.banner_state === "none" || !variant.banner_state;
-  });
-
-  console.info(`${apply ? "Repairing" : "Dry run:"} ${candidates.length} banner-enabled queued/scheduled post(s) need inspection.`);
-
-  let rendered = 0;
-  let notApplicable = 0;
-  let failed = 0;
-
-  for (const row of candidates) {
-    const variant = normaliseVariants(row.content_variants)[0];
-    console.info(`[banner-repair] ${row.id} ${row.status} ${row.scheduled_for ?? "unscheduled"} variant=${variant?.id ?? "missing"}`);
-
-    if (!apply) continue;
-
-    try {
-      const result = await renderBannerForContent({
-        contentId: row.id,
-        variantId: variant?.id,
-        supabase,
-      });
-      if (result.status === "rendered") rendered += 1;
-      if (result.status === "not_applicable") notApplicable += 1;
-      console.info(`[banner-repair] ${row.id} -> ${result.status}`);
-    } catch (renderError) {
-      failed += 1;
-      const message = renderError instanceof Error ? renderError.message : String(renderError);
-      console.error(`[banner-repair] ${row.id} failed: ${message}`);
-
-      await supabase
-        .from("content_items")
-        .update({ status: "draft", updated_at: new Date().toISOString() })
-        .eq("id", row.id);
-
-      await supabase
-        .from("publish_jobs")
-        .update({
-          status: "failed",
-          last_error: `Banner repair failed: ${message}`,
-          next_attempt_at: null,
-          updated_at: new Date().toISOString(),
-        })
-        .eq("content_item_id", row.id)
-        .in("status", ["queued"]);
-
-      await supabase.from("notifications").insert({
-        account_id: row.account_id,
-        category: "banner_invalidated",
-        message: "Post needs banner rendering before it can publish.",
-        metadata: {
-          contentId: row.id,
-          error: message,
-        },
-      });
-    }
-  }
-
-  console.info(`[banner-repair] rendered=${rendered} notApplicable=${notApplicable} failed=${failed} apply=${apply}`);
-}
-
-main().catch((error) => {
-  console.error(error);
-  process.exit(1);
-});
diff --git a/src/app/api/internal/render-banner/route.ts b/src/app/api/internal/render-banner/route.ts
index 77ef8ef..c4e7f26 100644
--- a/src/app/api/internal/render-banner/route.ts
+++ b/src/app/api/internal/render-banner/route.ts
@@ -1,56 +1,121 @@
 import { NextResponse } from "next/server";
-import { z } from "zod";
+import { timingSafeEqual } from "node:crypto";
 
-import { renderBannerForContent } from "@/lib/scheduling/banner-renderer.server";
+import { renderBannerServer } from "@/lib/banner/render-server";
+import type { ResolvedConfig, BannerPosition } from "@/lib/banner/config";
 
-export const dynamic = "force-dynamic";
 export const runtime = "nodejs";
+export const dynamic = "force-dynamic";
 
-const requestSchema = z.object({
-  contentId: z.string().uuid(),
-  variantId: z.string().uuid().optional(),
-});
+const BANNER_POSITIONS: BannerPosition[] = ["top", "bottom", "left", "right"];
 
-function normaliseAuthHeader(value: string | null) {
-  if (!value) return "";
-  return value.replace(/^Bearer\s+/i, "").trim();
+interface RenderBannerRequestBody {
+    sourceMediaUrl: string;
+    config: ResolvedConfig;
+    label: string;
 }
 
-function resolveInternalSecrets() {
-  return [process.env.INTERNAL_RENDER_SECRET, process.env.CRON_SECRET].filter((value): value is string => Boolean(value));
+function isResolvedConfig(value: unknown): value is ResolvedConfig {
+    if (!value || typeof value !== "object") return false;
+    const v = value as Record<string, unknown>;
+    if (typeof v.enabled !== "boolean") return false;
+    if (typeof v.position !== "string") return false;
+    if (!BANNER_POSITIONS.includes(v.position as BannerPosition)) return false;
+    if (typeof v.bgColour !== "string") return false;
+    if (typeof v.textColour !== "string") return false;
+    if (v.textOverride !== null && typeof v.textOverride !== "string") return false;
+    return true;
 }
 
-export async function POST(request: Request) {
-  const allowedSecrets = resolveInternalSecrets();
-  if (!allowedSecrets.length) {
-    return NextResponse.json({ error: "Internal render secret not configured" }, { status: 500 });
-  }
+function isValidBody(value: unknown): value is RenderBannerRequestBody {
+    if (!value || typeof value !== "object") return false;
+    const v = value as Record<string, unknown>;
+    if (typeof v.sourceMediaUrl !== "string" || v.sourceMediaUrl.length === 0) return false;
+    if (typeof v.label !== "string" || v.label.length === 0) return false;
+    if (!isResolvedConfig(v.config)) return false;
+    return true;
+}
 
-  const xInternalSecret = request.headers.get("x-internal-render-secret")?.trim();
-  const xCronSecret = request.headers.get("x-cron-secret")?.trim();
-  const authHeader = normaliseAuthHeader(request.headers.get("authorization"));
-  const providedSecret = xInternalSecret || xCronSecret || authHeader;
+function safeEqualSecret(provided: string, expected: string): boolean {
+    const a = Buffer.from(provided, "utf8");
+    const b = Buffer.from(expected, "utf8");
+    if (a.length !== b.length) {
+        // Constant-time compare against the longer to avoid early-exit timing leaks.
+        const padded = Buffer.alloc(b.length);
+        a.copy(padded);
+        timingSafeEqual(padded, b);
+        return false;
+    }
+    return timingSafeEqual(a, b);
+}
 
-  if (!allowedSecrets.includes(providedSecret)) {
+function unauthorized() {
     return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
-  }
-
-  const body = await request.json().catch(() => null);
-  const parsed = requestSchema.safeParse(body);
-  if (!parsed.success) {
-    return NextResponse.json({ error: "Invalid render payload" }, { status: 400 });
-  }
-
-  try {
-    const result = await renderBannerForContent(parsed.data);
-    return NextResponse.json({ ok: true, result });
-  } catch (error) {
-    return NextResponse.json(
-      {
-        ok: false,
-        error: error instanceof Error ? error.message : "Banner render failed",
-      },
-      { status: 500 },
-    );
-  }
+}
+
+export async function POST(request: Request): Promise<Response> {
+    const cronSecret = process.env.CRON_SECRET;
+    if (!cronSecret) {
+        return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
+    }
+
+    const authHeader = request.headers.get("authorization");
+    if (!authHeader) {
+        return unauthorized();
+    }
+    const provided = authHeader.replace(/^Bearer\s+/i, "").trim();
+    if (!provided || !safeEqualSecret(provided, cronSecret)) {
+        return unauthorized();
+    }
+
+    let body: unknown;
+    try {
+        body = await request.json();
+    } catch {
+        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
+    }
+
+    if (!isValidBody(body)) {
+        return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
+    }
+
+    const { sourceMediaUrl, config, label } = body;
+
+    let sourceBuffer: Buffer;
+    try {
+        const sourceResp = await fetch(sourceMediaUrl);
+        if (!sourceResp.ok) {
+            return NextResponse.json(
+                { error: `BANNER_RENDER_FAILED: source download failed with status ${sourceResp.status}` },
+                { status: 500 },
+            );
+        }
+        const arrayBuffer = await sourceResp.arrayBuffer();
+        sourceBuffer = Buffer.from(arrayBuffer);
+    } catch (err) {
+        const message = err instanceof Error ? err.message : "unknown source download error";
+        return NextResponse.json(
+            { error: `BANNER_RENDER_FAILED: ${message}` },
+            { status: 500 },
+        );
+    }
+
+    let rendered: Buffer;
+    try {
+        rendered = await renderBannerServer(sourceBuffer, config, label);
+    } catch (err) {
+        const message = err instanceof Error ? err.message : "unknown render error";
+        const reason = message.startsWith("BANNER_RENDER_FAILED")
+            ? message
+            : `BANNER_RENDER_FAILED: ${message}`;
+        return NextResponse.json({ error: reason }, { status: 500 });
+    }
+
+    return new Response(new Uint8Array(rendered), {
+        status: 200,
+        headers: {
+            "content-type": "image/jpeg",
+            "cache-control": "no-store",
+        },
+    });
 }
diff --git a/src/lib/create/service.ts b/src/lib/create/service.ts
index a2d2e89..0ca407e 100644
--- a/src/lib/create/service.ts
+++ b/src/lib/create/service.ts
@@ -28,9 +28,8 @@ import { selectHookStrategy, getHookInstruction } from "@/lib/ai/hooks";
 import type { HookStrategy } from "@/lib/ai/hooks";
 import { inferContentPillar, buildPillarNudge } from "@/lib/ai/pillars";
 import type { ContentPillar } from "@/lib/ai/pillars";
-import { bannerConfigFromDefaults } from "@/lib/scheduling/banner-config";
+import { BANNER_COLOUR_HEX } from "@/lib/scheduling/banner-config";
 import type { BannerDefaults } from "@/lib/scheduling/banner-config";
-import { renderBannerForContent, resolveBannerLabel } from "@/lib/scheduling/banner-renderer.server";
 
 
 const DEBUG_CONTENT_GENERATION = process.env.DEBUG_CONTENT_GENERATION === "true";
@@ -1339,7 +1338,17 @@ async function createCampaignFromPlans({
 
   const nowIso = new Date().toISOString();
 
-  const bannerConfig = bannerDefaults ? bannerConfigFromDefaults(bannerDefaults) : undefined;
+  // Per-campaign banner overrides written directly to content_variants.
+  // Banners are rendered at publish time by the publish-queue worker; no
+  // pre-render or banner_state lifecycle is needed.
+  const bannerOverride = bannerDefaults
+    ? {
+        banner_enabled: true,
+        banner_position: bannerDefaults.position,
+        banner_bg: BANNER_COLOUR_HEX[bannerDefaults.bgColour] ?? null,
+        banner_text_colour: BANNER_COLOUR_HEX[bannerDefaults.textColour] ?? null,
+      }
+    : null;
 
   const contentRows = variants.map((variant) => {
     const baseContext = { ...variant.promptContext, planIndex: variant.planIndex };
@@ -1354,9 +1363,7 @@ async function createCampaignFromPlans({
           ? "scheduled"
           : "queued"
         : "draft",
-      prompt_context: bannerConfig
-        ? { ...baseContext, banner: bannerConfig }
-        : baseContext,
+      prompt_context: baseContext,
       auto_generated: true,
       hook_strategy: variant.hookStrategy ?? null,
       content_pillar: variant.contentPillar ?? null,
@@ -1372,24 +1379,13 @@ async function createCampaignFromPlans({
 
   const variantPayloads = (insertedContent ?? []).map((content, index) => {
     const variant = variants[index];
-    const scheduledFor = variant?.scheduledFor ? variant.scheduledFor.toISOString() : nowIso;
-    const bannerLabel = bannerConfig
-      ? resolveBannerLabel({
-          bannerConfig,
-          scheduledFor,
-          campaign: {
-            campaign_type: type,
-            metadata,
-          },
-        })
-      : null;
 
     return {
       content_item_id: content.id,
       body: variant?.body ?? "",
       media_ids: variant?.mediaIds.length ? variant?.mediaIds : null,
       validation: variant?.validation ?? null,
-      banner_state: bannerConfig ? (bannerLabel ? "expected" : "not_applicable") : "none",
+      ...(bannerOverride ?? {}),
     };
   });
 
@@ -1412,34 +1408,6 @@ async function createCampaignFromPlans({
       throw new Error(`Variant id missing for content ${content.id}`);
     }
 
-    if (bannerConfig) {
-      try {
-        await renderBannerForContent({
-          contentId: content.id,
-          variantId,
-          accountId,
-          supabase,
-        });
-      } catch (error) {
-        const now = new Date().toISOString();
-        await supabase
-          .from("content_items")
-          .update({ status: "draft", updated_at: now })
-          .eq("id", content.id);
-        await supabase.from("notifications").insert({
-          account_id: accountId,
-          category: "banner_invalidated",
-          message: "Post needs banner rendering before it can be scheduled.",
-          metadata: {
-            contentId: content.id,
-            campaignId: campaignRow.id,
-            error: error instanceof Error ? error.message : String(error),
-          },
-        });
-        continue;
-      }
-    }
-
     await enqueuePublishJob({
       contentItemId: content.id,
       variantId,
diff --git a/src/lib/scheduling/banner-canvas.test.ts b/src/lib/scheduling/banner-canvas.test.ts
deleted file mode 100644
index 5080b26..0000000
--- a/src/lib/scheduling/banner-canvas.test.ts
+++ /dev/null
@@ -1,227 +0,0 @@
-// src/lib/scheduling/banner-canvas.test.ts
-import { describe, it, expect, vi, beforeEach } from "vitest";
-import { renderBannerCanvas, STRIP_PX, FONT_SIZE_MAX, FONT_SIZE_MIN } from "./banner-canvas";
-
-// Verify exported constants match spec
-expect(STRIP_PX).toBe(80);
-expect(FONT_SIZE_MAX).toBe(40);
-expect(FONT_SIZE_MIN).toBe(20);
-
-// Mock canvas context
-function createMockCanvas(width: number, height: number) {
-  const ctx = {
-    fillStyle: "",
-    font: "",
-    textAlign: "" as CanvasTextAlign,
-    textBaseline: "" as CanvasTextBaseline,
-    letterSpacing: "",
-    fillRect: vi.fn(),
-    fillText: vi.fn(),
-    drawImage: vi.fn(),
-    save: vi.fn(),
-    restore: vi.fn(),
-    translate: vi.fn(),
-    rotate: vi.fn(),
-    beginPath: vi.fn(),
-    rect: vi.fn(),
-    clip: vi.fn(),
-    measureText: vi.fn(() => ({ width: 200 })),
-  };
-
-  const canvas = {
-    width,
-    height,
-    getContext: vi.fn(() => ctx),
-    toBlob: vi.fn((cb: BlobCallback, type?: string, quality?: number) => {
-      void quality;
-      cb(new Blob(["fake-jpeg"], { type: type ?? "image/jpeg" }));
-    }),
-  } as unknown as HTMLCanvasElement;
-
-  return { canvas, ctx };
-}
-
-// Mock document.createElement to return our mock canvas
-function mockCreateElement(width: number, height: number) {
-  const { canvas, ctx } = createMockCanvas(width, height);
-  const mockDocument = {
-    createElement: vi.fn().mockReturnValue(canvas),
-  };
-  vi.stubGlobal("document", mockDocument);
-  return { canvas, ctx };
-}
-
-// Mock Image loading — use stubGlobal since Image doesn't exist in Node
-// Must use a regular function (not arrow) so it's constructable with `new`
-function mockImageLoad(naturalWidth: number, naturalHeight: number) {
-  function MockImage(this: Record<string, unknown>) {
-    this.crossOrigin = "";
-    this.src = "";
-    this.naturalWidth = naturalWidth;
-    this.naturalHeight = naturalHeight;
-    this.onload = null;
-    this.onerror = null;
-    // Trigger onload asynchronously
-    setTimeout(() => (this.onload as (() => void) | null)?.(), 0);
-  }
-  vi.stubGlobal("Image", MockImage);
-  return MockImage;
-}
-
-// Mock Image that triggers onerror
-function mockImageError() {
-  function MockImage(this: Record<string, unknown>) {
-    this.crossOrigin = "";
-    this.src = "";
-    this.onload = null;
-    this.onerror = null;
-    setTimeout(() => (this.onerror as ((e: unknown) => void) | null)?.(new Error("CORS blocked")), 0);
-  }
-  vi.stubGlobal("Image", MockImage);
-  return MockImage;
-}
-
-describe("renderBannerCanvas", () => {
-  beforeEach(() => {
-    vi.restoreAllMocks();
-    vi.unstubAllGlobals();
-  });
-
-  it("should produce a JPEG blob for a feed image with right-side banner", async () => {
-    mockImageLoad(1080, 1080);
-    const { ctx } = mockCreateElement(1080, 1080);
-
-    const blob = await renderBannerCanvas({
-      imageUrl: "https://example.com/image.jpg",
-      position: "right",
-      bgColour: "gold",
-      textColour: "white",
-      labelText: "THIS WEDNESDAY",
-    });
-
-    expect(blob).toBeInstanceOf(Blob);
-    expect(blob.type).toBe("image/jpeg");
-    // Verify strip was drawn
-    expect(ctx.fillRect).toHaveBeenCalled();
-    expect(ctx.fillText).toHaveBeenCalled();
-  });
-
-  it("should set crossOrigin to anonymous on the image", async () => {
-    mockImageLoad(1080, 1920);
-    mockCreateElement(1080, 1920);
-
-    await renderBannerCanvas({
-      imageUrl: "https://example.com/image.jpg",
-      position: "top",
-      bgColour: "black",
-      textColour: "white",
-      labelText: "TONIGHT",
-    });
-
-    // With a constructor function, the instance properties are set via `this`.
-    // The loadImage function sets crossOrigin = "anonymous" on the constructed instance.
-    // Since our mock triggers onload, the image loaded successfully with crossOrigin set.
-    // We verify indirectly: if crossOrigin wasn't set, CORS would block and toBlob would fail.
-    // The test passes because the mock image loads successfully.
-    expect(true).toBe(true);
-  });
-
-  it("should scale down images larger than 1080px on shortest side", async () => {
-    mockImageLoad(4000, 3000); // shortest side = 3000
-    const { canvas } = mockCreateElement(4000, 3000);
-
-    await renderBannerCanvas({
-      imageUrl: "https://example.com/big.jpg",
-      position: "bottom",
-      bgColour: "green",
-      textColour: "white",
-      labelText: "TOMORROW",
-    });
-
-    // Shortest side (3000) scaled to 1080 → ratio = 0.36
-    // Width: 4000 * 0.36 = 1440, Height: 1080
-    expect(canvas.width).toBe(1440);
-    expect(canvas.height).toBe(1080);
-  });
-
-  it("should not scale images already at or below 1080px shortest side", async () => {
-    mockImageLoad(1080, 1920);
-    const { canvas } = mockCreateElement(1080, 1920);
-
-    await renderBannerCanvas({
-      imageUrl: "https://example.com/story.jpg",
-      position: "right",
-      bgColour: "gold",
-      textColour: "white",
-      labelText: "TONIGHT",
-    });
-
-    expect(canvas.width).toBe(1080);
-    expect(canvas.height).toBe(1920);
-  });
-
-  it("should scale font down for long labels", async () => {
-    mockImageLoad(1080, 1080);
-    const { ctx } = mockCreateElement(1080, 1080);
-    // measureText returns a width larger than the strip
-    ctx.measureText.mockReturnValue({ width: 2000 } as TextMetrics);
-
-    await renderBannerCanvas({
-      imageUrl: "https://example.com/image.jpg",
-      position: "top",
-      bgColour: "gold",
-      textColour: "white",
-      labelText: "THIS WEDNESDAY NIGHT SPECIAL EVENT",
-    });
-
-    // Just verify fillText was still called (didn't throw)
-    expect(ctx.fillText).toHaveBeenCalled();
-  });
-
-  it("should use rotate for left position", async () => {
-    mockImageLoad(1080, 1920);
-    const { ctx } = mockCreateElement(1080, 1920);
-
-    await renderBannerCanvas({
-      imageUrl: "https://example.com/story.jpg",
-      position: "left",
-      bgColour: "black",
-      textColour: "gold",
-      labelText: "TOMORROW",
-    });
-
-    expect(ctx.rotate).toHaveBeenCalled();
-    expect(ctx.save).toHaveBeenCalled();
-    expect(ctx.restore).toHaveBeenCalled();
-  });
-
-  it("should use rotate for right position", async () => {
-    mockImageLoad(1080, 1920);
-    const { ctx } = mockCreateElement(1080, 1920);
-
-    await renderBannerCanvas({
-      imageUrl: "https://example.com/story.jpg",
-      position: "right",
-      bgColour: "gold",
-      textColour: "white",
-      labelText: "TONIGHT",
-    });
-
-    expect(ctx.rotate).toHaveBeenCalled();
-  });
-
-  it("should reject if image fails to load", async () => {
-    mockImageError();
-    mockCreateElement(100, 100);
-
-    await expect(
-      renderBannerCanvas({
-        imageUrl: "https://example.com/cors-blocked.jpg",
-        position: "right",
-        bgColour: "gold",
-        textColour: "white",
-        labelText: "TEST",
-      }),
-    ).rejects.toThrow();
-  });
-});
diff --git a/src/lib/scheduling/banner-canvas.ts b/src/lib/scheduling/banner-canvas.ts
deleted file mode 100644
index 49cbbd2..0000000
--- a/src/lib/scheduling/banner-canvas.ts
+++ /dev/null
@@ -1,210 +0,0 @@
-// src/lib/scheduling/banner-canvas.ts
-import { BANNER_COLOURS, type BannerPosition, type BannerColourId } from "./banner-config";
-
-export const STRIP_PX = 80;
-export const FONT_SIZE_MAX = 40;
-export const FONT_SIZE_MIN = 20;
-const FONT_FAMILY = "system-ui, -apple-system, sans-serif";
-const MAX_SHORT_SIDE_PX = 1080;
-const JPEG_QUALITY = 0.92;
-
-export interface BannerCanvasInput {
-  imageUrl: string;
-  position: BannerPosition;
-  bgColour: BannerColourId;
-  textColour: BannerColourId;
-  labelText: string;
-}
-
-function colourHex(id: BannerColourId): string {
-  return BANNER_COLOURS.find((c) => c.id === id)?.hex ?? "#a57626";
-}
-
-function loadImage(url: string): Promise<HTMLImageElement> {
-  return new Promise((resolve, reject) => {
-    const img = new Image();
-    img.crossOrigin = "anonymous";
-    img.onload = () => resolve(img);
-    img.onerror = (e) => reject(new Error(`Image load failed: ${String(e)}`));
-    img.src = url;
-  });
-}
-
-function computeOutputDimensions(
-  naturalWidth: number,
-  naturalHeight: number,
-): { width: number; height: number } {
-  const shortSide = Math.min(naturalWidth, naturalHeight);
-  if (shortSide <= MAX_SHORT_SIDE_PX) {
-    return { width: naturalWidth, height: naturalHeight };
-  }
-  const scale = MAX_SHORT_SIDE_PX / shortSide;
-  return {
-    width: Math.round(naturalWidth * scale),
-    height: Math.round(naturalHeight * scale),
-  };
-}
-
-const SEPARATOR = "  ·  ";
-
-/** Build a repeating string like "TONIGHT  ·  TONIGHT  ·  TONIGHT" wide enough to fill `targetWidth` */
-function buildRepeatingLabel(
-  ctx: CanvasRenderingContext2D,
-  label: string,
-  targetWidth: number,
-): string {
-  const segment = label + SEPARATOR;
-  const segmentWidth = ctx.measureText(segment).width;
-  if (segmentWidth <= 0) return label;
-  const count = Math.ceil(targetWidth / segmentWidth) + 2; // +2 to overflow past both edges
-  return Array(count).fill(label).join(SEPARATOR);
-}
-
-function fitFontSize(
-  ctx: CanvasRenderingContext2D,
-  _singleLabel: string,
-  stripThickness: number,
-): number {
-  // Font size should fit within the strip thickness (height for horizontal, width for vertical)
-  // Use 60% of strip as max font size, capped at FONT_SIZE_MAX
-  const maxFromStrip = Math.floor(stripThickness * 0.6);
-  const startSize = Math.min(FONT_SIZE_MAX, maxFromStrip);
-  for (let size = startSize; size >= FONT_SIZE_MIN; size -= 2) {
-    ctx.font = `800 ${size}px ${FONT_FAMILY}`;
-    // Check the text height fits in the strip (approximation: font size ≈ height)
-    if (size <= stripThickness - 8) {
-      return size;
-    }
-  }
-  return FONT_SIZE_MIN;
-}
-
-function drawHorizontalBanner(
-  ctx: CanvasRenderingContext2D,
-  canvasWidth: number,
-  canvasHeight: number,
-  position: "top" | "bottom",
-  bgHex: string,
-  textHex: string,
-  labelText: string,
-): void {
-  const y = position === "top" ? 0 : canvasHeight - STRIP_PX;
-
-  // Draw strip
-  ctx.fillStyle = bgHex;
-  ctx.fillRect(0, y, canvasWidth, STRIP_PX);
-
-  // Fit font and build repeating text
-  const fontSize = fitFontSize(ctx, labelText, STRIP_PX);
-  ctx.font = `800 ${fontSize}px ${FONT_FAMILY}`;
-  ctx.fillStyle = textHex;
-  ctx.textAlign = "left";
-  ctx.textBaseline = "middle";
-
-  const repeating = buildRepeatingLabel(ctx, labelText, canvasWidth);
-
-  // Clip to strip region to keep text within the banner
-  ctx.save();
-  ctx.beginPath();
-  ctx.rect(0, y, canvasWidth, STRIP_PX);
-  ctx.clip();
-
-  // Draw from negative offset so text overflows past left edge
-  const segmentWidth = ctx.measureText(labelText + SEPARATOR).width;
-  const startX = -(segmentWidth / 2);
-  ctx.fillText(repeating, startX, y + STRIP_PX / 2);
-
-  ctx.restore();
-}
-
-function drawVerticalBanner(
-  ctx: CanvasRenderingContext2D,
-  canvasWidth: number,
-  canvasHeight: number,
-  position: "left" | "right",
-  bgHex: string,
-  textHex: string,
-  labelText: string,
-): void {
-  const x = position === "left" ? 0 : canvasWidth - STRIP_PX;
-
-  // Draw strip
-  ctx.fillStyle = bgHex;
-  ctx.fillRect(x, 0, STRIP_PX, canvasHeight);
-
-  // Fit font and build repeating text (for vertical, the "length" is canvasHeight)
-  const fontSize = fitFontSize(ctx, labelText, STRIP_PX);
-
-  ctx.save();
-  ctx.font = `800 ${fontSize}px ${FONT_FAMILY}`;
-  ctx.fillStyle = textHex;
-  ctx.textAlign = "left";
-  ctx.textBaseline = "middle";
-
-  const repeating = buildRepeatingLabel(ctx, labelText, canvasHeight);
-
-  // Clip to strip region
-  ctx.beginPath();
-  ctx.rect(x, 0, STRIP_PX, canvasHeight);
-  ctx.clip();
-
-  // Rotate and draw
-  if (position === "right") {
-    ctx.translate(x + STRIP_PX / 2, canvasHeight / 2);
-    ctx.rotate(Math.PI / 2);
-  } else {
-    ctx.translate(x + STRIP_PX / 2, canvasHeight / 2);
-    ctx.rotate(-Math.PI / 2);
-  }
-
-  const totalWidth = ctx.measureText(repeating).width;
-  const startX = -(totalWidth / 2);
-  ctx.fillText(repeating, startX, 0);
-
-  ctx.restore();
-}
-
-export async function renderBannerCanvas(
-  input: BannerCanvasInput,
-): Promise<Blob> {
-  const img = await loadImage(input.imageUrl);
-  const { width, height } = computeOutputDimensions(
-    img.naturalWidth,
-    img.naturalHeight,
-  );
-
-  const canvas = document.createElement("canvas");
-  canvas.width = width;
-  canvas.height = height;
-
-  const ctx = canvas.getContext("2d");
-  if (!ctx) {
-    throw new Error("Canvas 2D context not available");
-  }
-
-  // Draw the source image scaled to output dimensions
-  ctx.drawImage(img, 0, 0, width, height);
-
-  const bgHex = colourHex(input.bgColour);
-  const textHex = colourHex(input.textColour);
-
-  if (input.position === "top" || input.position === "bottom") {
-    drawHorizontalBanner(ctx, width, height, input.position, bgHex, textHex, input.labelText);
-  } else {
-    drawVerticalBanner(ctx, width, height, input.position, bgHex, textHex, input.labelText);
-  }
-
-  return new Promise<Blob>((resolve, reject) => {
-    canvas.toBlob(
-      (blob) => {
-        if (!blob) {
-          reject(new Error("Canvas toBlob returned null — canvas may be tainted by CORS"));
-          return;
-        }
-        resolve(blob);
-      },
-      "image/jpeg",
-      JPEG_QUALITY,
-    );
-  });
-}
diff --git a/src/lib/scheduling/banner-renderer.server.ts b/src/lib/scheduling/banner-renderer.server.ts
deleted file mode 100644
index 16a1818..0000000
--- a/src/lib/scheduling/banner-renderer.server.ts
+++ /dev/null
@@ -1,481 +0,0 @@
-import sharp from "sharp";
-import type { SupabaseClient } from "@supabase/supabase-js";
-import { DateTime } from "luxon";
-
-import { BANNER_COLOUR_HEX, parseBannerConfig, type BannerConfig } from "@/lib/scheduling/banner-config";
-import { extractCampaignTiming } from "@/lib/scheduling/campaign-timing";
-import { getProximityLabel } from "@/lib/scheduling/proximity-label";
-import { MEDIA_BUCKET } from "@/lib/constants";
-import { createServiceSupabaseClient } from "@/lib/supabase/service";
-
-const STRIP_PX = 80;
-const FONT_SIZE_MAX = 40;
-const FONT_SIZE_MIN = 20;
-const MAX_SHORT_SIDE_PX = 1080;
-const JPEG_QUALITY = 92;
-const SEPARATOR = "  ·  ";
-
-type Placement = "feed" | "story";
-
-type CampaignRow = {
-  campaign_type: string | null;
-  metadata: Record<string, unknown> | null;
-} | null;
-
-type ContentRow = {
-  id: string;
-  account_id: string;
-  placement: Placement;
-  scheduled_for: string | null;
-  prompt_context: Record<string, unknown> | null;
-  campaign_id: string | null;
-  campaigns: CampaignRow;
-};
-
-type VariantRow = {
-  id: string;
-  content_item_id: string;
-  media_ids: string[] | null;
-  banner_state: string | null;
-  bannered_media_path: string | null;
-};
-
-type MediaRow = {
-  id: string;
-  storage_path: string;
-  media_type: "image" | "video";
-  derived_variants: Record<string, unknown> | null;
-};
-
-export type BannerRenderResult =
-  | {
-      status: "rendered";
-      contentId: string;
-      variantId: string;
-      storagePath: string;
-      label: string;
-      sourceMediaPath: string;
-      scheduledAt: string | null;
-      renderMetadata: Record<string, unknown>;
-    }
-  | {
-      status: "not_applicable";
-      contentId: string;
-      variantId: string;
-      reason: string;
-    }
-  | {
-      status: "skipped";
-      contentId: string;
-      reason: string;
-    };
-
-export interface RenderBannerForContentOptions {
-  contentId: string;
-  variantId?: string | null;
-  accountId?: string | null;
-  supabase?: SupabaseClient;
-}
-
-function normaliseStoragePath(path: string) {
-  if (path.startsWith(`${MEDIA_BUCKET}/`)) {
-    return path.slice(MEDIA_BUCKET.length + 1);
-  }
-  return path;
-}
-
-function computeOutputDimensions(width: number, height: number) {
-  const shortSide = Math.min(width, height);
-  if (shortSide <= MAX_SHORT_SIDE_PX) {
-    return { width, height };
-  }
-
-  const scale = MAX_SHORT_SIDE_PX / shortSide;
-  return {
-    width: Math.round(width * scale),
-    height: Math.round(height * scale),
-  };
-}
-
-function xmlEscape(value: string) {
-  return value
-    .replaceAll("&", "&amp;")
-    .replaceAll("<", "&lt;")
-    .replaceAll(">", "&gt;")
-    .replaceAll('"', "&quot;")
-    .replaceAll("'", "&apos;");
-}
-
-function buildRepeatingLabel(label: string, targetLength: number) {
-  const segment = `${label}${SEPARATOR}`;
-  const count = Math.max(4, Math.ceil(targetLength / Math.max(label.length * 22, 1)) + 4);
-  return Array(count).fill(label).join(SEPARATOR).startsWith(segment)
-    ? Array(count).fill(label).join(SEPARATOR)
-    : `${label}${SEPARATOR}${Array(count).fill(label).join(SEPARATOR)}`;
-}
-
-function fitFontSize(stripThickness: number) {
-  return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.floor(stripThickness * 0.6)));
-}
-
-function buildBannerSvg({
-  width,
-  height,
-  config,
-  label,
-}: {
-  width: number;
-  height: number;
-  config: BannerConfig;
-  label: string;
-}) {
-  const bg = BANNER_COLOUR_HEX[config.bgColour] ?? BANNER_COLOUR_HEX.gold;
-  const text = BANNER_COLOUR_HEX[config.textColour] ?? BANNER_COLOUR_HEX.white;
-  const fontSize = fitFontSize(STRIP_PX);
-  const escapedLabel = xmlEscape(buildRepeatingLabel(label, Math.max(width, height)));
-  const commonTextAttrs = [
-    `fill="${text}"`,
-    `font-family="Arial, Helvetica, sans-serif"`,
-    `font-size="${fontSize}"`,
-    `font-weight="800"`,
-    `letter-spacing="3"`,
-    `dominant-baseline="middle"`,
-  ].join(" ");
-
-  let rect = "";
-  let textNode = "";
-
-  if (config.position === "top" || config.position === "bottom") {
-    const y = config.position === "top" ? 0 : height - STRIP_PX;
-    rect = `<rect x="0" y="${y}" width="${width}" height="${STRIP_PX}" fill="${bg}" />`;
-    textNode = `<text x="-40" y="${y + STRIP_PX / 2}" ${commonTextAttrs}>${escapedLabel}</text>`;
-  } else {
-    const x = config.position === "left" ? 0 : width - STRIP_PX;
-    const rotation = config.position === "right" ? 90 : -90;
-    rect = `<rect x="${x}" y="0" width="${STRIP_PX}" height="${height}" fill="${bg}" />`;
-    textNode = [
-      `<g transform="translate(${x + STRIP_PX / 2} ${height / 2}) rotate(${rotation})">`,
-      `<text x="${-(height / 2) - 80}" y="0" ${commonTextAttrs}>${escapedLabel}</text>`,
-      `</g>`,
-    ].join("");
-  }
-
-  return Buffer.from(
-    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${rect}${textNode}</svg>`,
-  );
-}
-
-export function resolveBannerLabel({
-  bannerConfig,
-  scheduledFor,
-  campaign,
-}: {
-  bannerConfig: BannerConfig | null;
-  scheduledFor: string | null;
-  campaign: CampaignRow;
-}) {
-  if (!bannerConfig?.enabled) return null;
-
-  const customMessage = bannerConfig.customMessage?.trim();
-  if (customMessage) {
-    return customMessage.toUpperCase();
-  }
-
-  if (!campaign?.campaign_type || !campaign.metadata) {
-    return null;
-  }
-
-  const timing = extractCampaignTiming({
-    campaign_type: campaign.campaign_type,
-    metadata: campaign.metadata,
-  });
-  const referenceAt = scheduledFor
-    ? DateTime.fromISO(scheduledFor, { zone: "utc" })
-    : DateTime.now().setZone(timing.timezone);
-
-  return getProximityLabel({ referenceAt, campaignTiming: timing });
-}
-
-async function loadContent({
-  supabase,
-  contentId,
-  accountId,
-}: {
-  supabase: SupabaseClient;
-  contentId: string;
-  accountId?: string | null;
-}) {
-  let query = supabase
-    .from("content_items")
-    .select("id, account_id, placement, scheduled_for, prompt_context, campaign_id, campaigns(campaign_type, metadata)")
-    .eq("id", contentId);
-
-  if (accountId) {
-    query = query.eq("account_id", accountId);
-  }
-
-  const { data, error } = await query.maybeSingle<ContentRow>();
-  if (error) throw error;
-  return data ?? null;
-}
-
-async function loadVariant({
-  supabase,
-  contentId,
-  variantId,
-}: {
-  supabase: SupabaseClient;
-  contentId: string;
-  variantId?: string | null;
-}) {
-  let query = supabase
-    .from("content_variants")
-    .select("id, content_item_id, media_ids, banner_state, bannered_media_path")
-    .eq("content_item_id", contentId);
-
-  if (variantId) {
-    query = query.eq("id", variantId);
-  }
-
-  const { data, error } = await query
-    .order("updated_at", { ascending: false })
-    .limit(1)
-    .maybeSingle<VariantRow>();
-
-  if (error) throw error;
-  return data ?? null;
-}
-
-async function updateVariantBannerState({
-  supabase,
-  variantId,
-  state,
-}: {
-  supabase: SupabaseClient;
-  variantId: string;
-  state: "none" | "not_applicable" | "expected" | "rendered" | "stale";
-}) {
-  const nowIso = new Date().toISOString();
-  const { error } = await supabase
-    .from("content_variants")
-    .update({
-      banner_state: state,
-      bannered_media_path: null,
-      banner_label: null,
-      banner_rendered_for_scheduled_at: null,
-      banner_source_media_path: null,
-      banner_render_metadata: null,
-      updated_at: nowIso,
-    })
-    .eq("id", variantId);
-
-  if (error) throw error;
-}
-
-export async function resetBannerStateForContent(options: RenderBannerForContentOptions) {
-  const supabase = options.supabase ?? createServiceSupabaseClient();
-  const content = await loadContent({
-    supabase,
-    contentId: options.contentId,
-    accountId: options.accountId,
-  });
-
-  if (!content) {
-    throw new Error("Content item not found");
-  }
-
-  const variant = await loadVariant({
-    supabase,
-    contentId: options.contentId,
-    variantId: options.variantId,
-  });
-
-  if (!variant) {
-    return { status: "skipped" as const, reason: "variant_missing" };
-  }
-
-  const bannerConfig = parseBannerConfig(content.prompt_context);
-  if (!bannerConfig?.enabled) {
-    await updateVariantBannerState({
-      supabase,
-      variantId: variant.id,
-      state: "none",
-    });
-    return { status: "skipped" as const, reason: "banner_disabled" };
-  }
-
-  const label = resolveBannerLabel({
-    bannerConfig,
-    scheduledFor: content.scheduled_for,
-    campaign: content.campaigns,
-  });
-
-  await updateVariantBannerState({
-    supabase,
-    variantId: variant.id,
-    state: label ? "expected" : "not_applicable",
-  });
-
-  return {
-    status: label ? "expected" as const : "not_applicable" as const,
-    label,
-    variantId: variant.id,
-  };
-}
-
-export async function renderBannerForContent(options: RenderBannerForContentOptions): Promise<BannerRenderResult> {
-  const supabase = options.supabase ?? createServiceSupabaseClient();
-  const content = await loadContent({
-    supabase,
-    contentId: options.contentId,
-    accountId: options.accountId,
-  });
-
-  if (!content) {
-    throw new Error("Content item not found");
-  }
-
-  const bannerConfig = parseBannerConfig(content.prompt_context);
-  if (!bannerConfig?.enabled) {
-    return { status: "skipped", contentId: content.id, reason: "banner_disabled" };
-  }
-
-  const variant = await loadVariant({
-    supabase,
-    contentId: content.id,
-    variantId: options.variantId,
-  });
-
-  if (!variant) {
-    throw new Error("Variant missing for content item");
-  }
-
-  const label = resolveBannerLabel({
-    bannerConfig,
-    scheduledFor: content.scheduled_for,
-    campaign: content.campaigns,
-  });
-
-  if (!label) {
-    await updateVariantBannerState({
-      supabase,
-      variantId: variant.id,
-      state: "not_applicable",
-    });
-    return {
-      status: "not_applicable",
-      contentId: content.id,
-      variantId: variant.id,
-      reason: "no_label_due",
-    };
-  }
-
-  const mediaId = variant.media_ids?.[0];
-  if (!mediaId) {
-    await updateVariantBannerState({ supabase, variantId: variant.id, state: "expected" });
-    throw new Error("No source image available for banner rendering");
-  }
-
-  const { data: media, error: mediaError } = await supabase
-    .from("media_assets")
-    .select("id, storage_path, media_type, derived_variants")
-    .eq("id", mediaId)
-    .maybeSingle<MediaRow>();
-
-  if (mediaError) throw mediaError;
-  if (!media) {
-    await updateVariantBannerState({ supabase, variantId: variant.id, state: "expected" });
-    throw new Error("Media asset not found");
-  }
-  if (media.media_type !== "image") {
-    await updateVariantBannerState({ supabase, variantId: variant.id, state: "expected" });
-    throw new Error("Banner rendering requires an image asset");
-  }
-
-  let sourcePath = normaliseStoragePath(media.storage_path);
-  if (content.placement === "story") {
-    const storyPath = media.derived_variants?.story;
-    if (typeof storyPath !== "string" || !storyPath.length) {
-      await updateVariantBannerState({ supabase, variantId: variant.id, state: "expected" });
-      throw new Error("Story derivative not available for banner rendering");
-    }
-    sourcePath = normaliseStoragePath(storyPath);
-  }
-
-  const { data: sourceBlob, error: downloadError } = await supabase.storage
-    .from(MEDIA_BUCKET)
-    .download(sourcePath);
-
-  if (downloadError || !sourceBlob) {
-    await updateVariantBannerState({ supabase, variantId: variant.id, state: "expected" });
-    throw new Error(downloadError?.message ?? "Unable to download source image");
-  }
-
-  const sourceBuffer = Buffer.from(await sourceBlob.arrayBuffer());
-  const sourceImage = sharp(sourceBuffer).rotate();
-  const metadata = await sourceImage.metadata();
-  const naturalWidth = metadata.width;
-  const naturalHeight = metadata.height;
-
-  if (!naturalWidth || !naturalHeight) {
-    await updateVariantBannerState({ supabase, variantId: variant.id, state: "expected" });
-    throw new Error("Unable to read source image dimensions");
-  }
-
-  const { width, height } = computeOutputDimensions(naturalWidth, naturalHeight);
-  const overlay = buildBannerSvg({ width, height, config: bannerConfig, label });
-  const rendered = await sourceImage
-    .resize(width, height, { fit: "fill" })
-    .composite([{ input: overlay, top: 0, left: 0 }])
-    .jpeg({ quality: JPEG_QUALITY })
-    .toBuffer();
-
-  const storagePath = `banners/${content.id}/${variant.id}.jpg`;
-  const { error: uploadError } = await supabase.storage
-    .from(MEDIA_BUCKET)
-    .upload(storagePath, rendered, {
-      contentType: "image/jpeg",
-      upsert: true,
-    });
-
-  if (uploadError) {
-    await updateVariantBannerState({ supabase, variantId: variant.id, state: "expected" });
-    throw uploadError;
-  }
-
-  const renderMetadata = {
-    position: bannerConfig.position,
-    bgColour: bannerConfig.bgColour,
-    textColour: bannerConfig.textColour,
-    placement: content.placement,
-    width,
-    height,
-    sourceMediaId: media.id,
-  };
-  const nowIso = new Date().toISOString();
-  const { error: updateError } = await supabase
-    .from("content_variants")
-    .update({
-      banner_state: "rendered",
-      bannered_media_path: storagePath,
-      banner_label: label,
-      banner_rendered_for_scheduled_at: content.scheduled_for,
-      banner_source_media_path: sourcePath,
-      banner_render_metadata: renderMetadata,
-      updated_at: nowIso,
-    })
-    .eq("id", variant.id);
-
-  if (updateError) throw updateError;
-
-  return {
-    status: "rendered",
-    contentId: content.id,
-    variantId: variant.id,
-    storagePath,
-    label,
-    sourceMediaPath: sourcePath,
-    scheduledAt: content.scheduled_for,
-    renderMetadata,
-  };
-}
diff --git a/src/lib/settings/data.ts b/src/lib/settings/data.ts
index 06d6a32..d0928f1 100644
--- a/src/lib/settings/data.ts
+++ b/src/lib/settings/data.ts
@@ -1,6 +1,7 @@
 import { requireAuthContext } from "@/lib/auth/server";
 import { DEFAULT_TIMEZONE } from "@/lib/constants";
 import { isSchemaMissingError } from "@/lib/supabase/errors";
+import type { BannerPosition } from "@/lib/banner/config";
 
 export interface BrandProfile {
   toneFormal: number;
@@ -33,6 +34,12 @@ export interface PostingDefaults {
     event: "LEARN_MORE" | "BOOK" | "CALL";
     offer: "REDEEM" | "CALL" | "LEARN_MORE";
   };
+  bannerDefaults: {
+    bannersEnabled: boolean;
+    bannerPosition: BannerPosition;
+    bannerBg: string;
+    bannerTextColour: string;
+  };
 }
 
 export interface OwnerSettings {
@@ -67,6 +74,10 @@ type PostingDefaultsRow = {
   gbp_cta_standard: string;
   gbp_cta_event: string;
   gbp_cta_offer: string;
+  banners_enabled: boolean | null;
+  banner_position: BannerPosition | null;
+  banner_bg: string | null;
+  banner_text_colour: string | null;
 };
 
 type AccountRow = {
@@ -135,7 +146,7 @@ export async function getOwnerSettings(): Promise<OwnerSettings> {
     const { data: postingRow, error: postingError } = await supabase
       .from("posting_defaults")
       .select(
-        "facebook_location_id, instagram_location_id, gbp_location_id, default_posting_time, venue_location, venue_latitude, venue_longitude, notifications, gbp_cta_standard, gbp_cta_event, gbp_cta_offer",
+        "facebook_location_id, instagram_location_id, gbp_location_id, default_posting_time, venue_location, venue_latitude, venue_longitude, notifications, gbp_cta_standard, gbp_cta_event, gbp_cta_offer, banners_enabled, banner_position, banner_bg, banner_text_colour",
       )
       .eq("account_id", accountId)
       .maybeSingle<PostingDefaultsRow>();
@@ -183,6 +194,12 @@ export async function getOwnerSettings(): Promise<OwnerSettings> {
         offer:
           (postingRow?.gbp_cta_offer as PostingDefaults["gbpCtaDefaults"]["offer"]) ?? defaultPosting.gbpCtaDefaults.offer,
       },
+      bannerDefaults: {
+        bannersEnabled: postingRow?.banners_enabled ?? defaultPosting.bannerDefaults.bannersEnabled,
+        bannerPosition: postingRow?.banner_position ?? defaultPosting.bannerDefaults.bannerPosition,
+        bannerBg: postingRow?.banner_bg ?? defaultPosting.bannerDefaults.bannerBg,
+        bannerTextColour: postingRow?.banner_text_colour ?? defaultPosting.bannerDefaults.bannerTextColour,
+      },
     };
 
     return { brand, posting, venueName, venueLocation: posting.venueLocation };
@@ -210,6 +227,12 @@ function createDefaultPosting(timezone: string): PostingDefaults {
       event: "LEARN_MORE",
       offer: "REDEEM",
     },
+    bannerDefaults: {
+      bannersEnabled: false,
+      bannerPosition: "bottom",
+      bannerBg: "#000000",
+      bannerTextColour: "#FFFFFF",
+    },
   };
 }
 
diff --git a/supabase/functions/materialise-weekly/worker.ts b/supabase/functions/materialise-weekly/worker.ts
index 2deaa80..d863412 100644
--- a/supabase/functions/materialise-weekly/worker.ts
+++ b/supabase/functions/materialise-weekly/worker.ts
@@ -53,10 +53,18 @@ export interface MaterialiseWorkerConfig {
     serviceRoleKey: string;
     defaultWeeksAhead: number;
     dedupeWindowMinutes: number;
-    internalRenderUrl?: string;
-    internalRenderSecret?: string;
 }
 
+// Hex map for the legacy four-colour banner palette. Kept in sync with
+// src/lib/scheduling/banner-config.ts for write consistency. The new banner
+// override columns store hex strings, so we resolve here at write time.
+const BANNER_COLOUR_HEX: Record<string, string> = {
+    gold: "#a57626",
+    green: "#005131",
+    black: "#1a1a1a",
+    white: "#ffffff",
+};
+
 function readEnv(name: string): string | undefined {
     const denoEnv = (globalThis as typeof globalThis & {
         Deno?: { env?: { get?: (key: string) => string | undefined } };
@@ -71,14 +79,11 @@ function readEnv(name: string): string | undefined {
 }
 
 export function createDefaultConfig(): MaterialiseWorkerConfig {
-    const siteUrl = readEnv("NEXT_PUBLIC_SITE_URL")?.replace(/\/$/, "");
     return {
         supabaseUrl: readEnv("NEXT_PUBLIC_SUPABASE_URL")!,
         serviceRoleKey: readEnv("SUPABASE_SERVICE_ROLE_KEY")!,
         defaultWeeksAhead: Number(readEnv("WEEKLY_HORIZON_WEEKS") ?? 4),
         dedupeWindowMinutes: Number(readEnv("WEEKLY_DEDUPE_WINDOW_MINUTES") ?? 45),
-        internalRenderUrl: readEnv("INTERNAL_RENDER_URL") ?? (siteUrl ? `${siteUrl}/api/internal/render-banner` : undefined),
-        internalRenderSecret: readEnv("INTERNAL_RENDER_SECRET") ?? readEnv("CRON_SECRET"),
     };
 }
 
@@ -261,15 +266,6 @@ export class WeeklyMaterialiser {
                         proofPointMode,
                         proofPointsSelected,
                         proofPointIntentTags,
-                        ...(bannerDefaults ? {
-                            banner: {
-                                schemaVersion: 1,
-                                enabled: true,
-                                position: bannerDefaults.position,
-                                bgColour: bannerDefaults.bgColour,
-                                textColour: bannerDefaults.textColour,
-                            },
-                        } : {}),
                     },
                     auto_generated: true,
                 })),
@@ -288,6 +284,15 @@ export class WeeklyMaterialiser {
 
         const contentIds: string[] = [];
 

[diff truncated at line 1500 — total was 3415 lines. Consider scoping the review to fewer files.]
```

## Changed File Contents

### `package.json`

```
{
  "name": "cheersai-app",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build --webpack",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest",
    "lint:ci": "eslint --max-warnings=0",
    "typecheck": "tsc --noEmit",
    "test:ci": "CI=1 vitest run",
    "ci:verify": "npm run lint:ci && npm run typecheck && npm run test:ci && npm run build",
    "ops:backfill-connections": "tsx scripts/ops/backfill-connections.ts",
    "ops:repair-gbp-location-ids": "tsx scripts/ops/repair-gbp-location-ids.ts",
    "ops:backfill-link-in-bio-url": "tsx scripts/ops/backfill-link-in-bio-url.ts",
    "ops:invoke": "tsx scripts/ops/invoke-function.ts",
    "ops:link-auth-user": "tsx scripts/ops/link-auth-user.ts",
    "ops:regenerate-story-derivatives": "tsx scripts/ops/regenerate-story-derivatives.ts",
    "ops:search-meta-interests": "tsx scripts/ops/search-meta-interests.ts"
  },
  "dependencies": {
    "@hookform/resolvers": "^5.2.2",
    "@radix-ui/react-dialog": "^1.1.15",
    "@radix-ui/react-label": "^2.1.8",
    "@radix-ui/react-separator": "^1.1.8",
    "@radix-ui/react-slot": "^1.2.4",
    "@radix-ui/react-tooltip": "^1.2.8",
    "@supabase/ssr": "^0.8.0",
    "@supabase/supabase-js": "^2.89.0",
    "@tanstack/react-query": "^5.90.12",
    "@tanstack/react-query-devtools": "^5.91.1",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "dotenv": "^17.2.3",
    "framer-motion": "^12.23.26",
    "lucide-react": "^0.562.0",
    "luxon": "^3.7.2",
    "next": "16.1.0",
    "openai": "^6.15.0",
    "p-limit": "^7.3.0",
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "react-hook-form": "^7.69.0",
    "resend": "^6.6.0",
    "sharp": "^0.34.5",
    "tailwind-merge": "^3.4.0",
    "tailwindcss-animate": "^1.0.7",
    "zod": "^4.2.1"
  },
  "devDependencies": {
    "@eslint/eslintrc": "^3",
    "@tailwindcss/postcss": "^4",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@types/luxon": "^3.7.1",
    "@types/node": "^25",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.1.0",
    "jsdom": "^29.1.1",
    "tailwindcss": "^4",
    "tsx": "^4.21.0",
    "typescript": "^5",
    "vitest": "^4.0.16"
  },
  "optionalDependencies": {
    "lightningcss-darwin-arm64": "^1.30.2"
  }
}
```

### `scripts/ops/repair-banner-overlays.ts`

_(deleted or missing from working tree)_

### `src/app/api/internal/render-banner/route.ts`

```
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { renderBannerServer } from "@/lib/banner/render-server";
import type { ResolvedConfig, BannerPosition } from "@/lib/banner/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BANNER_POSITIONS: BannerPosition[] = ["top", "bottom", "left", "right"];

interface RenderBannerRequestBody {
    sourceMediaUrl: string;
    config: ResolvedConfig;
    label: string;
}

function isResolvedConfig(value: unknown): value is ResolvedConfig {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    if (typeof v.enabled !== "boolean") return false;
    if (typeof v.position !== "string") return false;
    if (!BANNER_POSITIONS.includes(v.position as BannerPosition)) return false;
    if (typeof v.bgColour !== "string") return false;
    if (typeof v.textColour !== "string") return false;
    if (v.textOverride !== null && typeof v.textOverride !== "string") return false;
    return true;
}

function isValidBody(value: unknown): value is RenderBannerRequestBody {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    if (typeof v.sourceMediaUrl !== "string" || v.sourceMediaUrl.length === 0) return false;
    if (typeof v.label !== "string" || v.label.length === 0) return false;
    if (!isResolvedConfig(v.config)) return false;
    return true;
}

function safeEqualSecret(provided: string, expected: string): boolean {
    const a = Buffer.from(provided, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length) {
        // Constant-time compare against the longer to avoid early-exit timing leaks.
        const padded = Buffer.alloc(b.length);
        a.copy(padded);
        timingSafeEqual(padded, b);
        return false;
    }
    return timingSafeEqual(a, b);
}

function unauthorized() {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: Request): Promise<Response> {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
        return unauthorized();
    }
    const provided = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!provided || !safeEqualSecret(provided, cronSecret)) {
        return unauthorized();
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (!isValidBody(body)) {
        return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { sourceMediaUrl, config, label } = body;

    let sourceBuffer: Buffer;
    try {
        const sourceResp = await fetch(sourceMediaUrl);
        if (!sourceResp.ok) {
            return NextResponse.json(
                { error: `BANNER_RENDER_FAILED: source download failed with status ${sourceResp.status}` },
                { status: 500 },
            );
        }
        const arrayBuffer = await sourceResp.arrayBuffer();
        sourceBuffer = Buffer.from(arrayBuffer);
    } catch (err) {
        const message = err instanceof Error ? err.message : "unknown source download error";
        return NextResponse.json(
            { error: `BANNER_RENDER_FAILED: ${message}` },
            { status: 500 },
        );
    }

    let rendered: Buffer;
    try {
        rendered = await renderBannerServer(sourceBuffer, config, label);
    } catch (err) {
        const message = err instanceof Error ? err.message : "unknown render error";
        const reason = message.startsWith("BANNER_RENDER_FAILED")
            ? message
            : `BANNER_RENDER_FAILED: ${message}`;
        return NextResponse.json({ error: reason }, { status: 500 });
    }

    return new Response(new Uint8Array(rendered), {
        status: 200,
        headers: {
            "content-type": "image/jpeg",
            "cache-control": "no-store",
        },
    });
}
```

### `src/lib/create/service.ts`

```
import { DateTime } from "luxon";
import pLimit from "p-limit";

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuthContext } from "@/lib/auth/server";
import type {
  EventCampaignInput,
  InstantPostAdvancedOptions,
  InstantPostInput,
  MediaAssetInput,
  PromotionCampaignInput,
  StorySeriesInput,
  WeeklyCampaignInput,
} from "@/lib/create/schema";
import { buildInstantPostPrompt } from "@/lib/ai/prompts";
import { postProcessGeneratedCopy } from "@/lib/ai/postprocess";
import { applyChannelRules, lintContent } from "@/lib/ai/content-rules";
import { getOpenAIClient } from "@/lib/ai/client";
import { getOwnerSettings } from "@/lib/settings/data";
import { enqueuePublishJob } from "@/lib/publishing/queue";
import { isSchemaMissingError } from "@/lib/supabase/errors";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { formatFriendlyTime } from "@/lib/utils/date";
import { resolveStoryScheduledFor } from "@/lib/create/story-schedule";
import { buildSpreadEvenlySlots, getEngagementOptimisedHour, isSameCalendarDay } from "@/lib/scheduling/spread";
import { deconflictCampaignPlans } from "@/lib/scheduling/deconflict";
import { selectHookStrategy, getHookInstruction } from "@/lib/ai/hooks";
import type { HookStrategy } from "@/lib/ai/hooks";
import { inferContentPillar, buildPillarNudge } from "@/lib/ai/pillars";
import type { ContentPillar } from "@/lib/ai/pillars";
import { BANNER_COLOUR_HEX } from "@/lib/scheduling/banner-config";
import type { BannerDefaults } from "@/lib/scheduling/banner-config";


const DEBUG_CONTENT_GENERATION = process.env.DEBUG_CONTENT_GENERATION === "true";

/** In-memory batch state for hook + pillar variety tracking. */
interface CopyEngagement {
  recentHooks: string[];
  recentPillars: string[];
}

/**
 * Fetch the last 5 hook_strategy and content_pillar values for this account.
 * Runs ONCE per campaign creation, not per plan.
 * Returns arrays seeded for in-memory batch tracking.
 */
async function fetchRecentCopyHistory(
  supabase: SupabaseClient,
  accountId: string,
): Promise<CopyEngagement> {
  const { data, error } = await supabase
    .from("content_items")
    .select("hook_strategy, content_pillar")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    // Non-fatal — fall back to empty history if columns don't exist yet
    console.warn("[create] fetchRecentCopyHistory failed, using empty history:", error.message);
    return { recentHooks: [], recentPillars: [] };
  }

  const recentHooks: string[] = [];
  const recentPillars: string[] = [];

  for (const row of data ?? []) {
    if (typeof row.hook_strategy === "string" && row.hook_strategy) {
      recentHooks.push(row.hook_strategy);
    }
    if (typeof row.content_pillar === "string" && row.content_pillar) {
      recentPillars.push(row.content_pillar);
    }
  }

  // DB query returns newest-first (DESC). Reverse so newest items are at the
  // end of each array — selectHookStrategy uses slice(-3) and buildPillarNudge
  // uses slice(-2) to read the most recent entries from the tail.
  return { recentHooks: recentHooks.reverse(), recentPillars: recentPillars.reverse() };
}

type Platform = InstantPostInput["platforms"][number];

interface VariantPlan {
  title: string;
  prompt: string;
  scheduledFor: Date | null;
  platforms: Platform[];
  media?: MediaAssetInput[];
  promptContext?: Record<string, unknown>;
  options?: InstantPostAdvancedOptions;
  ctaUrl?: string | null;
  linkInBioUrl?: string | null;
  placement: "feed" | "story";
  /** When true, deconflict will not shift this plan to a different day. */
  pinned?: boolean;
  /** Stable index identifying which campaign plan produced this variant. */
  planIndex: number;
}

interface GeneratedVariantResult {
  platform: Platform;
  body: string;
  validation?: BuiltVariant["validation"];
}

interface BuiltVariant {
  platform: Platform;
  body: string;
  scheduledFor: Date | null;
  promptContext: Record<string, unknown>;
  mediaIds: string[];
  options: InstantPostAdvancedOptions;
  linkInBioUrl?: string | null;
  placement: "feed" | "story";
  hookStrategy?: string;
  contentPillar?: string;
  planIndex: number;
  validation?: {
    lintPass: boolean;
    issues: Array<{ code: string; message: string }>;
    repairsApplied: string[];
    metrics: Record<string, unknown>;
    timestamp: string;
  };
}

const DEFAULT_ADVANCED_OPTIONS: InstantPostAdvancedOptions = {
  toneAdjust: "default",
  lengthPreference: "standard",
  includeHashtags: true,
  includeEmojis: true,
  ctaStyle: "default",
};

const MIN_SCHEDULE_OFFSET_MS = 15 * 60 * 1000;
const INSTAGRAM_WORD_LIMIT = 80;
const SLOT_INCREMENT_MINUTES = 30;
const MINUTES_PER_DAY = 24 * 60;

function resolveAdvancedOptions(
  overrides?: Partial<InstantPostAdvancedOptions>,
): InstantPostAdvancedOptions {
  return {
    ...DEFAULT_ADVANCED_OPTIONS,
    ...(overrides ?? {}),
  };
}

function extractAdvancedOptions(
  source: {
    toneAdjust?: InstantPostAdvancedOptions["toneAdjust"];
    lengthPreference?: InstantPostAdvancedOptions["lengthPreference"];
    includeHashtags?: boolean;
    includeEmojis?: boolean;
    ctaStyle?: InstantPostAdvancedOptions["ctaStyle"];
  },
): InstantPostAdvancedOptions {
  return resolveAdvancedOptions({
    toneAdjust: source.toneAdjust,
    lengthPreference: source.lengthPreference,
    includeHashtags: source.includeHashtags,
    includeEmojis: source.includeEmojis,
    ctaStyle: source.ctaStyle,
  });
}

function composePrompt(baseSections: string[], userNotes?: string | null) {
  const sections = baseSections
    .map((section) => section?.trim())
    .filter((section): section is string => Boolean(section?.length));
  const trimmedNotes = userNotes?.trim();
  if (trimmedNotes) {
    sections.push(`Creator notes: ${trimmedNotes}`);
  }
  return sections.join("\n");
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function ensureFutureDate(input: Date | null | undefined): Date | null {
  if (!input) return null;
  const candidate = new Date(input);
  const minimumTime = Date.now() + MIN_SCHEDULE_OFFSET_MS;
  if (candidate.getTime() < minimumTime) {
    return new Date(minimumTime);
  }
  return candidate;
}

interface ScheduledSlotRow {
  scheduled_for: string | null;
  platform: Platform | null;
  placement: "feed" | "story" | null;
}

function toScheduleSlot(date: Date) {
  const zoned = DateTime.fromJSDate(date, { zone: DEFAULT_TIMEZONE }).startOf("minute");

[truncated at line 200 — original has 2019 lines]
```

### `src/lib/scheduling/banner-canvas.test.ts`

_(deleted or missing from working tree)_

### `src/lib/scheduling/banner-canvas.ts`

_(deleted or missing from working tree)_

### `src/lib/scheduling/banner-renderer.server.ts`

_(deleted or missing from working tree)_

### `src/lib/settings/data.ts`

```
import { requireAuthContext } from "@/lib/auth/server";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { isSchemaMissingError } from "@/lib/supabase/errors";
import type { BannerPosition } from "@/lib/banner/config";

export interface BrandProfile {
  toneFormal: number;
  tonePlayful: number;
  keyPhrases: string[];
  bannedTopics: string[];
  bannedPhrases: string[];
  defaultHashtags: string[];
  defaultEmojis: string[];
  instagramSignature?: string;
  facebookSignature?: string;
  gbpCta?: string;
}

export interface PostingDefaults {
  timezone: string;
  facebookLocationId?: string;
  instagramLocationId?: string;
  gbpLocationId?: string;
  defaultPostingTime?: string;
  venueLocation?: string;
  venueLatitude?: number;
  venueLongitude?: number;
  notifications: {
    emailFailures: boolean;
    emailTokenExpiring: boolean;
  };
  gbpCtaDefaults: {
    standard: "LEARN_MORE" | "BOOK" | "CALL";
    event: "LEARN_MORE" | "BOOK" | "CALL";
    offer: "REDEEM" | "CALL" | "LEARN_MORE";
  };
  bannerDefaults: {
    bannersEnabled: boolean;
    bannerPosition: BannerPosition;
    bannerBg: string;
    bannerTextColour: string;
  };
}

export interface OwnerSettings {
  brand: BrandProfile;
  posting: PostingDefaults;
  venueName?: string;
  venueLocation?: string;
}

type BrandProfileRow = {
  tone_formal: number | null;
  tone_playful: number | null;
  key_phrases: string[] | null;
  banned_topics: string[] | null;
  banned_phrases: string[] | null;
  default_hashtags: string[] | null;
  default_emojis: string[] | null;
  instagram_signature: string | null;
  facebook_signature: string | null;
  gbp_cta: string | null;
};

type PostingDefaultsRow = {
  facebook_location_id: string | null;
  instagram_location_id: string | null;
  gbp_location_id: string | null;
  default_posting_time: string | null;
  venue_location: string | null;
  venue_latitude: number | string | null;
  venue_longitude: number | string | null;
  notifications: Record<string, boolean> | null;
  gbp_cta_standard: string;
  gbp_cta_event: string;
  gbp_cta_offer: string;
  banners_enabled: boolean | null;
  banner_position: BannerPosition | null;
  banner_bg: string | null;
  banner_text_colour: string | null;
};

type AccountRow = {
  timezone: string | null;
  display_name: string | null;
};

export async function getOwnerSettings(): Promise<OwnerSettings> {
  const { supabase, accountId } = await requireAuthContext();

  const defaultBrand: BrandProfile = {
    toneFormal: 0.5,
    tonePlayful: 0.5,
    keyPhrases: [],
    bannedTopics: [],
    bannedPhrases: [],
    defaultHashtags: [],
    defaultEmojis: [],
    instagramSignature: undefined,
    facebookSignature: undefined,
    gbpCta: "LEARN_MORE",
  };

  try {
    const [accountResult, linkInBioResult] = await Promise.all([
      supabase
        .from("accounts")
        .select("timezone, display_name")
        .eq("id", accountId)
        .maybeSingle<AccountRow>(),
      supabase
        .from("link_in_bio_profiles")
        .select("display_name")
        .eq("account_id", accountId)
        .maybeSingle<{ display_name: string | null }>(),
    ]);

    const { data: accountRow, error: accountError } = accountResult;
    const { data: linkInBioRow } = linkInBioResult;

    if (accountError && !isSchemaMissingError(accountError)) {
      throw accountError;
    }

    const timezone = DEFAULT_TIMEZONE;
    // Prioritize Link in Bio display name, fall back to account display name
    const venueName =
      linkInBioRow?.display_name?.trim() || accountRow?.display_name?.trim() || undefined;
    const defaultPosting = createDefaultPosting(timezone);

    const { data: brandRow, error: brandError } = await supabase
      .from("brand_profile")
      .select(
        "tone_formal, tone_playful, key_phrases, banned_topics, banned_phrases, default_hashtags, default_emojis, instagram_signature, facebook_signature, gbp_cta",
      )
      .eq("account_id", accountId)
      .maybeSingle<BrandProfileRow>();

    if (brandError) {
      if (isSchemaMissingError(brandError)) {
        return { brand: defaultBrand, posting: defaultPosting, venueName };
      }
      throw brandError;
    }

    const { data: postingRow, error: postingError } = await supabase
      .from("posting_defaults")
      .select(
        "facebook_location_id, instagram_location_id, gbp_location_id, default_posting_time, venue_location, venue_latitude, venue_longitude, notifications, gbp_cta_standard, gbp_cta_event, gbp_cta_offer, banners_enabled, banner_position, banner_bg, banner_text_colour",
      )
      .eq("account_id", accountId)
      .maybeSingle<PostingDefaultsRow>();

    if (postingError) {
      if (isSchemaMissingError(postingError)) {
        return { brand: defaultBrand, posting: defaultPosting, venueName };
      }
      throw postingError;
    }

    const notifications = postingRow?.notifications ?? defaultPosting.notifications;

    const brand: BrandProfile = {
      toneFormal: brandRow?.tone_formal ?? defaultBrand.toneFormal,
      tonePlayful: brandRow?.tone_playful ?? defaultBrand.tonePlayful,
      keyPhrases: brandRow?.key_phrases ?? defaultBrand.keyPhrases,
      bannedTopics: brandRow?.banned_topics ?? defaultBrand.bannedTopics,
      bannedPhrases: brandRow?.banned_phrases ?? defaultBrand.bannedPhrases,
      defaultHashtags: brandRow?.default_hashtags ?? defaultBrand.defaultHashtags,
      defaultEmojis: brandRow?.default_emojis ?? defaultBrand.defaultEmojis,
      instagramSignature: brandRow?.instagram_signature ?? defaultBrand.instagramSignature,
      facebookSignature: brandRow?.facebook_signature ?? defaultBrand.facebookSignature,
      gbpCta: brandRow?.gbp_cta ?? defaultBrand.gbpCta,
    };

    const posting: PostingDefaults = {
      timezone,
      facebookLocationId: postingRow?.facebook_location_id ?? undefined,
      instagramLocationId: postingRow?.instagram_location_id ?? undefined,
      gbpLocationId: postingRow?.gbp_location_id ?? undefined,
      defaultPostingTime: postingRow?.default_posting_time ?? undefined,
      venueLocation: postingRow?.venue_location ?? undefined,
      venueLatitude: normaliseOptionalNumber(postingRow?.venue_latitude),
      venueLongitude: normaliseOptionalNumber(postingRow?.venue_longitude),
      notifications: {
        emailFailures: Boolean(notifications?.emailFailures ?? defaultPosting.notifications.emailFailures),
        emailTokenExpiring: Boolean(notifications?.emailTokenExpiring ?? defaultPosting.notifications.emailTokenExpiring),
      },
      gbpCtaDefaults: {
        standard:
          (postingRow?.gbp_cta_standard as PostingDefaults["gbpCtaDefaults"]["standard"]) ?? defaultPosting.gbpCtaDefaults.standard,
        event:
          (postingRow?.gbp_cta_event as PostingDefaults["gbpCtaDefaults"]["event"]) ?? defaultPosting.gbpCtaDefaults.event,
        offer:
          (postingRow?.gbp_cta_offer as PostingDefaults["gbpCtaDefaults"]["offer"]) ?? defaultPosting.gbpCtaDefaults.offer,
      },
      bannerDefaults: {
        bannersEnabled: postingRow?.banners_enabled ?? defaultPosting.bannerDefaults.bannersEnabled,
        bannerPosition: postingRow?.banner_position ?? defaultPosting.bannerDefaults.bannerPosition,
        bannerBg: postingRow?.banner_bg ?? defaultPosting.bannerDefaults.bannerBg,

[truncated at line 200 — original has 246 lines]
```

### `supabase/functions/materialise-weekly/worker.ts`

```
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import { type SupabaseClient, createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildWeeklyCopy, clampDay, getFirstOccurrenceAfter, type WeeklyAdvancedOptions } from "./utils.ts";

export type ProviderPlatform = "facebook" | "instagram" | "gbp";
export type ContentStatus = "draft" | "scheduled" | "publishing" | "posted" | "failed";

export interface WeeklyCampaignRow {
    id: string;
    account_id: string;
    name: string;
    auto_confirm: boolean;
    metadata: {
        description?: string;
        dayOfWeek?: number;
        time?: string;
        startDate?: string;
        weeksAhead?: number;
        platforms?: string[];
        heroMedia?: { assetId: string; mediaType: "image" | "video" }[];
        displayEndDate?: string;
        ctaUrl?: string;
        ctaLabel?: string;
        linkInBioUrl?: string;
        proofPointMode?: string;
        proofPointsSelected?: string[];
        proofPointIntentTags?: string[];
        cadence?: unknown; // Keep as unknown for parsing validation if needed, or structured if known
        advanced?: unknown;
    } | null;
}

export interface ContentItemRow {
    id: string;
    scheduled_for: string | null;
    platform: ProviderPlatform;
    placement: "feed" | "story";
    status: ContentStatus | null;
}

export type AdvancedOptions = WeeklyAdvancedOptions;

export interface CadenceEntry {
    platform: ProviderPlatform;
    weekday: number;
    hour: number;
    minute: number;
}

export interface MaterialiseWorkerConfig {
    supabaseUrl: string;
    serviceRoleKey: string;
    defaultWeeksAhead: number;
    dedupeWindowMinutes: number;
}

// Hex map for the legacy four-colour banner palette. Kept in sync with
// src/lib/scheduling/banner-config.ts for write consistency. The new banner
// override columns store hex strings, so we resolve here at write time.
const BANNER_COLOUR_HEX: Record<string, string> = {
    gold: "#a57626",
    green: "#005131",
    black: "#1a1a1a",
    white: "#ffffff",
};

function readEnv(name: string): string | undefined {
    const denoEnv = (globalThis as typeof globalThis & {
        Deno?: { env?: { get?: (key: string) => string | undefined } };
    }).Deno?.env;
    if (denoEnv?.get) {
        return denoEnv.get(name);
    }
    if (typeof process !== "undefined") {
        return process.env?.[name];
    }
    return undefined;
}

export function createDefaultConfig(): MaterialiseWorkerConfig {
    return {
        supabaseUrl: readEnv("NEXT_PUBLIC_SUPABASE_URL")!,
        serviceRoleKey: readEnv("SUPABASE_SERVICE_ROLE_KEY")!,
        defaultWeeksAhead: Number(readEnv("WEEKLY_HORIZON_WEEKS") ?? 4),
        dedupeWindowMinutes: Number(readEnv("WEEKLY_DEDUPE_WINDOW_MINUTES") ?? 45),
    };
}

const DEFAULT_ADVANCED: AdvancedOptions = {
    toneAdjust: "default",
    lengthPreference: "standard",
    includeHashtags: true,
    includeEmojis: true,
    ctaStyle: "default",
};
const SLOT_INCREMENT_MINUTES = 30;
const MINUTES_PER_DAY = 24 * 60;

export class WeeklyMaterialiser {
    private supabase: SupabaseClient;
    private config: MaterialiseWorkerConfig;

    constructor(config: MaterialiseWorkerConfig, supabaseClient?: SupabaseClient) {
        this.config = config;
        this.supabase = supabaseClient ?? createClient(config.supabaseUrl, config.serviceRoleKey, {
            auth: { persistSession: false },
        });
    }

    async run(now = new Date()) {
        const { data: campaigns, error } = await this.supabase
            .from("campaigns")
            .select("id, account_id, name, auto_confirm, metadata")
            .eq("campaign_type", "weekly")
            .eq("status", "scheduled")
            .returns<WeeklyCampaignRow[]>();

        if (error) {
            console.error("[materialise-weekly] failed to fetch campaigns", error);
            throw error;
        }

        let createdCount = 0;
        for (const campaign of campaigns ?? []) {
            createdCount += await this.materialiseForCampaign(campaign, now);
        }
        return createdCount;
    }

    async materialiseForCampaign(campaign: WeeklyCampaignRow, now: Date) {
        const metadata = campaign.metadata ?? {};
        const description = metadata.description ?? "";
        const dayOfWeek = clampDay(metadata.dayOfWeek ?? 0);
        const time = metadata.time ?? "07:00";
        const heroMedia = Array.isArray(metadata.heroMedia) ? metadata.heroMedia : [];
        const platforms = (metadata.platforms && metadata.platforms.length
            ? metadata.platforms
            : ["facebook", "instagram"]) as ProviderPlatform[];
        const weeksAhead = metadata.weeksAhead ?? this.config.defaultWeeksAhead;
        const startDate = metadata.startDate ? new Date(metadata.startDate) : now;
        const displayEndDate = metadata.displayEndDate ? new Date(metadata.displayEndDate) : null;
        const autoConfirm = Boolean(campaign.auto_confirm);
        const ctaUrl = typeof metadata.ctaUrl === "string" ? metadata.ctaUrl : null;
        const ctaLabel = typeof metadata.ctaLabel === "string" ? metadata.ctaLabel : null;
        const linkInBioUrl = typeof metadata.linkInBioUrl === "string" ? metadata.linkInBioUrl : null;
        const proofPointMode = typeof metadata.proofPointMode === "string" ? metadata.proofPointMode : null;
        const proofPointsSelected = Array.isArray(metadata.proofPointsSelected)
            ? metadata.proofPointsSelected.filter((item) => typeof item === "string")
            : [];
        const proofPointIntentTags = Array.isArray(metadata.proofPointIntentTags)
            ? metadata.proofPointIntentTags.filter((item) => typeof item === "string")
            : [];

        const bannerDefaults = this.parseBannerDefaults(metadata);
        const cadence = this.parseCadence(metadata.cadence, platforms, dayOfWeek, time);
        const advanced = this.parseAdvanced(metadata.advanced);
        const computedHorizon = new Date(now.getTime() + weeksAhead * 7 * 24 * 60 * 60 * 1000);
        const horizon = displayEndDate && displayEndDate > now ? displayEndDate : computedHorizon;

        const { data: contentItems, error } = await this.supabase
            .from("content_items")
            .select("id, scheduled_for, platform, placement, status")
            .eq("account_id", campaign.account_id)
            .gte("scheduled_for", now.toISOString())
            .lte("scheduled_for", horizon.toISOString())
            .returns<ContentItemRow[]>();

        if (error) {
            console.error("[materialise-weekly] failed to fetch content_items", error);
            return 0;
        }

        const occupiedByDay = new Map<string, Set<number>>();
        for (const item of contentItems ?? []) {
            if (!item.scheduled_for) continue;
            if (item.placement === "story") continue;
            const scheduledDate = new Date(item.scheduled_for);
            if (!Number.isFinite(scheduledDate.getTime())) continue;
            reserveSlotOnSameDay(scheduledDate, item.platform, occupiedByDay);
        }

        const inserts: {
            scheduledFor: Date;
            platform: ProviderPlatform;
            body: string;
            mediaIds: string[];
            status: ContentStatus;
            placement: "feed" | "story";
            advanced: AdvancedOptions;
        }[] = [];

        for (const cadenceEntry of cadence) {
            const firstOccurrence = getFirstOccurrenceAfter(
                startDate,
                cadenceEntry.weekday,
                formatTimeParts(cadenceEntry.hour, cadenceEntry.minute),
                now,
            );


[truncated at line 200 — original has 530 lines]
```

### `supabase/functions/publish-queue/banner-config.ts`

```
// supabase/functions/publish-queue/banner-config.ts
//
// DUPLICATED from src/lib/banner/config.ts because Deno cannot resolve the
// `@/...` alias used in Node code. Keep the shapes and resolver logic in sync
// with src/lib/banner/config.ts. The same intentional-duplication pattern is
// already used by supabase/functions/materialise-weekly/utils.ts.

export type BannerPosition = "top" | "bottom" | "left" | "right";

export type AccountBannerDefaults = {
    banners_enabled: boolean;
    banner_position: BannerPosition;
    banner_bg: string;
    banner_text_colour: string;
};

export type PostBannerOverrides = {
    banner_enabled: boolean | null;
    banner_text_override: string | null;
    banner_position: BannerPosition | null;
    banner_bg: string | null;
    banner_text_colour: string | null;
};

export type ResolvedConfig = {
    enabled: boolean;
    position: BannerPosition;
    bgColour: string;
    textColour: string;
    textOverride: string | null;
};

export function bannerConfigResolver(
    accountDefaults: AccountBannerDefaults,
    postOverrides: PostBannerOverrides,
): ResolvedConfig {
    return {
        enabled: postOverrides.banner_enabled ?? accountDefaults.banners_enabled,
        position: postOverrides.banner_position ?? accountDefaults.banner_position,
        bgColour: postOverrides.banner_bg ?? accountDefaults.banner_bg,
        textColour: postOverrides.banner_text_colour ?? accountDefaults.banner_text_colour,
        textOverride: postOverrides.banner_text_override,
    };
}
```

### `supabase/functions/publish-queue/banner-label.ts`

```
// supabase/functions/publish-queue/banner-label.ts
//
// DUPLICATED from src/lib/scheduling/campaign-timing.ts and
// src/lib/scheduling/proximity-label.ts because Deno cannot resolve the
// `@/...` alias used in Node code. Keep the timing extraction and label
// derivation logic in sync with the canonical sources in src/lib/scheduling/.
// The same intentional-duplication pattern is already used by
// supabase/functions/materialise-weekly/utils.ts.

import { DateTime } from "luxon";

const DEFAULT_TZ = "Europe/London";

export interface CampaignTiming {
    campaignType: "event" | "promotion" | "weekly" | "story_series";
    startAt: DateTime;
    endAt?: DateTime;
    startTime?: string; // "HH:MM"
    weeklyDayOfWeek?: number; // 1=Mon..7=Sun (Luxon weekday)
    timezone: string;
}

/**
 * Extract canonical timing from a campaign's metadata.
 * Handles both current metadata shapes and legacy eventStart ISO strings.
 */
export function extractCampaignTiming(campaign: {
    campaign_type: string;
    metadata: unknown;
}): CampaignTiming {
    const meta = (campaign.metadata ?? {}) as Record<string, unknown>;
    const tz = DEFAULT_TZ;

    if (campaign.campaign_type === "weekly") {
        return {
            campaignType: "weekly",
            startAt: DateTime.now().setZone(tz),
            weeklyDayOfWeek: Number(meta.dayOfWeek) || 1,
            startTime: typeof meta.time === "string" ? meta.time : undefined,
            timezone: tz,
        };
    }

    let startAt: DateTime;
    if (typeof meta.startDate === "string") {
        startAt = DateTime.fromISO(meta.startDate, { zone: tz });
    } else if (typeof meta.eventStart === "string") {
        startAt = DateTime.fromISO(meta.eventStart, { zone: tz });
    } else {
        startAt = DateTime.now().setZone(tz);
    }

    let startTime: string | undefined;
    if (typeof meta.startTime === "string") {
        startTime = meta.startTime;
    } else if (typeof meta.eventStart === "string") {
        const parsed = DateTime.fromISO(meta.eventStart, { zone: tz });
        if (parsed.isValid) {
            startTime = parsed.toFormat("HH:mm");
        }
    }

    if (campaign.campaign_type === "promotion") {
        const endAt = typeof meta.endDate === "string"
            ? DateTime.fromISO(meta.endDate, { zone: tz })
            : undefined;

        return {
            campaignType: "promotion",
            startAt,
            endAt,
            startTime,
            timezone: tz,
        };
    }

    const resolvedType = campaign.campaign_type === "story_series" ? "story_series" : "event";

    return {
        campaignType: resolvedType,
        startAt,
        startTime,
        timezone: tz,
    };
}

export function getNextWeeklyOccurrence(
    referenceAt: DateTime,
    dayOfWeek: number,
    timezone: string,
): DateTime {
    const ref = referenceAt.setZone(timezone).startOf("day");
    const currentWeekday = ref.weekday;

    let daysUntil = dayOfWeek - currentWeekday;
    if (daysUntil < 0) {
        daysUntil += 7;
    }

    return ref.plus({ days: daysUntil });
}

export type ProximityLabel = string | null;

export interface ProximityLabelInput {
    referenceAt: DateTime;
    campaignTiming: CampaignTiming;
}

const EVENING_THRESHOLD_HOUR = 17;

const WEEKDAY_NAMES = [
    "", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY",
];

const MONTH_SHORT = [
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
    "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function isEvening(startTime?: string): boolean {
    if (!startTime) return false;
    const hour = parseInt(startTime.split(":")[0], 10);
    return hour >= EVENING_THRESHOLD_HOUR;
}

function getEventStartTimestamp(
    eventDate: DateTime,
    startTime: string | undefined,
    timezone: string,
): DateTime {
    if (!startTime) {
        return eventDate.setZone(timezone).endOf("day");
    }
    const [h, m] = startTime.split(":").map(Number);
    return eventDate.setZone(timezone).set({ hour: h, minute: m, second: 0, millisecond: 0 });
}

function getEventLabel(
    referenceAt: DateTime,
    timing: CampaignTiming,
): ProximityLabel {
    const tz = timing.timezone;
    const refDay = referenceAt.setZone(tz).startOf("day");
    const eventDay = timing.startAt.setZone(tz).startOf("day");

    const eventTimestamp = getEventStartTimestamp(timing.startAt, timing.startTime, tz);
    if (referenceAt >= eventTimestamp) {
        return null;
    }

    const daysDiff = eventDay.diff(refDay, "days").days;

    if (daysDiff <= 0) {
        return isEvening(timing.startTime) ? "TONIGHT" : "TODAY";
    }

    if (daysDiff === 1) {
        return isEvening(timing.startTime) ? "TOMORROW NIGHT" : "TOMORROW";
    }

    const targetInTz = timing.startAt.setZone(tz);

    if (daysDiff >= 2 && daysDiff <= 6) {
        const weekdayName = WEEKDAY_NAMES[targetInTz.weekday];
        return `THIS ${weekdayName}`;
    }

    if (daysDiff >= 7 && daysDiff <= 13) {
        const weekdayName = WEEKDAY_NAMES[targetInTz.weekday];
        return `NEXT ${weekdayName}`;
    }

    if (daysDiff >= 14) {
        const weekdayShort = WEEKDAY_NAMES[targetInTz.weekday].slice(0, 3);
        const monthShort = MONTH_SHORT[targetInTz.month - 1];
        return `${weekdayShort} ${targetInTz.day} ${monthShort}`;
    }

    return null;
}

function getPromotionLabel(
    referenceAt: DateTime,
    timing: CampaignTiming,
): ProximityLabel {
    const tz = timing.timezone;
    const refDay = referenceAt.setZone(tz).startOf("day");
    const startDay = timing.startAt.setZone(tz).startOf("day");

    const endDay = timing.endAt
        ? timing.endAt.setZone(tz).startOf("day")
        : undefined;
    const endEOD = endDay
        ? endDay.endOf("day")
        : undefined;

    if (endEOD && referenceAt > endEOD) {
        return null;
    }

[truncated at line 200 — original has 258 lines]
```

### `supabase/functions/publish-queue/worker.ts`

```
/// <reference lib="dom" />

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DateTime } from "luxon";

import { publishToFacebook } from "./providers/facebook.ts";
import { publishToInstagram } from "./providers/instagram.ts";
import { publishToGBP } from "./providers/gbp.ts";
import { resolveConnectionMetadata } from "./metadata.ts";
import type {
    ProviderMedia,
    ProviderPlatform,
    ProviderPlacement,
    ProviderPublishRequest,
    ProviderPublishResult,
} from "./providers/types.ts";
import {
    bannerConfigResolver,
    type AccountBannerDefaults,
    type BannerPosition,
    type PostBannerOverrides,
    type ResolvedConfig,
} from "./banner-config.ts";
import { extractCampaignTiming, getProximityLabel } from "./banner-label.ts";

export interface PublishJobPayload {
    leadWindowMinutes?: number;
    source?: string;
}

export interface PublishJobRow {
    id: string;
    content_item_id: string;
    status: string;
    next_attempt_at: string | null;
    attempt: number | null;
    placement: "feed" | "story";
    variant_id: string;
}

type ContentStatus = "draft" | "scheduled" | "publishing" | "posted" | "failed";

type VariantRow = {
    id: string;
    content_item_id: string;
    body: string | null;
    media_ids: string[] | null;
    banner_enabled: boolean | null;
    banner_text_override: string | null;
    banner_position: BannerPosition | null;
    banner_bg: string | null;
    banner_text_colour: string | null;
};

type PostingDefaultsRow = {
    banners_enabled: boolean;
    banner_position: BannerPosition;
    banner_bg: string;
    banner_text_colour: string;
};

type ConnectionStatus = "active" | "expiring" | "needs_action";

type ContentRow = {
    id: string;
    account_id: string;
    platform: ProviderPlatform;
    placement: "feed" | "story";
    scheduled_for: string | null;
    prompt_context: Record<string, unknown> | null;
    campaigns: {
        name: string | null;
        campaign_type: string | null;
        metadata: Record<string, unknown> | null;
    } | null;
}

type ScheduledContentRow = {
    id: string;
    scheduled_for: string | null;
    placement: "feed" | "story";
}

type ConnectionRow = {
    id: string;
    provider: ProviderPlatform;
    status: ConnectionStatus;
    access_token: string | null;
    refresh_token: string | null;
    expires_at: string | null;
    display_name: string | null;
    metadata: Record<string, unknown> | null;
}

type MediaRow = {
    id: string;
    storage_path: string;
    media_type: "image" | "video";
    mime_type: string | null;
    derived_variants: Record<string, unknown> | null;
    processed_status?: string | null;
}

type NewPublishJobRow = {
    content_item_id: string;
    variant_id: string;
    status: "queued";
    next_attempt_at: string;
    placement: "feed" | "story";
};

function readEnv(name: string): string | undefined {
    const denoEnv = (globalThis as typeof globalThis & {
        Deno?: { env?: { get?: (key: string) => string | undefined } };
    }).Deno?.env;
    if (denoEnv?.get) {
        return denoEnv.get(name);
    }
    if (typeof process !== "undefined") {
        return process.env?.[name];
    }
    return undefined;
}

const BANNER_TIMEZONE = "Europe/London";

interface BannerRenderEndpointConfig {
    url: string;
    secret: string;
}

/**
 * Resolve the banner config + label and (if enabled and a label is due) call
 * the Node-only Sharp render endpoint over HTTP, then upload the result.
 *
 * This worker runs in Deno, which cannot resolve Sharp or the `@/...` module
 * alias used in Node code, so the actual render lives behind a Next.js route
 * (POST /api/internal/render-banner) that this function authenticates against
 * with CRON_SECRET.
 *
 * Returns the storage path of the rendered banner uploaded under
 * `banners/{contentId}/{variantId}.jpg`, or null when no banner applies.
 * Throws on render failure with a `BANNER_RENDER_FAILED:` prefix — caller
 * marks the job failed without invoking any platform.
 */
async function resolveAndRenderBanner(params: {
    supabase: SupabaseClient;
    content: ContentRow;
    variant: VariantRow;
    resolveSourcePath: () => Promise<string | null>;
    mediaBucket: string;
    renderEndpoint: BannerRenderEndpointConfig;
}): Promise<string | null> {
    const { supabase, content, variant, resolveSourcePath, mediaBucket, renderEndpoint } = params;

    const { data: defaultsRow } = await supabase
        .from("posting_defaults")
        .select("banners_enabled, banner_position, banner_bg, banner_text_colour")
        .eq("account_id", content.account_id)
        .maybeSingle<PostingDefaultsRow>();

    if (!defaultsRow) {
        return null;
    }

    const accountDefaults: AccountBannerDefaults = {
        banners_enabled: defaultsRow.banners_enabled,
        banner_position: defaultsRow.banner_position,
        banner_bg: defaultsRow.banner_bg,
        banner_text_colour: defaultsRow.banner_text_colour,
    };
    const postOverrides: PostBannerOverrides = {
        banner_enabled: variant.banner_enabled,
        banner_text_override: variant.banner_text_override,
        banner_position: variant.banner_position,
        banner_bg: variant.banner_bg,
        banner_text_colour: variant.banner_text_colour,
    };
    const config: ResolvedConfig = bannerConfigResolver(accountDefaults, postOverrides);

    if (!config.enabled) {
        return null;
    }

    let computedLabel: string | null = null;
    if (content.campaigns?.campaign_type) {
        try {
            const timing = extractCampaignTiming({
                campaign_type: content.campaigns.campaign_type,
                metadata: content.campaigns.metadata,
            });
            const referenceAt = content.scheduled_for
                ? DateTime.fromISO(content.scheduled_for, { zone: BANNER_TIMEZONE })
                : DateTime.now().setZone(BANNER_TIMEZONE);
            computedLabel = getProximityLabel({ referenceAt, campaignTiming: timing });
        } catch (err) {
            console.warn("[publish-queue] failed to compute proximity label", err);
        }
    }


[truncated at line 200 — original has 1427 lines]
```

### `supabase/migrations/20260507100100_banner_overlay_drop_columns.sql`

```
-- Banner overlay consistency — drop legacy columns (Migration 2 of 2)
-- See docs/superpowers/specs/2026-05-07-banner-overlay-consistency-design.md
--
-- Function audit per .claude/rules/supabase.md was clean:
--   No public functions or triggers reference banner_state, banner_label,
--   bannered_media_path, banner_rendered_for_scheduled_at, banner_render_metadata,
--   or banner_source_media_path. (Verified via information_schema.routines on
--   the cheersai2.0 project on 2026-05-07.)

ALTER TABLE public.content_variants
  DROP COLUMN IF EXISTS banner_state,
  DROP COLUMN IF EXISTS banner_label,
  DROP COLUMN IF EXISTS banner_source_media_path,
  DROP COLUMN IF EXISTS bannered_media_path,
  DROP COLUMN IF EXISTS banner_render_metadata,
  DROP COLUMN IF EXISTS banner_rendered_for_scheduled_at;

-- Drop the index that pointed at the now-removed banner_state / bannered_media_path.
DROP INDEX IF EXISTS idx_content_variants_banner_rendered;
```

### `tests/app/internal/render-banner-route.test.ts`

```
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { renderBannerServerMock } = vi.hoisted(() => ({
    renderBannerServerMock: vi.fn(),
}));

vi.mock("@/lib/banner/render-server", () => ({
    renderBannerServer: renderBannerServerMock,
}));

import { POST } from "@/app/api/internal/render-banner/route";

const VALID_CONFIG = {
    enabled: true,
    position: "bottom" as const,
    bgColour: "#000000",
    textColour: "#FFFFFF",
    textOverride: null,
};

function buildRequest(opts: {
    body?: unknown;
    headers?: Record<string, string>;
    rawBody?: string;
}): Request {
    const headers = new Headers(opts.headers ?? {});
    if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
    }
    const body = opts.rawBody !== undefined
        ? opts.rawBody
        : opts.body !== undefined
            ? JSON.stringify(opts.body)
            : undefined;
    return new Request("http://localhost/api/internal/render-banner", {
        method: "POST",
        headers,
        body,
    });
}

describe("POST /api/internal/render-banner", () => {
    const originalCronSecret = process.env.CRON_SECRET;
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        process.env.CRON_SECRET = "test-cron-secret";
        renderBannerServerMock.mockReset();
    });

    afterEach(() => {
        if (originalCronSecret === undefined) {
            delete process.env.CRON_SECRET;
        } else {
            process.env.CRON_SECRET = originalCronSecret;
        }
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it("returns 500 when CRON_SECRET is not configured", async () => {
        delete process.env.CRON_SECRET;

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer anything" },
            body: { sourceMediaUrl: "https://example.com/img.jpg", config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(500);
        const json = await response.json();
        expect(json).toEqual({ error: "CRON_SECRET not configured" });
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("returns 401 when authorization header is missing", async () => {
        const response = await POST(buildRequest({
            body: { sourceMediaUrl: "https://example.com/img.jpg", config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(401);
        const json = await response.json();
        expect(json).toEqual({ error: "Unauthorized" });
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("returns 401 when authorization header is wrong", async () => {
        const response = await POST(buildRequest({
            headers: { authorization: "Bearer wrong-secret" },
            body: { sourceMediaUrl: "https://example.com/img.jpg", config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(401);
        const json = await response.json();
        expect(json).toEqual({ error: "Unauthorized" });
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("returns 400 for invalid JSON body", async () => {
        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            rawBody: "{not json",
        }));

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json).toEqual({ error: "Invalid JSON body" });
    });

    it("returns 400 when body fields are missing or invalid", async () => {
        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: { sourceMediaUrl: "https://example.com/img.jpg", config: VALID_CONFIG },
        }));

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json).toEqual({ error: "Invalid request body" });
    });

    it("returns 400 when config has invalid position", async () => {
        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: {
                sourceMediaUrl: "https://example.com/img.jpg",
                config: { ...VALID_CONFIG, position: "centre" },
                label: "TONIGHT",
            },
        }));

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json).toEqual({ error: "Invalid request body" });
    });

    it("returns 500 when source download fails", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response("nope", { status: 503 }));

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: { sourceMediaUrl: "https://example.com/img.jpg", config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(500);
        const json = await response.json();
        expect(json.error).toMatch(/^BANNER_RENDER_FAILED: source download failed with status 503$/);
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("returns 500 when renderBannerServer throws", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(
            new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
        );
        renderBannerServerMock.mockRejectedValueOnce(new Error("BANNER_RENDER_FAILED: source has no dimensions"));

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: { sourceMediaUrl: "https://example.com/img.jpg", config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(500);
        const json = await response.json();
        expect(json).toEqual({ error: "BANNER_RENDER_FAILED: source has no dimensions" });
        expect(renderBannerServerMock).toHaveBeenCalledOnce();
    });

    it("prefixes BANNER_RENDER_FAILED on render errors that lack the prefix", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(
            new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
        );
        renderBannerServerMock.mockRejectedValueOnce(new Error("ENOENT"));

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: { sourceMediaUrl: "https://example.com/img.jpg", config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(500);
        const json = await response.json();
        expect(json).toEqual({ error: "BANNER_RENDER_FAILED: ENOENT" });
    });

    it("returns the rendered JPEG buffer on success", async () => {
        const sourceBytes = new Uint8Array([10, 20, 30, 40]);
        globalThis.fetch = vi.fn().mockResolvedValue(new Response(sourceBytes, { status: 200 }));
        const renderedBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
        renderBannerServerMock.mockResolvedValueOnce(renderedBytes);

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: { sourceMediaUrl: "https://example.com/img.jpg", config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("image/jpeg");
        const result = Buffer.from(await response.arrayBuffer());
        expect(result.equals(renderedBytes)).toBe(true);

        expect(renderBannerServerMock).toHaveBeenCalledWith(
            expect.any(Buffer),
            VALID_CONFIG,

[truncated at line 200 — original has 206 lines]
```

### `tests/features/settings/schema.test.ts`

```
import { describe, expect, it } from "vitest";

import { postingDefaultsFormSchema } from "@/features/settings/schema";

const basePostingDefaults = {
  timezone: "Europe/London",
  notifications: {
    emailFailures: true,
    emailTokenExpiring: true,
  },
  gbpCtaDefaults: {
    standard: "LEARN_MORE",
    event: "LEARN_MORE",
    offer: "REDEEM",
  },
  bannerDefaults: {
    bannersEnabled: false,
    bannerPosition: "bottom",
    bannerBg: "#000000",
    bannerTextColour: "#ffffff",
  },
} as const;

describe("postingDefaultsFormSchema", () => {
  it("trims a visible venue location for paid ads targeting", () => {
    const parsed = postingDefaultsFormSchema.parse({
      ...basePostingDefaults,
      venueLocation: "  123 High Street, Leatherhead  ",
    });

    expect(parsed.venueLocation).toBe("123 High Street, Leatherhead");
  });

  it("allows the venue location field to be left blank", () => {
    const parsed = postingDefaultsFormSchema.parse({
      ...basePostingDefaults,
      venueLocation: "",
    });

    expect(parsed.venueLocation).toBe("");
  });

  it("accepts valid Meta Ads coordinates", () => {
    const parsed = postingDefaultsFormSchema.parse({
      ...basePostingDefaults,
      venueLatitude: "51.4625",
      venueLongitude: "-0.5021",
    });

    expect(parsed.venueLatitude).toBe("51.4625");
    expect(parsed.venueLongitude).toBe("-0.5021");
  });

  it("requires latitude and longitude to be entered together", () => {
    const result = postingDefaultsFormSchema.safeParse({
      ...basePostingDefaults,
      venueLatitude: "51.4625",
      venueLongitude: "",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("both latitude and longitude");
  });

  it("rejects out-of-range coordinates", () => {
    const result = postingDefaultsFormSchema.safeParse({
      ...basePostingDefaults,
      venueLatitude: "151.4625",
      venueLongitude: "-0.5021",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("UK latitude");
  });

  it("rejects likely swapped coordinates", () => {
    const result = postingDefaultsFormSchema.safeParse({
      ...basePostingDefaults,
      venueLatitude: "-0.5021",
      venueLongitude: "51.4625",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message).join(" ")).toContain("UK latitude");
  });
});
```

### `tests/lib/scheduling/banner-renderer.server.test.ts`

_(deleted or missing from working tree)_

### `tests/publish-queue.test.ts`

```
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PublishQueueWorker, createDefaultConfig } from "../supabase/functions/publish-queue/worker";
import type { ProviderPlatform, ProviderPublishRequest, ProviderPublishResult } from "../supabase/functions/publish-queue/providers/types";

// Mock Supabase Client
const mockSupabase = {
    from: vi.fn(),
    storage: {
        from: vi.fn(),
    },
    rpc: vi.fn(),
};

// Test-specific Worker subclass to override protected methods
class TestWorker extends PublishQueueWorker {
    // Spy on this method to inject responses
    async publishByPlatform(platform: ProviderPlatform, request: ProviderPublishRequest): Promise<ProviderPublishResult> {
        return super.publishByPlatform(platform, request);
    }

    // Stub recovery to avoid breaking existing test mocks
    async recoverStuckJobs() {
        return;
    }

    protected async recordHeartbeat() {
        return;
    }

    protected async ensureJobsForScheduledContent() {
        return;
    }

    // Expose real implementation for testing
    public async testEnsureJobsForScheduledContent(windowIso: string, nowIso: string) {
        return PublishQueueWorker.prototype["ensureJobsForScheduledContent"].call(this, windowIso, nowIso);
    }
}

describe("PublishQueueWorker", () => {
    let worker: TestWorker;
    const config = createDefaultConfig();

    beforeEach(() => {
        vi.clearAllMocks();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        worker = new TestWorker(config, mockSupabase as any);

        // Default mocks
        mockSupabase.rpc.mockResolvedValue({ data: { context: "test" }, error: null });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("processDueJobs", () => {
        it("handles empty queue gracefully", async () => {
            mockSupabase.from.mockReturnValue({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                lte: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            });

            const result = await worker.processDueJobs();
            expect(result.processed).toBe(0);
        });

        it("processes a valid facebook job successfully", async () => {
            // 1. Mock jobs fetch
            const job = {
                id: "job-1",
                content_item_id: "content-1",
                variant_id: "variant-1",
                status: "queued",
                attempt: 0,
                placement: "feed",
            };

            mockSupabase.from.mockReturnValueOnce({ // select jobs
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                lte: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue({ data: [job], error: null }),
            });

            // 2. Mock lockJob
            mockSupabase.from.mockReturnValueOnce({ // update status=in_progress
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }),
            });

            // 3. Mock loadContent
            mockSupabase.from.mockReturnValueOnce({ // select content
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                        id: "content-1",
                        account_id: "acc-1",
                        platform: "facebook",
                        placement: "feed",
                        prompt_context: {},
                        campaigns: null
                    },
                    error: null
                }),
            });

            // 4. Mock loadVariant — banner override columns all null (banner disabled by default since no posting_defaults loaded)
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                        id: "variant-1",
                        content_item_id: "content-1",
                        body: "Hello World",
                        media_ids: [],
                        banner_enabled: null,
                        banner_text_override: null,
                        banner_position: null,
                        banner_bg: null,
                        banner_text_colour: null,
                    },
                    error: null,
                }),
            });

            // 5. Mock loadConnection
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                        id: "conn-1",
                        provider: "facebook",
                        status: "active",
                        access_token: "token",
                        metadata: { pageId: "123" }
                    },
                    error: null
                }),
            });

            // 6. Mock markContentStatus (publishing)
            mockSupabase.from.mockReturnValueOnce({ update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) });

            // 7. Mock posting_defaults lookup (banner preflight): no row → renderBannerPreflight short-circuits.
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            });

            // 8. Mock publishByPlatform (Stub the response)
            const publishSpy = vi.spyOn(worker, 'publishByPlatform').mockResolvedValue({
                platform: 'facebook',
                externalId: 'post-123',
                payloadPreview: 'Hello World',
                publishedAt: new Date().toISOString()
            });

            // 9. Mock markJobSucceeded
            mockSupabase.from.mockReturnValueOnce({ update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) });
            // 10. Mock markContentStatus (posted)
            mockSupabase.from.mockReturnValueOnce({ update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) });
            // 11. Mock insertNotification
            mockSupabase.from.mockReturnValueOnce({ insert: vi.fn().mockResolvedValue({ error: null }) });

            const result = await worker.processDueJobs();
            expect(result.processed).toBe(1);
            expect(publishSpy).toHaveBeenCalled();
        });

        it("handles retry logic on network failure", async () => {
            // 1. Mock jobs fetch
            const job = { id: "job-2", content_item_id: "content-2", variant_id: "variant-2", status: "queued", attempt: 0, placement: "feed" };
            mockSupabase.from.mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), lte: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: [job], error: null }) });

            // 2. Lock
            mockSupabase.from.mockReturnValueOnce({ update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: "job-2" }, error: null }) });

            // 3. Content
            mockSupabase.from.mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: "content-2", account_id: "acc-1", platform: "facebook", placement: "feed" }, error: null }) });
            // 4. Variant — banner override columns all null
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                        id: "variant-2",
                        content_item_id: "content-2",
                        body: "Retry me",
                        media_ids: [],

[truncated at line 200 — original has 696 lines]
```

### `tests/setup.ts`

```

import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Disable Framer Motion animations in tests to prevent timing issues.
// The node test environment has no DOM, so we return simple passthrough stubs.
vi.mock('framer-motion', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  motion: new Proxy({}, { get: (_, __) => (props: Record<string, unknown>) => props['children'] ?? null }),
  AnimatePresence: ({ children }: { children: unknown }) => children,
  useAnimation: () => ({ start: vi.fn(), stop: vi.fn(), set: vi.fn() }),
  useMotionValue: (initial: number) => ({ get: () => initial, set: vi.fn() }),
  useTransform: () => ({ get: () => 0 }),
  useSpring: (initial: number) => ({ get: () => initial, set: vi.fn() }),
}));

// Set env vars required by src/env.ts for tests that import modules using the env singleton.
// These are mock values — no real services are called in tests.
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'mock-anon-key';
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://mock.supabase.co';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'mock-openai-key';
process.env.CRON_SECRET = process.env.CRON_SECRET ?? 'mock-cron-secret';
process.env.BANNER_RENDER_URL = process.env.BANNER_RENDER_URL ?? 'http://localhost/api/internal/render-banner';

// Mock Deno global if it doesn't exist
// @ts-expect-error - implicit any on globalThis
if (!globalThis.Deno) {
    // @ts-expect-error - overriding global fetch for tests
    globalThis.Deno = {
        env: {
            get: (key: string) => {
                const env: Record<string, string> = {
                    NEXT_PUBLIC_SUPABASE_URL: "https://mock.supabase.co",
                    SUPABASE_SERVICE_ROLE_KEY: "mock-key",
                    MEDIA_BUCKET: "media",
                    ALERT_EMAIL: "test@example.com",
                    META_GRAPH_VERSION: "v19.0",
                    CRON_SECRET: "mock-cron-secret",
                    BANNER_RENDER_URL: "http://localhost/api/internal/render-banner",
                };
                return env[key] || process.env[key];
            },
            toObject: () => process.env,
        },
    };
}
```

## Related Files (grep hints)

These files reference the basenames of changed files. They are hints for verification — not included inline. Read them only if a specific finding requires it.

```
.agents/skills/obsidian-docs/SKILL.md
.agents/skills/obsidian-docs/references/templates.md
.claude/skills/obsidian-docs/SKILL.md
.claude/skills/obsidian-docs/references/templates.md
.github/workflows/ci.yml
.superpowers/brainstorm/18776-1777198840/content/edge-banners.html
.superpowers/brainstorm/47462-1777194875/content/edge-banners.html
.superpowers/brainstorm/47462-1777194875/content/proximity-labels-v10.html
.superpowers/brainstorm/47462-1777194875/content/proximity-labels-v11.html
.superpowers/brainstorm/85876-1777191999/content/banner-angle-v2.html
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
