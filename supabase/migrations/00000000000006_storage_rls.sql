-- =============================================================================
-- Storage RLS Policies for the 'media' Bucket
-- =============================================================================
-- Files are stored at path: {account_id}/{asset_id}/{filename}
-- Account-scoped access: users can only read/write within their account folder.
-- The bucket itself must be created manually via Supabase Dashboard -> Storage.
-- =============================================================================

-- Allow authenticated users to upload to their account folder
CREATE POLICY "media_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = (
      SELECT id::text FROM public.accounts WHERE auth_user_id = auth.uid()
    )
  );

-- Allow authenticated users to read from their account folder
CREATE POLICY "media_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = (
      SELECT id::text FROM public.accounts WHERE auth_user_id = auth.uid()
    )
  );

-- Allow authenticated users to update objects in their account folder
CREATE POLICY "media_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = (
      SELECT id::text FROM public.accounts WHERE auth_user_id = auth.uid()
    )
  );

-- Allow authenticated users to delete from their account folder
CREATE POLICY "media_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = (
      SELECT id::text FROM public.accounts WHERE auth_user_id = auth.uid()
    )
  );
