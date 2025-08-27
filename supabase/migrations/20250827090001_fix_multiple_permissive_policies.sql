-- =====================================================
-- FIX MULTIPLE PERMISSIVE POLICIES
-- This migration consolidates multiple permissive policies
-- into single combined policies per operation type
-- =====================================================

-- Note: Having multiple permissive policies (where USING clause uses OR logic) 
-- can lead to performance issues. We'll consolidate them into single policies
-- that handle all access patterns.

-- === CAMPAIGNS TABLE ===
-- Drop all existing policies first
DROP POLICY IF EXISTS "campaigns_select" ON campaigns;
DROP POLICY IF EXISTS "campaigns_insert" ON campaigns;
DROP POLICY IF EXISTS "campaigns_update" ON campaigns;
DROP POLICY IF EXISTS "campaigns_delete" ON campaigns;
DROP POLICY IF EXISTS "campaigns_tenant_isolation" ON campaigns;

-- Create consolidated policies
CREATE POLICY "campaigns_select"
    ON campaigns FOR SELECT
    USING (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    );

CREATE POLICY "campaigns_insert"
    ON campaigns FOR INSERT
    WITH CHECK (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    );

CREATE POLICY "campaigns_update"
    ON campaigns FOR UPDATE
    USING (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    )
    WITH CHECK (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    );

CREATE POLICY "campaigns_delete"
    ON campaigns FOR DELETE
    USING (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    );

-- === GLOBAL_CONTENT_SETTINGS TABLE ===
-- Note: This is a global table without tenant_id, accessible only by superadmins
-- Skip policy consolidation as existing policies are appropriate for this table

-- Note: For tables that already have consolidated policies (like those fixed in the previous migration),
-- we need to ensure there are no duplicate policies. The previous migration already addressed many of these.

-- === Additional cleanup for any remaining duplicate policies ===

-- Function to help identify and drop duplicate policies
DO $$
DECLARE
    policy_record RECORD;
    table_record RECORD;
BEGIN
    -- List of tables to check
    FOR table_record IN 
        SELECT unnest(ARRAY[
            'ai_generation_feedback', 'analytics', 'brand_profiles', 'brand_voice_profiles',
            'brand_voice_samples', 'campaign_posts', 'content_guardrails', 
            'content_guardrails_history', 'data_exports', 'error_logs', 
            'media_assets', 'performance_metrics', 'posting_schedules', 
            'publishing_history', 'publishing_queue', 'social_connections',
            'support_tickets', 'tenant_logos', 'tenants', 'user_deletion_requests',
            'user_tenants', 'users', 'watermark_settings'
        ]) AS table_name
    LOOP
        -- Find all policies for each table
        FOR policy_record IN
            SELECT policyname 
            FROM pg_policies 
            WHERE schemaname = 'public' 
            AND tablename = table_record.table_name
            AND policyname NOT IN (
                -- Keep these policy patterns
                table_record.table_name || '_select',
                table_record.table_name || '_insert', 
                table_record.table_name || '_update',
                table_record.table_name || '_delete',
                table_record.table_name || '_all',
                table_record.table_name || '_tenant_isolation',
                -- Also keep specific named policies that are intentional
                'simple_select', 'simple_insert', 'simple_update', 'simple_delete',
                'Users can update own profile or superadmin bypass',
                'Simple select policy'
            )
        LOOP
            -- Drop any extra policies that don't match our naming convention
            EXECUTE format('DROP POLICY IF EXISTS %I ON %I', policy_record.policyname, table_record.table_name);
        END LOOP;
    END LOOP;
END $$;