-- Fix for Issue #257: Missing User Activity Log (Last 30 Days)
-- Simple, efficient activity logging with proper indexes

-- Create activity log table (simple structure, partition later if needed)
CREATE TABLE IF NOT EXISTS public.user_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  action_category text NOT NULL CHECK (action_category IN (
    'authentication',
    'content_management', 
    'workflow',
    'user_management',
    'template_management',
    'settings',
    'api_usage',
    'file_operations'
  )),
  resource_type text,
  resource_id uuid,
  resource_name text,
  brand_id uuid,
  ip_address inet,
  user_agent text,
  session_id text,
  duration_ms integer,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT NOW()
);
-- Efficient index for "last 30 days" queries
CREATE INDEX IF NOT EXISTS idx_activity_user_30d
ON public.user_activity_log (user_id, created_at DESC);
-- Index for filtering by category
CREATE INDEX IF NOT EXISTS idx_activity_category 
ON public.user_activity_log (action_category, created_at DESC);
-- Index for resource lookups
CREATE INDEX IF NOT EXISTS idx_activity_resource
ON public.user_activity_log (resource_type, resource_id) 
WHERE resource_id IS NOT NULL;
-- Index for brand-specific queries
CREATE INDEX IF NOT EXISTS idx_activity_brand
ON public.user_activity_log (brand_id, created_at DESC) 
WHERE brand_id IS NOT NULL;
-- Function to log activity from API layer (not triggers)
CREATE OR REPLACE FUNCTION log_user_activity(
  p_user_id uuid,
  p_action_type text,
  p_action_category text,
  p_resource_type text DEFAULT NULL,
  p_resource_id uuid DEFAULT NULL,
  p_resource_name text DEFAULT NULL,
  p_brand_id uuid DEFAULT NULL,
  p_ip_address inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_session_id text DEFAULT NULL,
  p_duration_ms integer DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid AS $$
DECLARE
  v_activity_id uuid;
BEGIN
  INSERT INTO public.user_activity_log (
    user_id, action_type, action_category,
    resource_type, resource_id, resource_name,
    brand_id, ip_address, user_agent,
    session_id, duration_ms, metadata
  ) VALUES (
    p_user_id, p_action_type, p_action_category,
    p_resource_type, p_resource_id, p_resource_name,
    p_brand_id, p_ip_address, p_user_agent,
    p_session_id, p_duration_ms, p_metadata
  ) RETURNING id INTO v_activity_id;
  
  RETURN v_activity_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Function to get user activity for last N days
CREATE OR REPLACE FUNCTION get_user_activity(
  p_user_id uuid,
  p_days integer DEFAULT 30
) RETURNS TABLE (
  id uuid,
  action_type text,
  action_category text,
  resource_type text,
  resource_id uuid,
  resource_name text,
  brand_id uuid,
  duration_ms integer,
  metadata jsonb,
  created_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ual.id,
    ual.action_type,
    ual.action_category,
    ual.resource_type,
    ual.resource_id,
    ual.resource_name,
    ual.brand_id,
    ual.duration_ms,
    ual.metadata,
    ual.created_at
  FROM public.user_activity_log ual
  WHERE ual.user_id = p_user_id
  AND ual.created_at >= NOW() - INTERVAL '1 day' * p_days
  ORDER BY ual.created_at DESC
  LIMIT 1000; -- Reasonable limit for UI display
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
-- Function to get activity summary
CREATE OR REPLACE FUNCTION get_user_activity_summary(
  p_user_id uuid,
  p_days integer DEFAULT 30
) RETURNS jsonb AS $$
DECLARE
  v_summary jsonb;
BEGIN
  WITH activity_data AS (
    SELECT * FROM public.user_activity_log
    WHERE user_id = p_user_id
    AND created_at >= NOW() - INTERVAL '1 day' * p_days
  ),
  category_counts AS (
    SELECT 
      action_category,
      COUNT(*) as count
    FROM activity_data
    GROUP BY action_category
  ),
  daily_counts AS (
    SELECT 
      DATE(created_at) as day,
      COUNT(*) as count
    FROM activity_data
    GROUP BY DATE(created_at)
  ),
  hourly_distribution AS (
    SELECT 
      EXTRACT(HOUR FROM created_at)::int as hour,
      COUNT(*) as count
    FROM activity_data
    GROUP BY EXTRACT(HOUR FROM created_at)
  ),
  recent_resources AS (
    SELECT DISTINCT ON (resource_id)
      resource_type,
      resource_id,
      resource_name,
      created_at
    FROM activity_data
    WHERE resource_id IS NOT NULL
    ORDER BY resource_id, created_at DESC
    LIMIT 10
  )
  SELECT jsonb_build_object(
    'total_actions', (SELECT COUNT(*) FROM activity_data),
    'by_category', (SELECT jsonb_object_agg(action_category, count) FROM category_counts),
    'by_day', (SELECT jsonb_object_agg(day::text, count) FROM daily_counts),
    'by_hour', (SELECT jsonb_object_agg(hour::text, count) FROM hourly_distribution),
    'recent_items', (SELECT jsonb_agg(row_to_json(r)) FROM recent_resources r),
    'date_range', jsonb_build_object(
      'start', (SELECT MIN(created_at) FROM activity_data),
      'end', (SELECT MAX(created_at) FROM activity_data)
    )
  ) INTO v_summary;
  
  RETURN v_summary;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
-- RLS policies
ALTER TABLE public.user_activity_log ENABLE ROW LEVEL SECURITY;
-- Users can view their own activity
CREATE POLICY "Users can view own activity" ON public.user_activity_log
  FOR SELECT USING (auth.uid() = user_id);
-- Admins can view all activity
CREATE POLICY "Admins can view all activity" ON public.user_activity_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM auth.users 
      WHERE id = auth.uid() 
      AND (raw_user_meta_data->>'role' = 'admin')
    )
  );
-- Retention policy function (run periodically)
CREATE OR REPLACE FUNCTION cleanup_old_activity_logs(
  p_retention_days integer DEFAULT 90
) RETURNS integer AS $$
DECLARE
  v_deleted_count integer;
BEGIN
  -- Delete logs older than retention period
  -- Keep PII data for shorter period (90 days)
  -- Keep non-PII data longer if needed
  
  -- First, clear PII from old records
  UPDATE public.user_activity_log
  SET 
    ip_address = NULL,
    user_agent = NULL,
    session_id = NULL
  WHERE created_at < NOW() - INTERVAL '1 day' * p_retention_days
  AND (ip_address IS NOT NULL OR user_agent IS NOT NULL OR session_id IS NOT NULL);
  
  -- Optionally delete very old records (e.g., > 365 days)
  DELETE FROM public.user_activity_log
  WHERE created_at < NOW() - INTERVAL '365 days';
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Create a scheduled job to run cleanup (if using pg_cron)
-- SELECT cron.schedule('cleanup-activity-logs', '0 2 * * 0', 'SELECT cleanup_old_activity_logs();');;
