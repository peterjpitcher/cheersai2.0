-- Address Supabase DB linter warnings:
-- - auth_rls_initplan: wrap auth.* calls in SELECT within policies
-- - multiple_permissive_policies: remove duplicate/select policies and split superadmin manage

-- 0) Helper: ensure tables exist before mutating policies
DO $$
BEGIN
  -- USERS: drop *_fixed duplicates
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users') THEN
    EXECUTE 'DROP POLICY IF EXISTS "users_select_fixed" ON public.users';
    EXECUTE 'DROP POLICY IF EXISTS "users_insert_fixed" ON public.users';
    EXECUTE 'DROP POLICY IF EXISTS "users_update_fixed" ON public.users';
    EXECUTE 'DROP POLICY IF EXISTS "users_delete_fixed" ON public.users';
  END IF;

  -- TENANTS: drop *_fixed and legacy variants if present
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='tenants') THEN
    EXECUTE 'DROP POLICY IF EXISTS "tenants_select_fixed" ON public.tenants';
    EXECUTE 'DROP POLICY IF EXISTS "tenants_insert_fixed" ON public.tenants';
    EXECUTE 'DROP POLICY IF EXISTS "tenants_update_fixed" ON public.tenants';
    EXECUTE 'DROP POLICY IF EXISTS "tenants_delete_fixed" ON public.tenants';
    EXECUTE 'DROP POLICY IF EXISTS "tenants_insert_owner_match" ON public.tenants';
    EXECUTE 'DROP POLICY IF EXISTS "tenants_insert_superadmin" ON public.tenants';
  END IF;

  -- CAMPAIGNS: drop *_fixed and legacy broad policy
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='campaigns') THEN
    EXECUTE 'DROP POLICY IF EXISTS "campaigns_select_fixed" ON public.campaigns';
    EXECUTE 'DROP POLICY IF EXISTS "campaigns_insert_fixed" ON public.campaigns';
    EXECUTE 'DROP POLICY IF EXISTS "campaigns_update_fixed" ON public.campaigns';
    EXECUTE 'DROP POLICY IF EXISTS "campaigns_delete_fixed" ON public.campaigns';
    EXECUTE 'DROP POLICY IF EXISTS "Users can view campaigns from their tenant" ON public.campaigns';
  END IF;

  -- USER_TENANTS: drop *_fixed duplicates
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_tenants') THEN
    EXECUTE 'DROP POLICY IF EXISTS "user_tenants_select_fixed" ON public.user_tenants';
    EXECUTE 'DROP POLICY IF EXISTS "user_tenants_insert_fixed" ON public.user_tenants';
    EXECUTE 'DROP POLICY IF EXISTS "user_tenants_update_fixed" ON public.user_tenants';
    EXECUTE 'DROP POLICY IF EXISTS "user_tenants_delete_fixed" ON public.user_tenants';
  END IF;
END $$;

-- 1) Guardrail audit log policies: wrap auth.uid in sub-selects
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='guardrail_audit_log') THEN
    EXECUTE 'DROP POLICY IF EXISTS tenant_can_select_guardrail_audit ON public.guardrail_audit_log';
    EXECUTE 'CREATE POLICY tenant_can_select_guardrail_audit ON public.guardrail_audit_log
              FOR SELECT USING (
                tenant_id IN (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
              )';

    EXECUTE 'DROP POLICY IF EXISTS insert_via_trigger_guardrail_audit ON public.guardrail_audit_log';
    EXECUTE 'CREATE POLICY insert_via_trigger_guardrail_audit ON public.guardrail_audit_log
              FOR INSERT WITH CHECK (
                tenant_id IN (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
                AND changed_by = (SELECT auth.uid())
              )';
  END IF;
END $$;

-- 2) Audit log policy: wrap auth.uid in sub-selects
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='audit_log') THEN
    EXECUTE 'DROP POLICY IF EXISTS audit_log_tenant_read ON public.audit_log';
    EXECUTE 'CREATE POLICY audit_log_tenant_read ON public.audit_log FOR SELECT USING (
               tenant_id IN (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
             )';
  END IF;
END $$;

-- 3) Split superadmin manage policies to avoid multiple permissive SELECT policies
--    Keep a single read policy per table, and separate write policies for superadmin
DO $$
BEGIN
  -- events
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='events') THEN
    EXECUTE 'DROP POLICY IF EXISTS events_superadmin_manage ON public.events';
    EXECUTE 'CREATE POLICY events_superadmin_insert ON public.events FOR INSERT
              WITH CHECK (public.is_superadmin())';
    EXECUTE 'CREATE POLICY events_superadmin_update ON public.events FOR UPDATE
              USING (public.is_superadmin()) WITH CHECK (public.is_superadmin())';
    EXECUTE 'CREATE POLICY events_superadmin_delete ON public.events FOR DELETE
              USING (public.is_superadmin())';
  END IF;

  -- event_occurrences
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='event_occurrences') THEN
    EXECUTE 'DROP POLICY IF EXISTS event_occurrences_superadmin_manage ON public.event_occurrences';
    EXECUTE 'CREATE POLICY event_occurrences_superadmin_insert ON public.event_occurrences FOR INSERT
              WITH CHECK (public.is_superadmin())';
    EXECUTE 'CREATE POLICY event_occurrences_superadmin_update ON public.event_occurrences FOR UPDATE
              USING (public.is_superadmin()) WITH CHECK (public.is_superadmin())';
    EXECUTE 'CREATE POLICY event_occurrences_superadmin_delete ON public.event_occurrences FOR DELETE
              USING (public.is_superadmin())';
  END IF;

  -- event_briefs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='event_briefs') THEN
    EXECUTE 'DROP POLICY IF EXISTS event_briefs_superadmin_manage ON public.event_briefs';
    EXECUTE 'CREATE POLICY event_briefs_superadmin_insert ON public.event_briefs FOR INSERT
              WITH CHECK (public.is_superadmin())';
    EXECUTE 'CREATE POLICY event_briefs_superadmin_update ON public.event_briefs FOR UPDATE
              USING (public.is_superadmin()) WITH CHECK (public.is_superadmin())';
    EXECUTE 'CREATE POLICY event_briefs_superadmin_delete ON public.event_briefs FOR DELETE
              USING (public.is_superadmin())';
  END IF;

  -- idea_instances
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='idea_instances') THEN
    EXECUTE 'DROP POLICY IF EXISTS idea_instances_superadmin_manage ON public.idea_instances';
    EXECUTE 'CREATE POLICY idea_instances_superadmin_insert ON public.idea_instances FOR INSERT
              WITH CHECK (public.is_superadmin())';
    EXECUTE 'CREATE POLICY idea_instances_superadmin_update ON public.idea_instances FOR UPDATE
              USING (public.is_superadmin()) WITH CHECK (public.is_superadmin())';
    EXECUTE 'CREATE POLICY idea_instances_superadmin_delete ON public.idea_instances FOR DELETE
              USING (public.is_superadmin())';
  END IF;
END $$;

