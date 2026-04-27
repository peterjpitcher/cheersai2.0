# Banner Overlay Redesign

**Date:** 27 April 2026
**Status:** Approved
**Context:** The current FFmpeg WASM banner renderer crashes in Deno Edge Functions and has fundamental API mismatches. The consultant review identified six issues across rendering, config flow, and preview fidelity. This spec replaces the publish-time FFmpeg approach with client-side Canvas pre-rendering at approval time.

---

## Goals

1. Banners render reliably — no silent fallbacks, no publish-time rendering failures
2. What the user sees in the preview is what gets posted
3. Story series campaigns support banner configuration
4. Visual quality is high — proper typography, proportional sizing, vertical text on side positions

## Non-goals

- Animated banners or video overlays
- Custom fonts (system sans-serif is sufficient for v1)
- Banner editing after approval (user can unapprove, edit, re-approve)

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
User approves → Canvas renders banner → Bannered image uploaded to Storage
→ content_items variant references bannered derivative
→ Cron triggers worker → Worker loads pre-rendered image → Publish
```

The worker has no knowledge of banners. It publishes whatever image the variant references.

---

## Components

### 1. `renderBannerCanvas()` — Client-side renderer

**File:** `src/lib/scheduling/banner-canvas.ts`

**Input:**
```typescript
interface BannerCanvasInput {
  imageUrl: string;           // source image URL (signed or public)
  position: BannerPosition;   // "top" | "bottom" | "left" | "right"
  bgColour: BannerColourId;   // "gold" | "green" | "black" | "white"
  textColour: BannerColourId;
  labelText: string;          // e.g. "THIS WEDNESDAY"
}
```

**Output:** `Promise<Blob>` — JPEG blob of the bannered image.

**Rendering spec:**
- Load source image onto an offscreen `<canvas>`
- Draw an 80px strip at the specified position (solid colour fill)
- Top/bottom: text drawn horizontally, centred within the strip
- Left/right: text drawn vertically (canvas `rotate(-90°)` for left, `rotate(90°)` for right), centred within the strip
- Font: `bold 40px system-ui, -apple-system, sans-serif`
- Text colour from `BANNER_COLOUR_HEX` map
- Letter spacing: 2px (for readability in uppercase)
- Output: canvas `toBlob("image/jpeg", 0.92)`

**Constants:**
```typescript
const STRIP_PX = 80;
const FONT_SIZE = 40;
const FONT = `bold ${FONT_SIZE}px system-ui, -apple-system, sans-serif`;
```

### 2. Banner pre-render on approval

**Important:** `renderBannerCanvas()` uses the browser Canvas API, but `approvePlanner()` is a server action. The rendering and upload must happen client-side before the server action is called.

**Client-side flow** (in the planner approval UI):

1. Before calling the `approvePlanner` server action, check if the content item has `prompt_context.banner.enabled === true`
2. Compute the proximity label using `getProximityLabel()` with `scheduled_for` as `referenceAt`
3. If a `customMessage` is set, use that instead
4. If no label is produced (null — event 7+ days away or post-event), skip banner rendering
5. Call `renderBannerCanvas()` with the source image and banner config
6. Upload the blob to Supabase Storage at `banners/{contentItemId}/{variantId}.jpg` using the browser Supabase client
7. Pass the storage path to the server action

**File:** `src/features/planner/use-banner-prerender.ts` — **New** hook encapsulating steps 1-7.

**Server-side flow** (in `approvePlanner()`):

**File:** `src/app/(app)/planner/actions.ts`

8. If a `bannerStoragePath` is provided, store it in the variant's `derived_variants.banner` field (same pattern as `derived_variants.story`)
9. If the client reported a rendering error, return the error — do not approve the post

**Label computation uses the same logic already in `src/lib/scheduling/proximity-label.ts`** — no new module needed. The campaign timing is extracted from the content item's linked campaign metadata via `extractCampaignTiming()`.

### 3. Worker changes — remove banner rendering

**File:** `supabase/functions/publish-queue/worker.ts`

Remove:
- Lines 494-558 (banner rendering block in `handleJob()`)
- Import of `renderBanner`, `cleanupBannerTemp` from `./banner-renderer.ts`
- Import of `extractCampaignTiming`, `getProximityLabel` from `./proximity.ts` (only if no longer used elsewhere in the worker)

The worker's `loadMedia()` method already resolves `derived_variants` for story derivatives. Extend this to also check for `derived_variants.banner`:
- If `derived_variants.banner` exists, use the banner path instead of the original
- The existence of the derivative is the signal — no need to check `prompt_context.banner.enabled` in the worker
- This uses the same signed-URL flow already in place

### 4. Delete FFmpeg renderer

**File:** `supabase/functions/publish-queue/banner-renderer.ts` — delete entirely.

### 5. Story series banner config

**File:** `src/features/create/story-series-form.tsx`

Add `BannerDefaultsPicker` to the story series creation form (same component already used in `event-campaign-form.tsx`). Wire the selected defaults into the form values.

**File:** `src/lib/create/service.ts` — `createStorySeries()`

Pass `bannerDefaults` through to `createCampaignFromPlans()` so that:
- Campaign metadata includes `bannerDefaults`
- Each content item's `prompt_context.banner` is populated via `bannerConfigFromDefaults()`

### 6. Show banner controls for stories in planner

**File:** `src/features/planner/planner-content-composer.tsx`

Remove the placement gate that hides `BannerControls` for story placements. Stories should be editable like feed posts.

### 7. Align preview with renderer

**File:** `src/features/planner/banner-preview.tsx`

Update the CSS preview to match the canvas renderer:
- Use a fixed 80px strip (or proportional equivalent in the preview container)
- Side positions: use `writing-mode: vertical-rl` with correct rotation direction matching the canvas renderer
- Match the font sizing and letter spacing

---

## Media derivative pattern

The bannered image is stored as a derived variant, following the existing pattern used for story derivatives:

```typescript
// content_variants.derived_variants (JSONB)
{
  "story": "derivatives/story/abc123.jpg",   // existing
  "banner": "banners/{contentItemId}/{variantId}.jpg"  // new
}
```

The worker's `loadMedia()` resolves the correct path based on placement and banner config:
- Story with banner → use `derived_variants.banner` (bannered version of the story derivative)
- Feed with banner → use `derived_variants.banner`
- No banner → use original path (existing behaviour)

**Note:** For stories with banners, the banner should be rendered on top of the story derivative (the 9:16 cropped version), not the original image. The approval flow should:
1. Ensure the story derivative exists first
2. Render the banner on the story derivative
3. Store the result in `derived_variants.banner`

---

## Error handling

| Scenario | Behaviour |
|----------|-----------|
| Canvas rendering fails | Approval action returns `{ error: "Banner rendering failed" }`. Post stays in current status. |
| Banner upload fails | Approval action returns `{ error: "Banner upload failed" }`. Post stays in current status. |
| Banner image missing at publish time | Worker's existing "media not found" error handling applies. Post fails with clear error. |
| No proximity label (null) | Banner is skipped — original image published. This is intentional (event 7+ days away). |
| Story derivative not ready | Approval deferred — same as existing story derivative flow. |

No silent fallbacks. Every failure is surfaced to the user.

---

## Colour palette

Unchanged from current:

| ID | Hex |
|----|-----|
| `gold` | `#a57626` |
| `green` | `#005131` |
| `black` | `#1a1a1a` |
| `white` | `#ffffff` |

