-- Performance optimization indexes
-- Based on common query patterns identified in the codebase

-- Composite indexes for frequently joined queries
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant_status_date 
ON campaigns(tenant_id, status, created_at DESC) 
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_posts_campaign_platform 
ON campaign_posts(campaign_id, platform, scheduled_for) 
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_social_connections_tenant_platform 
ON social_connections(tenant_id, platform, is_active) 
WHERE deleted_at IS NULL;

-- Index for AI prompt lookups (fixes issue from generate/route.ts)
CREATE INDEX IF NOT EXISTS idx_ai_prompts_lookup 
ON ai_platform_prompts(platform, content_type, is_active, is_default) 
WHERE deleted_at IS NULL;

-- Index for content guardrails lookup
CREATE INDEX IF NOT EXISTS idx_content_guardrails_active 
ON content_guardrails(tenant_id, is_active, rule_type) 
WHERE deleted_at IS NULL;

-- Index for posting schedules
CREATE INDEX IF NOT EXISTS idx_posting_schedules_tenant_day 
ON posting_schedules(tenant_id, day_of_week, is_active) 
WHERE deleted_at IS NULL;

-- Index for media assets
CREATE INDEX IF NOT EXISTS idx_media_assets_tenant_type 
ON media_assets(tenant_id, asset_type, created_at DESC) 
WHERE deleted_at IS NULL;

-- Index for users table tenant lookup
CREATE INDEX IF NOT EXISTS idx_users_tenant_role 
ON users(tenant_id, role) 
WHERE deleted_at IS NULL;

-- Index for subscription limit checks
CREATE INDEX IF NOT EXISTS idx_tenants_subscription 
ON tenants(subscription_status, subscription_tier) 
WHERE deleted_at IS NULL;

-- Partial index for trial tenants
CREATE INDEX IF NOT EXISTS idx_tenants_trial 
ON tenants(trial_ends_at) 
WHERE subscription_status = 'trialing' AND deleted_at IS NULL;

-- Index for campaign statistics
CREATE INDEX IF NOT EXISTS idx_campaign_posts_stats 
ON campaign_posts(campaign_id, status, published_at) 
WHERE status IN ('published', 'failed');

-- Create materialized view for expensive campaign statistics
CREATE MATERIALIZED VIEW IF NOT EXISTS campaign_statistics AS
SELECT 
  c.id as campaign_id,
  c.tenant_id,
  c.name,
  c.status,
  COUNT(DISTINCT cp.id) as total_posts,
  COUNT(DISTINCT CASE WHEN cp.status = 'published' THEN cp.id END) as published_posts,
  COUNT(DISTINCT CASE WHEN cp.status = 'scheduled' THEN cp.id END) as scheduled_posts,
  COUNT(DISTINCT CASE WHEN cp.status = 'draft' THEN cp.id END) as draft_posts,
  COUNT(DISTINCT cp.platform) as platforms_used,
  MIN(cp.scheduled_for) as first_post_date,
  MAX(cp.scheduled_for) as last_post_date,
  c.created_at,
  c.updated_at
FROM campaigns c
LEFT JOIN campaign_posts cp ON c.id = cp.campaign_id AND cp.deleted_at IS NULL
WHERE c.deleted_at IS NULL
GROUP BY c.id, c.tenant_id, c.name, c.status, c.created_at, c.updated_at;

