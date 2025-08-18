-- =====================================================
-- Add storage_path column to media_assets table
-- =====================================================

-- Add the missing storage_path column that the application expects
ALTER TABLE media_assets 
ADD COLUMN IF NOT EXISTS storage_path TEXT;

-- Add index for better query performance when looking up by storage path
CREATE INDEX IF NOT EXISTS idx_media_assets_storage_path ON media_assets(storage_path);

-- Update existing records to extract storage path from file_url
-- This extracts the path after '/media/' from the public URL
UPDATE media_assets 
SET storage_path = 
  CASE 
    WHEN file_url LIKE '%/storage/v1/object/public/media/%' 
    THEN SUBSTRING(file_url FROM '.*?/storage/v1/object/public/media/(.*)$')
    ELSE NULL
  END
WHERE storage_path IS NULL;

-- =====================================================
-- VERIFICATION
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '✅ MEDIA ASSETS STORAGE PATH FIX COMPLETE';
    RAISE NOTICE '=========================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Changes made:';
    RAISE NOTICE '  ✅ Added storage_path column to media_assets table';
    RAISE NOTICE '  ✅ Created index on storage_path for performance';
    RAISE NOTICE '  ✅ Updated existing records with extracted storage paths';
    RAISE NOTICE '';
    RAISE NOTICE '📝 The application can now properly store media asset paths';
    RAISE NOTICE '';
END $$;