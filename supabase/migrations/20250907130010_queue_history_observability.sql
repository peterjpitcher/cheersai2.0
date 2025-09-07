-- Queue & History Observability Enhancements (Issue #135)
-- - Add richer retry/attempt tracking on publishing_queue
-- - Add denormalised fields to publishing_history for UI surfacing
-- - Normalise legacy statuses

-- publishing_queue: add attempt tracking fields
ALTER TABLE public.publishing_queue
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

-- Helpful index for schedulers/processors that look at next attempt time
CREATE INDEX IF NOT EXISTS idx_publishing_queue_next_attempt_at
  ON public.publishing_queue (next_attempt_at);

-- Normalise legacy statuses
-- Some rows may still use 'published' or 'retry' from earlier iterations
UPDATE public.publishing_queue SET status = 'completed' WHERE status = 'published';
UPDATE public.publishing_queue SET status = 'pending' WHERE status = 'retry';

-- publishing_history: add fields for connection + platform details surfaced in UI
ALTER TABLE public.publishing_history
  ADD COLUMN IF NOT EXISTS connection_id UUID REFERENCES public.social_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS account_name TEXT,
  ADD COLUMN IF NOT EXISTS external_id TEXT;

-- Backfill history.external_id from legacy platform_post_id
UPDATE public.publishing_history ph
SET external_id = ph.platform_post_id
WHERE ph.platform_post_id IS NOT NULL AND ph.external_id IS NULL;

-- Backfill history.account_name from current social_connections
UPDATE public.publishing_history ph
SET account_name = COALESCE(sc.page_name, sc.account_name)
FROM public.social_connections sc
WHERE ph.social_connection_id = sc.id
  AND ph.account_name IS NULL;

-- Backfill history.connection_id from existing social_connection_id
UPDATE public.publishing_history ph
SET connection_id = ph.social_connection_id
WHERE ph.social_connection_id IS NOT NULL AND ph.connection_id IS NULL;

-- Optional: document columns
COMMENT ON COLUMN public.publishing_queue.last_attempt_at IS 'Timestamp of the most recent processing attempt';
COMMENT ON COLUMN public.publishing_queue.next_attempt_at IS 'Timestamp when the next processing attempt should be made (exponential backoff)';
COMMENT ON COLUMN public.publishing_history.connection_id IS 'Reference to the social connection at time of publish';
COMMENT ON COLUMN public.publishing_history.account_name IS 'Denormalised account/page name at time of publish';
COMMENT ON COLUMN public.publishing_history.external_id IS 'External platform post ID (alias of legacy platform_post_id)';

