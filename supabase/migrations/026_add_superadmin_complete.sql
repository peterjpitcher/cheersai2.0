-- Comprehensive Superadmin Implementation
-- This migration adds complete superadmin functionality with proper email handling

-- 1. Add superadmin column to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN DEFAULT false;

-- 2. Create index for faster superadmin queries
CREATE INDEX IF NOT EXISTS idx_users_superadmin ON users(is_superadmin) WHERE is_superadmin = true;

-- 3. Ensure email sync from auth.users to public.users
-- This trigger ensures emails are always synced
CREATE OR REPLACE FUNCTION sync_user_email()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE users 
  SET email = NEW.email 
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS sync_user_email_trigger ON auth.users;
CREATE TRIGGER sync_user_email_trigger
AFTER UPDATE OF email ON auth.users
FOR EACH ROW
EXECUTE FUNCTION sync_user_email();

-- 4. Sync existing emails from auth.users to public.users
UPDATE users u
SET email = au.email
FROM auth.users au
WHERE u.id = au.id AND (u.email IS NULL OR u.email != au.email);

-- 5. Set peter.pitcher@outlook.com as superadmin
-- First ensure the user exists with correct email
UPDATE users u
SET 
  is_superadmin = true,
  email = au.email
FROM auth.users au
WHERE u.id = au.id 
  AND au.email = 'peter.pitcher@outlook.com';

-- 6. Create helper function to check superadmin status
CREATE OR REPLACE FUNCTION is_superadmin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM users 
    WHERE id = auth.uid() 
    AND is_superadmin = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Create missing global_content_settings table
CREATE TABLE IF NOT EXISTS global_content_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  setting_key TEXT NOT NULL UNIQUE,
  setting_value JSONB NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);

-- 8. Add RLS to global_content_settings
ALTER TABLE global_content_settings ENABLE ROW LEVEL SECURITY;

-- 9. Create comprehensive superadmin policies for ALL tables

-- Tenants table
DROP POLICY IF EXISTS "Superadmins can view all tenants" ON tenants;
CREATE POLICY "Superadmins bypass all tenant restrictions" ON tenants
  FOR ALL TO authenticated
  USING (
    get_auth_tenant_id() = id 
    OR is_superadmin()
  )
  WITH CHECK (
    get_auth_tenant_id() = id 
    OR is_superadmin()
  );

-- Users table
DROP POLICY IF EXISTS "Users can view tenant members" ON users;
CREATE POLICY "Users can view tenant members or superadmin bypass" ON users
  FOR SELECT TO authenticated
  USING (
    tenant_id = get_auth_tenant_id() 
    OR is_superadmin()
  );

DROP POLICY IF EXISTS "Users can update own profile" ON users;
CREATE POLICY "Users can update own profile or superadmin bypass" ON users
  FOR UPDATE TO authenticated
  USING (
    id = auth.uid() 
    OR is_superadmin()
  )
  WITH CHECK (
    id = auth.uid() 
    OR is_superadmin()
  );

-- Brand profiles
DROP POLICY IF EXISTS "Tenant members can manage brand profiles" ON brand_profiles;
CREATE POLICY "Tenant members can manage brand profiles or superadmin" ON brand_profiles
  FOR ALL TO authenticated
  USING (
    tenant_id = get_auth_tenant_id() 
    OR is_superadmin()
  )
  WITH CHECK (
    tenant_id = get_auth_tenant_id() 
    OR is_superadmin()
  );

-- Campaigns
DROP POLICY IF EXISTS "Tenant members can manage campaigns" ON campaigns;
CREATE POLICY "Tenant members can manage campaigns or superadmin" ON campaigns
  FOR ALL TO authenticated
  USING (
    tenant_id = get_auth_tenant_id() 
    OR is_superadmin()
  )
  WITH CHECK (
    tenant_id = get_auth_tenant_id() 
    OR is_superadmin()
  );

-- Campaign posts
DROP POLICY IF EXISTS "Tenant members can manage campaign posts" ON campaign_posts;
CREATE POLICY "Tenant members can manage campaign posts or superadmin" ON campaign_posts
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM campaigns 
      WHERE campaigns.id = campaign_posts.campaign_id 
      AND campaigns.tenant_id = get_auth_tenant_id()
    ) 
    OR is_superadmin()
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM campaigns 
      WHERE campaigns.id = campaign_posts.campaign_id 
      AND campaigns.tenant_id = get_auth_tenant_id()
    ) 
    OR is_superadmin()
  );

