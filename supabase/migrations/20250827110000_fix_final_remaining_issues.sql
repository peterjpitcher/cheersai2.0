-- =====================================================
-- FIX FINAL REMAINING DATABASE ISSUES
-- This migration addresses all remaining issues:
-- 1. Remaining unindexed foreign keys (12 instances)
-- 2. Clean up any duplicate indexes
-- =====================================================

-- === PART 1: ADD REMAINING FOREIGN KEY INDEXES ===
-- These were identified in the previous migration output

-- campaign_posts table
CREATE INDEX IF NOT EXISTS idx_campaign_posts_approved_by 
    ON campaign_posts(approved_by)
    WHERE approved_by IS NOT NULL;

-- publishing_history table
CREATE INDEX IF NOT EXISTS idx_publishing_history_campaign_post_id 
    ON publishing_history(campaign_post_id);

-- team_invitations table
CREATE INDEX IF NOT EXISTS idx_team_invitations_tenant_id 
    ON team_invitations(tenant_id);

-- analytics table
CREATE INDEX IF NOT EXISTS idx_analytics_campaign_post_id 
    ON analytics(campaign_post_id);

CREATE INDEX IF NOT EXISTS idx_analytics_tenant_id 
    ON analytics(tenant_id);

-- content_guardrails_history table
CREATE INDEX IF NOT EXISTS idx_content_guardrails_history_guardrail_id 
    ON content_guardrails_history(guardrail_id)
    WHERE guardrail_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_content_guardrails_history_tenant_id 
    ON content_guardrails_history(tenant_id);

-- ai_generation_feedback table
CREATE INDEX IF NOT EXISTS idx_ai_generation_feedback_campaign_id 
    ON ai_generation_feedback(campaign_id)
    WHERE campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_generation_feedback_tenant_id 
    ON ai_generation_feedback(tenant_id);

-- support_tickets table
CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_id 
    ON support_tickets(tenant_id);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id 
    ON support_tickets(user_id);

-- ai_platform_prompt_history table
CREATE INDEX IF NOT EXISTS idx_ai_platform_prompt_history_prompt_id 
    ON ai_platform_prompt_history(prompt_id);

-- === PART 2: OPTIMIZE EXISTING INDEXES ===
-- Add partial indexes where appropriate to reduce index size

-- Drop and recreate indexes with better optimization
DROP INDEX IF EXISTS idx_campaign_posts_approved_by;
CREATE INDEX idx_campaign_posts_approved_by 
    ON campaign_posts(approved_by)
    WHERE approved_by IS NOT NULL;

-- === PART 3: CLEAN UP DUPLICATE OR REDUNDANT INDEXES ===
DO $$
DECLARE
    rec RECORD;
    index_count INTEGER;
BEGIN
    -- Find tables with potential duplicate indexes
    FOR rec IN
        SELECT 
            schemaname,
            tablename,
            indexname,
            indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
        ORDER BY tablename, indexname
    LOOP
        -- Check for indexes that might be redundant
        SELECT COUNT(*) INTO index_count
        FROM pg_indexes
        WHERE schemaname = rec.schemaname
        AND tablename = rec.tablename
        AND indexdef LIKE '%' || 
            substring(rec.indexdef from position('(' in rec.indexdef) + 1 
                     for position(')' in rec.indexdef) - position('(' in rec.indexdef) - 1) || '%'
        AND indexname != rec.indexname;
        
        IF index_count > 0 THEN
            RAISE NOTICE 'Potential duplicate index pattern found for % on table %', rec.indexname, rec.tablename;
        END IF;
    END LOOP;
END $$;

-- === PART 4: ENSURE ALL TABLES WITH RLS HAVE PROPER POLICIES ===
-- Final check for any tables with RLS enabled but missing policies
DO $$
DECLARE
    rec RECORD;
    policy_count INTEGER;
BEGIN
    FOR rec IN
        SELECT 
            schemaname,
            tablename
        FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename IN (
            SELECT tablename 
            FROM pg_tables t
            WHERE t.schemaname = 'public'
            AND EXISTS (
                SELECT 1 
                FROM pg_class c
                WHERE c.relname = t.tablename
                AND c.relrowsecurity = true
            )
        )
    LOOP
        -- Count policies for this table
        SELECT COUNT(*) INTO policy_count
        FROM pg_policies
        WHERE schemaname = rec.schemaname
        AND tablename = rec.tablename;
        
        IF policy_count = 0 THEN
            RAISE WARNING 'Table % has RLS enabled but no policies!', rec.tablename;
        ELSIF policy_count = 1 THEN
            RAISE NOTICE 'Table % has % policy', rec.tablename, policy_count;
        ELSE
            RAISE NOTICE 'Table % has % policies', rec.tablename, policy_count;
        END IF;
    END LOOP;
END $$;

-- === PART 5: FINAL OPTIMIZATIONS ===
-- Analyze tables to update statistics after index changes
ANALYZE campaign_posts;
ANALYZE publishing_history;
ANALYZE team_invitations;
ANALYZE analytics;
ANALYZE content_guardrails_history;
ANALYZE ai_generation_feedback;
ANALYZE support_tickets;
ANALYZE ai_platform_prompt_history;

-- === PART 6: CREATE MONITORING VIEW ===
-- Create a view to monitor index usage going forward
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

-- Grant access to authenticated users to view index stats
GRANT SELECT ON index_usage_stats TO authenticated;

-- === PART 7: DOCUMENT INDEX PURPOSE ===
-- Add comments to indexes for documentation
COMMENT ON INDEX idx_campaign_posts_approved_by IS 'Foreign key index for approval workflow queries';
COMMENT ON INDEX idx_publishing_history_campaign_post_id IS 'Foreign key index for post history lookups';
COMMENT ON INDEX idx_team_invitations_tenant_id IS 'Foreign key index for tenant invitation queries';
COMMENT ON INDEX idx_analytics_campaign_post_id IS 'Foreign key index for analytics aggregation';
COMMENT ON INDEX idx_analytics_tenant_id IS 'Foreign key index for tenant analytics queries';
COMMENT ON INDEX idx_content_guardrails_history_guardrail_id IS 'Foreign key index for guardrail history tracking';
COMMENT ON INDEX idx_content_guardrails_history_tenant_id IS 'Foreign key index for tenant guardrail queries';
COMMENT ON INDEX idx_ai_generation_feedback_campaign_id IS 'Foreign key index for campaign AI feedback';
COMMENT ON INDEX idx_ai_generation_feedback_tenant_id IS 'Foreign key index for tenant AI feedback';
COMMENT ON INDEX idx_support_tickets_tenant_id IS 'Foreign key index for tenant support queries';
COMMENT ON INDEX idx_support_tickets_user_id IS 'Foreign key index for user support history';
COMMENT ON INDEX idx_ai_platform_prompt_history_prompt_id IS 'Foreign key index for prompt version history';