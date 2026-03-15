---
title: Media Library
created: 2026-03-14
last_updated: 2026-03-14
status: current
tags:
  - type/reference
  - section/features
  - module/library
route: /library
related:
  - "[[Content Creation & Campaigns]]"
  - "[[Planner]]"
  - "[[Schema]]"
typescript: src/lib/library/data.ts
---

← [[_Index]] / [[_Features MOC]]

# Media Library

## Overview

The Library is a media asset manager where users upload images and videos that can be attached to content. Uploaded assets are stored in Supabase Storage (`media-assets` bucket) and their metadata recorded in the `media_assets` table.

## Upload Flow

1. User selects file in `UploadPanel` component
2. File is uploaded directly to Supabase Storage under the path `{account_id}/{uuid}/{filename}`
3. A `media_assets` row is inserted with the `storage_path`, `file_name`, `media_type`, `mime_type`, and `size_bytes`
4. Background processing generates `derived_variants` (story crop, thumbnails for different placements)

## Derived Variants

The `derived_variants` JSONB column on `media_assets` stores processed variant paths:
```json
{
  "story": "path/to/story-cropped.jpg",
  "thumbnail": "path/to/thumb.jpg"
}
```

`resolvePreviewCandidates()` in `src/lib/library/data.ts` returns an ordered list of candidates (story-crop first for story placement, original otherwise). The planner and content detail use this to display the best-fit preview.

## Signed URLs

Media files in Supabase Storage are private. Signed URLs with a 600-second TTL are generated in batches via `createSignedUrls()`. The planner generates them in a single batch pass for all visible content items.

## Asset Hiding

`media_assets.hidden_at` (added in migration `20250314090000`) allows soft-hiding assets from the library without deleting them. Hidden assets may still be referenced by existing content variants.

## Tags

The `tags` text[] column enables categorisation and filtering of assets in the library. Tag management is exposed in the `MediaAssetEditor` component.

## Components

| Component | File | Purpose |
|-----------|------|---------|
| `MediaAssetGrid` | `src/features/library/media-asset-grid.tsx` | Server-rendered grid of assets |
| `MediaAssetGridClient` | `src/features/library/media-asset-grid-client.tsx` | Client-side grid with selection |
| `MediaAssetEditor` | `src/features/library/media-asset-editor.tsx` | Edit asset metadata (tags, etc.) |
| `UploadPanel` | `src/features/library/upload-panel.tsx` | File upload dropzone |
| `ReprocessButton` | `src/features/library/reprocess-button.tsx` | Trigger re-processing of derived variants |
