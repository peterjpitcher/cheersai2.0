# Banner Overlay Redesign (v3)

**Date:** 27 April 2026
**Status:** Draft — pending review
**Context:** The current FFmpeg WASM banner renderer crashes in Deno Edge Functions. Two rounds of consultant review identified critical issues across rendering, config flow, storage model, error handling, and state management. This spec replaces publish-time FFmpeg with client-side Canvas pre-rendering at approval time.

---

## Goals

1. Banners render reliably — no silent fallbacks, no publish-time rendering failures
2. WYSIWYG — the planner approval view shows the actual rendered canvas output
3. Story series campaigns support banner configuration
4. Visual quality is high — proper typography, vertical text on side positions, 80px fixed strip
5. Explicit banner state — "intentionally skipped" and "missing due to failure" are distinguishable

## Non-goals

- Animated banners or video overlays
- Custom/bundled fonts (system sans-serif for v1; brand font is a future enhancement)
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
User configures banner → Canvas renders preview (actual pixels in approval view)
User approves → Client uploads rendered image to server-issued signed path
→ Server validates, recomputes label, records banner metadata on content_variants
→ Cron triggers worker → Worker checks banner_state → Uses bannered image → Publish
                         banner_state = 'not_applicable' → Uses original image
                         banner_state = 'expected' (render missing) → Fails job
```

---

## Storage model

### Why not `media_assets.derived_variants`

`derived_variants` lives on `media_assets`. A single media asset can be reused across multiple posts with different dates, labels, and banner configs. Storing a banner derivative per media asset would overwrite other posts' banners.

### New columns on `content_variants`

```sql
ALTER TABLE content_variants
  ADD COLUMN banner_state text NOT NULL DEFAULT 'none'
    CHECK (banner_state IN ('none', 'not_applicable', 'expected', 'rendered', 'stale')),
  ADD COLUMN bannered_media_path text,
  ADD COLUMN banner_label text,
  ADD COLUMN banner_rendered_for_scheduled_at timestamptz,
  ADD COLUMN banner_source_media_path text,
  ADD COLUMN banner_render_metadata jsonb;
```

| Column | Purpose |
|--------|---------|
| `banner_state` | Explicit lifecycle state (see state machine below). |
| `bannered_media_path` | Storage path of the rendered banner image. Null unless `rendered`. |
| `banner_label` | The label text baked into the image (audit/debugging). |
| `banner_rendered_for_scheduled_at` | The `scheduled_for` used when computing the label. Staleness detection. |
| `banner_source_media_path` | The source image path used for rendering. Detects media changes. |
| `banner_render_metadata` | Position, colours, source dimensions. For debugging/audit. |

### Banner state machine

```
none ──────────────── Banner not configured on this content item
  │
  ├─ banner enabled, label exists ──► expected ──► rendered (after upload + validation)
  │                                                  │
  │                                                  ├─ schedule change invalidates label ──► stale
  │                                                  ├─ media change ──► stale
  │                                                  ├─ banner config change ──► stale
  │                                                  └─ banner disabled ──► none
  │
  ├─ banner enabled, no label (7+ days, post-event) ──► not_applicable
  │
  └─ banner disabled ──► none

