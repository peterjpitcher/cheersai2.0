-- =========================================
-- PubHubAI Complete Database Setup
-- Run this single file in Supabase SQL Editor
-- =========================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =========================================
-- PART 1: Core Tables (001_initial_schema.sql)
-- =========================================

-- Tenants table (organizations/pubs)
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  subscription_status VARCHAR(20) DEFAULT 'trial',
  subscription_tier VARCHAR(20) DEFAULT 'free',
  trial_ends_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '14 days',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  full_name TEXT,
  role VARCHAR(20) DEFAULT 'owner',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Brand profiles
CREATE TABLE IF NOT EXISTS brand_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  business_type VARCHAR(50),
  tone_attributes TEXT[],
  target_audience TEXT,
  brand_colors JSONB DEFAULT '{}',
  language_code VARCHAR(10) DEFAULT 'en-GB',
  content_boundaries TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Media assets
CREATE TABLE IF NOT EXISTS media_assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type VARCHAR(50),
  file_size INTEGER,
  tags TEXT[],
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  event_date TIMESTAMPTZ,
  campaign_type VARCHAR(50) NOT NULL,
  hero_image_id UUID REFERENCES media_assets(id) ON DELETE SET NULL,
  status VARCHAR(20) DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Campaign posts
CREATE TABLE IF NOT EXISTS campaign_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  post_timing VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_brand_profiles_tenant_id ON brand_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_tenant_id ON media_assets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant_id ON campaigns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaign_posts_campaign_id ON campaign_posts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_posts_scheduled_for ON campaign_posts(scheduled_for);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
DROP TRIGGER IF EXISTS update_tenants_updated_at ON tenants;
CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_brand_profiles_updated_at ON brand_profiles;
CREATE TRIGGER update_brand_profiles_updated_at BEFORE UPDATE ON brand_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_media_assets_updated_at ON media_assets;
CREATE TRIGGER update_media_assets_updated_at BEFORE UPDATE ON media_assets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_campaigns_updated_at ON campaigns;
CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================
-- PART 2: Row Level Security (002_row_level_security.sql)
-- =========================================

-- Helper function to get user's tenant_id
CREATE OR REPLACE FUNCTION get_user_tenant_id(user_id UUID)
RETURNS UUID AS $$
  SELECT tenant_id FROM users WHERE id = user_id;
$$ LANGUAGE sql SECURITY DEFINER;

-- Enable RLS on all tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_posts ENABLE ROW LEVEL SECURITY;

-- Tenants policies
CREATE POLICY "Users can view their own tenant" ON tenants
  FOR SELECT USING (id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can update their own tenant" ON tenants
  FOR UPDATE USING (id = get_user_tenant_id(auth.uid()));

-- Users policies
CREATE POLICY "Users can view users in their tenant" ON users
  FOR SELECT USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can update their own profile" ON users
  FOR UPDATE USING (id = auth.uid());

CREATE POLICY "Users can insert themselves" ON users
  FOR INSERT WITH CHECK (id = auth.uid());

-- Brand profiles policies
CREATE POLICY "Users can view their tenant's brand profile" ON brand_profiles
  FOR SELECT USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can update their tenant's brand profile" ON brand_profiles
  FOR UPDATE USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can create brand profile for their tenant" ON brand_profiles
  FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()));

-- Media assets policies
CREATE POLICY "Users can view their tenant's media" ON media_assets
  FOR SELECT USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can upload media for their tenant" ON media_assets
  FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can delete their tenant's media" ON media_assets
  FOR DELETE USING (tenant_id = get_user_tenant_id(auth.uid()));

-- Campaigns policies
CREATE POLICY "Users can view their tenant's campaigns" ON campaigns
  FOR SELECT USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can create campaigns for their tenant" ON campaigns
  FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can update their tenant's campaigns" ON campaigns
  FOR UPDATE USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can delete their tenant's campaigns" ON campaigns
  FOR DELETE USING (tenant_id = get_user_tenant_id(auth.uid()));

-- Campaign posts policies
CREATE POLICY "Users can view posts for their campaigns" ON campaign_posts
  FOR SELECT USING (
    campaign_id IN (
      SELECT id FROM campaigns WHERE tenant_id = get_user_tenant_id(auth.uid())
    )
  );

CREATE POLICY "Users can create posts for their campaigns" ON campaign_posts
  FOR INSERT WITH CHECK (
    campaign_id IN (
      SELECT id FROM campaigns WHERE tenant_id = get_user_tenant_id(auth.uid())
    )
  );

CREATE POLICY "Users can update posts for their campaigns" ON campaign_posts
  FOR UPDATE USING (
    campaign_id IN (
      SELECT id FROM campaigns WHERE tenant_id = get_user_tenant_id(auth.uid())
    )
  );

