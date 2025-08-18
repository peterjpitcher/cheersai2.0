-- Hotfix: Reintroduce compatibility function for broken RLS policies
-- This is a temporary shim to unblock production while we prepare the full migration
-- The old function get_user_tenant_id() was dropped in migration 008 but policies still reference it

CREATE OR REPLACE FUNCTION public.get_user_tenant_id(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  -- Delegate to the new function that was introduced in migration 008
  -- Note: The parameter p_user_id is ignored as the new function uses auth context
  SELECT public.get_auth_tenant_id();
$$;

-- Add a comment to remind us this is temporary
COMMENT ON FUNCTION public.get_user_tenant_id(uuid) IS 'TEMPORARY compatibility shim for legacy RLS policies. Remove after migration 022 updates all policies.';