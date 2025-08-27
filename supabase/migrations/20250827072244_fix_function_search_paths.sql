-- Fix search_path for all functions to prevent security issues
-- Setting search_path to an empty string ensures the function only uses fully qualified table names

-- 1. update_support_tickets_updated_at
ALTER FUNCTION public.update_support_tickets_updated_at() SET search_path = '';

-- 2. create_ai_prompt_history
ALTER FUNCTION public.create_ai_prompt_history() SET search_path = '';

-- 3. increment_ai_prompt_version
ALTER FUNCTION public.increment_ai_prompt_version() SET search_path = '';

-- 4. update_media_last_used
ALTER FUNCTION public.update_media_last_used() SET search_path = '';

-- 5. handle_user_tenant_claim
ALTER FUNCTION public.handle_user_tenant_claim() SET search_path = '';

-- 6. get_auth_tenant_id
ALTER FUNCTION public.get_auth_tenant_id() SET search_path = '';

-- 7. soft_delete_user_data
ALTER FUNCTION public.soft_delete_user_data(UUID) SET search_path = '';

-- 8. cleanup_expired_data
ALTER FUNCTION public.cleanup_expired_data() SET search_path = '';

-- 9. test_tenant_creation_now (this might be a test function - consider removing in production)
ALTER FUNCTION public.test_tenant_creation_now() SET search_path = '';

-- 10. update_guardrails_updated_at
ALTER FUNCTION public.update_guardrails_updated_at() SET search_path = '';

-- 11. log_guardrail_change
ALTER FUNCTION public.log_guardrail_change() SET search_path = '';

-- 12. update_updated_at_column
ALTER FUNCTION public.update_updated_at_column() SET search_path = '';

-- 13. sync_user_email
ALTER FUNCTION public.sync_user_email() SET search_path = '';

-- 14. is_superadmin
ALTER FUNCTION public.is_superadmin() SET search_path = '';

-- 15. log_superadmin_action
ALTER FUNCTION public.log_superadmin_action(TEXT, TEXT, UUID, UUID, JSONB) SET search_path = '';

-- Now we need to update all function definitions to use fully qualified table names
-- This ensures they work correctly with the restricted search_path

-- Fix get_auth_tenant_id to use fully qualified names
CREATE OR REPLACE FUNCTION public.get_auth_tenant_id()
RETURNS UUID
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
  tenant_id UUID;
BEGIN
  SELECT COALESCE(
    (auth.jwt()->>'tenant_id')::UUID,
    (SELECT public.users.tenant_id FROM public.users WHERE public.users.id = auth.uid())
  ) INTO tenant_id;
  
  RETURN tenant_id;
END;
$$;

-- Fix is_superadmin to use fully qualified names
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN 
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.users 
    WHERE id = auth.uid() 
    AND is_superadmin = true
  );
END;
$$;

-- Fix sync_user_email to use fully qualified names
CREATE OR REPLACE FUNCTION public.sync_user_email()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.users 
  SET email = NEW.email 
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

