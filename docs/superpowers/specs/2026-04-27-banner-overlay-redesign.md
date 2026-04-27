# Banner Overlay Redesign (v2)

**Date:** 27 April 2026
**Status:** Draft — pending review
**Context:** The current FFmpeg WASM banner renderer crashes in Deno Edge Functions. The consultant review identified critical issues across rendering, config flow, preview fidelity, storage model, and error handling. This spec replaces publish-time FFmpeg with client-side Canvas pre-rendering at approval time.

---

## Goals

1. Banners render reliably — no silent fallbacks, no publish-time rendering failures
2. WYSIWYG — the planner shows the actual rendered canvas output, not a CSS approximation
3. Story series campaigns support banner configuration
4. Visual quality is high — proper typography, vertical text on side positions, 80px fixed strip

## Non-goals

- Animated banners or video overlays
- Custom fonts (system sans-serif is sufficient for v1)
- PNG transparency preservation (all bannered output is JPEG)

---

## Architecture

### Current flow (broken)

```
User approves → content_items.status = scheduled
→ Cron triggers worker → Worker loads image → FFmpeg WASM renders banner → Publish
                                               ↓ (fails silently)
                                         Publishes original image
```

### New flow

```
User configures banner → Canvas renders preview (actual pixels shown in planner)
User approves → Client uploads rendered image to server-issued signed path
→ Server records banner metadata on content_variants
→ Cron triggers worker → Worker checks banner_expected → Uses bannered image → Publish
                                                       → Fails if banner missing (no fallback)
```

---

## Storage model

### Why not `media_assets.derived_variants`

`derived_variants` lives on `media_assets`. A single media asset can be reused across multiple posts with different dates, labels, and banner configs. Storing a banner derivative per media asset would overwrite other posts' banners.

### New columns on `content_variants`

Migration adds three nullable columns:

```sql
ALTER TABLE content_variants
  ADD COLUMN bannered_media_path text,
  ADD COLUMN banner_label text,
  ADD COLUMN banner_rendered_for_scheduled_at timestamptz;
```

| Column | Purpose |
|--------|---------|
| `bannered_media_path` | Storage path of the rendered banner image. Null = no banner. |
| `banner_label` | The label text baked into the image (for audit/debugging). |
| `banner_rendered_for_scheduled_at` | The `scheduled_for` value used when computing the label. Enables staleness detection. |

**The worker uses `bannered_media_path` as the authoritative signal.** If `content_items.prompt_context.banner.enabled === true` and `bannered_media_path` is null, the worker fails the job — no silent fallback.

---

## Components

### 1. `renderBannerCanvas()` — Client-side renderer

**File:** `src/lib/scheduling/banner-canvas.ts`

**Input:**
```typescript
interface BannerCanvasInput {
  imageUrl: string;           // source image URL — must be CORS-accessible
  position: BannerPosition;   // "top" | "bottom" | "left" | "right"
  bgColour: BannerColourId;   // "gold" | "green" | "black" | "white"
  textColour: BannerColourId;
  labelText: string;          // e.g. "THIS WEDNESDAY"
}
```

**Output:** `Promise<Blob>` — JPEG blob of the bannered image.

**Rendering spec:**
- Create an `Image` element with `crossOrigin = "anonymous"` (required for Supabase signed URLs)
- Load source image onto an offscreen `<canvas>` at the image's native dimensions
- Draw an 80px strip at the specified position (solid colour fill)
- Top/bottom: text drawn horizontally, centred within the strip
- Left/right: text drawn vertically (canvas `rotate(-90°)` for left, `rotate(90°)` for right), centred within the strip
- Font: `bold 40px system-ui, -apple-system, sans-serif`
- Text colour from `BANNER_COLOUR_HEX` map
- Text fitting: use `ctx.measureText()` to check width. If text exceeds strip length minus 16px margins, scale font down until it fits (minimum 20px).
- Output: `canvas.toBlob("image/jpeg", 0.92)` — always JPEG, no transparency

**Constants:**
```typescript
const STRIP_PX = 80;
const FONT_SIZE_MAX = 40;
const FONT_SIZE_MIN = 20;
const FONT_FAMILY = "system-ui, -apple-system, sans-serif";
const TEXT_MARGIN_PX = 16;  // padding from strip edges
```

**CORS requirement:** Supabase Storage must have CORS configured to allow the app origin. The image is loaded with `crossOrigin = "anonymous"`. If the canvas becomes tainted, `toBlob()` will throw — this is caught and surfaced as an error.

**Source image:**
- Feed posts: use the original media asset URL
- Stories: use the story derivative URL (9:16 cropped version). The story derivative must exist before banner rendering.

### 2. Planner preview — use canvas output, not CSS

**File:** `src/features/planner/banner-preview.tsx` — **rewrite**

Replace the current CSS-based preview with a component that calls `renderBannerCanvas()` and displays the result as an `<img>`. This guarantees WYSIWYG — the preview shows the exact pixels that will be published.

