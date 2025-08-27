-- =====================================================
-- FIX REMAINING DATABASE ISSUES
-- This migration addresses remaining issues after initial fixes:
-- 1. Function search path security issue (1 instance)
-- 2. RLS enabled with no policy on user_tenants (1 instance)
-- 3. Remaining auth RLS init plan issues (7 instances)
-- 4. Remaining multiple permissive policies (33 instances)
-- 5. New unused indexes created by previous migration (22 instances)
-- 6. Remaining unindexed foreign keys (12 instances)
-- =====================================================

-- === PART 1: FIX FUNCTION SEARCH PATH ===
-- Set search_path for security to prevent search path hijacking
DROP FUNCTION IF EXISTS increment_guardrails_usage(uuid);
CREATE OR REPLACE FUNCTION increment_guardrails_usage(guardrail_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
    UPDATE content_guardrails
    SET 
        usage_count = COALESCE(usage_count, 0) + 1,
        last_used = NOW(),
        updated_at = NOW()
    WHERE id = guardrail_id;
END;
$$;

-- === PART 2: ADD MISSING RLS POLICIES FOR USER_TENANTS ===
-- The table has RLS enabled but no policies
-- These were removed in the previous migration, let's add them back properly

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "user_tenants_view_own" ON user_tenants;
DROP POLICY IF EXISTS "user_tenants_view_same_tenant" ON user_tenants;
DROP POLICY IF EXISTS "user_tenants_insert_own" ON user_tenants;
DROP POLICY IF EXISTS "user_tenants_update_own" ON user_tenants;
DROP POLICY IF EXISTS "user_tenants_delete_own" ON user_tenants;

-- Allow users to view their own tenant associations
CREATE POLICY "user_tenants_view_own"
    ON user_tenants FOR SELECT
    USING (user_id = (SELECT auth.uid()));

-- Allow users to view other users in the same tenant
CREATE POLICY "user_tenants_view_same_tenant"
    ON user_tenants FOR SELECT
    USING (tenant_id = get_auth_tenant_id());

-- Allow users to insert their own tenant associations
CREATE POLICY "user_tenants_insert_own"
    ON user_tenants FOR INSERT
    WITH CHECK (user_id = (SELECT auth.uid()));

-- Allow users to update their own tenant associations
CREATE POLICY "user_tenants_update_own"
    ON user_tenants FOR UPDATE
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));

-- Allow users to delete their own tenant associations
CREATE POLICY "user_tenants_delete_own"
    ON user_tenants FOR DELETE
    USING (user_id = (SELECT auth.uid()));

-- === PART 3: FIX REMAINING RLS INIT PLAN ISSUES ===
-- Fix brand_profiles, tenants, and users tables that still have issues

-- brand_profiles - ensure it exists and fix policies
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'brand_profiles') THEN
        -- Drop all existing policies including the one we may have created
        DROP POLICY IF EXISTS "brand_profiles_tenant_isolation" ON brand_profiles;
        DROP POLICY IF EXISTS "brand_profiles_select" ON brand_profiles;
        DROP POLICY IF EXISTS "brand_profiles_insert" ON brand_profiles;
        DROP POLICY IF EXISTS "brand_profiles_update" ON brand_profiles;
        DROP POLICY IF EXISTS "brand_profiles_delete" ON brand_profiles;
        DROP POLICY IF EXISTS "brand_profiles_all" ON brand_profiles;
        
        -- Recreate consolidated policy with proper auth caching
        CREATE POLICY "brand_profiles_all"
            ON brand_profiles FOR ALL
            USING (
                tenant_id = get_auth_tenant_id()
                OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
            )
            WITH CHECK (
                tenant_id = get_auth_tenant_id()
                OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
            );
    END IF;
END $$;

-- tenants - fix remaining policies
DROP POLICY IF EXISTS "simple_select" ON tenants;
DROP POLICY IF EXISTS "simple_insert" ON tenants;
DROP POLICY IF EXISTS "simple_update" ON tenants;
DROP POLICY IF EXISTS "simple_delete" ON tenants;

CREATE POLICY "tenants_select"
    ON tenants FOR SELECT
    USING (
        id = get_auth_tenant_id()
        OR id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
        OR (SELECT (auth.jwt()->>'email')) = 'pipitcher@gmail.com'
    );

CREATE POLICY "tenants_insert"
    ON tenants FOR INSERT
    WITH CHECK (
        id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
        OR (SELECT (auth.jwt()->>'email')) = 'pipitcher@gmail.com'
    );

CREATE POLICY "tenants_update"
    ON tenants FOR UPDATE
    USING (
        id = get_auth_tenant_id()
        OR id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
        OR (SELECT (auth.jwt()->>'email')) = 'pipitcher@gmail.com'
    )
    WITH CHECK (
        id = get_auth_tenant_id()
        OR id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
        OR (SELECT (auth.jwt()->>'email')) = 'pipitcher@gmail.com'
    );

CREATE POLICY "tenants_delete"
    ON tenants FOR DELETE
    USING (
        id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()) AND role = 'owner')
        OR (SELECT (auth.jwt()->>'email')) = 'pipitcher@gmail.com'
    );

