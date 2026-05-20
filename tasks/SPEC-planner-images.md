# SPEC: Planner Calendar Images Not Showing

**Status:** Reviewed and revised
**Date:** 2026-05-20
**Complexity:** L (DB bridge + media resolver + queries + create/upload paths + tests)

---

## Problem

Calendar tiles on the planner page show grey placeholder boxes instead of post thumbnails. This affects existing scheduled content and can also affect newly created content, depending on which creation path produced the media relationship.

The current spec was directionally correct that the planner is reading the wrong media relationship for a large amount of existing content. It was incomplete in one important way: a one-time migration to `media_library.file_url` is not enough, because the application still treats `media_assets` as the active media source of truth.

---

## Reviewer Verdict

The original root cause is only half the issue.

The app is mid-migration between two media models:

| Area | Current implementation | Consequence |
|------|------------------------|-------------|
| Library upload/listing | Writes and reads `media_assets` via `src/app/(app)/library/actions.ts` and `src/lib/library/data.ts` | New uploaded media does not automatically exist in `media_library` |
| Create wizard media picker | Returns `media_assets.id` values | Selected IDs are not guaranteed to satisfy `content_media_attachments.media_id -> media_library(id)` |
| V2 attachment action | `attachMediaToContent()` writes `content_media_attachments` | Insert can fail unless `media_library` has rows with matching IDs |
| Planner v2 query | Reads `content_media_attachments(media_library(file_url))` | Existing v1 content with `content_variants.media_ids` has no thumbnail |
| Storage bucket | `ensureBucketExists()` sets `public: false`; storage policies are account-scoped | Public Supabase Storage URLs are the wrong default for migrated thumbnails |
| Existing planner/library previews | Sign `media_assets.storage_path` or derived variants for 600s | Signed URL resolution is the proven path in this codebase |

So the bug is not just "v2 tables are empty." It is an identity and URL-resolution mismatch:

1. The active media records are in `media_assets`.
2. Existing content stores media IDs in `content_variants.media_ids`.
3. New v2 content attempts to store media links in `content_media_attachments`, but the IDs come from `media_assets`.
4. The v2 planner expects durable `media_library.file_url` values, but the bucket is private and most of the app uses signed URLs.

---

## Current Broken Data Flows

### Existing v1 scheduled content

```text
planner/page.tsx
  -> getContentForCalendar()                         [src/lib/content/queries.ts]
    -> content_items
    -> content_media_attachments(media_library(file_url))
       ^ empty or incomplete for v1 content
    -> thumbnailUrl = null
  -> calendar-cell.tsx
    -> MediaOnTile renders grey placeholder
```

### New create-wizard content

```text
MediaPicker
  -> selectedMediaIds are media_assets.id values
attachMediaToContent()
  -> inserts selected IDs into content_media_attachments.media_id
  -> FK expects media_library.id
  -> fails unless media_library is mirrored with matching IDs
```

### Working preview path elsewhere in the app

```text
media_assets.storage_path + derived_variants
  -> resolvePreviewCandidates()
  -> Supabase Storage createSignedUrl/createSignedUrls()
  -> short-lived preview URL
```

This is the path already used by the library UI and the older planner data layer.

---

## Critical Issues With The Original Recommendation

### 1. Public `file_url` is unsafe as the default

The prior Option A proposed constructing:

```text
{SUPABASE_URL}/storage/v1/object/public/media/{storage_path}
```

That conflicts with the codebase:

- `ensureBucketExists()` creates/updates the `media` bucket with `public: false`.
- `00000000000006_storage_rls.sql` and the bridge migration define authenticated, account-folder scoped storage policies.
- The library and planner preview paths use signed URLs, not public URLs.

Unless the product explicitly decides that all media should be public, the planner should resolve signed URLs server-side.

### 2. A one-time migration does not cover future uploads

`finaliseMediaUpload()` upserts only `media_assets`. `listMediaAssets()` reads only `media_assets`. If we only backfill `media_library` once, the next upload will still miss `media_library`, and `attachMediaToContent()` can still fail.

Any DB bridge must include an ongoing write path, not just historical data migration.

### 3. IDs must be preserved