**Behaviour:**
- When banner is enabled and a label exists, call `renderBannerCanvas()` with the source image URL
- Show a loading spinner while rendering
- Display the canvas output as a blob URL (`URL.createObjectURL(blob)`)
- Re-render when any banner config property changes (position, colours, custom message)
- Clean up blob URLs on unmount to prevent memory leaks

### 3. Banner pre-render and upload on approval

**Client-side flow:**

**File:** `src/features/planner/use-banner-prerender.ts` — **New** hook

1. Save banner config explicitly before rendering (not optimistic — wait for server confirmation)
2. Compute the proximity label using `getProximityLabel()` with `scheduled_for` as `referenceAt`
3. If a `customMessage` is set, use that instead
4. If no label (null — event 7+ days away or post-event), skip rendering, clear any stale `bannered_media_path`
5. Call `renderBannerCanvas()` with the source image and banner config
6. Request a signed upload URL from a server action (see security model below)
7. Upload the blob to the signed URL
8. Pass the storage path, label, and scheduled_for to the approval server action

**Server-side flow:**

**File:** `src/app/(app)/planner/actions.ts` — modify `approveDraftContent()`

9. Validate the provided storage path belongs to the authenticated account and matches the expected pattern (`banners/{contentItemId}/*`)
10. Verify the file exists in storage
11. Update `content_variants` with `bannered_media_path`, `banner_label`, `banner_rendered_for_scheduled_at`
12. If banner is enabled but no bannered path provided, return `{ error: "Banner rendering required" }`

### 4. Security model for client uploads

**File:** `src/app/(app)/planner/actions.ts` — new server action `createBannerUploadUrl()`

```typescript
export async function createBannerUploadUrl(contentItemId: string): Promise<{
  signedUrl: string;
  storagePath: string;
} | { error: string }> {
  // 1. Verify auth + user owns the content item
  // 2. Generate path: banners/{contentItemId}/{uuid}.jpg
  // 3. Create signed upload URL with 60s TTL, max 5MB, image/jpeg only
  // 4. Return signed URL and path
}
```

On the approval server action, validate:
- The `bannered_media_path` starts with `banners/{contentItemId}/`
- The file exists in storage
- The file is under 5MB and has `image/jpeg` MIME type

### 5. Worker changes

**File:** `supabase/functions/publish-queue/worker.ts`

**Remove:**
- Banner rendering block (lines 494-558)
- Imports of `renderBanner`, `cleanupBannerTemp` from `./banner-renderer.ts`

**Add to `loadMedia()`:**
- Accept `banneredMediaPath: string | null` parameter
- If `banneredMediaPath` is set, use it as the storage path for the first media item instead of the original
- Signed URL resolution uses the same existing flow

**Add to `handleJob()`:**
- Load `content_variants.bannered_media_path` alongside the existing variant query
- If `content.prompt_context?.banner?.enabled === true` and `banneredMediaPath` is null:
  - Fail the job with `"Banner expected but not rendered"` (non-retryable)
- Pass `banneredMediaPath` to `loadMedia()`

**Delete:** `supabase/functions/publish-queue/banner-renderer.ts`

**Keep:** `supabase/functions/publish-queue/proximity.ts` — still used by the worker for non-banner proximity logic (e.g. if future features need it). However, delete the unused imports and exports if the only consumer was the banner block.

### 6. Staleness detection — schedule changes after banner render

**Problem:** If the user changes `scheduled_for` after approval, the baked-in label may be wrong (e.g. "THIS WEDNESDAY" becomes "TOMORROW").

**Solution:** When `scheduled_for` changes on a content item that has a `bannered_media_path`:

1. Compare new `scheduled_for` against `banner_rendered_for_scheduled_at`
2. If the proximity label would change for the new date, clear the banner:
   - Set `bannered_media_path = null`, `banner_label = null`, `banner_rendered_for_scheduled_at = null`
   - Delete the old banner file from storage
   - Set `content_items.status` back to `draft`
   - Insert notification: "Schedule changed — banner needs re-rendering. Please re-approve."
3. If the label would be the same (e.g. moved by a few hours on the same day), keep the banner

This check runs in the existing schedule-change server action.

### 7. Banner config saves — no optimistic writes

**File:** `src/features/planner/banner-controls.tsx`

Currently `BannerControls` saves optimistically and swallows errors. Change to:
- Save returns a promise that the caller awaits
- Errors are surfaced to the user via toast
- The pre-render hook waits for a confirmed save before rendering
- Approval button is disabled while a banner config save is in-flight

### 8. Story series banner config

**File:** `src/features/create/story-series-form.tsx`

Add `BannerDefaultsPicker` to the story series creation form (same component already used in `event-campaign-form.tsx`).

**File:** `src/lib/create/service.ts` — `createStorySeries()`

Pass `bannerDefaults` through to `createCampaignFromPlans()` so that:
- Campaign metadata includes `bannerDefaults`
- Each content item's `prompt_context.banner` is populated via `bannerConfigFromDefaults()`

### 9. Show banner controls for stories in planner

**File:** `src/features/planner/planner-content-composer.tsx`

Remove the placement gate that hides `BannerControls` for story placements. Stories should be editable like feed posts.

### 10. Banner cleanup

