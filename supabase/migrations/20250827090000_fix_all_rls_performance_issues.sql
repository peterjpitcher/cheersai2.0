-- =====================================================
-- FIX ALL RLS PERFORMANCE ISSUES
-- This migration addresses all auth_rls_initplan warnings
-- by replacing auth.uid() with (SELECT auth.uid()) and
-- auth.jwt() with (SELECT auth.jwt()) in all RLS policies
-- =====================================================

-- === AI_GENERATION_FEEDBACK TABLE ===
DROP POLICY IF EXISTS "ai_generation_feedback_tenant_isolation" ON ai_generation_feedback;
CREATE POLICY "ai_generation_feedback_tenant_isolation"
    ON ai_generation_feedback FOR ALL
    USING (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    )
    WITH CHECK (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    );

-- === BRAND_PROFILES TABLE ===
-- Skip if table doesn't exist
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'brand_profiles') THEN
        DROP POLICY IF EXISTS "brand_profiles_tenant_isolation" ON brand_profiles;
        CREATE POLICY "brand_profiles_tenant_isolation"
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

-- === BRAND_VOICE_PROFILES TABLE ===
DROP POLICY IF EXISTS "brand_voice_profiles_tenant_isolation" ON brand_voice_profiles;
CREATE POLICY "brand_voice_profiles_tenant_isolation"
    ON brand_voice_profiles FOR ALL
    USING (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    )
    WITH CHECK (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    );

-- === BRAND_VOICE_SAMPLES TABLE ===
DROP POLICY IF EXISTS "brand_voice_samples_tenant_isolation" ON brand_voice_samples;
CREATE POLICY "brand_voice_samples_tenant_isolation"
    ON brand_voice_samples FOR ALL
    USING (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    )
    WITH CHECK (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    );

-- === CAMPAIGN_POSTS TABLE ===
DROP POLICY IF EXISTS "campaign_posts_tenant_isolation" ON campaign_posts;
CREATE POLICY "campaign_posts_tenant_isolation"
    ON campaign_posts FOR ALL
    USING (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    )
    WITH CHECK (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    );

-- === CONTENT_GUARDRAILS TABLE ===
DROP POLICY IF EXISTS "content_guardrails_tenant_isolation" ON content_guardrails;
CREATE POLICY "content_guardrails_tenant_isolation"
    ON content_guardrails FOR ALL
    USING (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    )
    WITH CHECK (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    );

-- === CONTENT_GUARDRAILS_HISTORY TABLE ===
-- Skip if table doesn't exist
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'content_guardrails_history') THEN
        DROP POLICY IF EXISTS "content_guardrails_history_view" ON content_guardrails_history;
        DROP POLICY IF EXISTS "content_guardrails_history_insert" ON content_guardrails_history;

        CREATE POLICY "content_guardrails_history_view"
            ON content_guardrails_history FOR SELECT
            USING (
                tenant_id = get_auth_tenant_id()
                OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
            );

        CREATE POLICY "content_guardrails_history_insert"
            ON content_guardrails_history FOR INSERT
            WITH CHECK (
                tenant_id = get_auth_tenant_id()
                OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
            );
    END IF;
END $$;

-- === DATA_EXPORTS TABLE ===
-- Skip if table doesn't exist or has no tenant_id
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'data_exports' 
        AND column_name = 'tenant_id'
    ) THEN
        DROP POLICY IF EXISTS "data_exports_view" ON data_exports;
        DROP POLICY IF EXISTS "data_exports_insert" ON data_exports;

        CREATE POLICY "data_exports_view"
            ON data_exports FOR SELECT
            USING (
                tenant_id = get_auth_tenant_id()
                OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
            );

        CREATE POLICY "data_exports_insert"
            ON data_exports FOR INSERT
            WITH CHECK (
                tenant_id = get_auth_tenant_id()
                OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
            );
    END IF;
END $$;