-- Create index on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_statistics_id ON campaign_statistics(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_statistics_tenant ON campaign_statistics(tenant_id, status);

-- Create function to refresh statistics
CREATE OR REPLACE FUNCTION refresh_campaign_statistics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY campaign_statistics;
END;
$$;

-- Create materialized view for tenant usage statistics
CREATE MATERIALIZED VIEW IF NOT EXISTS tenant_usage_statistics AS
SELECT 
  t.id as tenant_id,
  t.subscription_tier,
  t.subscription_status,
  COUNT(DISTINCT c.id) as total_campaigns,
  COUNT(DISTINCT c.id) FILTER (WHERE c.created_at > NOW() - INTERVAL '30 days') as campaigns_last_30_days,
  COUNT(DISTINCT cp.id) as total_posts,
  COUNT(DISTINCT cp.id) FILTER (WHERE cp.created_at > NOW() - INTERVAL '30 days') as posts_last_30_days,
  COUNT(DISTINCT sc.id) as connected_accounts,
  COUNT(DISTINCT u.id) as team_members,
  COALESCE(SUM(
    CASE 
      WHEN cg.times_applied IS NOT NULL 
      THEN cg.times_applied 
      ELSE 0 
    END
  ), 0) as ai_generations,
  MAX(c.created_at) as last_campaign_created,
  MAX(cp.published_at) as last_post_published
FROM tenants t
LEFT JOIN campaigns c ON t.id = c.tenant_id AND c.deleted_at IS NULL
LEFT JOIN campaign_posts cp ON c.id = cp.campaign_id AND cp.deleted_at IS NULL
LEFT JOIN social_connections sc ON t.id = sc.tenant_id AND sc.deleted_at IS NULL
LEFT JOIN users u ON t.id = u.tenant_id AND u.deleted_at IS NULL
LEFT JOIN content_guardrails cg ON t.id = cg.tenant_id
WHERE t.deleted_at IS NULL
GROUP BY t.id, t.subscription_tier, t.subscription_status;

-- Create indexes on usage statistics
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_usage_statistics_id ON tenant_usage_statistics(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_usage_statistics_tier ON tenant_usage_statistics(subscription_tier);

-- Function to get tenant usage with limits
CREATE OR REPLACE FUNCTION get_tenant_usage_with_limits(p_tenant_id UUID)
RETURNS TABLE (
  campaigns_used INTEGER,
  campaigns_limit INTEGER,
  posts_used INTEGER,
  posts_limit INTEGER,
  ai_used INTEGER,
  ai_limit INTEGER,
  is_over_limit BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_tier TEXT;
  v_campaigns_limit INTEGER;
  v_posts_limit INTEGER;
  v_ai_limit INTEGER;
BEGIN
  -- Get tenant's subscription tier
  SELECT subscription_tier INTO v_tier
  FROM tenants
  WHERE id = p_tenant_id;
  
  -- Set limits based on tier
  CASE v_tier
    WHEN 'free' THEN
      v_campaigns_limit := 10;
      v_posts_limit := 50;
      v_ai_limit := 100;
    WHEN 'starter' THEN
      v_campaigns_limit := 50;
      v_posts_limit := 500;
      v_ai_limit := 500;
    WHEN 'professional' THEN
      v_campaigns_limit := 200;
      v_posts_limit := 2000;
      v_ai_limit := 2000;
    WHEN 'enterprise' THEN
      v_campaigns_limit := 999999;
      v_posts_limit := 999999;
      v_ai_limit := 999999;
    ELSE
      v_campaigns_limit := 10;
      v_posts_limit := 50;
      v_ai_limit := 100;
  END CASE;
  
  RETURN QUERY
  SELECT 
    COALESCE(tus.campaigns_last_30_days, 0)::INTEGER as campaigns_used,
    v_campaigns_limit as campaigns_limit,
    COALESCE(tus.posts_last_30_days, 0)::INTEGER as posts_used,
    v_posts_limit as posts_limit,
    COALESCE(tus.ai_generations, 0)::INTEGER as ai_used,
    v_ai_limit as ai_limit,
    (
      COALESCE(tus.campaigns_last_30_days, 0) > v_campaigns_limit OR
      COALESCE(tus.posts_last_30_days, 0) > v_posts_limit OR
      COALESCE(tus.ai_generations, 0) > v_ai_limit
    ) as is_over_limit
  FROM tenant_usage_statistics tus
  WHERE tus.tenant_id = p_tenant_id;
END;
$$;

-- Create function to clean up old soft-deleted records
CREATE OR REPLACE FUNCTION cleanup_soft_deleted_records()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  total_deleted INTEGER := 0;
  table_deleted INTEGER;
BEGIN
  -- Delete campaigns older than 90 days
  DELETE FROM campaigns 
  WHERE deleted_at IS NOT NULL 
  AND deleted_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS table_deleted = ROW_COUNT;
  total_deleted := total_deleted + table_deleted;
  
  -- Delete campaign posts older than 90 days
  DELETE FROM campaign_posts 
  WHERE deleted_at IS NOT NULL 
  AND deleted_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS table_deleted = ROW_COUNT;
  total_deleted := total_deleted + table_deleted;
  
  -- Delete old audit logs older than 1 year
  DELETE FROM audit_logs 
  WHERE created_at < NOW() - INTERVAL '1 year';
  GET DIAGNOSTICS table_deleted = ROW_COUNT;
  total_deleted := total_deleted + table_deleted;
  
  RETURN total_deleted;
END;
$$;

-- Schedule periodic refresh of materialized views (requires pg_cron extension)
-- This would be set up separately in production
-- SELECT cron.schedule('refresh-campaign-stats', '*/15 * * * *', 'SELECT refresh_campaign_statistics()');
-- SELECT cron.schedule('refresh-tenant-usage', '*/30 * * * *', 'REFRESH MATERIALIZED VIEW CONCURRENTLY tenant_usage_statistics');

-- Add comments for documentation
COMMENT ON MATERIALIZED VIEW campaign_statistics IS 'Pre-computed campaign statistics for performance';
COMMENT ON MATERIALIZED VIEW tenant_usage_statistics IS 'Pre-computed tenant usage for subscription limits';
COMMENT ON FUNCTION get_tenant_usage_with_limits IS 'Get tenant usage with subscription tier limits';
COMMENT ON FUNCTION cleanup_soft_deleted_records IS 'Clean up old soft-deleted records for GDPR compliance';