-- Media assets
DROP POLICY IF EXISTS "Tenant members can manage media" ON media_assets;
CREATE POLICY "Tenant members can manage media or superadmin" ON media_assets
  FOR ALL TO authenticated
  USING (
    tenant_id = get_auth_tenant_id() 
    OR is_superadmin()
  )
  WITH CHECK (
    tenant_id = get_auth_tenant_id() 
    OR is_superadmin()
  );

-- Social connections
DROP POLICY IF EXISTS "Tenant members can manage connections" ON social_connections;
CREATE POLICY "Tenant members can manage connections or superadmin" ON social_connections
  FOR ALL TO authenticated
  USING (
    tenant_id = get_auth_tenant_id() 
    OR is_superadmin()
  )
  WITH CHECK (
    tenant_id = get_auth_tenant_id() 
    OR is_superadmin()
  );

-- Publishing queue (uses social_connection_id for tenant isolation)
DROP POLICY IF EXISTS "publishing_queue_tenant_isolation" ON publishing_queue;
CREATE POLICY "publishing_queue_tenant_isolation_or_superadmin" ON publishing_queue
  FOR ALL TO authenticated
  USING (
    social_connection_id IN (
      SELECT id FROM social_connections 
      WHERE tenant_id = get_auth_tenant_id()
         OR tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    )
    OR is_superadmin()
  )
  WITH CHECK (
    social_connection_id IN (
      SELECT id FROM social_connections 
      WHERE tenant_id = get_auth_tenant_id()
         OR tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    )
    OR is_superadmin()
  );

-- Content guardrails
DROP POLICY IF EXISTS "Tenant members can manage guardrails" ON content_guardrails;
CREATE POLICY "Tenant members can manage guardrails or superadmin" ON content_guardrails
  FOR ALL TO authenticated
  USING (
    tenant_id = get_auth_tenant_id() 
    OR is_superadmin()
  )
  WITH CHECK (
    tenant_id = get_auth_tenant_id() 
    OR is_superadmin()
  );

-- AI generation feedback
DROP POLICY IF EXISTS "Tenant members can manage feedback" ON ai_generation_feedback;
CREATE POLICY "Tenant members can manage feedback or superadmin" ON ai_generation_feedback
  FOR ALL TO authenticated
  USING (
    tenant_id = get_auth_tenant_id() 
    OR is_superadmin()
  )
  WITH CHECK (
    tenant_id = get_auth_tenant_id() 
    OR is_superadmin()
  );

-- Analytics
DROP POLICY IF EXISTS "Tenant members can view analytics" ON analytics;
CREATE POLICY "Tenant members can view analytics or superadmin" ON analytics
  FOR ALL TO authenticated
  USING (
    tenant_id = get_auth_tenant_id() 
    OR is_superadmin()
  )
  WITH CHECK (
    tenant_id = get_auth_tenant_id() 
    OR is_superadmin()
  );

-- Publishing history (uses social_connection_id for tenant isolation)
DROP POLICY IF EXISTS "publishing_history_view" ON publishing_history;
CREATE POLICY "publishing_history_view_or_superadmin" ON publishing_history
  FOR SELECT TO authenticated
  USING (
    social_connection_id IN (
      SELECT id FROM social_connections 
      WHERE tenant_id = get_auth_tenant_id()
         OR tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    )
    OR is_superadmin()
  );

-- Brand voice profiles
DROP POLICY IF EXISTS "brand_voice_profiles_tenant_isolation" ON brand_voice_profiles;
CREATE POLICY "brand_voice_profiles_tenant_or_superadmin" ON brand_voice_profiles
  FOR ALL TO authenticated
  USING (
    tenant_id = get_auth_tenant_id() 
    OR is_superadmin()
  )
  WITH CHECK (
    tenant_id = get_auth_tenant_id() 
    OR is_superadmin()
  );

-- Brand voice samples  
DROP POLICY IF EXISTS "brand_voice_samples_tenant_isolation" ON brand_voice_samples;
CREATE POLICY "brand_voice_samples_tenant_or_superadmin" ON brand_voice_samples
  FOR ALL TO authenticated
  USING (
    tenant_id = get_auth_tenant_id() 
    OR is_superadmin()
  )
  WITH CHECK (
    tenant_id = get_auth_tenant_id() 
    OR is_superadmin()
  );