If `media_library` is used as a bridge table, rows must be inserted with:

```sql
media_library.id = media_assets.id
```

The create wizard and existing `content_variants.media_ids` both carry `media_assets.id` values. Generating fresh `media_library.id` values would not fix the FK mismatch.

### 4. `getContentByAccount()` is not the whole recurring issue

The previous spec correctly noted that `getContentByAccount()` does not join media. But even after adding a join, recurring slots still would not show thumbnails because:

- `MaterialisedSlot` has no `thumbnailUrl` field.
- `getItemThumbnail()` explicitly returns `null` for materialised slots.

If recurring thumbnails are required, the materialisation type and `calendar-cell.tsx` helper both need to carry thumbnails forward.

### 5. Attachment order is currently nondeterministic

`extractThumbnailUrl()` uses `attachments[0]`, but the nested query does not request or enforce ordering by `content_media_attachments.position`. The thumbnail resolver should select `position` and sort by it before choosing the primary image.

### 6. `content_media_attachments` RLS checks only content ownership

The insert/update policies validate that the `content_item_id` belongs to the current account, but they do not validate that `media_id` belongs to the same account. If this table remains the v2 attachment model, policy hardening should also check the media side.

---

## Revised Recommendation

Use `media_assets` as the operational source of truth for thumbnails until the media model is fully consolidated. Do not switch the planner to public `file_url` values.

### Phase 1: Immediate planner fix

Implement a shared server-side thumbnail resolver that can resolve thumbnails from both relationship models:

1. Read v2 relationships:
   - `content_media_attachments.content_item_id`
   - `content_media_attachments.media_id`
   - `content_media_attachments.position`
2. Read v1 relationships for fallback:
   - `content_variants.content_item_id`
   - `content_variants.media_ids`
3. Query `media_assets` for the collected media IDs:
   - `id`
   - `media_type`
   - `storage_path`
   - `derived_variants`
   - `processed_status`
4. Resolve candidates using the existing `resolvePreviewCandidates()` helper.
5. Sign candidates with Supabase Storage (`createSignedUrls`) on the server.
6. Return `Map<contentItemId, thumbnailUrl>`.

`getContentForCalendar()` should keep the v2 join only if needed for attachment IDs, but it should populate `thumbnailUrl` from the resolver rather than trusting `media_library.file_url`.

### Phase 2: Bridge the FK mismatch

Add a migration that mirrors `media_assets` into `media_library` with preserved IDs:

```sql
INSERT INTO public.media_library (
  id,
  account_id,
  file_name,
  file_url,
  file_type,
  file_size_bytes,
  tags,
  created_at
)
SELECT
  id,
  account_id,
  file_name,
  storage_path,
  COALESCE(mime_type, media_type),
  size_bytes::integer,
  COALESCE(tags, ARRAY[]::text[]),
  uploaded_at
FROM public.media_assets
ON CONFLICT (id) DO UPDATE SET
  file_name = EXCLUDED.file_name,
  file_url = EXCLUDED.file_url,
  file_type = EXCLUDED.file_type,
  file_size_bytes = EXCLUDED.file_size_bytes,
  tags = EXCLUDED.tags;
```

Important: `file_url` should be treated as a legacy compatibility field here, not as a public browser URL. The planner resolver should still sign through `media_assets`.

### Phase 3: Backfill attachments

Backfill `content_media_attachments` from both known sources:

1. `content_variants.media_ids` for old/generated/publishing content.
2. `content_items.body_draft->'selectedMediaIds'` for v2 create-wizard drafts that saved IDs but failed to attach.

Use array ordinality for `position`, and `ON CONFLICT DO NOTHING`.

Example shape:

```sql
INSERT INTO public.content_media_attachments (content_item_id, media_id, position)
SELECT
  cv.content_item_id,
  media_id,
  ordinality::integer - 1
FROM public.content_variants cv
CROSS JOIN LATERAL unnest(COALESCE(cv.media_ids, ARRAY[]::uuid[]))
  WITH ORDINALITY AS media(media_id, ordinality)
JOIN public.media_library ml ON ml.id = media.media_id
ON CONFLICT (content_item_id, media_id) DO NOTHING;
```

