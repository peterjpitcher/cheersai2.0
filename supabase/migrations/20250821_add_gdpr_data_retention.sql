-- GDPR Data Retention Migration for UK Users
-- Implements UK ICO guidelines for data retention periods

-- Add soft delete columns to main tables
ALTER TABLE tenants ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE brand_profiles ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE campaigns ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE campaign_posts ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE media_assets ADD COLUMN deleted_at TIMESTAMPTZ, ADD COLUMN last_used_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE social_connections ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE publishing_history ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE publishing_queue ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE performance_metrics ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE error_logs ADD COLUMN deleted_at TIMESTAMPTZ;

-- Add data retention metadata table
CREATE TABLE data_retention_policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  data_type VARCHAR(50) NOT NULL UNIQUE,
  retention_days INTEGER NOT NULL,
  description TEXT,
  uk_ico_compliant BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert UK ICO compliant retention periods
INSERT INTO data_retention_policies (data_type, retention_days, description) VALUES
('user_account_data', 30, 'User account data retained for 30 days after deletion request (UK ICO guideline)'),
('analytics_data', 730, 'Analytics and performance data retained for 2 years (UK business standard)'),
('generated_content', 0, 'Generated content kept while account active, deleted with account'),
('media_files', 90, 'Media files retained for 90 days after last use'),
('publishing_history', 365, 'Publishing history retained for 1 year for audit purposes'),
('error_logs', 90, 'Error logs retained for 90 days for debugging'),
('social_tokens', 0, 'Social media tokens deleted immediately with account');

-- Add user deletion requests tracking
CREATE TABLE user_deletion_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'processing', 'completed'
  deletion_reason TEXT,
  data_export_provided BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add data export tracking
