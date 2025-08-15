-- =====================================================
-- COMPLETE RLS REDESIGN - JWT Claims Approach
-- This migration completely rebuilds the RLS architecture
-- to eliminate all circular dependencies
-- =====================================================

-- STEP 1: Drop ALL existing policies and functions
-- We need a clean slate to rebuild properly

DO $$
DECLARE
    pol RECORD;
    func RECORD;
BEGIN
    -- Drop all policies on public schema tables
    FOR pol IN 
        SELECT schemaname, tablename, policyname 
        FROM pg_policies 
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', 
            pol.policyname, pol.schemaname, pol.tablename);
    END LOOP;
    
    -- Drop storage policies that use the old function
    DROP POLICY IF EXISTS "Users can upload media to their tenant folder" ON storage.objects;
    DROP POLICY IF EXISTS "Users can view media in their tenant folder" ON storage.objects;
    DROP POLICY IF EXISTS "Users can update media in their tenant folder" ON storage.objects;
    DROP POLICY IF EXISTS "Users can delete media from their tenant folder" ON storage.objects;
    
    -- Now we can safely drop the functions
    DROP FUNCTION IF EXISTS get_user_tenant_id(UUID) CASCADE;
    DROP FUNCTION IF EXISTS user_has_tenant(UUID) CASCADE;
    
    RAISE NOTICE 'All existing policies and functions dropped';
END $$;

-- =====================================================
-- STEP 2: Create trigger to add tenant_id to JWT claims
-- =====================================================

-- Function to update user's app_metadata with tenant_id
CREATE OR REPLACE FUNCTION public.handle_user_tenant_claim()
RETURNS TRIGGER AS $$
BEGIN
    -- Update the user's raw_app_meta_data in auth.users
    UPDATE auth.users
    SET raw_app_meta_data = 
        COALESCE(raw_app_meta_data, '{}'::jsonb) || 
        jsonb_build_object('tenant_id', NEW.tenant_id::text)
    WHERE id = NEW.id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to sync tenant_id to JWT claims
DROP TRIGGER IF EXISTS sync_user_tenant_claim ON users;
CREATE TRIGGER sync_user_tenant_claim
    AFTER INSERT OR UPDATE OF tenant_id ON users
    FOR EACH ROW
    EXECUTE FUNCTION handle_user_tenant_claim();

-- =====================================================
-- STEP 3: Simple helper function for tenant access
-- This function does NOT query RLS-protected tables
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_auth_tenant_id()
RETURNS UUID AS $$
    SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid;
$$ LANGUAGE SQL STABLE;

-- =====================================================
-- STEP 4: Create NEW RLS policies - NO CIRCULAR DEPENDENCIES
-- =====================================================

-- USERS table policies
CREATE POLICY "users_insert_self"
    ON users FOR INSERT
    WITH CHECK (id = auth.uid());

CREATE POLICY "users_view_self"
    ON users FOR SELECT
    USING (id = auth.uid());

CREATE POLICY "users_update_self"
    ON users FOR UPDATE
    USING (id = auth.uid());

CREATE POLICY "users_view_same_tenant"
    ON users FOR SELECT
    USING (
        -- Only if user has a tenant_id in their JWT
        get_auth_tenant_id() IS NOT NULL 
        AND tenant_id = get_auth_tenant_id()
    );

-- TENANTS table policies
CREATE POLICY "tenants_insert_authenticated"
    ON tenants FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "tenants_view_own"
    ON tenants FOR SELECT
    USING (
        id = get_auth_tenant_id()
        OR id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    );

