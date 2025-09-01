-- Migration: Add comprehensive user deletion function
-- Description: Safely deletes user account and all associated data

-- Drop existing broken function if it exists
DROP FUNCTION IF EXISTS soft_delete_user_data(uuid);

-- Create comprehensive user deletion function
CREATE OR REPLACE FUNCTION delete_user_account(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_is_sole_owner boolean := false;
  v_other_users_count integer;
  v_result json;
BEGIN
  -- Check if user exists
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'User not found'
    );
  END IF;

  -- Get user's tenant
  SELECT tenant_id INTO v_tenant_id
  FROM users
  WHERE id = p_user_id;

  -- Check if user is sole tenant owner
  IF v_tenant_id IS NOT NULL THEN
    -- Check if user owns the tenant
    IF EXISTS (SELECT 1 FROM tenants WHERE id = v_tenant_id AND owner_id = p_user_id) THEN
      -- Count other users in the tenant
      SELECT COUNT(*) INTO v_other_users_count
      FROM users
      WHERE tenant_id = v_tenant_id
      AND id != p_user_id;

      IF v_other_users_count = 0 THEN
        v_is_sole_owner := true;
      END IF;
    END IF;
  END IF;

  -- Start deletion process
  BEGIN
    -- Clean up orphaned references (set to NULL to preserve history)
    UPDATE team_invitations SET invited_by = NULL WHERE invited_by = p_user_id;
    UPDATE content_guardrails SET user_id = NULL WHERE user_id = p_user_id;
    UPDATE content_guardrails_history SET user_id = NULL WHERE user_id = p_user_id;
    UPDATE ai_generation_feedback SET user_id = NULL WHERE user_id = p_user_id;
    UPDATE campaign_posts SET approved_by = NULL WHERE approved_by = p_user_id;
    UPDATE ai_platform_prompts SET created_by = NULL WHERE created_by = p_user_id;
    UPDATE ai_platform_prompt_history SET created_by = NULL WHERE created_by = p_user_id;
    
    -- Preserve audit logs but anonymize
    UPDATE audit_logs 
    SET user_id = NULL,
        metadata = jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{deleted_user_id}',
          to_jsonb(p_user_id::text)
        )
    WHERE user_id = p_user_id;

    -- Delete tenant if user is sole owner (cascades to all tenant data)
    IF v_is_sole_owner AND v_tenant_id IS NOT NULL THEN
      DELETE FROM tenants WHERE id = v_tenant_id;
    END IF;

    -- Delete user record (cascades to user-specific tables)
    DELETE FROM users WHERE id = p_user_id;

    -- Note: auth.users deletion must be done through Supabase Admin API
    -- This function handles only the application database

    v_result := json_build_object(
      'success', true,
      'tenant_deleted', v_is_sole_owner,
      'tenant_id', v_tenant_id
    );

    RETURN v_result;

  EXCEPTION
    WHEN OTHERS THEN
      RETURN json_build_object(
        'success', false,
        'error', SQLERRM
      );
  END;
END;
$$;

-- Create soft delete function for GDPR compliance (30-day retention)
CREATE OR REPLACE FUNCTION soft_delete_user_account(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
BEGIN
  -- Check if user exists
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'User not found'
    );
  END IF;

  -- Mark user as deleted and anonymize PII
  UPDATE users
  SET 
    deleted_at = NOW(),
    email = CONCAT('deleted_', p_user_id, '@deleted.local'),
    first_name = 'Deleted',
    last_name = 'User',
    updated_at = NOW()
  WHERE id = p_user_id;

  -- Disable user's auth account (requires service role)
  -- This would be done through the API endpoint

  v_result := json_build_object(
    'success', true,
    'message', 'Account marked for deletion. Will be permanently deleted in 30 days.'
  );

  RETURN v_result;

EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

-- Create function to clean up soft-deleted users after retention period
CREATE OR REPLACE FUNCTION cleanup_deleted_users()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_record RECORD;
BEGIN
  -- Find users marked for deletion more than 30 days ago
  FOR v_user_record IN 
    SELECT id 
    FROM users 
    WHERE deleted_at IS NOT NULL 
    AND deleted_at < NOW() - INTERVAL '30 days'
  LOOP
    -- Use the hard delete function
    PERFORM delete_user_account(v_user_record.id);
  END LOOP;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION delete_user_account TO authenticated;
GRANT EXECUTE ON FUNCTION soft_delete_user_account TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_deleted_users TO service_role;

-- Add deleted_at column to users table if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'users' 
    AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE users ADD COLUMN deleted_at timestamptz;
    CREATE INDEX idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NOT NULL;
  END IF;
END $$;

-- Comment on functions
COMMENT ON FUNCTION delete_user_account IS 'Permanently deletes a user account and all associated data. Deletes tenant if user is sole owner.';
COMMENT ON FUNCTION soft_delete_user_account IS 'Marks a user account for deletion and anonymizes PII. Account will be permanently deleted after 30 days.';
COMMENT ON FUNCTION cleanup_deleted_users IS 'Cleans up soft-deleted users after 30-day retention period. Should be run periodically via cron job.';