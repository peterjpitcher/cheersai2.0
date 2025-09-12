-- Drop unused original_url column from media_assets
-- Context: bulk watermarking feature was removed; we no longer
-- rewrite file_url nor store a pointer to the original asset.

BEGIN;

ALTER TABLE IF EXISTS public.media_assets
  DROP COLUMN IF EXISTS original_url;

COMMIT;

