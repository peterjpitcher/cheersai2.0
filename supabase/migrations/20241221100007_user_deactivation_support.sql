-- Fix for Issue #260: Missing Deactivate User Option
-- Implements user deactivation with proper Supabase auth integration

-- Create user account status tracking table
-- (Cannot modify auth.users directly in Supabase)
CREATE TABLE IF NOT EXISTS public.user_accounts (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  status_reason text,
  status_changed_at timestamptz DEFAULT NOW(),
  status_changed_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);
-- Create status history table for audit trail
CREATE TABLE IF NOT EXISTS public.user_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  old_status text,
  new_status text NOT NULL,
  reason text,
  changed_by uuid REFERENCES auth.users(id),
  changed_at timestamptz DEFAULT NOW(),
  metadata jsonb DEFAULT '{}'::jsonb
);
-- Initialize user_accounts for existing users
INSERT INTO public.user_accounts (id, status)
SELECT id, 'active' FROM auth.users
ON CONFLICT (id) DO NOTHING;
-- Create trigger to auto-create user_accounts entry for new users
CREATE OR REPLACE FUNCTION create_user_account()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_accounts (id, status)
  VALUES (NEW.id, 'active')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Create trigger for new auth.users to ensure a user_accounts row exists
DO $$
BEGIN
  -- Use a unique trigger name to avoid clashes with other auth.users triggers
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE t.tgname = 'on_auth_user_created_create_user_account'
      AND n.nspname = 'auth'
      AND c.relname = 'users'
  ) THEN
    CREATE TRIGGER on_auth_user_created_create_user_account
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION create_user_account();
  END IF;
END;
$$;
-- Function to check if user is active (for RLS policies)
CREATE OR REPLACE FUNCTION is_user_active(user_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_accounts 
    WHERE id = user_id AND status = 'active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
-- Update RLS policies to check active status
-- Example for a typical table (apply pattern to all protected tables):
-- ALTER POLICY "Users can view own data" ON your_table
-- USING (auth.uid() = user_id AND is_user_active(auth.uid()));

-- Function to deactivate user (called from API with service role)
CREATE OR REPLACE FUNCTION deactivate_user(
  p_user_id uuid,
  p_reason text DEFAULT NULL,
  p_changed_by uuid DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_old_status text;
  v_result jsonb;
BEGIN
  -- Get current status
  SELECT status INTO v_old_status
  FROM public.user_accounts
  WHERE id = p_user_id;
  
  IF v_old_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;
  
  IF v_old_status = 'inactive' THEN
    RETURN jsonb_build_object('success', false, 'error', 'User already inactive');
  END IF;
  
  -- Update status
  UPDATE public.user_accounts
  SET 
    status = 'inactive',
    status_reason = p_reason,
    status_changed_at = NOW(),
    status_changed_by = p_changed_by,
    updated_at = NOW()
  WHERE id = p_user_id;
  
  -- Record history
  INSERT INTO public.user_status_history (
    user_id, old_status, new_status, reason, changed_by
  ) VALUES (
    p_user_id, v_old_status, 'inactive', p_reason, p_changed_by
  );
  
  -- Note: Session revocation must be done via Supabase Admin API
  -- from an Edge Function or backend with service role key
  
  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'old_status', v_old_status,
    'new_status', 'inactive'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Function to reactivate user
CREATE OR REPLACE FUNCTION reactivate_user(
  p_user_id uuid,
  p_reason text DEFAULT NULL,
  p_changed_by uuid DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_old_status text;
BEGIN
  -- Get current status
  SELECT status INTO v_old_status
  FROM public.user_accounts
  WHERE id = p_user_id;
  
  IF v_old_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;
  
  IF v_old_status = 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'User already active');
  END IF;
  
  -- Update status
  UPDATE public.user_accounts
  SET 
    status = 'active',
    status_reason = p_reason,
    status_changed_at = NOW(),
    status_changed_by = p_changed_by,
    updated_at = NOW()
  WHERE id = p_user_id;
  
  -- Record history
  INSERT INTO public.user_status_history (
    user_id, old_status, new_status, reason, changed_by
  ) VALUES (
    p_user_id, v_old_status, 'active', p_reason, p_changed_by
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'old_status', v_old_status,
    'new_status', 'active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_accounts_status 
ON public.user_accounts(status) 
WHERE status != 'active';
CREATE INDEX IF NOT EXISTS idx_user_status_history_user 
ON public.user_status_history(user_id, changed_at DESC);
-- RLS policies
ALTER TABLE public.user_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_status_history ENABLE ROW LEVEL SECURITY;
-- Only admins can view user account status
CREATE POLICY "Admins can view user accounts" ON public.user_accounts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM auth.users 
      WHERE id = auth.uid() 
      AND (raw_user_meta_data->>'role' = 'admin')
    )
  );
-- Only admins can view status history
CREATE POLICY "Admins can view status history" ON public.user_status_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM auth.users 
      WHERE id = auth.uid() 
      AND (raw_user_meta_data->>'role' = 'admin')
    )
  );
-- Guard function to prevent deactivating last admin
CREATE OR REPLACE FUNCTION can_deactivate_user(p_user_id uuid)
RETURNS boolean AS $$
DECLARE
  v_user_role text;
  v_active_admin_count int;
BEGIN
  -- Get user role
  SELECT raw_user_meta_data->>'role' INTO v_user_role
  FROM auth.users WHERE id = p_user_id;
  
  -- If not an admin, can deactivate
  IF v_user_role != 'admin' THEN
    RETURN true;
  END IF;
  
  -- Count active admins
  SELECT COUNT(*) INTO v_active_admin_count
  FROM auth.users u
  JOIN public.user_accounts ua ON ua.id = u.id
  WHERE u.raw_user_meta_data->>'role' = 'admin'
  AND ua.status = 'active'
  AND u.id != p_user_id;
  
  -- Can't deactivate if this is the last active admin
  RETURN v_active_admin_count > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
