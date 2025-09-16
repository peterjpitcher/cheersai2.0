-- Migration to fix issue #261: Deleted users appear in workflow assignment
-- Creates brand-scoped view for active users only

-- First, ensure we have proper status values (safe coercion)
UPDATE auth.users 
SET raw_user_meta_data = jsonb_set(
  COALESCE(raw_user_meta_data, '{}'::jsonb),
  '{status}',
  '"active"'::jsonb
)
WHERE raw_user_meta_data->>'status' IS NULL;
-- Create ENUM type for user status if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN
    CREATE TYPE user_status AS ENUM ('active', 'inactive', 'pending', 'suspended');
  END IF;
END $$;
-- Create brand-scoped view for active users (only if required tables exist)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'profiles') 
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_brand_permissions') THEN
    
    CREATE OR REPLACE VIEW active_brand_users_v AS
    SELECT 
      u.id,
      COALESCE(p.email, u.email) as email,
      p.full_name,
      p.avatar_url,
      ubp.brand_id,
      p.job_title,
      u.created_at,
      p.updated_at
    FROM auth.users u
    INNER JOIN profiles p ON p.id = u.id
    INNER JOIN user_brand_permissions ubp ON ubp.user_id = u.id
    WHERE COALESCE(u.raw_user_meta_data->>'status', 'active') = 'active';
      
  ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_brand_permissions') THEN
    -- Create simplified view without profiles table
    CREATE OR REPLACE VIEW active_brand_users_v AS
    SELECT 
      u.id,
      u.email,
      NULL::text as full_name,
      NULL::text as avatar_url,
      ubp.brand_id,
      NULL::text as job_title,
      u.created_at,
      u.updated_at
    FROM auth.users u
    INNER JOIN user_brand_permissions ubp ON ubp.user_id = u.id
    WHERE COALESCE(u.raw_user_meta_data->>'status', 'active') = 'active';
  END IF;
END $$;
-- Add comment for documentation (only if view exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_name = 'active_brand_users_v') THEN
    COMMENT ON VIEW active_brand_users_v IS 'Brand-scoped view of active, non-deleted users for workflow assignments';
  END IF;
END $$;
-- Create indexes for better search performance if tables exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'profiles') THEN
    CREATE INDEX IF NOT EXISTS idx_profiles_email_search ON profiles USING gin (email gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_profiles_full_name_search ON profiles USING gin (full_name gin_trgm_ops);
    -- Create composite search index for better performance
    CREATE INDEX IF NOT EXISTS idx_profiles_search_combo 
    ON profiles USING gin ((COALESCE(email,'') || ' ' || COALESCE(full_name,'')) gin_trgm_ops);
  END IF;
END $$;
-- Grant appropriate permissions (only if view exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_name = 'active_brand_users_v') THEN
    GRANT SELECT ON active_brand_users_v TO authenticated;
  END IF;
END $$;
-- Add RLS policy for the view's underlying tables if not exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_brand_permissions')
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE tablename = 'user_brand_permissions'
       AND policyname = 'Users can view brand permissions'
     ) THEN
    CREATE POLICY "Users can view brand permissions"
    ON user_brand_permissions
    FOR SELECT
    USING (
      user_id = auth.uid()
      OR brand_id IN (
        SELECT brand_id
        FROM user_brand_permissions
        WHERE user_id = auth.uid()
      )
    );
  END IF;
END $$;
