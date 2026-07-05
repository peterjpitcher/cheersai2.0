-- Track failed publish jobs that have been reviewed/cleared without deleting
-- their audit trail.

ALTER TABLE public.publish_jobs
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_kind text,
  ADD COLUMN IF NOT EXISTS resolution_note text;

DO $$
BEGIN
  ALTER TABLE public.publish_jobs
    ADD CONSTRAINT publish_jobs_resolution_kind_check
    CHECK (
      resolution_kind IS NULL
      OR resolution_kind IN (
        'user_archived_failure',
        'stale_failure_archived',
        'legacy_gbp_removed',
        'unsupported_platform'
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_publish_jobs_active_failed
  ON public.publish_jobs(account_id, status, updated_at DESC)
  WHERE status = 'failed' AND resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_publish_jobs_unresolved_due
  ON public.publish_jobs(next_attempt_at)
  WHERE status = 'queued' AND resolved_at IS NULL;
