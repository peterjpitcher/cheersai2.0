-- Advisory lock functions for cron orchestration

CREATE OR REPLACE FUNCTION acquire_inspiration_lock()
RETURNS BOOLEAN
LANGUAGE sql
AS $$
  SELECT pg_try_advisory_lock(9876543210);
$$;

CREATE OR REPLACE FUNCTION release_inspiration_lock()
RETURNS BOOLEAN
LANGUAGE sql
AS $$
  SELECT pg_advisory_unlock(9876543210);
$$;

COMMENT ON FUNCTION acquire_inspiration_lock IS 'Returns true if lock acquired; prevents overlapping cron runs.';
COMMENT ON FUNCTION release_inspiration_lock IS 'Releases the advisory lock for inspiration job.';

