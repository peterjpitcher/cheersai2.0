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
