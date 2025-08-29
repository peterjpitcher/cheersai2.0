-- =====================================================
-- EMERGENCY FIX FOR INFINITE RECURSION
-- Single migration to fix all policy issues
-- =====================================================

-- First, ensure we have the non-recursive function
CREATE OR REPLACE FUNCTION get_auth_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT tenant_id 
    FROM users 
    WHERE id = auth.uid()
    LIMIT 1
$$;

-- ===== FIX USERS TABLE =====
-- Drop ALL existing policies first
DO $$
DECLARE
    r RECORD;
BEGIN
    -- Drop all existing policies on users table
    FOR r IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users')
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON users', r.policyname);
    END LOOP;
END $$;

-- Create clean users policies
CREATE POLICY "users_select_fixed"
    ON users FOR SELECT
    USING (
        id = auth.uid()
        OR tenant_id = get_auth_tenant_id()
        OR (auth.jwt()->>'email') = 'pipitcher@gmail.com'
    );

CREATE POLICY "users_insert_fixed"
    ON users FOR INSERT
    WITH CHECK (
        id = auth.uid()
    );

CREATE POLICY "users_update_fixed"
    ON users FOR UPDATE
    USING (
        id = auth.uid()
        OR (auth.jwt()->>'email') = 'pipitcher@gmail.com'
    );

CREATE POLICY "users_delete_fixed"
    ON users FOR DELETE
    USING (
        (auth.jwt()->>'email') = 'pipitcher@gmail.com'
    );

-- ===== FIX CAMPAIGNS TABLE =====
DO $$
DECLARE
    r RECORD;
BEGIN
    -- Drop all existing policies on campaigns table
    FOR r IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'campaigns')
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON campaigns', r.policyname);
    END LOOP;
END $$;

-- Create clean campaigns policies
CREATE POLICY "campaigns_select_fixed"
    ON campaigns FOR SELECT
    USING (
        tenant_id = get_auth_tenant_id()
        OR (auth.jwt()->>'email') = 'pipitcher@gmail.com'
    );

CREATE POLICY "campaigns_insert_fixed"
    ON campaigns FOR INSERT
    WITH CHECK (
        tenant_id = get_auth_tenant_id()
        OR (auth.jwt()->>'email') = 'pipitcher@gmail.com'
    );

CREATE POLICY "campaigns_update_fixed"
    ON campaigns FOR UPDATE
    USING (
        tenant_id = get_auth_tenant_id()
        OR (auth.jwt()->>'email') = 'pipitcher@gmail.com'
    );

CREATE POLICY "campaigns_delete_fixed"
    ON campaigns FOR DELETE
    USING (
        tenant_id = get_auth_tenant_id()
        OR (auth.jwt()->>'email') = 'pipitcher@gmail.com'
    );

-- ===== FIX TENANTS TABLE =====
DO $$
DECLARE
    r RECORD;
BEGIN
    -- Drop all existing policies on tenants table
    FOR r IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tenants')
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON tenants', r.policyname);
    END LOOP;
END $$;

-- Create clean tenants policies
CREATE POLICY "tenants_select_fixed"
    ON tenants FOR SELECT
    USING (
        id = get_auth_tenant_id()
        OR (auth.jwt()->>'email') = 'pipitcher@gmail.com'
    );

CREATE POLICY "tenants_insert_fixed"
    ON tenants FOR INSERT
    WITH CHECK (
        auth.uid() IS NOT NULL
    );

CREATE POLICY "tenants_update_fixed"
    ON tenants FOR UPDATE
    USING (
        id = get_auth_tenant_id()
        OR (auth.jwt()->>'email') = 'pipitcher@gmail.com'
    );

CREATE POLICY "tenants_delete_fixed"
    ON tenants FOR DELETE
    USING (
        (auth.jwt()->>'email') = 'pipitcher@gmail.com'
    );

-- ===== FIX USER_TENANTS TABLE =====
DO $$
DECLARE
    r RECORD;
BEGIN
    -- Drop all existing policies on user_tenants table
    FOR r IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_tenants')
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON user_tenants', r.policyname);
    END LOOP;
END $$;

-- Create clean user_tenants policies
CREATE POLICY "user_tenants_select_fixed"
    ON user_tenants FOR SELECT
    USING (
        user_id = auth.uid()
        OR tenant_id = get_auth_tenant_id()
        OR (auth.jwt()->>'email') = 'pipitcher@gmail.com'
    );

CREATE POLICY "user_tenants_insert_fixed"
    ON user_tenants FOR INSERT
    WITH CHECK (
        user_id = auth.uid()
        OR (auth.jwt()->>'email') = 'pipitcher@gmail.com'
    );

CREATE POLICY "user_tenants_update_fixed"
    ON user_tenants FOR UPDATE
    USING (
        user_id = auth.uid()
        OR (auth.jwt()->>'email') = 'pipitcher@gmail.com'
    );

CREATE POLICY "user_tenants_delete_fixed"
    ON user_tenants FOR DELETE
    USING (
        user_id = auth.uid()
        OR (auth.jwt()->>'email') = 'pipitcher@gmail.com'
    );

-- Verify everything is fixed
DO $$
DECLARE
    rec RECORD;
BEGIN
    RAISE NOTICE '=== FINAL POLICY STATE ===';
    
    FOR rec IN
        SELECT 
            tablename,
            COUNT(*) as policy_count,
            string_agg(policyname, ', ') as policies
        FROM pg_policies
        WHERE schemaname = 'public'
            AND tablename IN ('users', 'tenants', 'campaigns', 'user_tenants')
        GROUP BY tablename
        ORDER BY tablename
    LOOP
        RAISE NOTICE 'Table %: % policies (%)', rec.tablename, rec.policy_count, rec.policies;
    END LOOP;
END $$;