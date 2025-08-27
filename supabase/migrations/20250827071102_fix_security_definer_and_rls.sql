-- Fix security issues identified by Supabase linter

-- 1. Fix SECURITY DEFINER on superadmin_dashboard view
-- Drop and recreate the view without SECURITY DEFINER
DROP VIEW IF EXISTS superadmin_dashboard;

-- Recreate view without SECURITY DEFINER (SECURITY INVOKER is default)
CREATE VIEW superadmin_dashboard AS
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
WHERE is_superadmin() = true  -- Only allow superadmins to query this view
GROUP BY t.id
ORDER BY t.created_at DESC;

-- Grant access to the view
GRANT SELECT ON superadmin_dashboard TO authenticated;

-- Re-add comment
COMMENT ON VIEW superadmin_dashboard IS 'Overview of all tenants and their usage for superadmins';

-- 2. Enable RLS on ai_platform_prompts table
ALTER TABLE ai_platform_prompts ENABLE ROW LEVEL SECURITY;

-- Create policies for ai_platform_prompts
-- Only superadmins can view prompts
CREATE POLICY "Only superadmins can view prompts" ON ai_platform_prompts
  FOR SELECT TO authenticated
  USING (is_superadmin());

-- Only superadmins can insert prompts
CREATE POLICY "Only superadmins can insert prompts" ON ai_platform_prompts
  FOR INSERT TO authenticated
  WITH CHECK (is_superadmin());

-- Only superadmins can update prompts
CREATE POLICY "Only superadmins can update prompts" ON ai_platform_prompts
  FOR UPDATE TO authenticated
  USING (is_superadmin())
  WITH CHECK (is_superadmin());

-- Only superadmins can delete prompts
CREATE POLICY "Only superadmins can delete prompts" ON ai_platform_prompts
  FOR DELETE TO authenticated
  USING (is_superadmin());

-- 3. Enable RLS on ai_platform_prompt_history table
ALTER TABLE ai_platform_prompt_history ENABLE ROW LEVEL SECURITY;

-- Create policies for ai_platform_prompt_history
-- Only superadmins can view prompt history
CREATE POLICY "Only superadmins can view prompt history" ON ai_platform_prompt_history
  FOR SELECT TO authenticated
  USING (is_superadmin());

-- Only superadmins can insert prompt history (via trigger or manual)
CREATE POLICY "Only superadmins can insert prompt history" ON ai_platform_prompt_history
  FOR INSERT TO authenticated
  WITH CHECK (is_superadmin());

-- Only superadmins can update prompt history (should rarely happen)
CREATE POLICY "Only superadmins can update prompt history" ON ai_platform_prompt_history
  FOR UPDATE TO authenticated
  USING (is_superadmin())
  WITH CHECK (is_superadmin());

-- Only superadmins can delete prompt history
CREATE POLICY "Only superadmins can delete prompt history" ON ai_platform_prompt_history
  FOR DELETE TO authenticated
  USING (is_superadmin());

-- Add comments documenting security model
COMMENT ON TABLE ai_platform_prompts IS 'Platform-specific AI prompts manageable only by superadmins, protected by RLS';
COMMENT ON TABLE ai_platform_prompt_history IS 'Version history of AI prompts, accessible only to superadmins, protected by RLS';