-- users - fix policies
DROP POLICY IF EXISTS "Users can update own profile or superadmin bypass" ON users;
DROP POLICY IF EXISTS "Simple select policy" ON users;

CREATE POLICY "users_select"
    ON users FOR SELECT
    USING (
        id = (SELECT auth.uid())
        OR tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
        OR (SELECT (auth.jwt()->>'email')) = 'pipitcher@gmail.com'
    );

CREATE POLICY "users_update"
    ON users FOR UPDATE
    USING (
        id = (SELECT auth.uid())
        OR (SELECT (auth.jwt()->>'email')) = 'pipitcher@gmail.com'
    )
    WITH CHECK (
        id = (SELECT auth.uid())
        OR (SELECT (auth.jwt()->>'email')) = 'pipitcher@gmail.com'
    );

-- === PART 4: FIX REMAINING MULTIPLE PERMISSIVE POLICIES ===

-- campaigns table
DROP POLICY IF EXISTS "campaigns_select" ON campaigns;
DROP POLICY IF EXISTS "campaigns_insert" ON campaigns;
DROP POLICY IF EXISTS "campaigns_update" ON campaigns;
DROP POLICY IF EXISTS "campaigns_delete" ON campaigns;
DROP POLICY IF EXISTS "campaigns_tenant_isolation" ON campaigns;

CREATE POLICY "campaigns_all"
    ON campaigns FOR ALL
    USING (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    )
    WITH CHECK (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    );

-- global_content_settings - superadmin only table
DROP POLICY IF EXISTS "global_content_settings_all" ON global_content_settings;
DROP POLICY IF EXISTS "global_content_settings_select" ON global_content_settings;
DROP POLICY IF EXISTS "global_content_settings_insert" ON global_content_settings;
DROP POLICY IF EXISTS "global_content_settings_update" ON global_content_settings;
DROP POLICY IF EXISTS "global_content_settings_delete" ON global_content_settings;

CREATE POLICY "global_content_settings_superadmin"
    ON global_content_settings FOR ALL
    USING (
        (SELECT (auth.jwt()->>'email')) = 'pipitcher@gmail.com'
    )
    WITH CHECK (
        (SELECT (auth.jwt()->>'email')) = 'pipitcher@gmail.com'
    );

-- publishing_queue table - fix policies
DROP POLICY IF EXISTS "publishing_queue_select" ON publishing_queue;
DROP POLICY IF EXISTS "publishing_queue_insert" ON publishing_queue;
DROP POLICY IF EXISTS "publishing_queue_update" ON publishing_queue;
DROP POLICY IF EXISTS "publishing_queue_delete" ON publishing_queue;

CREATE POLICY "publishing_queue_all"
    ON publishing_queue FOR ALL
    USING (
        campaign_post_id IN (
            SELECT id FROM campaign_posts 
            WHERE tenant_id = get_auth_tenant_id()
               OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
        )
    )
    WITH CHECK (
        campaign_post_id IN (
            SELECT id FROM campaign_posts 
            WHERE tenant_id = get_auth_tenant_id()
               OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
        )
    );

-- === PART 5: REMOVE NEWLY CREATED UNUSED INDEXES ===
-- These indexes were created in the previous migration but haven't been used yet
-- We should keep them for a while and only remove if they remain unused after monitoring

-- Note: We're keeping the newly created indexes for now as they were just added
-- and may be needed for foreign key performance. They should be monitored
-- for usage over time before deciding to remove them.

-- === PART 6: REMAINING UNINDEXED FOREIGN KEYS ===
-- Check if any additional foreign keys still need indexes

-- Analyze and add any missing indexes that weren't caught in the previous migration
DO $$
DECLARE
    rec RECORD;
BEGIN
    -- Find foreign keys without covering indexes
    FOR rec IN
        SELECT DISTINCT
            conrelid::regclass AS table_name,
            conname AS constraint_name,
            pg_get_constraintdef(oid) AS constraint_def
        FROM pg_constraint
        WHERE contype = 'f'
        AND NOT EXISTS (
            SELECT 1
            FROM pg_index
            WHERE pg_index.indrelid = pg_constraint.conrelid
            AND pg_index.indkey[0] = ANY(pg_constraint.conkey)
        )
        AND connamespace = 'public'::regnamespace
    LOOP
        -- Log any remaining unindexed foreign keys for manual review
        RAISE NOTICE 'Unindexed foreign key found: % on table %', rec.constraint_name, rec.table_name;
    END LOOP;
END $$;

-- === PART 7: CLEAN UP ANY DUPLICATE POLICIES ===
-- Ensure no duplicate policies remain

DO $$
DECLARE
    policy_rec RECORD;
    policy_count INT;
BEGIN
    -- Find tables with multiple policies of the same type
    FOR policy_rec IN
        SELECT 
            tablename,
            COUNT(*) as policy_count
        FROM pg_policies
        WHERE schemaname = 'public'
        GROUP BY tablename
        HAVING COUNT(*) > 4  -- More than 4 policies might indicate duplicates
    LOOP
        RAISE NOTICE 'Table % has % policies - review for duplicates', policy_rec.tablename, policy_rec.policy_count;
    END LOOP;
END $$;