-- =============================================================================
-- Realtime & Notification Schema Fix Migration
-- =============================================================================
-- 1. Adds missing message/metadata columns to notifications (schema mismatch fix)
-- 2. Enables Supabase Realtime publication on publish_jobs and notifications
-- 3. Sets REPLICA IDENTITY FULL for status-transition detection in UPDATE events
-- 4. Adds partial index for failed publish count queries
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Fix notifications schema mismatch (code uses message + metadata columns)
-- ---------------------------------------------------------------------------

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS message text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}';

-- ---------------------------------------------------------------------------
-- 2. Enable Realtime publication (D-01)
-- ---------------------------------------------------------------------------

ALTER PUBLICATION supabase_realtime ADD TABLE public.publish_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- ---------------------------------------------------------------------------
-- 3. REPLICA IDENTITY FULL — UPDATE events include old row for transition detection
-- ---------------------------------------------------------------------------

ALTER TABLE public.publish_jobs REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

-- ---------------------------------------------------------------------------
-- 4. Partial index for attention-needed (failed publish count) query
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_publish_jobs_failed
  ON public.publish_jobs(account_id)
  WHERE status = 'failed';
