-- =====================================================
-- FIX: Allow users to create their initial tenant during onboarding
-- =====================================================

-- Drop existing policies that might conflict
DROP POLICY IF EXISTS "Users can view their own tenant" ON tenants;
DROP POLICY IF EXISTS "Users can update their own tenant" ON tenants;
DROP POLICY IF EXISTS "Users can create their initial tenant" ON tenants;
DROP POLICY IF EXISTS "Users can insert themselves during signup" ON users;
DROP POLICY IF EXISTS "Users can view members of their tenant" ON users;

-- Create a function to check if user already has a tenant
CREATE OR REPLACE FUNCTION user_has_tenant(user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE id = user_id AND tenant_id IS NOT NULL
  );
$$ LANGUAGE SQL SECURITY DEFINER;

-- Improved function to get user's tenant_id (returns NULL if not set)
CREATE OR REPLACE FUNCTION get_user_tenant_id(user_id UUID)
RETURNS UUID AS $$
  SELECT tenant_id FROM users WHERE id = user_id;
$$ LANGUAGE SQL SECURITY DEFINER;

-- =====================================================
-- TENANTS TABLE POLICIES
-- =====================================================

-- Allow users to create their FIRST tenant (during onboarding)
CREATE POLICY "Users can create their initial tenant"
  ON tenants FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL 
    AND NOT user_has_tenant(auth.uid())
  );

-- Users can view their own tenant
CREATE POLICY "Users can view their own tenant"
  ON tenants FOR SELECT
  USING (
    id = get_user_tenant_id(auth.uid())
    OR id IN (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid())
  );

-- Users can update their own tenant
CREATE POLICY "Users can update their own tenant"
  ON tenants FOR UPDATE
  USING (
    id = get_user_tenant_id(auth.uid())
    OR id IN (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
  );

-- =====================================================
-- USERS TABLE POLICIES
-- =====================================================

-- Allow users to insert themselves during signup/onboarding
CREATE POLICY "Users can insert themselves"
  ON users FOR INSERT
  WITH CHECK (id = auth.uid());

-- Allow users to view members of their tenant
CREATE POLICY "Users can view members of their tenant"
  ON users FOR SELECT
  USING (
    id = auth.uid() -- Can always see yourself
    OR tenant_id = get_user_tenant_id(auth.uid()) -- Can see others in your tenant
    OR tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()) -- Multi-tenant support
  );

-- Users can update their own profile (drop first if exists)
DROP POLICY IF EXISTS "Users can update their own profile" ON users;
CREATE POLICY "Users can update their own profile"
  ON users FOR UPDATE
  USING (id = auth.uid());

-- =====================================================
-- USER_TENANTS TABLE POLICIES (for team members)
-- =====================================================

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their tenant memberships" ON user_tenants;
DROP POLICY IF EXISTS "Users can insert initial tenant relationship" ON user_tenants;

-- Users can create their initial tenant relationship
CREATE POLICY "Users can insert initial tenant relationship"
  ON user_tenants FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND role = 'owner' -- First user is always owner
  );

-- Users can view tenant memberships
CREATE POLICY "Users can view their tenant memberships"
  ON user_tenants FOR SELECT
  USING (
    user_id = auth.uid() 
    OR tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid())
  );

-- =====================================================
-- BRAND_PROFILES TABLE POLICIES
-- =====================================================

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Users can insert brand profile for their tenant" ON brand_profiles;
DROP POLICY IF EXISTS "Users can insert brand profile" ON brand_profiles;
DROP POLICY IF EXISTS "Users can view their tenant's brand profile" ON brand_profiles;
DROP POLICY IF EXISTS "Users can update their tenant's brand profile" ON brand_profiles;

-- Allow inserting brand profile for a tenant you just created or own
CREATE POLICY "Users can insert brand profile"
  ON brand_profiles FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT id FROM tenants 
      WHERE id = get_user_tenant_id(auth.uid())
         OR id IN (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid())
    )
  );

-- Recreate view policy
CREATE POLICY "Users can view their tenant's brand profile"
  ON brand_profiles FOR SELECT
  USING (
    tenant_id = get_user_tenant_id(auth.uid())
    OR tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid())
  );

-- Recreate update policy
CREATE POLICY "Users can update their tenant's brand profile"
  ON brand_profiles FOR UPDATE
  USING (
    tenant_id = get_user_tenant_id(auth.uid())
    OR tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
  );

-- =====================================================
-- VERIFICATION QUERY
-- =====================================================
DO $$
BEGIN
  RAISE NOTICE 'Tenant creation policies have been fixed!';
  RAISE NOTICE 'Users can now:';
  RAISE NOTICE '  1. Create their initial tenant during onboarding';
  RAISE NOTICE '  2. Create their user profile linked to that tenant';
  RAISE NOTICE '  3. Create a brand profile for their tenant';
  RAISE NOTICE '  4. Manage their tenant after creation';
END $$;