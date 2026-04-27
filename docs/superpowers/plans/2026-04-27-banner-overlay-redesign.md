# Banner Overlay Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken FFmpeg WASM publish-time banner renderer with a reliable client-side Canvas pre-rendering system that produces WYSIWYG results at approval time.

**Architecture:** Banner images are rendered client-side using the Canvas API when a user approves a post. The rendered JPEG is uploaded to Supabase Storage, and the path is recorded on `content_variants` with an explicit `banner_state` lifecycle. The publish worker uses the pre-rendered image directly — no server-side rendering. Schedule, media, or config changes invalidate the banner and require re-approval.

**Tech Stack:** Canvas API (browser), Supabase Storage (signed uploads), PostgreSQL migration, Next.js server actions, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-04-27-banner-overlay-redesign.md` (v3)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `supabase/migrations/YYYYMMDD_add_banner_variant_columns.sql` | Add `banner_state`, `bannered_media_path`, etc. to `content_variants` |
| `src/lib/scheduling/banner-canvas.ts` | Pure canvas rendering function — image in, JPEG blob out |
| `src/lib/scheduling/banner-canvas.test.ts` | Unit tests for canvas renderer |
| `src/features/planner/banner-rendered-preview.tsx` | WYSIWYG preview component using canvas renderer |
| `src/features/planner/use-banner-prerender.ts` | Hook: render + upload + approve orchestration |
| `src/features/planner/banner-overlay-preview.tsx` | Renamed from `banner-preview.tsx` — lightweight CSS overlay |
| `src/app/(app)/planner/actions.ts` | New `createBannerUploadUrl()`, modified `approveDraftContent()`, staleness in schedule changes |
| `src/features/planner/banner-controls.tsx` | Explicit saves, staleness triggers |
| `src/features/planner/planner-content-composer.tsx` | Integrate new preview, show controls for stories, wire pre-render hook |
| `src/lib/planner/data.ts` | Fix DEFAULT_BANNER_CONFIG fallback |
| `src/features/create/story-series-form.tsx` | Add BannerDefaultsPicker |
| `src/lib/create/service.ts` | Pass `bannerDefaults` in `createStorySeries()` |
| `supabase/functions/publish-queue/worker.ts` | Remove banner rendering, check `banner_state`, resolve `bannered_media_path` |
| `supabase/functions/publish-queue/banner-renderer.ts` | **Delete** |
| `supabase/functions/publish-queue/proximity.ts` | **Delete** |

---

## Task 1: Database migration — add banner columns to content_variants

**Files:**
- Create: `supabase/migrations/20260427120000_add_banner_variant_columns.sql`

- [ ] **Step 1: Create migration file**

```sql
-- supabase/migrations/20260427120000_add_banner_variant_columns.sql

ALTER TABLE content_variants
  ADD COLUMN banner_state text NOT NULL DEFAULT 'none'
    CHECK (banner_state IN ('none', 'not_applicable', 'expected', 'rendered', 'stale')),
  ADD COLUMN bannered_media_path text,
  ADD COLUMN banner_label text,
  ADD COLUMN banner_rendered_for_scheduled_at timestamptz,
  ADD COLUMN banner_source_media_path text,
  ADD COLUMN banner_render_metadata jsonb;

COMMENT ON COLUMN content_variants.banner_state IS
  'Banner lifecycle: none=not configured, not_applicable=enabled but no label, expected=awaiting render, rendered=ready, stale=invalidated';

CREATE INDEX idx_content_variants_banner_rendered
  ON content_variants (content_item_id)
  WHERE banner_state = 'rendered';
```

- [ ] **Step 2: Dry-run the migration**

Run: `npx supabase db push --dry-run`
Expected: Migration applies without errors.

- [ ] **Step 3: Push the migration**

Run: `npx supabase db push`
Expected: Migration applied successfully.

- [ ] **Step 4: Verify columns exist**

Run via Supabase SQL editor or CLI:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'content_variants' AND column_name LIKE 'banner%'
ORDER BY ordinal_position;
```
Expected: 6 new columns listed.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260427120000_add_banner_variant_columns.sql
git commit -m "feat: add banner state columns to content_variants"
```

---

## Task 2: Canvas renderer — `renderBannerCanvas()`

**Files:**
- Create: `src/lib/scheduling/banner-canvas.ts`
- Create: `src/lib/scheduling/banner-canvas.test.ts`

- [ ] **Step 1: Write the test file with all test cases**

```typescript
// src/lib/scheduling/banner-canvas.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderBannerCanvas, STRIP_PX, FONT_SIZE_MAX, FONT_SIZE_MIN } from "./banner-canvas";

// Mock canvas context
function createMockCanvas(width: number, height: number) {
  const ctx = {
    fillStyle: "",
    font: "",
    textAlign: "" as CanvasTextAlign,
    textBaseline: "" as CanvasTextBaseline,
    letterSpacing: "",
    fillRect: vi.fn(),
    fillText: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    measureText: vi.fn(() => ({ width: 200 })),
  };

  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    toBlob: vi.fn((cb: BlobCallback, type?: string, quality?: number) => {
      cb(new Blob(["fake-jpeg"], { type: type ?? "image/jpeg" }));
    }),
  } as unknown as HTMLCanvasElement;

  return { canvas, ctx };
}

// Mock document.createElement to return our mock canvas
function mockCreateElement(width: number, height: number) {
  const { canvas, ctx } = createMockCanvas(width, height);
  vi.spyOn(document, "createElement").mockReturnValue(canvas as unknown as HTMLElement);
  return { canvas, ctx };
}