-- Tenant logos
DROP POLICY IF EXISTS "tenant_logos_tenant_isolation" ON tenant_logos;
CREATE POLICY "tenant_logos_tenant_or_superadmin" ON tenant_logos
  FOR ALL TO authenticated
  USING (
    tenant_id = get_auth_tenant_id() 
    OR is_superadmin()
  )
  WITH CHECK (
    tenant_id = get_auth_tenant_id() 
    OR is_superadmin()
  );

-- Watermark settings
DROP POLICY IF EXISTS "watermark_settings_tenant_isolation" ON watermark_settings;
CREATE POLICY "watermark_settings_tenant_or_superadmin" ON watermark_settings
  FOR ALL TO authenticated
  USING (
    tenant_id = get_auth_tenant_id() 
    OR is_superadmin()
  )
  WITH CHECK (
    tenant_id = get_auth_tenant_id() 
    OR is_superadmin()
  );

-- Global content settings (superadmin only for write)
CREATE POLICY "Anyone can read global settings" ON global_content_settings
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Only superadmins can modify global settings" ON global_content_settings
  FOR ALL TO authenticated
  USING (is_superadmin())
  WITH CHECK (is_superadmin());

-- 10. Storage policies for superadmin
-- Note: Storage policies need to be updated in Supabase dashboard
-- as they use a different policy system

-- 11. Create superadmin dashboard view
CREATE OR REPLACE VIEW superadmin_dashboard AS
SELECT 
  t.id as tenant_id,
  t.name as tenant_name,
  t.subscription_tier,
  t.subscription_status,
  t.trial_ends_at,
  t.created_at as tenant_created,
  COUNT(DISTINCT u.id) as user_count,
  COUNT(DISTINCT c.id) as campaign_count,
  COUNT(DISTINCT cp.id) as post_count,
  COUNT(DISTINCT ma.id) as media_count,
  COUNT(DISTINCT sc.id) as connection_count
FROM tenants t
LEFT JOIN users u ON u.tenant_id = t.id
LEFT JOIN campaigns c ON c.tenant_id = t.id
LEFT JOIN campaign_posts cp ON cp.campaign_id = c.id
LEFT JOIN media_assets ma ON ma.tenant_id = t.id
LEFT JOIN social_connections sc ON sc.tenant_id = t.id
GROUP BY t.id
ORDER BY t.created_at DESC;

-- Grant access to the view
GRANT SELECT ON superadmin_dashboard TO authenticated;

-- 12. Add audit logging for superadmin actions
CREATE TABLE IF NOT EXISTS superadmin_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  superadmin_id UUID REFERENCES users(id) NOT NULL,
  action TEXT NOT NULL,
  target_table TEXT,
  target_id UUID,
  target_tenant_id UUID REFERENCES tenants(id),
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on audit log
ALTER TABLE superadmin_audit_log ENABLE ROW LEVEL SECURITY;

-- Only superadmins can view audit logs
CREATE POLICY "Only superadmins can view audit logs" ON superadmin_audit_log
  FOR SELECT TO authenticated
  USING (is_superadmin());

-- 13. Create function to log superadmin actions
CREATE OR REPLACE FUNCTION log_superadmin_action(
  p_action TEXT,
  p_target_table TEXT DEFAULT NULL,
  p_target_id UUID DEFAULT NULL,
  p_target_tenant_id UUID DEFAULT NULL,
  p_details JSONB DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  IF is_superadmin() THEN
    INSERT INTO superadmin_audit_log (
      superadmin_id, action, target_table, target_id, target_tenant_id, details
    ) VALUES (
      auth.uid(), p_action, p_target_table, p_target_id, p_target_tenant_id, p_details
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comments for documentation
COMMENT ON COLUMN users.is_superadmin IS 'Indicates if user has superadmin privileges for the entire application';
COMMENT ON FUNCTION is_superadmin() IS 'Helper function to check if current user is a superadmin';
COMMENT ON TABLE global_content_settings IS 'System-wide settings manageable only by superadmins';
COMMENT ON TABLE superadmin_audit_log IS 'Audit trail of all superadmin actions';
COMMENT ON VIEW superadmin_dashboard IS 'Overview of all tenants and their usage for superadmins';