For `body_draft->selectedMediaIds`, cast defensively and only insert valid UUIDs that exist in `media_library`.

### Phase 4: Keep future uploads in sync

Update active upload/finalise paths so new media can be attached through the v2 table:

- `src/app/(app)/library/actions.ts`
  - `finaliseMediaUpload()` should also upsert a matching `media_library` row with `id = media_assets.id`.
- `src/app/actions/media.ts`
  - If `uploadMediaAction()` is still reachable, it should do the same or be removed from active flows.

`attachMediaToContent()` should also attach an empty array when the user removes all selected media; current callers skip the action when `selectedMediaIds.length === 0`, which can leave stale attachments.

### Phase 5: Recurring thumbnails, if desired

If weekly recurring items should show thumbnails:

1. Add `thumbnailUrl: string | null` to `MaterialisedSlot`.
2. Pass the source content item's thumbnail into `materialiseRecurring()`.
3. Change `getItemThumbnail()` so materialised slots can return `item.thumbnailUrl`.
4. Add focused tests for materialised slot thumbnail preservation.

---

## Files Likely To Change

| Area | Files |
|------|-------|
| Thumbnail resolver | New helper under `src/lib/content/` or `src/lib/media/`; `src/lib/content/queries.ts` |
| DB bridge | New Supabase migration |
| Upload sync | `src/app/(app)/library/actions.ts`; maybe `src/app/actions/media.ts` |
| Attachment action | `src/app/actions/media.ts` |
| Recurring support | `src/lib/scheduling/materialise.ts`; `src/features/planner/calendar-cell.tsx` |
| Tests | `tests/lib/content/*.test.ts`, `src/lib/scheduling/materialise.test.ts`, or colocated existing test style |

---

## Acceptance Criteria

1. Existing scheduled content with `content_variants.media_ids` displays a thumbnail in planner media-on mode.
2. Newly uploaded media can be attached to new create-wizard content without FK failures.
3. Newly scheduled create-wizard content displays a planner thumbnail.
4. The primary thumbnail respects attachment/media order.
5. Private Supabase Storage remains private; no public bucket requirement is introduced.
6. `npm run typecheck` passes.
7. A focused test covers resolver fallback from v2 attachments to v1 `content_variants.media_ids`.

---

## Pre-Implementation Checks

Run these against the target Supabase project before writing the migration:

```sql
-- How much historical v1 media exists?
SELECT COUNT(*) AS media_assets_count FROM public.media_assets;

-- How many v1 content/media references need backfilling?
SELECT COUNT(*) AS content_variants_with_media
FROM public.content_variants
WHERE COALESCE(array_length(media_ids, 1), 0) > 0;

-- Are any v1 media references invalid?
SELECT media_id, COUNT(*) AS references_count
FROM public.content_variants cv
CROSS JOIN LATERAL unnest(COALESCE(cv.media_ids, ARRAY[]::uuid[])) AS media(media_id)
LEFT JOIN public.media_assets ma ON ma.id = media.media_id
WHERE ma.id IS NULL
GROUP BY media_id
ORDER BY references_count DESC;

-- Are there create-wizard drafts with saved media IDs but no v2 attachment rows?
SELECT ci.id, ci.status, ci.body_draft->'selectedMediaIds' AS selected_media_ids
FROM public.content_items ci
WHERE jsonb_typeof(ci.body_draft->'selectedMediaIds') = 'array'
  AND NOT EXISTS (
    SELECT 1
    FROM public.content_media_attachments cma
    WHERE cma.content_item_id = ci.id
  );
```

---

## Implementation Notes

- Prefer extracting thumbnail resolution instead of importing `loadPrimaryMediaPreviewsByContent()` directly. That function is currently private to `src/lib/planner/data.ts`.
- Avoid storing signed URLs in the database; they expire.
- Consider signing with a longer TTL for planner thumbnails if lazy loading causes expired URLs in long-lived calendar sessions.
- Keep `next.config.ts` Supabase `remotePatterns`; it is still needed for signed Supabase image URLs.
- If using `next/image` with short-lived signed URLs becomes flaky, either set planner thumbnails to `unoptimized` or introduce an authenticated image proxy route that signs on request.
