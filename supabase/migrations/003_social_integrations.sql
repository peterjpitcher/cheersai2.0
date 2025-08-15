-- Social Media Connections
CREATE TABLE social_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  platform VARCHAR(20) NOT NULL, -- 'facebook', 'instagram', 'google_my_business'
  account_name TEXT NOT NULL,
  account_id TEXT NOT NULL, -- Platform-specific ID
  access_token TEXT, -- Encrypted in production
  refresh_token TEXT, -- For platforms that use refresh tokens
  token_expires_at TIMESTAMPTZ,
  page_id TEXT, -- For Facebook/Instagram pages
  page_name TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, platform, account_id)
);

-- Publishing History
CREATE TABLE publishing_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_post_id UUID REFERENCES campaign_posts(id) ON DELETE CASCADE,
  social_connection_id UUID REFERENCES social_connections(id) ON DELETE SET NULL,
  platform VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL, -- 'pending', 'published', 'failed', 'scheduled'
  published_at TIMESTAMPTZ,
  platform_post_id TEXT, -- ID from the social platform
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Publishing Queue for scheduled posts
CREATE TABLE publishing_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_post_id UUID REFERENCES campaign_posts(id) ON DELETE CASCADE,
  social_connection_id UUID REFERENCES social_connections(id) ON DELETE CASCADE,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_social_connections_tenant_id ON social_connections(tenant_id);
CREATE INDEX idx_social_connections_platform ON social_connections(platform);
CREATE INDEX idx_publishing_history_campaign_post_id ON publishing_history(campaign_post_id);
CREATE INDEX idx_publishing_history_status ON publishing_history(status);
CREATE INDEX idx_publishing_queue_scheduled_for ON publishing_queue(scheduled_for);
CREATE INDEX idx_publishing_queue_status ON publishing_queue(status);

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