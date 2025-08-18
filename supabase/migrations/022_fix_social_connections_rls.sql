-- Fix social_connections RLS policies to use the current auth function
-- This migration updates policies that were missed in migration 008

-- 1) Log current policies for audit before dropping
DO $$
BEGIN
  RAISE NOTICE 'Updating social_connections RLS policies from get_user_tenant_id() to get_auth_tenant_id()';
END $$;

-- 2) Drop old policies that reference the legacy function
DROP POLICY IF EXISTS "Users can view their tenant's social connections" ON public.social_connections;
DROP POLICY IF EXISTS "Users can create social connections for their tenant" ON public.social_connections;
DROP POLICY IF EXISTS "Users can update their tenant's social connections" ON public.social_connections;
DROP POLICY IF EXISTS "Users can delete their tenant's social connections" ON public.social_connections;

-- 3) Recreate policies using the current function get_auth_tenant_id()
--    These policies match the pattern established in migration 008 for other tables

-- SELECT policy: users can view connections for their tenant
CREATE POLICY "Users can view their tenant's social connections"
ON public.social_connections
FOR SELECT
USING (
  tenant_id = public.get_auth_tenant_id()
  OR EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid() 
    AND u.tenant_id = social_connections.tenant_id
  )
);

-- INSERT policy: users can create connections for their tenant
CREATE POLICY "Users can create social connections"
ON public.social_connections
FOR INSERT
WITH CHECK (
  tenant_id = public.get_auth_tenant_id()
  OR EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid() 
    AND u.tenant_id = social_connections.tenant_id
  )
);

-- UPDATE policy: users can update connections for their tenant
CREATE POLICY "Users can update their tenant's social connections"
ON public.social_connections
FOR UPDATE
USING (
  tenant_id = public.get_auth_tenant_id()
  OR EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid() 
    AND u.tenant_id = social_connections.tenant_id
  )
)
WITH CHECK (
  tenant_id = public.get_auth_tenant_id()
  OR EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid() 
    AND u.tenant_id = social_connections.tenant_id
  )
);

-- DELETE policy: users can delete connections for their tenant
CREATE POLICY "Users can delete their tenant's social connections"
ON public.social_connections
FOR DELETE
USING (
  tenant_id = public.get_auth_tenant_id()
  OR EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid() 
    AND u.tenant_id = social_connections.tenant_id
  )
);

-- 4) Drop the compatibility shim if it exists (from migration 021)
-- We can now safely remove it since policies no longer reference it
DROP FUNCTION IF EXISTS public.get_user_tenant_id(uuid);

-- 5) Also update publishing_history and publishing_queue policies that were missed
-- These tables also reference social connections and may have the same issue

-- Drop and recreate publishing_history policies
DROP POLICY IF EXISTS "Users can view their publishing history" ON public.publishing_history;
DROP POLICY IF EXISTS "Users can create publishing history" ON public.publishing_history;

CREATE POLICY "Users can view their publishing history"
ON public.publishing_history
FOR SELECT
USING (
  EXISTS (
    SELECT 1 
    FROM public.campaign_posts cp
    JOIN public.campaigns c ON cp.campaign_id = c.id
    WHERE cp.id = publishing_history.campaign_post_id
    AND c.tenant_id = public.get_auth_tenant_id()
  )
  OR EXISTS (
    SELECT 1 
    FROM public.campaign_posts cp
    JOIN public.campaigns c ON cp.campaign_id = c.id
    JOIN public.users u ON u.tenant_id = c.tenant_id
    WHERE cp.id = publishing_history.campaign_post_id
    AND u.id = auth.uid()
  )
);

CREATE POLICY "Users can create publishing history"
ON public.publishing_history
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 
    FROM public.campaign_posts cp
    JOIN public.campaigns c ON cp.campaign_id = c.id
    WHERE cp.id = campaign_post_id
    AND c.tenant_id = public.get_auth_tenant_id()
  )
  OR EXISTS (
    SELECT 1 
    FROM public.campaign_posts cp
    JOIN public.campaigns c ON cp.campaign_id = c.id
    JOIN public.users u ON u.tenant_id = c.tenant_id
    WHERE cp.id = campaign_post_id
    AND u.id = auth.uid()
  )
);

-- Drop and recreate publishing_queue policies
DROP POLICY IF EXISTS "Users can view their publishing queue" ON public.publishing_queue;
DROP POLICY IF EXISTS "Users can manage their publishing queue" ON public.publishing_queue;

CREATE POLICY "Users can view their publishing queue"
ON public.publishing_queue
FOR SELECT
USING (
  EXISTS (
    SELECT 1 
    FROM public.social_connections sc
    WHERE sc.id = publishing_queue.social_connection_id
    AND sc.tenant_id = public.get_auth_tenant_id()
  )
  OR EXISTS (
    SELECT 1 
    FROM public.social_connections sc
    JOIN public.users u ON u.tenant_id = sc.tenant_id
    WHERE sc.id = publishing_queue.social_connection_id
    AND u.id = auth.uid()
  )
);

CREATE POLICY "Users can manage their publishing queue"
ON public.publishing_queue
FOR ALL
USING (
  EXISTS (
    SELECT 1 
    FROM public.social_connections sc
    WHERE sc.id = social_connection_id
    AND sc.tenant_id = public.get_auth_tenant_id()
  )
  OR EXISTS (
    SELECT 1 
    FROM public.social_connections sc
    JOIN public.users u ON u.tenant_id = sc.tenant_id
    WHERE sc.id = social_connection_id
    AND u.id = auth.uid()
  )
);

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'RLS policies updated successfully. All policies now use get_auth_tenant_id()';
END $$;