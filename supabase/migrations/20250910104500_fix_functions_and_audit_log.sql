-- Align functions with current schema and canonical audit table

-- 1) Fix increment_guardrails_usage to use existing columns
DROP FUNCTION IF EXISTS public.increment_guardrails_usage(uuid);
CREATE OR REPLACE FUNCTION public.increment_guardrails_usage(guardrail_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Update usage counters on content_guardrails using current column names
  UPDATE public.content_guardrails
  SET 
    times_applied = COALESCE(times_applied, 0) + 1,
    last_applied_at = NOW(),
    updated_at = NOW()
  WHERE id = guardrail_id;
END;
$$;

COMMENT ON FUNCTION public.increment_guardrails_usage(uuid) IS 'Atomically increments times_applied and updates last_applied_at for a guardrail.';

-- 2) Update delete_user_account to reference audit_log (singular) and meta column
CREATE OR REPLACE FUNCTION public.delete_user_account(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_is_sole_owner boolean := false;
  v_other_users_count integer;
  v_result json;
BEGIN
  -- Check if user exists
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN
    RETURN json_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Get user's tenant
  SELECT tenant_id INTO v_tenant_id FROM public.users WHERE id = p_user_id;

  -- Check if user is sole tenant owner
  IF v_tenant_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.tenants WHERE id = v_tenant_id AND owner_id = p_user_id) THEN
      SELECT COUNT(*) INTO v_other_users_count FROM public.users WHERE tenant_id = v_tenant_id AND id != p_user_id;
      IF v_other_users_count = 0 THEN
        v_is_sole_owner := true;
      END IF;
    END IF;
  END IF;

  BEGIN
    -- Clean up orphaned references (set to NULL to preserve history)
    UPDATE public.team_invitations SET invited_by = NULL WHERE invited_by = p_user_id;
    UPDATE public.content_guardrails SET user_id = NULL WHERE user_id = p_user_id;
    UPDATE public.content_guardrails_history SET user_id = NULL WHERE user_id = p_user_id;
    UPDATE public.ai_generation_feedback SET user_id = NULL WHERE user_id = p_user_id;
    UPDATE public.campaign_posts SET approved_by = NULL WHERE approved_by = p_user_id;
    UPDATE public.ai_platform_prompts SET created_by = NULL WHERE created_by = p_user_id;
    UPDATE public.ai_platform_prompt_history SET created_by = NULL WHERE created_by = p_user_id;

    -- Preserve audit logs but anonymize (canonical table: audit_log)
    UPDATE public.audit_log 
    SET user_id = NULL,
        meta = jsonb_set(
          COALESCE(meta, '{}'::jsonb),
          '{deleted_user_id}',
          to_jsonb(p_user_id::text)
        )
    WHERE user_id = p_user_id;

    -- Delete tenant if user is sole owner (cascades to all tenant data)
    IF v_is_sole_owner AND v_tenant_id IS NOT NULL THEN
      DELETE FROM public.tenants WHERE id = v_tenant_id;
    END IF;

    -- Delete user record
    DELETE FROM public.users WHERE id = p_user_id;

    v_result := json_build_object(
      'success', true,
      'tenant_deleted', v_is_sole_owner,
      'tenant_id', v_tenant_id
    );
    RETURN v_result;

  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
  END;
END;
$$;

COMMENT ON FUNCTION public.delete_user_account(uuid) IS 'Permanently deletes a user and anonymizes references; writes to audit_log.meta.';