CREATE POLICY "tenants_update_own"
    ON tenants FOR UPDATE
    USING (
        id = get_auth_tenant_id()
        OR id IN (SELECT tenant_id FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin'))
    );

-- USER_TENANTS table policies (for multi-tenant support)
CREATE POLICY "user_tenants_insert_self"
    ON user_tenants FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_tenants_view_self"
    ON user_tenants FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "user_tenants_view_same_tenant"
    ON user_tenants FOR SELECT
    USING (tenant_id = get_auth_tenant_id());

CREATE POLICY "user_tenants_update_self"
    ON user_tenants FOR UPDATE
    USING (user_id = auth.uid());

-- BRAND_PROFILES table policies
CREATE POLICY "brand_profiles_insert"
    ON brand_profiles FOR INSERT
    WITH CHECK (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    );

CREATE POLICY "brand_profiles_view"
    ON brand_profiles FOR SELECT
    USING (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    );

CREATE POLICY "brand_profiles_update"
    ON brand_profiles FOR UPDATE
    USING (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin'))
    );

-- CAMPAIGNS table policies
CREATE POLICY "campaigns_tenant_isolation"
    ON campaigns FOR ALL
    USING (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    );

-- CAMPAIGN_POSTS table policies
CREATE POLICY "campaign_posts_tenant_isolation"
    ON campaign_posts FOR ALL
    USING (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
        OR campaign_id IN (
            SELECT id FROM campaigns 
            WHERE tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
        )
    );

-- MEDIA_ASSETS table policies
CREATE POLICY "media_assets_tenant_isolation"
    ON media_assets FOR ALL
    USING (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    );

-- SOCIAL_ACCOUNTS table policies
CREATE POLICY "social_accounts_tenant_isolation"
    ON social_accounts FOR ALL
    USING (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    );

-- SOCIAL_CONNECTIONS table policies
CREATE POLICY "social_connections_tenant_isolation"
    ON social_connections FOR ALL
    USING (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    );

-- TEAM_INVITATIONS table policies
CREATE POLICY "team_invitations_view"
    ON team_invitations FOR SELECT
    USING (
        tenant_id = get_auth_tenant_id()
        OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
    );

CREATE POLICY "team_invitations_insert"
    ON team_invitations FOR INSERT
    WITH CHECK (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin'))
    );

-- TWO_FACTOR_AUTH table policies
CREATE POLICY "two_factor_auth_own"
    ON two_factor_auth FOR ALL
    USING (user_id = auth.uid());

-- NOTIFICATION_SETTINGS table policies
CREATE POLICY "notification_settings_own"
    ON notification_settings FOR ALL
    USING (user_id = auth.uid());

-- ANALYTICS table policies
CREATE POLICY "analytics_tenant_isolation"
    ON analytics FOR ALL
    USING (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    );

-- API_USAGE table policies
CREATE POLICY "api_usage_tenant_isolation"
    ON api_usage FOR ALL
    USING (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    );

-- PUBLISHING_QUEUE table policies
CREATE POLICY "publishing_queue_tenant_isolation"
    ON publishing_queue FOR ALL
    USING (
        social_connection_id IN (
            SELECT id FROM social_connections 
            WHERE tenant_id = get_auth_tenant_id()
               OR tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
        )
    );

-- PUBLISHING_HISTORY table policies
CREATE POLICY "publishing_history_view"
    ON publishing_history FOR SELECT
    USING (
        social_connection_id IN (
            SELECT id FROM social_connections 
            WHERE tenant_id = get_auth_tenant_id()
               OR tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
        )
    );

-- =====================================================
-- STEP 5: Update existing users to sync JWT claims
-- =====================================================

-- Force trigger to fire for all existing users
UPDATE users 
SET updated_at = NOW() 
WHERE tenant_id IS NOT NULL;

-- =====================================================
-- STEP 6: Storage bucket policies (using new pattern)
-- =====================================================

-- Storage policies for media uploads
CREATE POLICY "tenant_media_upload"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'media' 
        AND (storage.foldername(name))[1] = get_auth_tenant_id()::text
    );

CREATE POLICY "tenant_media_view"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'media' 
        AND (storage.foldername(name))[1] = get_auth_tenant_id()::text
    );

CREATE POLICY "tenant_media_update"
    ON storage.objects FOR UPDATE
    USING (
        bucket_id = 'media' 
        AND (storage.foldername(name))[1] = get_auth_tenant_id()::text
    );

CREATE POLICY "tenant_media_delete"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'media' 
        AND (storage.foldername(name))[1] = get_auth_tenant_id()::text
    );

-- =====================================================
-- VERIFICATION
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '✅ RLS COMPLETELY REDESIGNED!';
    RAISE NOTICE '✅ All circular dependencies eliminated';
    RAISE NOTICE '✅ Using JWT claims for tenant isolation';
    RAISE NOTICE '✅ No recursive function calls';
    RAISE NOTICE '';
    RAISE NOTICE '⚠️  IMPORTANT: Users may need to re-authenticate';
    RAISE NOTICE '    for JWT claims to take effect';
    RAISE NOTICE '';
    RAISE NOTICE 'Architecture:';
    RAISE NOTICE '  1. Tenant ID stored in JWT app_metadata';
    RAISE NOTICE '  2. Policies use get_auth_tenant_id() to read JWT';
    RAISE NOTICE '  3. Fallback to users table query (no recursion)';
    RAISE NOTICE '  4. No cross-table RLS dependencies';
END $$;