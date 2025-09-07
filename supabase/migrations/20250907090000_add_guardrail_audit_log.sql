-- Create audit log table for content guardrail changes
-- Fixes runtime error: relation "public.guardrail_audit_log" does not exist

CREATE TABLE IF NOT EXISTS public.guardrail_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guardrail_id UUID NOT NULL REFERENCES public.content_guardrails(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  old_values JSONB,
  new_values JSONB,
  changed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_guardrail_audit_log_guardrail_id ON public.guardrail_audit_log(guardrail_id);
CREATE INDEX IF NOT EXISTS idx_guardrail_audit_log_tenant_id ON public.guardrail_audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_guardrail_audit_log_created_at ON public.guardrail_audit_log(created_at DESC);

-- Enable RLS with sensible policies
ALTER TABLE public.guardrail_audit_log ENABLE ROW LEVEL SECURITY;

-- Allow tenant members to view their tenant's audit records
DROP POLICY IF EXISTS "tenant_can_select_guardrail_audit" ON public.guardrail_audit_log;
CREATE POLICY "tenant_can_select_guardrail_audit" ON public.guardrail_audit_log
  FOR SELECT
  USING (
    tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  );

-- Allow inserts by application triggers for the acting user and tenant
DROP POLICY IF EXISTS "insert_via_trigger_guardrail_audit" ON public.guardrail_audit_log;
CREATE POLICY "insert_via_trigger_guardrail_audit" ON public.guardrail_audit_log
  FOR INSERT
  WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
    AND changed_by = auth.uid()
  );

COMMENT ON TABLE public.guardrail_audit_log IS 'Audit trail of content_guardrails changes created by trigger log_guardrail_change()';
COMMENT ON COLUMN public.guardrail_audit_log.action IS 'TG_OP from trigger: INSERT, UPDATE, or DELETE';