CREATE POLICY "Users can delete posts for their campaigns" ON campaign_posts
  FOR DELETE USING (
    campaign_id IN (
      SELECT id FROM campaigns WHERE tenant_id = get_user_tenant_id(auth.uid())
    )
  );

-- =========================================
-- PART 3: Social Integrations (003_social_integrations.sql)
-- =========================================

-- Social Media Connections
CREATE TABLE IF NOT EXISTS social_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  platform VARCHAR(20) NOT NULL,
  account_name TEXT NOT NULL,
  account_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  page_id TEXT,
  page_name TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, platform, account_id)
);

-- Publishing History
CREATE TABLE IF NOT EXISTS publishing_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_post_id UUID REFERENCES campaign_posts(id) ON DELETE CASCADE,
  social_connection_id UUID REFERENCES social_connections(id) ON DELETE SET NULL,
  platform VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL,
  published_at TIMESTAMPTZ,
  platform_post_id TEXT,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Publishing Queue
CREATE TABLE IF NOT EXISTS publishing_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_post_id UUID REFERENCES campaign_posts(id) ON DELETE CASCADE,
  social_connection_id UUID REFERENCES social_connections(id) ON DELETE CASCADE,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_social_connections_tenant_id ON social_connections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_social_connections_platform ON social_connections(platform);
CREATE INDEX IF NOT EXISTS idx_publishing_history_campaign_post_id ON publishing_history(campaign_post_id);
CREATE INDEX IF NOT EXISTS idx_publishing_history_status ON publishing_history(status);
CREATE INDEX IF NOT EXISTS idx_publishing_queue_scheduled_for ON publishing_queue(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_publishing_queue_status ON publishing_queue(status);

-- Add RLS policies
ALTER TABLE social_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE publishing_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE publishing_queue ENABLE ROW LEVEL SECURITY;

-- Social connections policies
CREATE POLICY "Users can view their tenant's social connections"
  ON social_connections FOR SELECT
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can create social connections for their tenant"
  ON social_connections FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can update their tenant's social connections"
  ON social_connections FOR UPDATE
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can delete their tenant's social connections"
  ON social_connections FOR DELETE
  USING (tenant_id = get_user_tenant_id(auth.uid()));

-- Publishing history policies
CREATE POLICY "Users can view their publishing history"
  ON publishing_history FOR SELECT
  USING (
    campaign_post_id IN (
      SELECT cp.id FROM campaign_posts cp
      JOIN campaigns c ON cp.campaign_id = c.id
      WHERE c.tenant_id = get_user_tenant_id(auth.uid())
    )
  );

CREATE POLICY "Users can create publishing history"
  ON publishing_history FOR INSERT
  WITH CHECK (
    campaign_post_id IN (
      SELECT cp.id FROM campaign_posts cp
      JOIN campaigns c ON cp.campaign_id = c.id
      WHERE c.tenant_id = get_user_tenant_id(auth.uid())
    )
  );

-- Publishing queue policies
CREATE POLICY "Users can view their publishing queue"
  ON publishing_queue FOR SELECT
  USING (
    social_connection_id IN (
      SELECT id FROM social_connections
      WHERE tenant_id = get_user_tenant_id(auth.uid())
    )
  );

CREATE POLICY "Users can manage their publishing queue"
  ON publishing_queue FOR ALL
  USING (
    social_connection_id IN (
      SELECT id FROM social_connections
      WHERE tenant_id = get_user_tenant_id(auth.uid())
    )
  );

-- =========================================
-- PART 4: Add Email to Users (004_add_email_to_users.sql)
-- =========================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;

-- =========================================
-- PART 5: Missing Tables (005_missing_tables.sql)
-- =========================================

-- Add missing columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{"email": true, "push": false}';

-- Two-Factor Authentication table
CREATE TABLE IF NOT EXISTS two_factor_auth (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  secret TEXT NOT NULL,
  backup_codes TEXT[] NOT NULL,
  enabled BOOLEAN DEFAULT false,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Team invitations table
CREATE TABLE IF NOT EXISTS team_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role VARCHAR(20) DEFAULT 'member',
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  token TEXT UNIQUE NOT NULL,
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User tenants relationship (for multi-tenancy)
CREATE TABLE IF NOT EXISTS user_tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  role VARCHAR(20) DEFAULT 'member',
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, tenant_id)
);

-- Social accounts for OAuth connections
CREATE TABLE IF NOT EXISTS social_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL,
  account_id TEXT NOT NULL,
  account_name TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  page_id TEXT,
  page_name TEXT,
  profile_id TEXT,
  instagram_id TEXT,
  access_token_secret TEXT,
  username TEXT,
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, platform, account_id)
);

