-- =====================================================
-- Setup Media Storage Bucket and Policies
-- =====================================================

-- Create the media storage bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media',
  'media',
  true,  -- Public bucket for media assets
  5242880,  -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE
SET 
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];

-- Drop existing policies to start fresh
DROP POLICY IF EXISTS "Tenant users can upload media" ON storage.objects;
DROP POLICY IF EXISTS "Public can view media" ON storage.objects;
DROP POLICY IF EXISTS "Tenant users can update their media" ON storage.objects;
DROP POLICY IF EXISTS "Tenant users can delete their media" ON storage.objects;

-- Create storage policies for the media bucket

-- Allow authenticated users to upload to their tenant folder
CREATE POLICY "Tenant users can upload media"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'media' 
  AND auth.uid() IN (
    SELECT id FROM users WHERE tenant_id::text = (string_to_array(name, '/'))[1]
  )
);

-- Allow public to view all media (since it's a public bucket)
CREATE POLICY "Public can view media"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'media');

-- Allow users to update their own tenant's media
CREATE POLICY "Tenant users can update their media"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'media'
  AND auth.uid() IN (
    SELECT id FROM users WHERE tenant_id::text = (string_to_array(name, '/'))[1]
  )
);

-- Allow users to delete their own tenant's media
CREATE POLICY "Tenant users can delete their media"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'media'
  AND auth.uid() IN (
    SELECT id FROM users WHERE tenant_id::text = (string_to_array(name, '/'))[1]
  )
);

-- Create RLS policies for media_assets table if not exists
DROP POLICY IF EXISTS "media_assets_all_authenticated" ON media_assets;

-- Simple policy for media_assets table
CREATE POLICY "media_assets_all_authenticated"
ON media_assets
FOR ALL
TO authenticated
USING (
  tenant_id IN (
    SELECT tenant_id FROM users WHERE id = auth.uid()
    UNION
    SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
  )
)
WITH CHECK (
  tenant_id IN (
    SELECT tenant_id FROM users WHERE id = auth.uid()
    UNION
    SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
  )
);

-- =====================================================
-- VERIFICATION
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '📸 MEDIA STORAGE SETUP COMPLETE';
    RAISE NOTICE '================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Created/Updated:';
    RAISE NOTICE '  ✅ Media storage bucket (5MB limit)';
    RAISE NOTICE '  ✅ Allowed types: JPEG, PNG, GIF, WebP, SVG';
    RAISE NOTICE '  ✅ Public read access';
    RAISE NOTICE '  ✅ Tenant-scoped upload/update/delete';
    RAISE NOTICE '  ✅ Media assets table policies';
    RAISE NOTICE '';
    RAISE NOTICE '📝 Files are organized by tenant_id/filename';
    RAISE NOTICE '';
END $$;