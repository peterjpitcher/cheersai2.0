-- =============================================================================
-- Publishing Domain Migration
-- =============================================================================
-- Creates publishing and audit tables:
--   publish_jobs, publish_attempts, audit_log
-- publish_jobs has UNIQUE idempotency_key (DATA-04) and EXCLUDE constraint
-- to prevent concurrent jobs for the same content+platform.
-- audit_log is append-only: RLS allows SELECT and INSERT only (DATA-06).
-- RLS enabled on all tables with account-scoped policies (D-11).
-- =============================================================================

-- Required for EXCLUDE USING gist with non-geometric types
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- Table: publish_jobs (DATA-04: idempotency + exclusion constraint)
-- ---------------------------------------------------------------------------

CREATE TABLE public.publish_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  content_item_id uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  platform public.platform NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  status public.content_status NOT NULL DEFAULT 'queued',
  scheduled_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  error_code text,
  retry_count integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 4,
  platform_post_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Prevent concurrent jobs for the same content+platform (DATA-04)
  EXCLUDE USING gist (
    content_item_id WITH =,
    platform WITH =
  ) WHERE (status IN ('queued', 'publishing'))
);

CREATE INDEX idx_publish_jobs_account_status ON public.publish_jobs(account_id, status);
CREATE INDEX idx_publish_jobs_scheduled_queued ON public.publish_jobs(scheduled_at)
  WHERE status = 'queued';

CREATE TRIGGER trg_publish_jobs_updated_at
  BEFORE UPDATE ON public.publish_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.publish_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "publish_jobs_select" ON public.publish_jobs
  FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "publish_jobs_insert" ON public.publish_jobs
  FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "publish_jobs_update" ON public.publish_jobs
  FOR UPDATE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "publish_jobs_delete" ON public.publish_jobs
  FOR DELETE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Table: publish_attempts (handler-side idempotency)
-- ---------------------------------------------------------------------------

CREATE TABLE public.publish_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publish_job_id uuid NOT NULL REFERENCES public.publish_jobs(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL,
  status text NOT NULL CHECK (status IN ('started', 'succeeded', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_details jsonb,
  platform_response jsonb,
  UNIQUE (publish_job_id, attempt_number)
);

CREATE INDEX idx_publish_attempts_account ON public.publish_attempts(account_id);

ALTER TABLE public.publish_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "publish_attempts_select" ON public.publish_attempts
  FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "publish_attempts_insert" ON public.publish_attempts
  FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "publish_attempts_update" ON public.publish_attempts
  FOR UPDATE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "publish_attempts_delete" ON public.publish_attempts
  FOR DELETE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Table: audit_log (DATA-06: append-only audit trail)
-- ---------------------------------------------------------------------------

CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  operation_type text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  operation_status text NOT NULL DEFAULT 'success',
  details jsonb,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_account_created ON public.audit_log(account_id, created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Audit log is append-only: SELECT and INSERT only (no UPDATE or DELETE for anon role)
CREATE POLICY "audit_log_select" ON public.audit_log
  FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "audit_log_insert" ON public.audit_log
  FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
