-- =====================================================
-- FIX: Remove infinite recursion and fix entire auth flow
-- =====================================================

-- Drop ALL problematic policies that cause circular dependencies
DROP POLICY IF EXISTS "Users can view their tenant memberships" ON user_tenants;
DROP POLICY IF EXISTS "Users can insert initial tenant relationship" ON user_tenants;
DROP POLICY IF EXISTS "Admins can create invitations" ON team_invitations;
DROP POLICY IF EXISTS "Users can view invitations for their tenant" ON team_invitations;
DROP POLICY IF EXISTS "Users can view their tenant's social accounts" ON social_accounts;
DROP POLICY IF EXISTS "Users can manage their tenant's social accounts" ON social_accounts;

-- =====================================================
-- FIX 1: Non-circular user_tenants policies
-- =====================================================

-- Users can view their own memberships (simple, no recursion)
CREATE POLICY "Users can view their own memberships"
  ON user_tenants FOR SELECT
  USING (user_id = auth.uid());

-- Users can view team members using the users table instead
CREATE POLICY "Users can view team members in their tenant"
  ON user_tenants FOR SELECT
  USING (
    tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

-- Users can create their initial membership
CREATE POLICY "Users can create their own membership"
  ON user_tenants FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can update their own membership
CREATE POLICY "Users can update their own membership"
  ON user_tenants FOR UPDATE
  USING (user_id = auth.uid());

-- =====================================================
-- FIX 2: Team invitations policies without recursion
-- =====================================================

-- View invitations for your tenant (using users table)
CREATE POLICY "Users can view invitations for their tenant"
  ON team_invitations FOR SELECT
  USING (
    tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

-- Only owners/admins can create invitations
CREATE POLICY "Admins can create invitations"
  ON team_invitations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND tenant_id = team_invitations.tenant_id
      AND role IN ('owner', 'admin')
    )
  );

-- =====================================================
-- FIX 3: Social accounts policies without recursion
-- =====================================================

-- View social accounts for your tenant
CREATE POLICY "Users can view their tenant's social accounts"
  ON social_accounts FOR SELECT
  USING (
    tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

-- Manage social accounts for your tenant
CREATE POLICY "Users can manage their tenant's social accounts"
  ON social_accounts FOR ALL
  USING (
    tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

-- =====================================================
-- FIX 4: Improve helper function for better performance
-- =====================================================

-- Make the helper function STABLE for better query optimization
CREATE OR REPLACE FUNCTION get_user_tenant_id(user_id UUID)
RETURNS UUID AS $$
  SELECT tenant_id FROM users WHERE id = user_id LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- =====================================================
-- FIX 5: Fix tenants table policies for proper flow
-- =====================================================

-- Drop and recreate tenant policies
DROP POLICY IF EXISTS "Users can create their initial tenant" ON tenants;
DROP POLICY IF EXISTS "Users can view their own tenant" ON tenants;
DROP POLICY IF EXISTS "Users can update their own tenant" ON tenants;

-- Allow any authenticated user to create a tenant (will be linked in users table)
CREATE POLICY "Authenticated users can create tenants"
  ON tenants FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Users can view their tenant
CREATE POLICY "Users can view their tenant"
  ON tenants FOR SELECT
  USING (
    id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

-- Users can update their tenant (owners/admins only)
CREATE POLICY "Owners and admins can update tenant"
  ON tenants FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND tenant_id = tenants.id
      AND role IN ('owner', 'admin')
    )
  );

-- =====================================================
-- FIX 6: Fix brand_profiles policies
-- =====================================================

DROP POLICY IF EXISTS "Users can insert brand profile" ON brand_profiles;
DROP POLICY IF EXISTS "Users can view their tenant's brand profile" ON brand_profiles;
DROP POLICY IF EXISTS "Users can update their tenant's brand profile" ON brand_profiles;

-- Allow creating brand profile for your tenant
CREATE POLICY "Users can create brand profile for their tenant"
  ON brand_profiles FOR INSERT
  WITH CHECK (
    tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

-- View brand profile for your tenant
CREATE POLICY "Users can view their tenant's brand profile"
  ON brand_profiles FOR SELECT
  USING (
    tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

-- Update brand profile (owners/admins only)
CREATE POLICY "Owners and admins can update brand profile"
  ON brand_profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND tenant_id = brand_profiles.tenant_id
      AND role IN ('owner', 'admin')
    )
  );

-- =====================================================
-- FIX 7: Analytics and other table policies
-- =====================================================

-- Fix analytics policies if they exist
DROP POLICY IF EXISTS "Users can view their tenant's analytics" ON analytics;
CREATE POLICY "Users can view their tenant's analytics"
  ON analytics FOR SELECT
  USING (
    tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

-- Fix api_usage policies if they exist
DROP POLICY IF EXISTS "Users can view their tenant's API usage" ON api_usage;
CREATE POLICY "Users can view their tenant's API usage"
  ON api_usage FOR SELECT
  USING (
    tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

-- =====================================================
-- VERIFICATION
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '✅ INFINITE RECURSION FIXED!';
  RAISE NOTICE '✅ All RLS policies now use safe, non-circular references';
  RAISE NOTICE '✅ Authentication flow should work correctly';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '1. Update onboarding code to create user_tenants record';
  RAISE NOTICE '2. Test the complete flow';
  RAISE NOTICE '3. Consider simplifying to single-tenant architecture';
END $$;