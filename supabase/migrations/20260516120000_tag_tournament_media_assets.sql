-- Backfill: tag existing tournament-generated media assets so they can be
-- filtered out of the general content-creation picker.
UPDATE media_assets
SET tags = CASE
  WHEN tags IS NULL THEN ARRAY['Tournament']::text[]
  WHEN NOT tags @> ARRAY['Tournament']::text[] THEN array_append(tags, 'Tournament')
  ELSE tags
END
WHERE storage_path LIKE 'tournaments/%';