-- === ERROR_LOGS TABLE ===
DROP POLICY IF EXISTS "error_logs_tenant_isolation" ON error_logs;
CREATE POLICY "error_logs_tenant_isolation"
    ON error_logs FOR ALL
    USING (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    )
    WITH CHECK (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    );

-- === MEDIA_ASSETS TABLE ===
DROP POLICY IF EXISTS "media_assets_tenant_isolation" ON media_assets;
CREATE POLICY "media_assets_tenant_isolation"
    ON media_assets FOR ALL
    USING (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    );

-- === PERFORMANCE_METRICS TABLE ===
DROP POLICY IF EXISTS "performance_metrics_tenant_isolation" ON performance_metrics;
CREATE POLICY "performance_metrics_tenant_isolation"
    ON performance_metrics FOR ALL
    USING (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    )
    WITH CHECK (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    );

-- === POSTING_SCHEDULES TABLE ===
DROP POLICY IF EXISTS "posting_schedules_tenant_isolation" ON posting_schedules;
CREATE POLICY "posting_schedules_tenant_isolation"
    ON posting_schedules FOR ALL
    USING (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    );

-- === PUBLISHING_HISTORY TABLE ===
-- Note: publishing_history doesn't have tenant_id, it relies on campaign_post relationship
DROP POLICY IF EXISTS "publishing_history_select" ON publishing_history;
DROP POLICY IF EXISTS "publishing_history_insert" ON publishing_history;
DROP POLICY IF EXISTS "publishing_history_update" ON publishing_history;

CREATE POLICY "publishing_history_select"
    ON publishing_history FOR SELECT
    USING (
        campaign_post_id IN (
            SELECT id FROM campaign_posts 
            WHERE tenant_id = get_auth_tenant_id()
               OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
        )
    );

CREATE POLICY "publishing_history_insert"
    ON publishing_history FOR INSERT
    WITH CHECK (
        campaign_post_id IN (
            SELECT id FROM campaign_posts 
            WHERE tenant_id = get_auth_tenant_id()
               OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
        )
    );

CREATE POLICY "publishing_history_update"
    ON publishing_history FOR UPDATE
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

-- === PUBLISHING_QUEUE TABLE ===
-- Note: publishing_queue also doesn't have tenant_id, it relies on campaign_post relationship
DROP POLICY IF EXISTS "publishing_queue_select" ON publishing_queue;
DROP POLICY IF EXISTS "publishing_queue_insert" ON publishing_queue;
DROP POLICY IF EXISTS "publishing_queue_update" ON publishing_queue;

CREATE POLICY "publishing_queue_select"
    ON publishing_queue FOR SELECT
    USING (
        campaign_post_id IN (
            SELECT id FROM campaign_posts 
            WHERE tenant_id = get_auth_tenant_id()
               OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
        )
    );

CREATE POLICY "publishing_queue_insert"
    ON publishing_queue FOR INSERT
    WITH CHECK (
        campaign_post_id IN (
            SELECT id FROM campaign_posts 
            WHERE tenant_id = get_auth_tenant_id()
               OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
        )
    );

CREATE POLICY "publishing_queue_update"
    ON publishing_queue FOR UPDATE
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

-- === SOCIAL_CONNECTIONS TABLE ===
DROP POLICY IF EXISTS "social_connections_tenant_isolation" ON social_connections;
CREATE POLICY "social_connections_tenant_isolation"
    ON social_connections FOR ALL
    USING (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    )
    WITH CHECK (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    );

-- === SUPPORT_TICKETS TABLE ===
DROP POLICY IF EXISTS "support_tickets_tenant_isolation" ON support_tickets;
CREATE POLICY "support_tickets_tenant_isolation"
    ON support_tickets FOR ALL
    USING (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    )
    WITH CHECK (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    );

-- === TENANT_LOGOS TABLE ===
DROP POLICY IF EXISTS "tenant_logos_tenant_isolation" ON tenant_logos;
CREATE POLICY "tenant_logos_tenant_isolation"
    ON tenant_logos FOR ALL
    USING (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    )
    WITH CHECK (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
    );