---

## Testing

1. **Unit: `renderBannerCanvas()`** — Verify output blob is non-null, has correct MIME type, dimensions match input image. Test all four positions.
2. **Unit: proximity label parity** — Same inputs produce same labels in `src/lib/scheduling/proximity-label.ts` and `supabase/functions/publish-queue/proximity.ts`.
3. **Integration: approval with banner** — Mock canvas/upload, verify `derived_variants.banner` is set after approval.
4. **Manual: visual verification** — Approve a banner-enabled post, download the stored image, confirm overlay matches preview.

---

## Files changed

| File | Action |
|------|--------|
| `src/lib/scheduling/banner-canvas.ts` | **New** — Canvas rendering utility |
| `src/features/planner/use-banner-prerender.ts` | **New** — Client-side hook for rendering + uploading banner before approval |
| `src/app/(app)/planner/actions.ts` | **Modify** — Accept bannerStoragePath, store in derived_variants |
| `src/features/planner/planner-content-composer.tsx` | **Modify** — Show BannerControls for stories, integrate pre-render hook |
| `src/features/planner/banner-preview.tsx` | **Modify** — Align with 80px strip, match renderer |
| `src/features/create/story-series-form.tsx` | **Modify** — Add BannerDefaultsPicker |
| `src/lib/create/service.ts` | **Modify** — Pass bannerDefaults in createStorySeries() |
| `supabase/functions/publish-queue/worker.ts` | **Modify** — Remove banner rendering, resolve banner derivatives |
| `supabase/functions/publish-queue/banner-renderer.ts` | **Delete** |
| `src/lib/scheduling/banner-canvas.test.ts` | **New** — Unit tests |