stale ──► user re-approves ──► expected ──► rendered
```

**Worker behaviour by state:**

| `banner_state` | Worker action |
|----------------|---------------|
| `none` | Publish with original image. |
| `not_applicable` | Publish with original image. |
| `expected` | **Fail job** — `"Banner expected but not rendered"`. Non-retryable. |
| `rendered` | Use `bannered_media_path` for media resolution. |
| `stale` | **Fail job** — `"Banner stale — schedule/media/config changed"`. Non-retryable. |

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

- Create `Image` with `crossOrigin = "anonymous"` (required for Supabase signed URLs)
- **Output dimensions:** Cap the canvas at a maximum of 1080px on the shortest side. For stories (9:16), the story derivative is already 1080x1920 — use as-is. For feed images larger than 1080px, scale down proportionally before drawing. This ensures consistent visual proportions for the 80px strip.
- Draw an 80px strip at the specified position (solid colour fill)
- Top/bottom: text drawn horizontally, centred within the strip
- Left/right: text drawn vertically (`rotate(-90°)` for left, `rotate(90°)` for right), centred
- Font: `bold 40px system-ui, -apple-system, sans-serif`
- `textBaseline = "middle"`, `textAlign = "center"` for consistent vertical centering
- Text colour from `BANNER_COLOUR_HEX` map
- Text fitting: `ctx.measureText()` to check width. If text exceeds strip length minus 16px margins per side, scale font down (minimum 20px). If still too wide at 20px, truncate with ellipsis.
- Output: `canvas.toBlob("image/jpeg", 0.92)` — always JPEG, no transparency
- Handle EXIF orientation: draw to canvas (browsers auto-correct orientation on decode)

**Constants:**
```typescript
const STRIP_PX = 80;
const FONT_SIZE_MAX = 40;
const FONT_SIZE_MIN = 20;
const FONT_FAMILY = "system-ui, -apple-system, sans-serif";
const TEXT_MARGIN_PX = 16;
const MAX_SHORT_SIDE_PX = 1080;
```

**CORS requirement:** Supabase Storage CORS must allow the app origin for signed URLs. If the canvas becomes tainted, `toBlob()` throws — caught and surfaced as an error.

**Source image:**
- Feed posts: original media asset URL (scaled down if > 1080px shortest side)
- Stories: story derivative URL (9:16 cropped version, must exist before banner render)

**Debouncing:** When used for preview, renders are debounced (300ms) and cancelled when inputs change (e.g. user typing a custom message).

### 2. Preview components — split into two

**Current `BannerPreview`** is a lightweight CSS overlay used in planner calendar cards and link-in-bio. Rewriting it to a canvas-rendered `<img>` would break those callers.

**Split into:**

| Component | File | Use case |
|-----------|------|----------|
| `BannerOverlayPreview` | `src/features/planner/banner-overlay-preview.tsx` | Lightweight CSS overlay for calendar cards, list views, link-in-bio. Rename of current `BannerPreview`. |
| `BannerRenderedPreview` | `src/features/planner/banner-rendered-preview.tsx` | **New.** Calls `renderBannerCanvas()` and shows the output as an `<img>`. Used in the planner detail/approval view for WYSIWYG. |

**`BannerRenderedPreview` behaviour:**
- When banner is enabled and a label exists, calls `renderBannerCanvas()`
- Shows a loading spinner while rendering
- Displays canvas output via `URL.createObjectURL(blob)`
- Re-renders on banner config changes (debounced)
- Cleans up blob URLs on unmount

### 3. Banner pre-render and upload on approval

**Client-side flow:**

**File:** `src/features/planner/use-banner-prerender.ts` — **New** hook

1. **Save banner config synchronously** — wait for server confirmation before proceeding (no optimistic writes)
2. Compute the proximity label using `getProximityLabel()` with `scheduled_for` as `referenceAt`
3. If `customMessage` is set, use that instead
4. If no label (null — event 7+ days away or post-event):
   - Set `banner_state = 'not_applicable'` on the server
   - Skip rendering, proceed with approval
5. Call `renderBannerCanvas()` with the source image and banner config
6. Request a signed upload URL from `createBannerUploadUrl()` server action
7. Upload blob to the signed URL
8. Pass storage path, label, and `scheduled_for` to the approval action

**Server-side flow:**

**File:** `src/app/(app)/planner/actions.ts`

On approval, the server **recomputes and validates** — does not trust client inputs:

9. Reload: content item, variant, media, schedule, banner config, campaign metadata
10. Recompute expected label from current `scheduled_for` and campaign timing
11. Compare submitted label against recomputed label — reject if mismatched (stale render from another tab)
12. Verify `bannered_media_path` matches pattern `banners/{contentItemId}/*`
13. Verify file exists in storage and is ≤ 5MB
14. Verify source media hasn't changed since render (compare `banner_source_media_path`)
15. Update `content_variants`:
    - `banner_state = 'rendered'`
    - `bannered_media_path`, `banner_label`, `banner_rendered_for_scheduled_at`
    - `banner_source_media_path`, `banner_render_metadata`
16. If any validation fails, delete the uploaded file and return `{ error }`

### 4. Security model for client uploads

**File:** `src/app/(app)/planner/actions.ts` — new server action

```typescript
export async function createBannerUploadUrl(contentItemId: string): Promise<{
  signedUrl: string;
  storagePath: string;
} | { error: string }> {
  // 1. Verify auth + user owns the content item
  // 2. Generate unique path: banners/{contentItemId}/{crypto.randomUUID()}.jpg
  // 3. Create signed upload URL with 60s TTL
  // 4. Return signed URL and path
}
```

**Post-upload validation** (in approval action):
- Verify file exists at the path
- Check file size ≤ 5MB
- Check Content-Type is `image/jpeg`
- If Supabase doesn't enforce MIME/size at signed-upload time, validate after upload

**No upsert** — each render gets a unique UUID path. Old files are cleaned up explicitly.

### 5. Worker changes

**File:** `supabase/functions/publish-queue/worker.ts`

**Remove:**
- Banner rendering block (lines 494-558)
- Imports of `renderBanner`, `cleanupBannerTemp` from `./banner-renderer.ts`

**Modify variant query** to include new columns:
```sql
SELECT id, content_item_id, body, media_ids,
       banner_state, bannered_media_path
FROM content_variants WHERE id = $1
```

**Add to `handleJob()`:**
- After loading variant, check `banner_state`:
  - `'expected'` → fail with `"Banner expected but not rendered"` (non-retryable)
  - `'stale'` → fail with `"Banner stale — schedule/media/config changed"` (non-retryable)
  - `'rendered'` → pass `bannered_media_path` to `loadMedia()`
  - `'none'` or `'not_applicable'` → proceed with original media

**Modify `loadMedia()`:**
- Accept optional `banneredMediaPath` parameter
- If provided, use it as the storage path for the first media item

**Delete:** `supabase/functions/publish-queue/banner-renderer.ts`

**Delete:** `supabase/functions/publish-queue/proximity.ts` — no longer used by the worker. Removing eliminates the duplicated-logic maintenance burden.

### 6. Staleness detection and invalidation

When any of these change on a content item that has `banner_state = 'rendered'`:

| Trigger | Detection | Action |
|---------|-----------|--------|
| Schedule change | New `scheduled_for` produces a different proximity label | Set `banner_state = 'stale'` |
| Media change | New media path ≠ `banner_source_media_path` | Set `banner_state = 'stale'` |
| Banner config change | Position/colours/customMessage changed | Set `banner_state = 'stale'` |
| Banner disabled | `prompt_context.banner.enabled` set to false | Set `banner_state = 'none'`, clean up file |

**On any staleness trigger, also:**
- Set `content_items.status = 'draft'`
- Cancel/fail any existing `publish_jobs` for this content item:
  ```sql
  UPDATE publish_jobs
  SET status = 'failed', last_error = 'Banner invalidated', next_attempt_at = null
  WHERE content_item_id = $1 AND status IN ('queued', 'in_progress')
  ```
- Insert notification: "Banner invalidated — please re-approve"
- Do NOT delete the old banner file immediately (user may re-approve with same config)

**On re-approval after stale:**
- Pre-render hook runs normally
- Old banner file deleted after new render is validated and stored
- `banner_state` transitions from `stale` → `expected` → `rendered`

### 7. Banner config saves — explicit, not optimistic

**File:** `src/features/planner/banner-controls.tsx`

- Save returns a promise; caller awaits confirmation
- Errors surfaced via toast notification
- Pre-render hook waits for confirmed save before rendering
- Approval button disabled while a banner config save is in-flight
- Config change on a `rendered` banner triggers staleness (see section 6)

### 8. Fix DEFAULT_BANNER_CONFIG fallback

**File:** `src/lib/planner/data.ts`

Current code:
```typescript
const bannerConfig = parseBannerConfig(row.prompt_context) ?? DEFAULT_BANNER_CONFIG;
```

`DEFAULT_BANNER_CONFIG` has `enabled: true`, causing the planner to show banners on content that was never configured for banners.

**Fix:** When no persisted banner config exists, treat as "no banner configured":
```typescript
const bannerConfig = parseBannerConfig(row.prompt_context) ?? null;
```

Components that receive `null` show no banner UI. This prevents old/unconfigured content from unexpectedly triggering banner rendering.

### 9. Story series banner config

**File:** `src/features/create/story-series-form.tsx`

Add `BannerDefaultsPicker` to the story series creation form.

**File:** `src/lib/create/service.ts` — `createStorySeries()`

Pass `bannerDefaults` through to `createCampaignFromPlans()` so that:
- Campaign metadata includes `bannerDefaults`
- Each content item's `prompt_context.banner` is populated via `bannerConfigFromDefaults()`

### 10. Show banner controls for stories in planner

**File:** `src/features/planner/planner-content-composer.tsx`

Remove the placement gate that hides `BannerControls` for story placements.

### 11. Orphan cleanup

**Scenario:** Client uploads banner image, but approval fails (validation, network error, user cancels). The uploaded file is orphaned.

**Strategy:** Scheduled cleanup job (add to existing cron infrastructure):
- Run daily
- Find files in `banners/` storage prefix that are not referenced by any `content_variants.bannered_media_path`
- Delete files older than 24 hours (grace period for in-flight approvals)

This is simpler and more robust than trying to clean up on every failure path.

---

## Error handling

| Scenario | Behaviour |
|----------|-----------|
| Canvas rendering fails (CORS, memory) | Pre-render hook returns error. Approval blocked. Toast shown. |
| Signed upload URL request fails | Pre-render hook returns error. Approval blocked. Toast shown. |
| Banner upload fails | Pre-render hook returns error. Approval blocked. Toast shown. |
| Server label recomputation mismatches client | Approval returns `{ error: "Banner label is stale" }`. Post stays in current status. |
| Server detects source media changed | Approval returns `{ error: "Media changed — re-render required" }`. |
| `banner_state = 'expected'` at publish time | Worker fails job: `"Banner expected but not rendered"`. Non-retryable. |
| `banner_state = 'stale'` at publish time | Worker fails job: `"Banner stale"`. Non-retryable. |
| `banner_state = 'rendered'` but file missing | Worker fails with existing "media not found" error. |
| No proximity label (null) | `banner_state = 'not_applicable'`. Original image published. Intentional. |
| Story derivative not ready | Approval deferred — same as existing story derivative flow. |
| Schedule change invalidates label | `banner_state = 'stale'`, status → draft, job cancelled. User notified. |

No silent fallbacks.

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
ALTER TABLE content_variants
  ADD COLUMN banner_state text NOT NULL DEFAULT 'none'
    CHECK (banner_state IN ('none', 'not_applicable', 'expected', 'rendered', 'stale')),
  ADD COLUMN bannered_media_path text,
  ADD COLUMN banner_label text,
  ADD COLUMN banner_rendered_for_scheduled_at timestamptz,
  ADD COLUMN banner_source_media_path text,
  ADD COLUMN banner_render_metadata jsonb;

CREATE INDEX idx_content_variants_banner_rendered
  ON content_variants (content_item_id)
  WHERE banner_state = 'rendered';
```

No destructive changes. Fully backwards-compatible — `banner_state = 'none'` means no banner.

---

## Testing

### Automated (Vitest)

1. **Unit: `renderBannerCanvas()`** — Canvas mock. Verify blob output, MIME type, dimensions after scaling. Test all four positions. Test font scaling for long labels. Test truncation with ellipsis.
2. **Unit: staleness detection** — Label changes detected when `scheduled_for` shifts across day boundaries. Label unchanged for same-day time shifts.
3. **Unit: `createBannerUploadUrl()`** — Auth checks, path format validation, unique paths.
4. **Unit: server-side label recomputation** — Mismatched label rejected. Matching label accepted.
5. **Unit: DEFAULT_BANNER_CONFIG fix** — Missing persisted config returns null, not enabled defaults.
6. **Integration: approval with banner** — Mock canvas/upload, verify `banner_state = 'rendered'` and `bannered_media_path` set.
7. **Integration: approval blocked when banner expected but path missing** — Verify error returned.

### Playwright (E2E)

8. **Canvas rendering with real image** — Load test image, render banner, verify output blob has modified pixels in strip region.
9. **CORS test** — Signed Supabase URL, verify canvas export succeeds.
10. **Approval flow** — Approve banner-enabled post, verify database records.
11. **Schedule change invalidation** — Change schedule after approval, verify `banner_state = 'stale'`, status → draft, job cancelled.
12. **EXIF orientation** — Phone photo with rotation metadata renders correctly.

### Worker tests

13. **`banner_state = 'rendered'`** — Worker uses `bannered_media_path`. Publishes successfully.
14. **`banner_state = 'expected'`** — Worker fails. Does not fall back.
15. **`banner_state = 'stale'`** — Worker fails. Does not fall back.
16. **`banner_state = 'none'`** — Worker uses original media. Existing behaviour.
17. **`banner_state = 'not_applicable'`** — Worker uses original media. Existing behaviour.
18. **Job cancelled after invalidation** — Queued job does not publish after banner becomes stale.

---

## Files changed

| File | Action |
|------|--------|
| `supabase/migrations/YYYYMMDD_add_banner_columns.sql` | **New** — Add columns to content_variants |
| `src/lib/scheduling/banner-canvas.ts` | **New** — Canvas rendering utility |
| `src/features/planner/use-banner-prerender.ts` | **New** — Client hook for render + upload before approval |
| `src/features/planner/banner-rendered-preview.tsx` | **New** — WYSIWYG canvas preview for approval view |
| `src/app/(app)/planner/actions.ts` | **Modify** — Add `createBannerUploadUrl()`, modify `approveDraftContent()` for banner validation, add staleness to schedule-change action |
| `src/features/planner/banner-preview.tsx` | **Rename** → `banner-overlay-preview.tsx`. Lightweight CSS overlay unchanged. |
| `src/features/planner/banner-controls.tsx` | **Modify** — Explicit saves, surface errors, trigger staleness on config change |
| `src/features/planner/planner-content-composer.tsx` | **Modify** — Show BannerControls for stories, integrate pre-render hook, use `BannerRenderedPreview` in approval view |
| `src/lib/planner/data.ts` | **Modify** — Fix DEFAULT_BANNER_CONFIG fallback to null |
| `src/features/create/story-series-form.tsx` | **Modify** — Add BannerDefaultsPicker |
| `src/lib/create/service.ts` | **Modify** — Pass bannerDefaults in createStorySeries() |
| `supabase/functions/publish-queue/worker.ts` | **Modify** — Remove banner rendering, load banner_state, fail if expected/stale, resolve bannered_media_path |
| `supabase/functions/publish-queue/banner-renderer.ts` | **Delete** |
| `supabase/functions/publish-queue/proximity.ts` | **Delete** — No longer used by worker |
| `src/lib/scheduling/banner-canvas.test.ts` | **New** — Unit tests |
| `tests/e2e/banner-rendering.spec.ts` | **New** — Playwright E2E tests |
