-- Banner overlay consistency — additive schema (Migration 1 of 2)
-- See docs/superpowers/specs/2026-05-07-banner-overlay-consistency-design.md

-- Per-post override columns. NULL = inherit account default.
ALTER TABLE public.content_variants
  ADD COLUMN banner_enabled boolean,
  ADD COLUMN banner_text_override text
    CHECK (banner_text_override IS NULL OR char_length(banner_text_override) <= 20),
  ADD COLUMN banner_position text
    CHECK (banner_position IS NULL OR banner_position IN ('top','bottom','left','right')),
  ADD COLUMN banner_bg text
    CHECK (banner_bg IS NULL OR banner_bg ~ '^#[0-9A-Fa-f]{6}$'),
  ADD COLUMN banner_text_colour text
    CHECK (banner_text_colour IS NULL OR banner_text_colour ~ '^#[0-9A-Fa-f]{6}$');

-- Account-level defaults.
ALTER TABLE public.posting_defaults
  ADD COLUMN banners_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN banner_position text NOT NULL DEFAULT 'bottom'
    CHECK (banner_position IN ('top','bottom','left','right')),
  ADD COLUMN banner_bg text NOT NULL DEFAULT '#000000'
    CHECK (banner_bg ~ '^#[0-9A-Fa-f]{6}$'),
  ADD COLUMN banner_text_colour text NOT NULL DEFAULT '#FFFFFF'
    CHECK (banner_text_colour ~ '^#[0-9A-Fa-f]{6}$');

-- Validated copy from legacy prompt_context.bannerConfig into override columns.
-- Invalid legacy values become null (= inherit account default).
DO $$
DECLARE
  copied_enabled int;
  copied_text int;
  copied_position int;
  copied_bg int;
  copied_text_colour int;
BEGIN
  WITH src AS (
    SELECT cv.id AS variant_id,
           ci.prompt_context->'bannerConfig' AS bc
    FROM public.content_variants cv
    JOIN public.content_items ci ON cv.content_item_id = ci.id
    WHERE cv.banner_enabled IS NULL
      AND ci.prompt_context ? 'bannerConfig'
  ),
  upd AS (
    UPDATE public.content_variants cv
    SET banner_enabled =
          CASE WHEN jsonb_typeof(s.bc->'enabled') = 'boolean'
               THEN (s.bc->>'enabled')::boolean END,
        banner_text_override =
          CASE WHEN jsonb_typeof(s.bc->'customMessage') = 'string'
                AND char_length(s.bc->>'customMessage') <= 20
               THEN s.bc->>'customMessage' END,
        banner_position =
          CASE WHEN s.bc->>'position' IN ('top','bottom','left','right')
               THEN s.bc->>'position' END,
        banner_bg =
          CASE WHEN s.bc->>'bgColour' ~ '^#[0-9A-Fa-f]{6}$'
               THEN s.bc->>'bgColour' END,
        banner_text_colour =
          CASE WHEN s.bc->>'textColour' ~ '^#[0-9A-Fa-f]{6}$'
               THEN s.bc->>'textColour' END
    FROM src s
    WHERE cv.id = s.variant_id
    RETURNING cv.id,
              (cv.banner_enabled IS NOT NULL) AS got_enabled,
              (cv.banner_text_override IS NOT NULL) AS got_text,
              (cv.banner_position IS NOT NULL) AS got_position,
              (cv.banner_bg IS NOT NULL) AS got_bg,
              (cv.banner_text_colour IS NOT NULL) AS got_text_colour
  )
  SELECT
    COUNT(*) FILTER (WHERE got_enabled),
    COUNT(*) FILTER (WHERE got_text),
    COUNT(*) FILTER (WHERE got_position),
    COUNT(*) FILTER (WHERE got_bg),
    COUNT(*) FILTER (WHERE got_text_colour)
  INTO copied_enabled, copied_text, copied_position, copied_bg, copied_text_colour
  FROM upd;

  RAISE NOTICE 'Banner data copy: enabled=%, text_override=%, position=%, bg=%, text_colour=%',
    copied_enabled, copied_text, copied_position, copied_bg, copied_text_colour;
END $$;
