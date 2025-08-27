-- Fix for critical guardrails update bug
-- This function atomically increments the times_applied counter for each guardrail
-- preventing data corruption from the previous implementation

CREATE OR REPLACE FUNCTION increment_guardrails_usage(guardrail_ids UUID[])
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  -- Atomically increment times_applied for each guardrail
  UPDATE content_guardrails
  SET 
    times_applied = COALESCE(times_applied, 0) + 1,
    last_applied_at = NOW()
  WHERE id = ANY(guardrail_ids);
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION increment_guardrails_usage(UUID[]) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION increment_guardrails_usage(UUID[]) IS 
'Atomically increments the usage counter for content guardrails. Fixes the critical bug where all guardrails were updated with the same value.';