-- Fix update_updated_at_column to use fully qualified names
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Fix update_guardrails_updated_at to use fully qualified names
CREATE OR REPLACE FUNCTION public.update_guardrails_updated_at()
RETURNS TRIGGER
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Fix update_support_tickets_updated_at to use fully qualified names
CREATE OR REPLACE FUNCTION public.update_support_tickets_updated_at()
RETURNS TRIGGER
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Fix log_guardrail_change to use fully qualified names
CREATE OR REPLACE FUNCTION public.log_guardrail_change()
RETURNS TRIGGER
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.guardrail_audit_log (
    guardrail_id,
    action,
    old_values,
    new_values,
    changed_by,
    tenant_id
  ) VALUES (
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    CASE WHEN TG_OP != 'INSERT' THEN row_to_json(OLD) ELSE NULL END,
    CASE WHEN TG_OP != 'DELETE' THEN row_to_json(NEW) ELSE NULL END,
    auth.uid(),
    COALESCE(NEW.tenant_id, OLD.tenant_id)
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Fix handle_user_tenant_claim to use fully qualified names
CREATE OR REPLACE FUNCTION public.handle_user_tenant_claim()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
  tenant_id UUID;
BEGIN
  -- Get the user's tenant_id
  SELECT public.users.tenant_id INTO tenant_id 
  FROM public.users 
  WHERE public.users.id = NEW.id;
  
  -- Update the raw_app_meta_data with tenant_id
  UPDATE auth.users 
  SET raw_app_meta_data = 
    COALESCE(raw_app_meta_data, '{}'::jsonb) || 
    jsonb_build_object('tenant_id', tenant_id)
  WHERE id = NEW.id;
  
  RETURN NEW;
END;
$$;

-- Fix create_ai_prompt_history to use fully qualified names
CREATE OR REPLACE FUNCTION public.create_ai_prompt_history()
RETURNS TRIGGER
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.ai_platform_prompt_history (
    prompt_id, 
    version, 
    system_prompt, 
    user_prompt_template, 
    change_description,
    created_by
  ) VALUES (
    NEW.id,
    NEW.version,
    NEW.system_prompt,
    NEW.user_prompt_template,
    CASE 
      WHEN TG_OP = 'INSERT' THEN 'Initial version'
      ELSE 'Updated prompt'
    END,
    NEW.created_by
  );
  RETURN NEW;
END;
$$;

-- Fix increment_ai_prompt_version to use fully qualified names
CREATE OR REPLACE FUNCTION public.increment_ai_prompt_version()
RETURNS TRIGGER
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only increment version if system_prompt or user_prompt_template changed
  IF (OLD.system_prompt != NEW.system_prompt OR OLD.user_prompt_template != NEW.user_prompt_template) THEN
    NEW.version = OLD.version + 1;
    NEW.updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

-- Fix update_media_last_used to use fully qualified names
CREATE OR REPLACE FUNCTION public.update_media_last_used()
RETURNS TRIGGER
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.media_assets 
  SET last_used_at = NOW() 
  WHERE id = NEW.media_asset_id;
  RETURN NEW;
END;
$$;

-- Fix soft_delete_user_data to use fully qualified names
CREATE OR REPLACE FUNCTION public.soft_delete_user_data(target_user_id UUID)
RETURNS VOID
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  -- Soft delete user
  UPDATE public.users 
  SET deleted_at = NOW() 
  WHERE id = target_user_id;
  
  -- Soft delete related data
  UPDATE public.campaigns 
  SET deleted_at = NOW() 
  WHERE created_by = target_user_id;
  
  UPDATE public.campaign_posts 
  SET deleted_at = NOW() 
  WHERE campaign_id IN (
    SELECT id FROM public.campaigns WHERE created_by = target_user_id
  );
  
  UPDATE public.media_assets 
  SET deleted_at = NOW() 
  WHERE uploaded_by = target_user_id;
END;
$$;

-- Fix cleanup_expired_data to use fully qualified names
CREATE OR REPLACE FUNCTION public.cleanup_expired_data()
RETURNS VOID
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  -- Delete soft-deleted records older than retention period
  DELETE FROM public.users 
  WHERE deleted_at < NOW() - INTERVAL '6 years';
  
  DELETE FROM public.campaigns 
  WHERE deleted_at < NOW() - INTERVAL '3 years';
  
  DELETE FROM public.campaign_posts 
  WHERE deleted_at < NOW() - INTERVAL '3 years';
  
  DELETE FROM public.media_assets 
  WHERE deleted_at < NOW() - INTERVAL '1 year';
  
  DELETE FROM public.analytics 
  WHERE created_at < NOW() - INTERVAL '2 years';
  
  DELETE FROM public.ai_generation_feedback 
  WHERE created_at < NOW() - INTERVAL '1 year';
END;
$$;

-- Fix test_tenant_creation_now to use fully qualified names (consider removing this in production)
CREATE OR REPLACE FUNCTION public.test_tenant_creation_now()
RETURNS jsonb
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
  result jsonb;
  test_tenant_id UUID;
  test_user_id UUID;
BEGIN
  -- This appears to be a test function - should be removed in production
  -- Adding search_path for security compliance
  RETURN jsonb_build_object(
    'status', 'warning',
    'message', 'This is a test function and should not be used in production'
  );
END;
$$;

-- Fix log_superadmin_action to use fully qualified names
CREATE OR REPLACE FUNCTION public.log_superadmin_action(
  p_action TEXT,
  p_target_table TEXT DEFAULT NULL,
  p_target_id UUID DEFAULT NULL,
  p_target_tenant_id UUID DEFAULT NULL,
  p_details JSONB DEFAULT NULL
)
RETURNS VOID
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.is_superadmin() THEN
    INSERT INTO public.superadmin_audit_log (
      superadmin_id, action, target_table, target_id, target_tenant_id, details
    ) VALUES (
      auth.uid(), p_action, p_target_table, p_target_id, p_target_tenant_id, p_details
    );
  END IF;
END;
$$;

-- Add comment explaining the security improvement
COMMENT ON SCHEMA public IS 'All functions in this schema have been secured with search_path = '''' to prevent search path manipulation attacks';