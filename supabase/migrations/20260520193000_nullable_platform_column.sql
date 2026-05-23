-- v2 content items support multiple platforms via body_draft.platforms,
-- so the v1 single-platform column no longer needs to be NOT NULL.
-- Existing v1 rows retain their platform value; new v2 rows insert NULL.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'content_items'
      AND column_name = 'platform'
  ) THEN
    ALTER TABLE public.content_items ALTER COLUMN platform DROP NOT NULL;
  END IF;
END;
$$;