-- === TENANTS TABLE ===
DROP POLICY IF EXISTS "simple_select" ON tenants;
DROP POLICY IF EXISTS "simple_insert" ON tenants;
DROP POLICY IF EXISTS "simple_update" ON tenants;
DROP POLICY IF EXISTS "simple_delete" ON tenants;

CREATE POLICY "simple_select"
    ON tenants FOR SELECT
    USING (
        id = get_auth_tenant_id()
        OR id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
        OR (SELECT auth.jwt()->>'email') = 'pipitcher@gmail.com'
    );

CREATE POLICY "simple_insert"
    ON tenants FOR INSERT
    WITH CHECK (
        id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
        OR (SELECT auth.jwt()->>'email') = 'pipitcher@gmail.com'
    );

CREATE POLICY "simple_update"
    ON tenants FOR UPDATE
    USING (
        id = get_auth_tenant_id()
        OR id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
        OR (SELECT auth.jwt()->>'email') = 'pipitcher@gmail.com'
    )
    WITH CHECK (
        id = get_auth_tenant_id()
        OR id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
        OR (SELECT auth.jwt()->>'email') = 'pipitcher@gmail.com'
    );

CREATE POLICY "simple_delete"
    ON tenants FOR DELETE
    USING (
        id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()) AND role = 'owner')
        OR (SELECT auth.jwt()->>'email') = 'pipitcher@gmail.com'
    );

-- === USER_DELETION_REQUESTS TABLE ===
-- Skip if table doesn't exist
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_deletion_requests') THEN
        DROP POLICY IF EXISTS "user_deletion_requests_view" ON user_deletion_requests;
        DROP POLICY IF EXISTS "user_deletion_requests_insert" ON user_deletion_requests;

        CREATE POLICY "user_deletion_requests_view"
            ON user_deletion_requests FOR SELECT
            USING (
                user_id = (SELECT auth.uid())
                OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()) AND role IN ('owner', 'admin'))
            );

        CREATE POLICY "user_deletion_requests_insert"
            ON user_deletion_requests FOR INSERT
            WITH CHECK (
                user_id = (SELECT auth.uid())
            );
    END IF;
END $$;

-- === USER_TENANTS TABLE (already fixed in previous migration) ===
-- Skipping as these were already fixed in 20250827072945_fix_rls_performance_and_policies.sql

-- === USERS TABLE ===
DROP POLICY IF EXISTS "Users can update own profile or superadmin bypass" ON users;
DROP POLICY IF EXISTS "Simple select policy" ON users;

CREATE POLICY "Users can update own profile or superadmin bypass"
    ON users FOR UPDATE
    USING (
        id = (SELECT auth.uid())
        OR (SELECT auth.jwt()->>'email') = 'pipitcher@gmail.com'
    )
    WITH CHECK (
        id = (SELECT auth.uid())
        OR (SELECT auth.jwt()->>'email') = 'pipitcher@gmail.com'
    );

CREATE POLICY "Simple select policy"
    ON users FOR SELECT
    USING (
        id = (SELECT auth.uid())
        OR tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
        OR (SELECT auth.jwt()->>'email') = 'pipitcher@gmail.com'
    );

-- === WATERMARK_SETTINGS TABLE ===
-- Skip if table doesn't exist
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'watermark_settings') THEN
        DROP POLICY IF EXISTS "watermark_settings_view" ON watermark_settings;
        DROP POLICY IF EXISTS "watermark_settings_modify" ON watermark_settings;

        CREATE POLICY "watermark_settings_view"
            ON watermark_settings FOR SELECT
            USING (
                tenant_id = get_auth_tenant_id()
                OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
            );

        CREATE POLICY "watermark_settings_modify"
            ON watermark_settings FOR ALL
            USING (
                tenant_id = get_auth_tenant_id()
                OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()) AND role IN ('owner', 'admin'))
            )
            WITH CHECK (
                tenant_id = get_auth_tenant_id()
                OR tenant_id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()) AND role IN ('owner', 'admin'))
            );
    END IF;
END $$;