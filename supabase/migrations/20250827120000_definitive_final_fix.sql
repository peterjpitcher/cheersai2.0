-- =====================================================
-- DEFINITIVE FINAL FIX FOR ALL DATABASE ISSUES
-- This migration properly addresses ALL remaining issues
-- =====================================================

-- === PART 1: FIX SECURITY DEFINER VIEW (ERROR LEVEL) ===
-- Drop the security definer view as it's a security risk
DROP VIEW IF EXISTS index_usage_stats;

-- Recreate as a regular view (SECURITY INVOKER is default)
CREATE OR REPLACE VIEW index_usage_stats AS
SELECT 
    s.schemaname,
    s.relname as tablename,
    s.indexrelname as indexname,
    s.idx_scan as index_scans,
    s.idx_tup_read as tuples_read,
    s.idx_tup_fetch as tuples_fetched,
    pg_size_pretty(pg_relation_size(s.indexrelid)) as index_size,
    CASE 
        WHEN s.idx_scan = 0 THEN 'UNUSED'
        WHEN s.idx_scan < 10 THEN 'RARELY USED'
        WHEN s.idx_scan < 100 THEN 'OCCASIONALLY USED'
        ELSE 'FREQUENTLY USED'
    END as usage_category
FROM pg_stat_user_indexes s
WHERE s.schemaname = 'public'
ORDER BY s.idx_scan, pg_relation_size(s.indexrelid) DESC;

-- Grant access
GRANT SELECT ON index_usage_stats TO authenticated;

-- === PART 2: FIX ALL RLS POLICIES WITH PROPER AUTH CACHING ===
-- The correct pattern is (select auth.jwt())->>'email' NOT (SELECT (auth.jwt()->>'email'))

-- Fix tenants table policies
DROP POLICY IF EXISTS "tenants_select" ON tenants;
DROP POLICY IF EXISTS "tenants_insert" ON tenants;
DROP POLICY IF EXISTS "tenants_update" ON tenants;
DROP POLICY IF EXISTS "tenants_delete" ON tenants;

CREATE POLICY "tenants_select"
    ON tenants FOR SELECT
    USING (
        id = get_auth_tenant_id()
        OR id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid()))
        OR (select auth.jwt())->>'email' = 'pipitcher@gmail.com'
    );

CREATE POLICY "tenants_insert"
    ON tenants FOR INSERT
    WITH CHECK (
        id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid()))
        OR (select auth.jwt())->>'email' = 'pipitcher@gmail.com'
    );

CREATE POLICY "tenants_update"
    ON tenants FOR UPDATE
    USING (
        id = get_auth_tenant_id()
        OR id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid()))
        OR (select auth.jwt())->>'email' = 'pipitcher@gmail.com'
    )
    WITH CHECK (
        id = get_auth_tenant_id()
        OR id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid()))
        OR (select auth.jwt())->>'email' = 'pipitcher@gmail.com'
    );

CREATE POLICY "tenants_delete"
    ON tenants FOR DELETE
    USING (
        id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid()) AND role = 'owner')
        OR (select auth.jwt())->>'email' = 'pipitcher@gmail.com'
    );

-- Fix users table policies
DROP POLICY IF EXISTS "users_select" ON users;
DROP POLICY IF EXISTS "users_update" ON users;

CREATE POLICY "users_select"
    ON users FOR SELECT
    USING (
        id = (select auth.uid())
        OR tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid()))
        OR (select auth.jwt())->>'email' = 'pipitcher@gmail.com'
    );

CREATE POLICY "users_update"
    ON users FOR UPDATE
    USING (
        id = (select auth.uid())
        OR (select auth.jwt())->>'email' = 'pipitcher@gmail.com'
    )
    WITH CHECK (
        id = (select auth.uid())
        OR (select auth.jwt())->>'email' = 'pipitcher@gmail.com'
    );

-- Fix global_content_settings policies
DROP POLICY IF EXISTS "global_content_settings_superadmin" ON global_content_settings;
DROP POLICY IF EXISTS "Anyone can read global settings" ON global_content_settings;
DROP POLICY IF EXISTS "Only superadmins can modify global settings" ON global_content_settings;

