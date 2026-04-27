-- Add banner lifecycle columns to content_variants for client-side pre-rendering.
-- Replaces the broken FFmpeg WASM publish-time banner renderer with a model where
-- banners are rendered client-side at approval time and stored as pre-rendered images.

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