-- Analytics data
CREATE TABLE IF NOT EXISTS analytics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_post_id UUID REFERENCES campaign_posts(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL,
  metric_type VARCHAR(50) NOT NULL,
  metric_value INTEGER DEFAULT 0,
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notification settings
CREATE TABLE IF NOT EXISTS notification_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email_notifications BOOLEAN DEFAULT true,
  push_notifications BOOLEAN DEFAULT false,
  campaign_reminders BOOLEAN DEFAULT true,
  publishing_alerts BOOLEAN DEFAULT true,
  weekly_summary BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- API usage tracking
CREATE TABLE IF NOT EXISTS api_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  count INTEGER DEFAULT 1,
  date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, endpoint, date)
);

-- Campaign templates
CREATE TABLE IF NOT EXISTS campaign_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  template_type VARCHAR(50) NOT NULL,
  post_templates JSONB DEFAULT '[]',
  is_public BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add media_assets relationship to campaign_posts
ALTER TABLE campaign_posts ADD COLUMN IF NOT EXISTS media_assets UUID[] DEFAULT '{}';
ALTER TABLE campaign_posts ADD COLUMN IF NOT EXISTS platforms TEXT[] DEFAULT '{}';
ALTER TABLE campaign_posts ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

-- Add missing columns to campaigns
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS platforms TEXT[] DEFAULT '{}';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS auto_generate BOOLEAN DEFAULT false;

-- Create indexes for new tables
CREATE INDEX IF NOT EXISTS idx_two_factor_auth_user_id ON two_factor_auth(user_id);
CREATE INDEX IF NOT EXISTS idx_team_invitations_tenant_id ON team_invitations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_team_invitations_email ON team_invitations(email);
CREATE INDEX IF NOT EXISTS idx_team_invitations_token ON team_invitations(token);
CREATE INDEX IF NOT EXISTS idx_user_tenants_user_id ON user_tenants(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tenants_tenant_id ON user_tenants(tenant_id);
CREATE INDEX IF NOT EXISTS idx_social_accounts_tenant_id ON social_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_analytics_tenant_id ON analytics(tenant_id);
CREATE INDEX IF NOT EXISTS idx_analytics_campaign_post_id ON analytics(campaign_post_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_tenant_id ON api_usage(tenant_id);

-- Create updated_at triggers for new tables
DROP TRIGGER IF EXISTS update_two_factor_auth_updated_at ON two_factor_auth;
CREATE TRIGGER update_two_factor_auth_updated_at BEFORE UPDATE ON two_factor_auth
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_team_invitations_updated_at ON team_invitations;
CREATE TRIGGER update_team_invitations_updated_at BEFORE UPDATE ON team_invitations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_tenants_updated_at ON user_tenants;
CREATE TRIGGER update_user_tenants_updated_at BEFORE UPDATE ON user_tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_social_accounts_updated_at ON social_accounts;
CREATE TRIGGER update_social_accounts_updated_at BEFORE UPDATE ON social_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_notification_settings_updated_at ON notification_settings;
CREATE TRIGGER update_notification_settings_updated_at BEFORE UPDATE ON notification_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS on new tables
ALTER TABLE two_factor_auth ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies for two_factor_auth
CREATE POLICY "Users can view their own 2FA settings"
  ON two_factor_auth FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can update their own 2FA settings"
  ON two_factor_auth FOR ALL
  USING (user_id = auth.uid());

-- RLS Policies for team_invitations
CREATE POLICY "Users can view invitations for their tenant"
  ON team_invitations FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can create invitations"
  ON team_invitations FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM user_tenants 
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- RLS Policies for user_tenants
CREATE POLICY "Users can view their tenant memberships"
  ON user_tenants FOR SELECT
  USING (user_id = auth.uid() OR tenant_id IN (
    SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
  ));

-- RLS Policies for notification_settings
CREATE POLICY "Users can manage their notification settings"
  ON notification_settings FOR ALL
  USING (user_id = auth.uid());

-- RLS Policies for social_accounts
CREATE POLICY "Users can view their tenant's social accounts"
  ON social_accounts FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can manage their tenant's social accounts"
  ON social_accounts FOR ALL
  USING (tenant_id IN (
    SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
  ));

-- =========================================
-- VERIFICATION QUERIES
-- =========================================

-- Show all created tables
SELECT 'Tables Created:' as status;
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- Show RLS status
SELECT 'RLS Status:' as status;
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;

-- Show functions
SELECT 'Functions Created:' as status;
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public';

-- Final message
SELECT '✅ Database setup complete!' as message;