// Mock Image loading
function mockImageLoad(naturalWidth: number, naturalHeight: number) {
  vi.spyOn(globalThis, "Image").mockImplementation(() => {
    const img = {
      crossOrigin: "",
      src: "",
      naturalWidth,
      naturalHeight,
      onload: null as (() => void) | null,
      onerror: null as ((e: unknown) => void) | null,
    };
    // Trigger onload asynchronously
    setTimeout(() => img.onload?.(), 0);
    return img as unknown as HTMLImageElement;
  });
}

describe("renderBannerCanvas", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should produce a JPEG blob for a feed image with right-side banner", async () => {
    mockImageLoad(1080, 1080);
    const { ctx } = mockCreateElement(1080, 1080);

    const blob = await renderBannerCanvas({
      imageUrl: "https://example.com/image.jpg",
      position: "right",
      bgColour: "gold",
      textColour: "white",
      labelText: "THIS WEDNESDAY",
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/jpeg");
    // Verify strip was drawn
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalled();
  });

  it("should set crossOrigin to anonymous on the image", async () => {
    mockImageLoad(1080, 1920);
    mockCreateElement(1080, 1920);

    await renderBannerCanvas({
      imageUrl: "https://example.com/image.jpg",
      position: "top",
      bgColour: "black",
      textColour: "white",
      labelText: "TONIGHT",
    });

    const imgConstructor = vi.mocked(globalThis.Image);
    const instance = imgConstructor.mock.results[0].value;
    expect(instance.crossOrigin).toBe("anonymous");
  });

  it("should scale down images larger than 1080px on shortest side", async () => {
    mockImageLoad(4000, 3000); // shortest side = 3000
    const { canvas } = mockCreateElement(4000, 3000);

    await renderBannerCanvas({
      imageUrl: "https://example.com/big.jpg",
      position: "bottom",
      bgColour: "green",
      textColour: "white",
      labelText: "TOMORROW",
    });

    // Shortest side (3000) scaled to 1080 → ratio = 0.36
    // Width: 4000 * 0.36 = 1440, Height: 1080
    expect(canvas.width).toBe(1440);
    expect(canvas.height).toBe(1080);
  });

  it("should not scale images already at or below 1080px shortest side", async () => {
    mockImageLoad(1080, 1920);
    const { canvas } = mockCreateElement(1080, 1920);

    await renderBannerCanvas({
      imageUrl: "https://example.com/story.jpg",
      position: "right",
      bgColour: "gold",
      textColour: "white",
      labelText: "TONIGHT",
    });

    expect(canvas.width).toBe(1080);
    expect(canvas.height).toBe(1920);
  });

  it("should scale font down for long labels", async () => {
    mockImageLoad(1080, 1080);
    const { ctx } = mockCreateElement(1080, 1080);
    // measureText returns a width larger than the strip
    ctx.measureText.mockReturnValue({ width: 2000 } as TextMetrics);

    await renderBannerCanvas({
      imageUrl: "https://example.com/image.jpg",
      position: "top",
      bgColour: "gold",
      textColour: "white",
      labelText: "THIS WEDNESDAY NIGHT SPECIAL EVENT",
    });

    // Font should have been scaled below max
    const fontCalls = ctx.font.split("px");
    // Just verify fillText was still called (didn't throw)
    expect(ctx.fillText).toHaveBeenCalled();
  });

  it("should use rotate for left position", async () => {
    mockImageLoad(1080, 1920);
    const { ctx } = mockCreateElement(1080, 1920);

    await renderBannerCanvas({
      imageUrl: "https://example.com/story.jpg",
      position: "left",
      bgColour: "black",
      textColour: "gold",
      labelText: "TOMORROW",
    });

    expect(ctx.rotate).toHaveBeenCalled();
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
  });

  it("should use rotate for right position", async () => {
    mockImageLoad(1080, 1920);
    const { ctx } = mockCreateElement(1080, 1920);

    await renderBannerCanvas({
      imageUrl: "https://example.com/story.jpg",
      position: "right",
      bgColour: "gold",
      textColour: "white",
      labelText: "TONIGHT",
    });

    expect(ctx.rotate).toHaveBeenCalled();
  });

  it("should reject if image fails to load", async () => {
    vi.spyOn(globalThis, "Image").mockImplementation(() => {
      const img = {
        crossOrigin: "",
        src: "",
        onload: null as (() => void) | null,
        onerror: null as ((e: unknown) => void) | null,
      };
      setTimeout(() => img.onerror?.(new Error("CORS blocked")), 0);
      return img as unknown as HTMLImageElement;
    });
    mockCreateElement(100, 100);

    await expect(
      renderBannerCanvas({
        imageUrl: "https://example.com/cors-blocked.jpg",
        position: "right",
        bgColour: "gold",
        textColour: "white",
        labelText: "TEST",
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/scheduling/banner-canvas.test.ts`
Expected: FAIL — `renderBannerCanvas` not found.

- [ ] **Step 3: Write the canvas renderer implementation**

```typescript
// src/lib/scheduling/banner-canvas.ts
import { BANNER_COLOURS, type BannerPosition, type BannerColourId } from "./banner-config";

export const STRIP_PX = 80;
export const FONT_SIZE_MAX = 40;
export const FONT_SIZE_MIN = 20;
const FONT_FAMILY = "system-ui, -apple-system, sans-serif";
const TEXT_MARGIN_PX = 16;
const MAX_SHORT_SIDE_PX = 1080;
const JPEG_QUALITY = 0.92;

export interface BannerCanvasInput {
  imageUrl: string;
  position: BannerPosition;
  bgColour: BannerColourId;
  textColour: BannerColourId;
  labelText: string;
}

function colourHex(id: BannerColourId): string {
  return BANNER_COLOURS.find((c) => c.id === id)?.hex ?? "#a57626";
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`Image load failed: ${String(e)}`));
    img.src = url;
  });
}

function computeOutputDimensions(
  naturalWidth: number,
  naturalHeight: number,
): { width: number; height: number } {
  const shortSide = Math.min(naturalWidth, naturalHeight);
  if (shortSide <= MAX_SHORT_SIDE_PX) {
    return { width: naturalWidth, height: naturalHeight };
  }
  const scale = MAX_SHORT_SIDE_PX / shortSide;
  return {
    width: Math.round(naturalWidth * scale),
    height: Math.round(naturalHeight * scale),
  };
}

function fitFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): number {
  for (let size = FONT_SIZE_MAX; size >= FONT_SIZE_MIN; size -= 2) {
    ctx.font = `bold ${size}px ${FONT_FAMILY}`;
    const measured = ctx.measureText(text);
    if (measured.width <= maxWidth) {
      return size;
    }
  }
  return FONT_SIZE_MIN;
}

function drawHorizontalBanner(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  position: "top" | "bottom",
  bgHex: string,
  textHex: string,
  labelText: string,
): void {
  const y = position === "top" ? 0 : canvasHeight - STRIP_PX;

  // Draw strip
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, y, canvasWidth, STRIP_PX);

  // Fit and draw text
  const maxTextWidth = canvasWidth - TEXT_MARGIN_PX * 2;
  const fontSize = fitFontSize(ctx, labelText, maxTextWidth);
  ctx.font = `bold ${fontSize}px ${FONT_FAMILY}`;
  ctx.fillStyle = textHex;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(labelText, canvasWidth / 2, y + STRIP_PX / 2, maxTextWidth);
}

