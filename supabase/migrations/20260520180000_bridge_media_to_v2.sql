-- =============================================================================
-- Bridge v1 media data into v2 tables
-- =============================================================================
-- Purpose: Populate media_library and content_media_attachments from v1 data
-- so the v2 planner calendar can resolve thumbnails and the create wizard's
-- attachMediaToContent() FK constraint is satisfied.
--
-- Safe to re-run (all inserts use ON CONFLICT DO NOTHING/UPDATE).
-- Does NOT drop or modify any v1 tables.
-- =============================================================================


-- =============================================================================
-- Part A: Mirror media_assets -> media_library (preserve IDs)
-- =============================================================================
-- file_url stores storage_path as a compatibility value. The application
-- resolves signed URLs via media_assets at runtime, not via this field.
-- =============================================================================

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'media_assets'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'media_library'
  ) THEN
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
  END IF;
END $$;


-- =============================================================================
-- Part B: Backfill content_media_attachments from content_variants.media_ids
-- =============================================================================
-- Uses array ordinality for position. Only inserts where media_library row
-- exists (Part A must have run first).
-- =============================================================================

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'content_variants'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'content_media_attachments'
  ) THEN
    INSERT INTO public.content_media_attachments (content_item_id, media_id, position)
    SELECT
      cv.content_item_id,
      media.media_id,
      media.ordinality::integer - 1
    FROM public.content_variants cv
    CROSS JOIN LATERAL unnest(COALESCE(cv.media_ids, ARRAY[]::uuid[]))
      WITH ORDINALITY AS media(media_id, ordinality)
    JOIN public.media_library ml ON ml.id = media.media_id
    ON CONFLICT (content_item_id, media_id) DO NOTHING;
  END IF;
END $$;


-- =============================================================================
-- Part C: Backfill from content_items.body_draft->'selectedMediaIds'
-- =============================================================================
-- Catches v2 create-wizard drafts that saved media IDs in body_draft but
-- failed to attach via content_media_attachments.
-- Only inserts for items that have NO existing attachments (to avoid
-- conflicting with Part B or user-created attachments).
-- =============================================================================

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'content_media_attachments'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'media_library'
  ) THEN
    INSERT INTO public.content_media_attachments (content_item_id, media_id, position)
    SELECT
      ci.id,
      elem.value::uuid,
      (elem.ordinality::integer - 1)
    FROM public.content_items ci
    CROSS JOIN LATERAL jsonb_array_elements_text(ci.body_draft -> 'selectedMediaIds')
      WITH ORDINALITY AS elem(value, ordinality)
    WHERE jsonb_typeof(ci.body_draft -> 'selectedMediaIds') = 'array'
      AND EXISTS (
        SELECT 1 FROM public.media_library ml
        WHERE ml.id = elem.value::uuid
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.content_media_attachments cma
        WHERE cma.content_item_id = ci.id
      )
    ON CONFLICT (content_item_id, media_id) DO NOTHING;
  END IF;
END $$;


-- =============================================================================
-- DONE
-- =============================================================================