CREATE TABLE data_exports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  export_type VARCHAR(30) NOT NULL, -- 'gdpr_request', 'account_closure', 'data_portability'
  file_url TEXT,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days',
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'expired'
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for efficient cleanup queries
CREATE INDEX idx_tenants_deleted_at ON tenants(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_media_assets_last_used ON media_assets(last_used_at);
CREATE INDEX idx_performance_metrics_created_at ON performance_metrics(created_at);
CREATE INDEX idx_error_logs_created_at ON error_logs(created_at);
CREATE INDEX idx_user_deletion_requests_status ON user_deletion_requests(status);
CREATE INDEX idx_data_exports_expires_at ON data_exports(expires_at);

-- Enable RLS for new tables
ALTER TABLE data_retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_exports ENABLE ROW LEVEL SECURITY;

-- RLS policies for data retention policies (read-only for all users)
CREATE POLICY "Users can view retention policies"
  ON data_retention_policies FOR SELECT
  TO authenticated
  USING (true);

-- RLS policies for user deletion requests
CREATE POLICY "Users can view their own deletion requests"
  ON user_deletion_requests FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can create their own deletion requests"
  ON user_deletion_requests FOR INSERT
  WITH CHECK (
    user_id = auth.uid() AND
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

-- RLS policies for data exports
CREATE POLICY "Users can view their own data exports"
  ON data_exports FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can create their own data exports"
  ON data_exports FOR INSERT
  WITH CHECK (
    user_id = auth.uid() AND
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

-- Update media_assets last_used_at trigger
CREATE OR REPLACE FUNCTION update_media_last_used()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE media_assets 
  SET last_used_at = NOW() 
  WHERE id = NEW.hero_image_id AND NEW.hero_image_id IS NOT NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update media last_used_at when used in campaigns
CREATE TRIGGER update_media_usage_on_campaign_update
  AFTER UPDATE ON campaigns
  FOR EACH ROW
  WHEN (OLD.hero_image_id IS DISTINCT FROM NEW.hero_image_id)
  EXECUTE FUNCTION update_media_last_used();

-- Create function to soft delete user and related data
CREATE OR REPLACE FUNCTION soft_delete_user_data(target_user_id UUID)
RETURNS VOID AS $$
DECLARE
  target_tenant_id UUID;
BEGIN
  -- Get the user's tenant_id
  SELECT tenant_id INTO target_tenant_id FROM users WHERE id = target_user_id;
  
  IF target_tenant_id IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  
  -- Soft delete user data
  UPDATE users SET deleted_at = NOW() WHERE id = target_user_id;
  UPDATE brand_profiles SET deleted_at = NOW() WHERE tenant_id = target_tenant_id;
  UPDATE campaigns SET deleted_at = NOW() WHERE tenant_id = target_tenant_id;
  UPDATE campaign_posts SET deleted_at = NOW() WHERE campaign_id IN (
    SELECT id FROM campaigns WHERE tenant_id = target_tenant_id
  );
  UPDATE media_assets SET deleted_at = NOW() WHERE tenant_id = target_tenant_id;
  UPDATE social_connections SET deleted_at = NOW() WHERE tenant_id = target_tenant_id;
  UPDATE publishing_history SET deleted_at = NOW() WHERE campaign_post_id IN (
    SELECT cp.id FROM campaign_posts cp
    JOIN campaigns c ON cp.campaign_id = c.id
    WHERE c.tenant_id = target_tenant_id
  );
  UPDATE publishing_queue SET deleted_at = NOW() WHERE social_connection_id IN (
    SELECT id FROM social_connections WHERE tenant_id = target_tenant_id
  );
  UPDATE performance_metrics SET deleted_at = NOW() WHERE tenant_id = target_tenant_id;
  UPDATE error_logs SET deleted_at = NOW() WHERE tenant_id = target_tenant_id;
  
  -- Finally soft delete the tenant
  UPDATE tenants SET deleted_at = NOW() WHERE id = target_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to permanently delete expired soft-deleted data
CREATE OR REPLACE FUNCTION cleanup_expired_data()
RETURNS VOID AS $$
DECLARE
  cutoff_date TIMESTAMPTZ;
BEGIN
  -- UK ICO: 30 days after deletion request
  cutoff_date := NOW() - INTERVAL '30 days';
  
  -- Permanently delete expired user data
  DELETE FROM publishing_history WHERE deleted_at < cutoff_date;
  DELETE FROM publishing_queue WHERE deleted_at < cutoff_date;
  DELETE FROM campaign_posts WHERE deleted_at < cutoff_date;
  DELETE FROM campaigns WHERE deleted_at < cutoff_date;
  DELETE FROM social_connections WHERE deleted_at < cutoff_date;
  DELETE FROM brand_profiles WHERE deleted_at < cutoff_date;
  DELETE FROM media_assets WHERE deleted_at < cutoff_date;
  DELETE FROM users WHERE deleted_at < cutoff_date;
  DELETE FROM tenants WHERE deleted_at < cutoff_date;
  
  -- Clean up old analytics data (2 years)
  DELETE FROM performance_metrics 
  WHERE created_at < NOW() - INTERVAL '730 days' OR deleted_at < cutoff_date;
  
  -- Clean up old error logs (90 days)
  DELETE FROM error_logs 
  WHERE created_at < NOW() - INTERVAL '90 days' OR deleted_at < cutoff_date;
  
  -- Clean up unused media files (90 days since last use)
  UPDATE media_assets 
  SET deleted_at = NOW() 
  WHERE last_used_at < NOW() - INTERVAL '90 days' 
    AND deleted_at IS NULL;
  
  -- Clean up expired data exports
  DELETE FROM data_exports WHERE expires_at < NOW();
  
  -- Mark completed deletion requests older than 30 days for cleanup
  UPDATE user_deletion_requests 
  SET status = 'expired'
  WHERE completed_at < cutoff_date AND status = 'completed';
  
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to update updated_at for new tables
CREATE TRIGGER update_data_retention_policies_updated_at 
  BEFORE UPDATE ON data_retention_policies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_deletion_requests_updated_at 
  BEFORE UPDATE ON user_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_data_exports_updated_at 
  BEFORE UPDATE ON data_exports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE user_deletion_requests IS 'Tracks user requests for account deletion under GDPR/UK data protection';
COMMENT ON TABLE data_exports IS 'Tracks data export requests and generated files for GDPR compliance';
COMMENT ON TABLE data_retention_policies IS 'Defines data retention periods compliant with UK ICO guidelines';
COMMENT ON FUNCTION soft_delete_user_data IS 'Soft deletes all user data, starting 30-day UK ICO retention period';
COMMENT ON FUNCTION cleanup_expired_data IS 'Permanently deletes data past UK ICO retention periods';