-- Single policy for superadmin access
CREATE POLICY "global_content_settings_superadmin"
    ON global_content_settings FOR ALL
    USING (
        (select auth.jwt())->>'email' = 'pipitcher@gmail.com'
    )
    WITH CHECK (
        (select auth.jwt())->>'email' = 'pipitcher@gmail.com'
    );

-- Separate read policy for all authenticated users
CREATE POLICY "global_content_settings_read"
    ON global_content_settings FOR SELECT
    USING (true); -- Anyone can read

-- === PART 3: FIX DUPLICATE POLICIES ON CAMPAIGNS ===
-- Remove old policies and keep only the consolidated one
DROP POLICY IF EXISTS "Tenant members can manage campaigns or superadmin" ON campaigns;
DROP POLICY IF EXISTS "campaigns_all" ON campaigns;

CREATE POLICY "campaigns_tenant_isolation"
    ON campaigns FOR ALL
    USING (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid()))
    )
    WITH CHECK (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid()))
    );

-- === PART 4: FIX PUBLISHING_QUEUE DUPLICATE POLICIES ===
DROP POLICY IF EXISTS "publishing_queue_all" ON publishing_queue;
DROP POLICY IF EXISTS "publishing_queue_tenant_isolation" ON publishing_queue;

-- Single consolidated policy
CREATE POLICY "publishing_queue_tenant_isolation"
    ON publishing_queue FOR ALL
    USING (
        campaign_post_id IN (
            SELECT id FROM campaign_posts 
            WHERE tenant_id = get_auth_tenant_id()
               OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid()))
        )
    )
    WITH CHECK (
        campaign_post_id IN (
            SELECT id FROM campaign_posts 
            WHERE tenant_id = get_auth_tenant_id()
               OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid()))
        )
    );

-- === PART 5: FIX USER_TENANTS MULTIPLE SELECT POLICIES ===
DROP POLICY IF EXISTS "user_tenants_view_own" ON user_tenants;
DROP POLICY IF EXISTS "user_tenants_view_same_tenant" ON user_tenants;
DROP POLICY IF EXISTS "user_tenants_insert_own" ON user_tenants;
DROP POLICY IF EXISTS "user_tenants_update_own" ON user_tenants;
DROP POLICY IF EXISTS "user_tenants_delete_own" ON user_tenants;

-- Consolidated select policy
CREATE POLICY "user_tenants_select"
    ON user_tenants FOR SELECT
    USING (
        user_id = (select auth.uid())
        OR tenant_id = get_auth_tenant_id()
    );

-- Other operations
CREATE POLICY "user_tenants_insert"
    ON user_tenants FOR INSERT
    WITH CHECK (user_id = (select auth.uid()));

CREATE POLICY "user_tenants_update"
    ON user_tenants FOR UPDATE
    USING (user_id = (select auth.uid()))
    WITH CHECK (user_id = (select auth.uid()));

CREATE POLICY "user_tenants_delete"
    ON user_tenants FOR DELETE
    USING (user_id = (select auth.uid()));

-- === PART 6: FIX FUNCTION SEARCH PATH ===
-- Already fixed, but ensure it exists
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

-- === PART 7: CLEANUP UNUSED INDEXES (OPTIONAL) ===
-- These indexes were just created and may not show usage yet
-- We'll keep foreign key indexes but remove truly redundant ones

-- Remove indexes that are redundant with primary keys or unique constraints
-- (Primary keys and unique constraints automatically create indexes)

-- Keep all foreign key indexes as they're needed for performance
-- The "unused" status may just be because the app hasn't run queries yet

-- === PART 8: VERIFY FINAL STATE ===
-- Check for any remaining duplicate policies
DO $$
DECLARE
    rec RECORD;
    policy_count INTEGER;
BEGIN
    FOR rec IN
        SELECT 
            tablename,
            COUNT(*) as count,
            string_agg(policyname, ', ') as policies
        FROM pg_policies
        WHERE schemaname = 'public'
        GROUP BY tablename
        HAVING COUNT(*) > 5
    LOOP
        RAISE NOTICE 'Table % has % policies: %', rec.tablename, rec.count, rec.policies;
    END LOOP;
END $$;