When any of these change, delete the existing `bannered_media_path` file from storage and clear the columns:

- Media asset changes (user swaps the image)
- Banner config changes (position, colours, custom message toggled)
- Schedule changes that affect the label (see staleness detection above)
- Content item deleted or trashed

This runs in the relevant server actions. The storage path is known from `content_variants.bannered_media_path`.

---

## Error handling

| Scenario | Behaviour |
|----------|-----------|
| Canvas rendering fails (CORS, memory, etc.) | Pre-render hook returns error. Approval blocked. Toast shown. |
| Signed upload URL request fails | Pre-render hook returns error. Approval blocked. Toast shown. |
| Banner upload fails | Pre-render hook returns error. Approval blocked. Toast shown. |
| Server validation fails (path mismatch, file missing) | Approval action returns `{ error }`. Post stays in current status. |
| Banner expected but `bannered_media_path` is null at publish time | Worker fails job with `"Banner expected but not rendered"`. Non-retryable. Notification sent. |
| Banner file missing from storage at publish time | Worker fails with existing "media not found" error. Notification sent. |
| No proximity label (null) | Banner skipped — original image published. Intentional (event 7+ days away). |
| Story derivative not ready | Approval deferred — same as existing story derivative flow. |
| Schedule change invalidates label | Banner cleared, status set to draft, user notified to re-approve. |

No silent fallbacks. Every failure is surfaced.

---

## Colour palette

Unchanged:

| ID | Hex |
|----|-----|
| `gold` | `#a57626` |
| `green` | `#005131` |
| `black` | `#1a1a1a` |
| `white` | `#ffffff` |

---

## Migration

```sql
-- Add banner columns to content_variants
ALTER TABLE content_variants
  ADD COLUMN bannered_media_path text,
  ADD COLUMN banner_label text,
  ADD COLUMN banner_rendered_for_scheduled_at timestamptz;

-- Index for worker queries that check banner state
CREATE INDEX idx_content_variants_bannered
  ON content_variants (content_item_id)
  WHERE bannered_media_path IS NOT NULL;
```

No destructive changes. Fully backwards-compatible — null columns mean no banner.

---

## Testing

### Automated (Vitest)

1. **Unit: `renderBannerCanvas()`** — Use `jsdom` or `happy-dom` with canvas mock. Verify blob output is non-null, correct MIME type. Test all four positions. Test font scaling for long labels.
2. **Unit: staleness detection** — Verify label changes are detected when `scheduled_for` shifts across day boundaries.
3. **Unit: `createBannerUploadUrl()`** — Verify path format, auth checks, signed URL generation.
4. **Integration: approval with banner** — Mock canvas/upload, verify `bannered_media_path` is set after approval, verify approval blocked when banner enabled but path missing.

### Playwright (E2E)

5. **Canvas rendering with real image** — Load a test image through the actual browser canvas, render a banner, verify the output blob has modified pixel data in the strip region.
6. **CORS test** — Use a signed Supabase URL, verify canvas export succeeds with `crossOrigin = "anonymous"`.
7. **Approval flow** — Approve a banner-enabled post, verify `bannered_media_path` is recorded in the database.
8. **Schedule change** — Change schedule after approval, verify banner is cleared and status returns to draft.

### Worker tests

9. **Banner expected, path present** — Worker uses `bannered_media_path` for media resolution. Publishes successfully.
10. **Banner expected, path missing** — Worker fails with `"Banner expected but not rendered"`. Does not fall back to original.
11. **No banner expected** — Worker uses original media path. Existing behaviour preserved.

---

## Files changed

| File | Action |
|------|--------|
| `supabase/migrations/YYYYMMDD_add_banner_columns.sql` | **New** — Add columns to content_variants |
| `src/lib/scheduling/banner-canvas.ts` | **New** — Canvas rendering utility |
| `src/features/planner/use-banner-prerender.ts` | **New** — Client-side hook for render + upload before approval |
| `src/app/(app)/planner/actions.ts` | **Modify** — Add `createBannerUploadUrl()`, modify `approveDraftContent()` to record banner metadata, add staleness check to schedule-change action |
| `src/features/planner/banner-preview.tsx` | **Rewrite** — Replace CSS preview with canvas-rendered `<img>` |
| `src/features/planner/banner-controls.tsx` | **Modify** — Make saves explicit/synchronous, surface errors |
| `src/features/planner/planner-content-composer.tsx` | **Modify** — Show BannerControls for stories, integrate pre-render hook into approval |
| `src/features/create/story-series-form.tsx` | **Modify** — Add BannerDefaultsPicker |
| `src/lib/create/service.ts` | **Modify** — Pass bannerDefaults in createStorySeries() |
| `supabase/functions/publish-queue/worker.ts` | **Modify** — Remove banner rendering block, load bannered_media_path, fail if banner expected but missing |
| `supabase/functions/publish-queue/banner-renderer.ts` | **Delete** |
| `src/lib/scheduling/banner-canvas.test.ts` | **New** — Unit tests |
| `tests/e2e/banner-rendering.spec.ts` | **New** — Playwright E2E tests |
