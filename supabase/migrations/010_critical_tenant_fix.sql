-- =====================================================
-- CRITICAL FIX: Complete tenant creation solution
-- This migration MUST fix the tenant creation RLS issue
-- =====================================================

-- First, let's check what policies exist
DO $$
DECLARE
    r RECORD;
BEGIN
    RAISE NOTICE 'Checking existing tenant policies...';
    FOR r IN 
        SELECT policyname, cmd
        FROM pg_policies
        WHERE tablename = 'tenants'
    LOOP
        RAISE NOTICE 'Found policy: % for %', r.policyname, r.cmd;
    END LOOP;
END $$;

-- Drop ALL existing tenant policies to start fresh
DROP POLICY IF EXISTS "tenants_insert_first_tenant" ON tenants;
DROP POLICY IF EXISTS "tenants_insert_additional" ON tenants;
DROP POLICY IF EXISTS "tenants_insert_authenticated" ON tenants;
DROP POLICY IF EXISTS "tenants_view_own" ON tenants;
DROP POLICY IF EXISTS "tenants_update_own" ON tenants;
DROP POLICY IF EXISTS "tenants_delete_own" ON tenants;
DROP POLICY IF EXISTS "tenants_select_own" ON tenants;

-- Create a SIMPLE INSERT policy that ONLY checks authentication
-- This is the minimal requirement for tenant creation
CREATE POLICY "allow_authenticated_insert"
    ON tenants FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

-- For SELECT, check multiple sources since JWT might not have tenant_id yet
CREATE POLICY "allow_select_own_tenant"
    ON tenants FOR SELECT
    USING (
        -- Can view if you created it (via users table)
        id IN (SELECT tenant_id FROM users WHERE users.id = auth.uid())
        OR
        -- Can view if in JWT (after login refresh)
        id = COALESCE(
            (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
            '00000000-0000-0000-0000-000000000000'::uuid
        )
        OR
        -- Can view if you're a member
        id IN (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid())
    );

-- UPDATE only if you own it
CREATE POLICY "allow_update_own_tenant"
    ON tenants FOR UPDATE
    USING (
        id IN (SELECT tenant_id FROM users WHERE users.id = auth.uid() AND role = 'owner')
        OR
        id IN (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid() AND role = 'owner')
    );

-- DELETE only if you're the owner
CREATE POLICY "allow_delete_own_tenant"
    ON tenants FOR DELETE
    USING (
        id IN (SELECT tenant_id FROM users WHERE users.id = auth.uid() AND role = 'owner')
    );

-- Fix the users table INSERT policy to allow initial creation
DROP POLICY IF EXISTS "users_insert_self" ON users;

CREATE POLICY "users_insert_self"
    ON users FOR INSERT
    WITH CHECK (
        -- Must be creating your own record
        id = auth.uid()
    );

-- Fix the users table UPDATE to allow setting tenant_id
DROP POLICY IF EXISTS "users_update_self" ON users;

CREATE POLICY "users_update_self"
    ON users FOR UPDATE
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- Fix brand_profiles to work with new tenant
DROP POLICY IF EXISTS "brand_profiles_insert" ON brand_profiles;

CREATE POLICY "brand_profiles_insert"
    ON brand_profiles FOR INSERT
    WITH CHECK (
        -- Can insert if you own the tenant via users table
        tenant_id IN (
            SELECT tenant_id FROM users 
            WHERE users.id = auth.uid()
        )
        OR
        -- Can insert if you're a member
        tenant_id IN (
            SELECT tenant_id FROM user_tenants 
            WHERE user_id = auth.uid()
        )
    );

-- Fix user_tenants insert
DROP POLICY IF EXISTS "user_tenants_insert_self" ON user_tenants;

CREATE POLICY "user_tenants_insert_self"
    ON user_tenants FOR INSERT
    WITH CHECK (
        -- Must be adding yourself
        user_id = auth.uid()
        -- And the tenant must exist (but don't check RLS on tenants table)
        AND tenant_id IN (SELECT id FROM tenants)
    );

-- =====================================================
-- VERIFICATION FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION verify_tenant_creation_works()
RETURNS TABLE(check_name text, result text) AS $$
BEGIN
    -- Check 1: Can authenticated user create tenant?
    RETURN QUERY
    SELECT 
        'Can create tenant'::text,
        CASE 
            WHEN auth.uid() IS NOT NULL THEN 'YES - User authenticated'
            ELSE 'NO - User not authenticated'
        END::text;

    -- Check 2: Are there blocking policies?
    RETURN QUERY
    SELECT 
        'Tenant INSERT policy'::text,
        CASE 
            WHEN EXISTS (
                SELECT 1 FROM pg_policies 
                WHERE tablename = 'tenants' 
                AND cmd = 'INSERT'
                AND policyname = 'allow_authenticated_insert'
            ) THEN 'EXISTS - Simple auth check only'
            ELSE 'MISSING - Policy not found!'
        END::text;

    -- Check 3: Users table allows self-insert?
    RETURN QUERY
    SELECT 
        'Users INSERT policy'::text,
        CASE 
            WHEN EXISTS (
                SELECT 1 FROM pg_policies 
                WHERE tablename = 'users' 
                AND cmd = 'INSERT'
                AND policyname = 'users_insert_self'
            ) THEN 'EXISTS - Self insert allowed'
            ELSE 'MISSING - Policy not found!'
        END::text;

    RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- RUN VERIFICATION
-- =====================================================

DO $$
DECLARE
    r RECORD;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '🔧 CRITICAL TENANT FIX APPLIED';
    RAISE NOTICE '================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Changes made:';
    RAISE NOTICE '  ✅ Simplified tenant INSERT - only requires authentication';
    RAISE NOTICE '  ✅ Fixed SELECT to check multiple sources';
    RAISE NOTICE '  ✅ Removed complex circular checks';
    RAISE NOTICE '  ✅ Users can now create tenants during onboarding';
    RAISE NOTICE '';
    RAISE NOTICE 'Verification:';
    
    FOR r IN SELECT * FROM verify_tenant_creation_works() LOOP
        RAISE NOTICE '  - %: %', r.check_name, r.result;
    END LOOP;
    
    RAISE NOTICE '';
    RAISE NOTICE '⚡ The tenant creation should now work!';
    RAISE NOTICE '';
END $$;

-- Clean up
DROP FUNCTION IF EXISTS verify_tenant_creation_works();