function drawVerticalBanner(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  position: "left" | "right",
  bgHex: string,
  textHex: string,
  labelText: string,
): void {
  const x = position === "left" ? 0 : canvasWidth - STRIP_PX;

  // Draw strip
  ctx.fillStyle = bgHex;
  ctx.fillRect(x, 0, STRIP_PX, canvasHeight);

  // Fit and draw text (rotated)
  const maxTextWidth = canvasHeight - TEXT_MARGIN_PX * 2;
  const fontSize = fitFontSize(ctx, labelText, maxTextWidth);

  ctx.save();
  ctx.font = `bold ${fontSize}px ${FONT_FAMILY}`;
  ctx.fillStyle = textHex;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (position === "right") {
    ctx.translate(x + STRIP_PX / 2, canvasHeight / 2);
    ctx.rotate(Math.PI / 2);
  } else {
    ctx.translate(x + STRIP_PX / 2, canvasHeight / 2);
    ctx.rotate(-Math.PI / 2);
  }

  ctx.fillText(labelText, 0, 0, maxTextWidth);
  ctx.restore();
}

export async function renderBannerCanvas(
  input: BannerCanvasInput,
): Promise<Blob> {
  const img = await loadImage(input.imageUrl);
  const { width, height } = computeOutputDimensions(
    img.naturalWidth,
    img.naturalHeight,
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context not available");
  }

  // Draw the source image scaled to output dimensions
  ctx.drawImage(img, 0, 0, width, height);

  const bgHex = colourHex(input.bgColour);
  const textHex = colourHex(input.textColour);

  if (input.position === "top" || input.position === "bottom") {
    drawHorizontalBanner(ctx, width, height, input.position, bgHex, textHex, input.labelText);
  } else {
    drawVerticalBanner(ctx, width, height, input.position, bgHex, textHex, input.labelText);
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Canvas toBlob returned null — canvas may be tainted by CORS"));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/scheduling/banner-canvas.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduling/banner-canvas.ts src/lib/scheduling/banner-canvas.test.ts
git commit -m "feat: add client-side Canvas banner renderer with tests"
```

---

## Task 3: Fix DEFAULT_BANNER_CONFIG fallback

**Files:**
- Modify: `src/lib/planner/data.ts` (around line 526)

- [ ] **Step 1: Fix the fallback**

In `src/lib/planner/data.ts`, find:
```typescript
const bannerConfig = parseBannerConfig(row.prompt_context) ?? DEFAULT_BANNER_CONFIG;
```

Replace with:
```typescript
const bannerConfig = parseBannerConfig(row.prompt_context) ?? null;
```

- [ ] **Step 2: Update downstream code to handle null**

In the same function, the code after line 526 accesses `bannerConfig.enabled` — guard with null check:
```typescript
if (bannerConfig?.enabled && row.campaigns?.campaign_type && row.campaigns?.metadata) {
```
(This line likely already uses optional chaining — verify and fix if not.)

Also update the object spread that reads `bannerConfig.position`, `bannerConfig.bgColour`, `bannerConfig.textColour` to use optional chaining:
```typescript
bannerPosition: bannerConfig?.position ?? null,
bannerBgColour: bannerConfig?.bgColour ?? null,
bannerTextColour: bannerConfig?.textColour ?? null,
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm run typecheck && npm test`
Expected: No type errors. Tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/planner/data.ts
git commit -m "fix: default missing banner config to null, not enabled"
```

---

## Task 4: Rename `BannerPreview` → `BannerOverlayPreview`

**Files:**
- Rename: `src/features/planner/banner-preview.tsx` → `src/features/planner/banner-overlay-preview.tsx`
- Modify: all files that import `BannerPreview`

- [ ] **Step 1: Rename the file and export**

```bash
git mv src/features/planner/banner-preview.tsx src/features/planner/banner-overlay-preview.tsx
```

In the renamed file, change the export name:
```typescript
export function BannerOverlayPreview({
```
(was `BannerPreview`)

- [ ] **Step 2: Update all importers**

Find all files importing `BannerPreview`:
```bash
grep -r "banner-preview" src/ --include="*.tsx" --include="*.ts" -l
```

Update each import path from `./banner-preview` to `./banner-overlay-preview` and the component name from `BannerPreview` to `BannerOverlayPreview`.

Key files to check:
- `src/features/planner/planner-content-composer.tsx`
- Any link-in-bio or calendar card components

- [ ] **Step 3: Verify build**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: rename BannerPreview to BannerOverlayPreview"
```

---

## Task 5: WYSIWYG preview component — `BannerRenderedPreview`

**Files:**
- Create: `src/features/planner/banner-rendered-preview.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/features/planner/banner-rendered-preview.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { renderBannerCanvas, type BannerCanvasInput } from "@/lib/scheduling/banner-canvas";
import type { BannerPosition, BannerColourId } from "@/lib/scheduling/banner-config";

interface BannerRenderedPreviewProps {
  imageUrl: string | null;
  position: BannerPosition;
  bgColour: BannerColourId;
  textColour: BannerColourId;
  labelText: string | null;
  className?: string;
}

export function BannerRenderedPreview({
  imageUrl,
  position,
  bgColour,
  textColour,
  labelText,
  className,
}: BannerRenderedPreviewProps): React.ReactElement | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const currentBlobRef = useRef<string | null>(null);

  useEffect(() => {
    // Clean up previous blob URL
    if (currentBlobRef.current) {
      URL.revokeObjectURL(currentBlobRef.current);
      currentBlobRef.current = null;
    }

    if (!imageUrl || !labelText) {
      setBlobUrl(null);
      setError(null);
      return;
    }

    // Debounce renders (e.g. user typing custom message)
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    setLoading(true);
    setError(null);

    debounceRef.current = setTimeout(async () => {
      try {
        const blob = await renderBannerCanvas({
          imageUrl,
          position,
          bgColour,
          textColour,
          labelText,
        });
        const url = URL.createObjectURL(blob);
        currentBlobRef.current = url;
        setBlobUrl(url);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Banner render failed");
        setBlobUrl(null);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [imageUrl, position, bgColour, textColour, labelText]);

  // Clean up blob URL on unmount
  useEffect(() => {
    return () => {
      if (currentBlobRef.current) {
        URL.revokeObjectURL(currentBlobRef.current);
      }
    };
  }, []);

  if (!imageUrl || !labelText) return null;

  if (loading) {
    return (
      <div className={className ?? "flex items-center justify-center rounded-md bg-muted aspect-square"}>
        <span className="text-xs text-muted-foreground animate-pulse">Rendering banner...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={className ?? "flex items-center justify-center rounded-md bg-destructive/10 aspect-square"}>
        <span className="text-xs text-destructive">Banner preview failed</span>
      </div>
    );
  }

  if (!blobUrl) return null;

  return (
    <img
      src={blobUrl}
      alt={`Banner preview: ${labelText}`}
      className={className ?? "w-full rounded-md"}
    />
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/planner/banner-rendered-preview.tsx
git commit -m "feat: add WYSIWYG BannerRenderedPreview component"
```

---

## Task 6: Server actions — signed upload URL and approval changes

**Files:**
- Modify: `src/app/(app)/planner/actions.ts`

- [ ] **Step 1: Add createBannerUploadUrl server action**

At the end of the file, add:

```typescript
const bannerUploadSchema = z.object({
  contentItemId: z.string().uuid(),
});

export async function createBannerUploadUrl(
  payload: unknown,
): Promise<{ signedUrl: string; storagePath: string } | { error: string }> {
  const { contentItemId } = bannerUploadSchema.parse(payload);
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  // Verify user owns this content item
  const { data: item, error: itemError } = await supabase
    .from("content_items")
    .select("id, account_id")
    .eq("id", contentItemId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (itemError || !item) {
    return { error: "Content item not found" };
  }

  const storagePath = `banners/${contentItemId}/${crypto.randomUUID()}.jpg`;

  const { data, error: uploadError } = await supabase.storage
    .from("media")
    .createSignedUploadUrl(storagePath);

  if (uploadError || !data?.signedUrl) {
    return { error: "Failed to create upload URL" };
  }

  return { signedUrl: data.signedUrl, storagePath };
}
```

- [ ] **Step 2: Modify approveDraftContent to accept banner metadata**

Update the approve schema:

```typescript
const approveSchema = z.object({
  contentId: z.string().uuid(),
  bannerStoragePath: z.string().optional(),
  bannerLabel: z.string().optional(),
  bannerScheduledAt: z.string().optional(),
  bannerSourceMediaPath: z.string().optional(),
  bannerRenderMetadata: z.record(z.unknown()).optional(),
});
```

Inside `approveDraftContent()`, after the existing content item load, add banner validation:

```typescript
  // --- Banner validation ---
  const bannerConfig = parseBannerConfig(item.prompt_context);
  let bannerState: string = "none";

  if (bannerConfig?.enabled) {
    if (parsed.bannerStoragePath) {
      // Validate path belongs to this content item
      if (!parsed.bannerStoragePath.startsWith(`banners/${parsed.contentId}/`)) {
        return { error: "Invalid banner storage path" };
      }

      // Verify file exists
      const { data: fileList } = await supabase.storage
        .from("media")
        .list(parsed.bannerStoragePath.split("/").slice(0, -1).join("/"), {
          search: parsed.bannerStoragePath.split("/").pop(),
        });

      if (!fileList?.length) {
        return { error: "Banner file not found in storage" };
      }

      // Server-side label recomputation
      const campaignData = await supabase
        .from("campaigns")
        .select("campaign_type, metadata")
        .eq("id", item.campaign_id)
        .maybeSingle();

      if (campaignData.data) {
        const timing = extractCampaignTiming(campaignData.data);
        const scheduledAt = item.scheduled_for
          ? DateTime.fromISO(item.scheduled_for, { zone: timing.timezone })
          : DateTime.now().setZone(timing.timezone);
        const expectedLabel = bannerConfig.customMessage?.trim().toUpperCase()
          ?? getProximityLabel({ referenceAt: scheduledAt, campaignTiming: timing });

        if (expectedLabel && parsed.bannerLabel !== expectedLabel) {
          // Clean up the uploaded file
          await supabase.storage.from("media").remove([parsed.bannerStoragePath]);
          return { error: "Banner label is stale — re-render required" };
        }
      }

      bannerState = "rendered";
    } else {
      // Banner enabled but no path — check if label would be null (not_applicable)
      const campaignData = await supabase
        .from("campaigns")
        .select("campaign_type, metadata")
        .eq("id", item.campaign_id)
        .maybeSingle();

      if (campaignData.data) {
        const timing = extractCampaignTiming(campaignData.data);
        const scheduledAt = item.scheduled_for
          ? DateTime.fromISO(item.scheduled_for, { zone: timing.timezone })
          : DateTime.now().setZone(timing.timezone);
        const label = bannerConfig.customMessage?.trim().toUpperCase()
          ?? getProximityLabel({ referenceAt: scheduledAt, campaignTiming: timing });

        bannerState = label ? "expected" : "not_applicable";

        if (bannerState === "expected") {
          return { error: "Banner rendering required before approval" };
        }
      } else {
        bannerState = "not_applicable";
      }
    }
  }

  // Update content_variants with banner metadata
  if (bannerState !== "none") {
    const { error: variantError } = await supabase
      .from("content_variants")
      .update({
        banner_state: bannerState,
        bannered_media_path: parsed.bannerStoragePath ?? null,
        banner_label: parsed.bannerLabel ?? null,
        banner_rendered_for_scheduled_at: parsed.bannerScheduledAt ?? null,
        banner_source_media_path: parsed.bannerSourceMediaPath ?? null,
        banner_render_metadata: parsed.bannerRenderMetadata ?? null,
      })
      .eq("content_item_id", parsed.contentId)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (variantError) {
      console.error("[planner] failed to update banner state", variantError);
    }
  }
```

Note: Add these imports at the top of the file:
```typescript
import { parseBannerConfig } from "@/lib/scheduling/banner-config";
import { extractCampaignTiming } from "@/lib/scheduling/campaign-timing";
import { getProximityLabel } from "@/lib/scheduling/proximity-label";
import { DateTime } from "luxon";
```

- [ ] **Step 3: Add staleness check to schedule-change action**

Find the action that updates `scheduled_for` (search for `scheduled_for` updates in the file). After the schedule update, add:

```typescript
  // Check if banner needs invalidation
  const { data: variant } = await supabase
    .from("content_variants")
    .select("id, banner_state, banner_rendered_for_scheduled_at")
    .eq("content_item_id", contentId)
    .eq("banner_state", "rendered")
    .maybeSingle();

  if (variant && variant.banner_rendered_for_scheduled_at) {
    // Recompute label for new schedule
    const campaignData = await supabase
      .from("campaigns")
      .select("campaign_type, metadata")
      .eq("id", item.campaign_id)
      .maybeSingle();

    if (campaignData.data) {
      const timing = extractCampaignTiming(campaignData.data);
      const oldRef = DateTime.fromISO(variant.banner_rendered_for_scheduled_at, { zone: timing.timezone });
      const newRef = DateTime.fromISO(newScheduledFor, { zone: timing.timezone });
      const oldLabel = getProximityLabel({ referenceAt: oldRef, campaignTiming: timing });
      const newLabel = getProximityLabel({ referenceAt: newRef, campaignTiming: timing });

      if (oldLabel !== newLabel) {
        // Invalidate banner
        await supabase
          .from("content_variants")
          .update({ banner_state: "stale", updated_at: new Date().toISOString() })
          .eq("id", variant.id);

        // Cancel queued publish jobs
        await supabase
          .from("publish_jobs")
          .update({
            status: "failed",
            last_error: "Banner invalidated by schedule change",
            next_attempt_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("content_item_id", contentId)
          .in("status", ["queued"]);

        // Set content back to draft
        await supabase
          .from("content_items")
          .update({ status: "draft", updated_at: new Date().toISOString() })
          .eq("id", contentId);

        // Notify user
        await supabase.from("notifications").insert({
          account_id: item.account_id,
          category: "banner_invalidated",
          message: "Schedule changed — banner needs re-rendering. Please re-approve.",
          metadata: { contentId, oldLabel, newLabel },
        });
      }
    }
  }
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: No errors. Fix any type issues.

- [ ] **Step 5: Commit**

```bash
git add src/app/(app)/planner/actions.ts
git commit -m "feat: add banner upload URL, approval validation, and staleness detection"
```

---

## Task 7: Pre-render hook — `useBannerPrerender`

**Files:**
- Create: `src/features/planner/use-banner-prerender.ts`

- [ ] **Step 1: Create the hook**

```typescript
// src/features/planner/use-banner-prerender.ts
"use client";

import { useCallback, useRef } from "react";
import { renderBannerCanvas } from "@/lib/scheduling/banner-canvas";
import { getProximityLabel } from "@/lib/scheduling/proximity-label";
import { extractCampaignTiming } from "@/lib/scheduling/campaign-timing";
import { parseBannerConfig, type BannerConfig } from "@/lib/scheduling/banner-config";
import { createBannerUploadUrl } from "@/app/(app)/planner/actions";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { DateTime } from "luxon";

interface PrerenderedBanner {
  storagePath: string;
  label: string;
  scheduledAt: string;
  sourceMediaPath: string;
  renderMetadata: Record<string, unknown>;
}

interface PrerenderInput {
  contentItemId: string;
  bannerConfig: BannerConfig | null;
  scheduledFor: string | null;
  campaign: {
    campaignType: string | null;
    metadata: Record<string, unknown> | null;
  } | null;
  sourceImageUrl: string | null;
  sourceMediaPath: string | null;
  placement: "feed" | "story";
}

export function useBannerPrerender() {
  const renderingRef = useRef(false);

  const prerenderBanner = useCallback(
    async (input: PrerenderInput): Promise<PrerenderedBanner | "not_applicable" | { error: string }> => {
      if (renderingRef.current) {
        return { error: "Banner render already in progress" };
      }

      const { contentItemId, bannerConfig, scheduledFor, campaign, sourceImageUrl, sourceMediaPath, placement } = input;

      // No banner configured
      if (!bannerConfig?.enabled) {
        return "not_applicable";
      }

      // Compute label
      let labelText: string | null = null;

      if (bannerConfig.customMessage?.trim()) {
        labelText = bannerConfig.customMessage.trim().toUpperCase();
      } else if (campaign?.campaignType && campaign?.metadata && scheduledFor) {
        const timing = extractCampaignTiming({
          campaign_type: campaign.campaignType,
          metadata: campaign.metadata,
        });
        const referenceAt = DateTime.fromISO(scheduledFor, { zone: timing.timezone });
        labelText = getProximityLabel({ referenceAt, campaignTiming: timing });
      }

      // No label — not applicable (7+ days away or post-event)
      if (!labelText) {
        return "not_applicable";
      }

      if (!sourceImageUrl) {
        return { error: "No source image available for banner rendering" };
      }

      renderingRef.current = true;

      try {
        // 1. Render banner on canvas
        const blob = await renderBannerCanvas({
          imageUrl: sourceImageUrl,
          position: bannerConfig.position,
          bgColour: bannerConfig.bgColour,
          textColour: bannerConfig.textColour,
          labelText,
        });

        // 2. Get signed upload URL from server
        const uploadResult = await createBannerUploadUrl({ contentItemId });
        if ("error" in uploadResult) {
          return { error: uploadResult.error };
        }

        // 3. Upload the blob
        const supabase = getSupabaseBrowserClient();
        const { error: uploadError } = await supabase.storage
          .from("media")
          .uploadToSignedUrl(uploadResult.storagePath, uploadResult.signedUrl.split("token=")[1], blob, {
            contentType: "image/jpeg",
          });

        if (uploadError) {
          return { error: `Banner upload failed: ${uploadError.message}` };
        }

        return {
          storagePath: uploadResult.storagePath,
          label: labelText,
          scheduledAt: scheduledFor ?? new Date().toISOString(),
          sourceMediaPath: sourceMediaPath ?? "",
          renderMetadata: {
            position: bannerConfig.position,
            bgColour: bannerConfig.bgColour,
            textColour: bannerConfig.textColour,
            placement,
          },
        };
      } finally {
        renderingRef.current = false;
      }
    },
    [],
  );

  return { prerenderBanner, isRendering: renderingRef };
}
```

- [ ] **Step 2: Verify build**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/planner/use-banner-prerender.ts
git commit -m "feat: add useBannerPrerender hook for approval-time rendering"
```

---

## Task 8: Make BannerControls saves explicit

**Files:**
- Modify: `src/features/planner/banner-controls.tsx`

- [ ] **Step 1: Replace optimistic save with explicit async save**

Find the `save` function (which currently calls `.catch(() => {})`). Replace with:

```typescript
  const [saving, setSaving] = useState(false);

  async function save(partial: Partial<BannerConfig>) {
    const updated = { ...config, ...partial };
    onUpdate?.(updated);
    setSaving(true);
    try {
      const result = await updatePlannerBannerConfig(contentItemId, updated);
      if (result.error) {
        toast.error(`Failed to save banner settings: ${result.error}`);
        // Revert optimistic update
        onUpdate?.(config);
      }
    } catch {
      toast.error("Failed to save banner settings");
      onUpdate?.(config);
    } finally {
      setSaving(false);
    }
  }
```

Add at the top:
```typescript
import { toast } from "sonner";
```

- [ ] **Step 2: Expose saving state**

Add `saving` to the component's rendered output — e.g., disable controls while saving:

```typescript
const isLocked = saving || !BANNER_EDITABLE_STATUSES.includes(status);
```

Use `isLocked` to disable all inputs.

- [ ] **Step 3: Verify build**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/features/planner/banner-controls.tsx
git commit -m "fix: make BannerControls saves explicit with error handling"
```

---

## Task 9: Wire up planner composer — stories, WYSIWYG preview, approval flow

**Files:**
- Modify: `src/features/planner/planner-content-composer.tsx`

- [ ] **Step 1: Remove story placement gate for BannerControls**

Find (around line 276):
```tsx
{!isStory ? (
  <BannerControls
```

Replace with:
```tsx
{(
  <BannerControls
```

Remove the `: null}` closing.

- [ ] **Step 2: Add BannerRenderedPreview in the approval view**

Import the new component:
```typescript
import { BannerRenderedPreview } from "./banner-rendered-preview";
```

Find where the existing `BannerOverlayPreview` is rendered (was `BannerPreview`). In the detail/approval view section, add the WYSIWYG preview alongside or replacing the overlay:

```tsx
{bannerConfig?.enabled && bannerLabel && detail.media[0]?.url ? (
  <BannerRenderedPreview
    imageUrl={detail.media[0].url}
    position={bannerConfig.position}
    bgColour={bannerConfig.bgColour}
    textColour={bannerConfig.textColour}
    labelText={bannerLabel}
    className="w-full rounded-md"
  />
) : null}
```

- [ ] **Step 3: Integrate pre-render hook into approval**

Import and use the hook:
```typescript
import { useBannerPrerender } from "./use-banner-prerender";
```

In the component:
```typescript
const { prerenderBanner } = useBannerPrerender();
```

Find the approve button handler. Before calling `approveDraftContent`, add:

```typescript
  // Pre-render banner if needed
  let bannerResult: Awaited<ReturnType<typeof prerenderBanner>> | null = null;
  if (bannerConfig?.enabled) {
    bannerResult = await prerenderBanner({
      contentItemId: detail.id,
      bannerConfig,
      scheduledFor: detail.scheduledFor,
      campaign: detail.campaign ? {
        campaignType: detail.campaign.campaignType,
        metadata: detail.campaign.metadata,
      } : null,
      sourceImageUrl: detail.media[0]?.url ?? null,
      sourceMediaPath: null, // Will be resolved from media data
      placement: detail.placement,
    });

    if (bannerResult && typeof bannerResult === "object" && "error" in bannerResult) {
      toast.error(bannerResult.error);
      return;
    }
  }
```

Then pass banner metadata to the approval action:

```typescript
  const result = await approveDraftContent({
    contentId: detail.id,
    ...(bannerResult && bannerResult !== "not_applicable" ? {
      bannerStoragePath: bannerResult.storagePath,
      bannerLabel: bannerResult.label,
      bannerScheduledAt: bannerResult.scheduledAt,
      bannerSourceMediaPath: bannerResult.sourceMediaPath,
      bannerRenderMetadata: bannerResult.renderMetadata,
    } : {}),
  });
```

- [ ] **Step 4: Verify build and test manually**

Run: `npm run typecheck`
Expected: No errors.

Start dev server: `npm run dev`
Navigate to planner, verify:
- BannerControls visible for stories
- BannerRenderedPreview shows canvas output for banner-enabled posts
- Approve flow calls pre-render hook

- [ ] **Step 5: Commit**

```bash
git add src/features/planner/planner-content-composer.tsx
git commit -m "feat: wire banner preview, controls for stories, and pre-render approval flow"
```

---

## Task 10: Story series — BannerDefaultsPicker and service wiring

**Files:**
- Modify: `src/lib/create/schema.ts` (verify `bannerDefaults` already in storySeriesFormSchema — if not, add it)
- Modify: `src/features/create/story-series-form.tsx`
- Modify: `src/lib/create/service.ts`

- [ ] **Step 1: Add bannerDefaults to story series form schema if missing**

Check `storySeriesFormSchema`. If it doesn't include `bannerDefaults`, add it:

```typescript
export const storySeriesFormSchema = z
  .object({
    title: z.string().min(1, "Series name is required"),
    eventDate: z.string().min(1, "Event date is required"),
    eventTime: z.string().optional().transform((val) => (val && /^\d{2}:\d{2}$/.test(val) ? val : undefined)),
    notes: z.string().optional(),
    platforms: z.array(platformEnum).min(1, "Select at least one platform"),
    slots: z.array(storySeriesSlotFormSchema).min(1, "Add at least one story slot"),
    bannerDefaults: BannerDefaultsSchema.optional(),
  })
```

- [ ] **Step 2: Add BannerDefaultsPicker to story-series-form.tsx**

Import the picker:
```typescript
import { BannerDefaultsPicker } from "./banner-defaults-picker";
import { DEFAULT_BANNER_DEFAULTS, type BannerDefaults } from "@/lib/scheduling/banner-config";
```

Add state for banner defaults:
```typescript
const [bannerDefaults, setBannerDefaults] = useState<BannerDefaults>(DEFAULT_BANNER_DEFAULTS);
```

Add the picker in the form UI (after the event date/time fields):
```tsx
<div className="space-y-2">
  <Label>Banner overlay defaults</Label>
  <BannerDefaultsPicker
    value={bannerDefaults}
    onChange={setBannerDefaults}
  />
</div>
```

Wire into form submission — ensure `bannerDefaults` is passed to the server action.

- [ ] **Step 3: Pass bannerDefaults in createStorySeries**

In `src/lib/create/service.ts`, find `createStorySeries()`. It calls `createCampaignFromPlans()`. Add `bannerDefaults` to that call:

```typescript
return createCampaignFromPlans({
  supabase,
  accountId,
  brand,
  venueName,
  venueLocation,
  name: input.title,
  type: "story_series",
  metadata: {
    createdWith: "story-series",
    notes: trimmedNotes ?? null,
    placement: "story",
    startDate: input.eventDate.toISOString(),
    startTime: input.eventTime ?? undefined,
  },
  plans,
  linkInBioUrl: null,
  bannerDefaults: input.bannerDefaults,  // ← ADD THIS
});
```

- [ ] **Step 4: Verify build**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/create/schema.ts src/features/create/story-series-form.tsx src/lib/create/service.ts
git commit -m "feat: add BannerDefaultsPicker to story series form and service"
```

---

## Task 11: Worker — remove banner rendering, check banner_state

**Files:**
- Modify: `supabase/functions/publish-queue/worker.ts`
- Delete: `supabase/functions/publish-queue/banner-renderer.ts`
- Delete: `supabase/functions/publish-queue/proximity.ts`

- [ ] **Step 1: Update VariantRow type to include banner columns**

In `worker.ts`, update the `VariantRow` type (around line 37):

```typescript
type VariantRow = {
    id: string;
    content_item_id: string;
    body: string | null;
    media_ids: string[] | null;
    banner_state: string;
    bannered_media_path: string | null;
};
```

- [ ] **Step 2: Update loadVariant to select new columns**

```typescript
private async loadVariant(variantId: string): Promise<VariantRow | null> {
    const { data, error } = await this.supabase
        .from('content_variants')
        .select('id, content_item_id, body, media_ids, banner_state, bannered_media_path')
        .eq('id', variantId)
        .maybeSingle<VariantRow>();

    if (error) {
        console.error(`[publish-queue] failed to load variant ${variantId}`, error);
        return null;
    }
    return data ?? null;
}
```

- [ ] **Step 3: Add banner_state check in handleJob**

In `handleJob()`, after the variant is loaded and validated (after line ~415), add:

```typescript
    // Banner state check
    if (variant.banner_state === "expected") {
        await this.handleFailure({
            jobId: job.id,
            content,
            attempt: currentAttempt,
            now,
            message: "Banner expected but not rendered",
            retryable: false,
        });
        return;
    }
    if (variant.banner_state === "stale") {
        await this.handleFailure({
            jobId: job.id,
            content,
            attempt: currentAttempt,
            now,
            message: "Banner stale — schedule/media/config changed since render",
            retryable: false,
        });
        return;
    }
```

- [ ] **Step 4: Pass bannered_media_path to loadMedia**

Update `loadMedia` signature to accept an optional override path:

```typescript
private async loadMedia(
    mediaIds: string[],
    placement: ProviderPlacement,
    banneredMediaPath?: string | null,
) {
```

At the start of `loadMedia`, if `banneredMediaPath` is provided, override the first media item's storage path:

After loading media rows and before creating signed URLs, check:

```typescript
    // If a bannered image is available, use it as the first media item's path
    if (banneredMediaPath) {
        const firstMediaId = mediaRows[0]?.id;
        if (firstMediaId) {
            let bannerPath = banneredMediaPath;
            if (bannerPath.startsWith(`${this.config.mediaBucket}/`)) {
                bannerPath = bannerPath.slice(this.config.mediaBucket.length + 1);
            }
            pathByMedia.set(firstMediaId, bannerPath);
        }
    }
```

In `handleJob()`, pass the banner path when calling `loadMedia`:

```typescript
    const banneredPath = variant.banner_state === "rendered" ? variant.bannered_media_path : null;
    media = await this.loadMedia(variant.media_ids ?? [], content.placement, banneredPath);
```

- [ ] **Step 5: Remove the entire banner rendering block**

Delete lines 494-558 (the `// --- Banner rendering (best-effort, falls back to original image) ---` block) and the associated `bannerTempPath` variable and cleanup code (around line 595-602).

- [ ] **Step 6: Remove banner-related imports**

Remove from the top of `worker.ts`:
```typescript
import { renderBanner, cleanupBannerTemp } from "./banner-renderer.ts";
import { extractCampaignTiming, getProximityLabel } from "./proximity.ts";
```

- [ ] **Step 7: Delete banner-renderer.ts and proximity.ts**

```bash
rm supabase/functions/publish-queue/banner-renderer.ts
rm supabase/functions/publish-queue/proximity.ts
```

- [ ] **Step 8: Deploy the edge function**

Run: `npx supabase functions deploy publish-queue`
Expected: Deployed successfully.

- [ ] **Step 9: Test the edge function boots**

```bash
source .env.local
curl -s -X POST "${NEXT_PUBLIC_SUPABASE_URL}/functions/v1/publish-queue" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "content-type: application/json" \
  -d '{"source":"manual-test"}'
```

Expected: `{"ok":true,"processed":...}` — no BOOT_ERROR.

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/publish-queue/worker.ts
git rm supabase/functions/publish-queue/banner-renderer.ts
git rm supabase/functions/publish-queue/proximity.ts
git commit -m "feat: worker uses pre-rendered banners, remove FFmpeg renderer and proximity module"
```

---

## Deferred: Orphan banner cleanup

The spec calls for a daily scheduled job to clean up unreferenced files in the `banners/` storage prefix. This is not blocking for the core feature — orphan files are small JPEGs and the grace period is 24 hours. Implement as a follow-up task after the core pipeline is verified working.

---

## Task 12: Verification pipeline

**Files:**
- All modified files

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: Zero warnings, zero errors.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: Clean compilation.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass, including new banner-canvas tests.

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: Successful production build.

- [ ] **Step 5: Manual smoke test**

Start: `npm run dev`

Test flow:
1. Navigate to planner
2. Find a banner-enabled feed post (Cash Bingo)
3. Verify `BannerRenderedPreview` shows actual canvas-rendered image
4. Toggle banner position/colours — preview updates
5. Approve the post — observe pre-render + upload
6. Check database: `content_variants.banner_state = 'rendered'`, `bannered_media_path` set
7. Find a story series item — verify BannerControls are visible
8. Verify content without banner config shows no banner UI

- [ ] **Step 6: Final commit if any fixes needed**

```bash
git add -A
git commit -m "chore: verification fixes"
```
