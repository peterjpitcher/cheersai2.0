SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;
CREATE SCHEMA IF NOT EXISTS "graphql_public";
ALTER SCHEMA "graphql_public" OWNER TO "supabase_admin";
CREATE SCHEMA IF NOT EXISTS "public";
ALTER SCHEMA "public" OWNER TO "pg_database_owner";
COMMENT ON SCHEMA "public" IS 'All functions in this schema have been secured with search_path = '''' to prevent search path manipulation attacks';
CREATE TYPE "public"."user_status" AS ENUM (
    'active',
    'inactive',
    'pending',
    'suspended'
);
ALTER TYPE "public"."user_status" OWNER TO "postgres";
CREATE TYPE "public"."workflow_status" AS ENUM (
    'draft',
    'active',
    'archived'
);
ALTER TYPE "public"."workflow_status" OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."acquire_inspiration_lock"() RETURNS boolean
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  SELECT pg_try_advisory_lock(9876543210);
$$;
ALTER FUNCTION "public"."acquire_inspiration_lock"() OWNER TO "postgres";
COMMENT ON FUNCTION "public"."acquire_inspiration_lock"() IS 'Returns true if lock acquired; prevents overlapping cron runs.';
CREATE OR REPLACE FUNCTION "public"."can_deactivate_user"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
DECLARE
  v_user_role text;
  v_active_admin_count int;
BEGIN
  -- Get user role
  SELECT raw_user_meta_data->>'role' INTO v_user_role
  FROM auth.users WHERE id = p_user_id;
  
  -- If not an admin, can deactivate
  IF v_user_role != 'admin' THEN
    RETURN true;
  END IF;
  
  -- Count active admins
  SELECT COUNT(*) INTO v_active_admin_count
  FROM auth.users u
  JOIN public.user_accounts ua ON ua.id = u.id
  WHERE u.raw_user_meta_data->>'role' = 'admin'
  AND ua.status = 'active'
  AND u.id != p_user_id;
  
  -- Can't deactivate if this is the last active admin
  RETURN v_active_admin_count > 0;
END;
$$;
ALTER FUNCTION "public"."can_deactivate_user"("p_user_id" "uuid") OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."can_remove_brand_admin"("p_user_id" "uuid", "p_brand_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
DECLARE
  v_user_role text;
  v_admin_count integer;
BEGIN
  -- Get user's role for this brand
  SELECT role INTO v_user_role
  FROM user_brand_permissions
  WHERE user_id = p_user_id
  AND brand_id = p_brand_id;
  
  -- If not an admin/owner, can remove
  IF v_user_role NOT IN ('admin', 'owner') THEN
    RETURN true;
  END IF;
  
  -- Count other admins/owners for this brand
  SELECT COUNT(*) INTO v_admin_count
  FROM user_brand_permissions
  WHERE brand_id = p_brand_id
  AND user_id != p_user_id
  AND role IN ('admin', 'owner');
  
  -- Can't remove if this is the last admin/owner
  RETURN v_admin_count > 0;
END;
$$;
ALTER FUNCTION "public"."can_remove_brand_admin"("p_user_id" "uuid", "p_brand_id" "uuid") OWNER TO "postgres";
SET default_tablespace = '';
SET default_table_access_method = "heap";
CREATE TABLE IF NOT EXISTS "public"."notification_outbox" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "type" "text" NOT NULL,
    "recipient_id" "uuid",
    "recipient_email" "text",
    "subject" "text" NOT NULL,
    "template_name" "text" NOT NULL,
    "template_data" "jsonb" NOT NULL,
    "priority" integer DEFAULT 5,
    "status" "text" DEFAULT 'pending'::"text",
    "attempts" integer DEFAULT 0,
    "max_attempts" integer DEFAULT 3,
    "scheduled_for" timestamp with time zone DEFAULT "now"(),
    "sent_at" timestamp with time zone,
    "failed_at" timestamp with time zone,
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "notification_outbox_priority_check" CHECK ((("priority" >= 1) AND ("priority" <= 10))),
    CONSTRAINT "notification_outbox_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'sent'::"text", 'failed'::"text"]))),
    CONSTRAINT "notification_outbox_type_check" CHECK (("type" = ANY (ARRAY['email'::"text", 'in_app'::"text", 'webhook'::"text"]))),
    CONSTRAINT "require_recipient" CHECK ((("recipient_id" IS NOT NULL) OR ("recipient_email" IS NOT NULL)))
);
ALTER TABLE "public"."notification_outbox" OWNER TO "postgres";
COMMENT ON TABLE "public"."notification_outbox" IS 'Queue for async notification delivery with exactly-once semantics';
CREATE OR REPLACE FUNCTION "public"."claim_notifications"("p_limit" integer DEFAULT 25) RETURNS SETOF "public"."notification_outbox"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  UPDATE notification_outbox n
  SET status = 'processing', attempts = attempts + 1
  WHERE n.id IN (
    SELECT id 
    FROM notification_outbox
    WHERE status = 'pending' 
      AND scheduled_for <= NOW() 
      AND attempts < max_attempts
    ORDER BY priority DESC, created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  RETURNING *;
$$;
ALTER FUNCTION "public"."claim_notifications"("p_limit" integer) OWNER TO "postgres";
COMMENT ON FUNCTION "public"."claim_notifications"("p_limit" integer) IS 'Atomically claim notifications for processing with skip-locked to prevent double-sends';
CREATE OR REPLACE FUNCTION "public"."cleanup_deleted_users"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_record RECORD;
BEGIN
  -- Find users marked for deletion more than 30 days ago
  FOR v_user_record IN 
    SELECT id 
    FROM users 
    WHERE deleted_at IS NOT NULL 
    AND deleted_at < NOW() - INTERVAL '30 days'
  LOOP
    -- Use the hard delete function
    PERFORM delete_user_account(v_user_record.id);
  END LOOP;
END;
$$;
ALTER FUNCTION "public"."cleanup_deleted_users"() OWNER TO "postgres";
COMMENT ON FUNCTION "public"."cleanup_deleted_users"() IS 'Cleans up soft-deleted users after 30-day retention period. Should be run periodically via cron job.';
CREATE OR REPLACE FUNCTION "public"."cleanup_expired_data"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
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
ALTER FUNCTION "public"."cleanup_expired_data"() OWNER TO "postgres";
COMMENT ON FUNCTION "public"."cleanup_expired_data"() IS 'Permanently deletes data past UK ICO retention periods';
CREATE OR REPLACE FUNCTION "public"."cleanup_old_activity_logs"("p_retention_days" integer DEFAULT 90) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_deleted_count integer;
BEGIN
  -- Delete logs older than retention period
  -- Keep PII data for shorter period (90 days)
  -- Keep non-PII data longer if needed
  
  -- First, clear PII from old records
  UPDATE public.user_activity_log
  SET 
    ip_address = NULL,
    user_agent = NULL,
    session_id = NULL
  WHERE created_at < NOW() - INTERVAL '1 day' * p_retention_days
  AND (ip_address IS NOT NULL OR user_agent IS NOT NULL OR session_id IS NOT NULL);
  
  -- Optionally delete very old records (e.g., > 365 days)
  DELETE FROM public.user_activity_log
  WHERE created_at < NOW() - INTERVAL '365 days';
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  RETURN v_deleted_count;
END;
$$;
ALTER FUNCTION "public"."cleanup_old_activity_logs"("p_retention_days" integer) OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."create_ai_prompt_history"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
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
ALTER FUNCTION "public"."create_ai_prompt_history"() OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."create_tenant_and_assign"("p_name" "text", "p_business_type" "text" DEFAULT NULL::"text", "p_brand_voice" "text" DEFAULT NULL::"text", "p_target_audience" "text" DEFAULT NULL::"text", "p_brand_identity" "text" DEFAULT NULL::"text", "p_brand_color" "text" DEFAULT NULL::"text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_tenant_id uuid;
    v_slug text;
    v_user_id uuid;
BEGIN
    -- Get current user
    v_user_id := auth.uid();
    
    -- Check authentication
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Check if user already has a tenant
    IF EXISTS (
        SELECT 1 FROM public.users 
        WHERE id = v_user_id 
        AND tenant_id IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'User already has a tenant assigned';
    END IF;

    -- Generate unique slug
    v_slug := lower(regexp_replace(p_name, '[^a-z0-9]+', '-', 'g'));
    v_slug := v_slug || '-' || extract(epoch from now())::bigint;

    -- Create tenant
    INSERT INTO public.tenants (name, slug, owner_id)
    VALUES (p_name, v_slug, v_user_id)
    RETURNING id INTO v_tenant_id;

    -- Update user with tenant_id
    UPDATE public.users
    SET 
        tenant_id = v_tenant_id,
        role = COALESCE(role, 'owner'),
        updated_at = now()
    WHERE id = v_user_id;

    -- Create brand profile if details provided
    IF p_business_type IS NOT NULL OR p_brand_voice IS NOT NULL THEN
        INSERT INTO public.brand_profiles (
            tenant_id,
            business_type,
            brand_voice,
            target_audience,
            brand_identity,
            primary_color
        ) VALUES (
            v_tenant_id,
            p_business_type,
            p_brand_voice,
            p_target_audience,
            p_brand_identity,
            p_brand_color
        )
        ON CONFLICT (tenant_id) 
        DO UPDATE SET
            business_type = COALESCE(EXCLUDED.business_type, brand_profiles.business_type),
            brand_voice = COALESCE(EXCLUDED.brand_voice, brand_profiles.brand_voice),
            target_audience = COALESCE(EXCLUDED.target_audience, brand_profiles.target_audience),
            brand_identity = COALESCE(EXCLUDED.brand_identity, brand_profiles.brand_identity),
            primary_color = COALESCE(EXCLUDED.primary_color, brand_profiles.primary_color),
            updated_at = now();
    END IF;

    -- Create user_tenants relationship (for multi-tenant support)
    INSERT INTO public.user_tenants (user_id, tenant_id, role)
    VALUES (v_user_id, v_tenant_id, 'owner')
    ON CONFLICT (user_id, tenant_id) DO NOTHING;

    -- Return success with IDs
    RETURN json_build_object(
        'success', true,
        'tenant_id', v_tenant_id,
        'slug', v_slug,
        'message', 'Tenant created and assigned successfully'
    );
    
EXCEPTION
    WHEN OTHERS THEN
        -- Log error and re-raise with context
        RAISE EXCEPTION 'Failed to create tenant: %', SQLERRM;
END;
$$;
ALTER FUNCTION "public"."create_tenant_and_assign"("p_name" "text", "p_business_type" "text", "p_brand_voice" "text", "p_target_audience" "text", "p_brand_identity" "text", "p_brand_color" "text") OWNER TO "postgres";
COMMENT ON FUNCTION "public"."create_tenant_and_assign"("p_name" "text", "p_business_type" "text", "p_brand_voice" "text", "p_target_audience" "text", "p_brand_identity" "text", "p_brand_color" "text") IS 'Atomically creates a tenant and assigns it to the current user. 
Prevents circular dependency issues with RLS policies.
Called during onboarding to set up new accounts.';
CREATE OR REPLACE FUNCTION "public"."create_user_account"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.user_accounts (id, status)
  VALUES (NEW.id, 'active')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
ALTER FUNCTION "public"."create_user_account"() OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."create_workflow_and_log_invitations"("p_brand_id" "uuid", "p_workflow_name" "text", "p_workflow_description" "text", "p_created_by" "uuid", "p_workflow_steps" "jsonb", "p_template_id" "uuid" DEFAULT NULL::"uuid", "p_status" "text" DEFAULT 'active'::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_workflow_id uuid;
  v_step record;
  v_step_id uuid;
  v_assignment record;
  v_user_index int;
BEGIN
  -- Validate input
  IF p_workflow_name IS NULL OR trim(p_workflow_name) = '' THEN
    RAISE EXCEPTION 'Workflow name is required';
  END IF;
  
  IF p_brand_id IS NULL THEN
    RAISE EXCEPTION 'Brand ID is required';
  END IF;
  
  IF p_workflow_steps IS NULL OR jsonb_array_length(p_workflow_steps) = 0 THEN
    RAISE EXCEPTION 'At least one workflow step is required';
  END IF;

  -- Start transaction
  BEGIN
    -- Create workflow
    INSERT INTO workflows (
      brand_id, 
      name, 
      description, 
      created_by, 
      template_id, 
      status,
      published_at,
      created_at,
      updated_at
    )
    VALUES (
      p_brand_id, 
      p_workflow_name, 
      p_workflow_description, 
      p_created_by, 
      p_template_id, 
      p_status,
      CASE WHEN p_status = 'active' THEN NOW() ELSE NULL END,
      NOW(),
      NOW()
    )
    RETURNING id INTO v_workflow_id;

    -- Create steps with proper assignments
    FOR v_step IN SELECT * FROM jsonb_array_elements(p_workflow_steps)
    LOOP
      -- Validate step data
      IF v_step.value->>'name' IS NULL THEN
        RAISE EXCEPTION 'Step name is required';
      END IF;
      
      -- Create the step
      INSERT INTO workflow_steps (
        workflow_id,
        name,
        type,
        order_index,
        created_at,
        updated_at
      )
      VALUES (
        v_workflow_id,
        v_step.value->>'name',
        COALESCE(v_step.value->>'type', 'review'),
        COALESCE((v_step.value->>'order')::int, (v_step.value->>'order_index')::int, 0),
        NOW(),
        NOW()
      )
      RETURNING id INTO v_step_id;

      -- Create assignments in the relational table
      IF v_step.value->'assigned_user_ids' IS NOT NULL THEN
        FOR v_user_index IN 0..jsonb_array_length(v_step.value->'assigned_user_ids') - 1
        LOOP
          INSERT INTO workflow_step_assignments (
            step_id,
            user_id,
            role
          )
          VALUES (
            v_step_id,
            (v_step.value->'assigned_user_ids'->>v_user_index)::uuid,
            COALESCE(
              v_step.value->'assigned_roles'->>v_user_index,
              v_step.value->'role_mapping'->>(v_step.value->'assigned_user_ids'->>v_user_index),
              'reviewer' -- Default role
            )::text
          )
          ON CONFLICT (step_id, user_id) DO UPDATE
          SET role = EXCLUDED.role, updated_at = NOW();
        END LOOP;
      END IF;

      -- Log invitations if needed
      IF v_step.value->'assigned_user_ids' IS NOT NULL THEN
        INSERT INTO invitation_logs (
          workflow_step_id,
          user_id,
          invited_at,
          role
        )
        SELECT 
          v_step_id,
          (user_id_text)::uuid,
          NOW(),
          COALESCE(
            v_step.value->'assigned_roles'->>idx::text,
            v_step.value->'role_mapping'->>user_id_text,
            'reviewer'
          )::text
        FROM jsonb_array_elements_text(v_step.value->'assigned_user_ids') 
        WITH ORDINALITY AS t(user_id_text, idx);
      END IF;
    END LOOP;

    RETURN v_workflow_id;
  EXCEPTION
    WHEN OTHERS THEN
      -- Rollback and re-raise with context
      RAISE EXCEPTION 'Failed to create workflow: %', SQLERRM;
  END;
END;
$$;
ALTER FUNCTION "public"."create_workflow_and_log_invitations"("p_brand_id" "uuid", "p_workflow_name" "text", "p_workflow_description" "text", "p_created_by" "uuid", "p_workflow_steps" "jsonb", "p_template_id" "uuid", "p_status" "text") OWNER TO "postgres";
COMMENT ON FUNCTION "public"."create_workflow_and_log_invitations"("p_brand_id" "uuid", "p_workflow_name" "text", "p_workflow_description" "text", "p_created_by" "uuid", "p_workflow_steps" "jsonb", "p_template_id" "uuid", "p_status" "text") IS 'Atomically creates workflow with steps and assignments';
CREATE OR REPLACE FUNCTION "public"."deactivate_user"("p_user_id" "uuid", "p_reason" "text" DEFAULT NULL::"text", "p_changed_by" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_old_status text;
  v_result jsonb;
BEGIN
  -- Get current status
  SELECT status INTO v_old_status
  FROM public.user_accounts
  WHERE id = p_user_id;
  
  IF v_old_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;
  
  IF v_old_status = 'inactive' THEN
    RETURN jsonb_build_object('success', false, 'error', 'User already inactive');
  END IF;
  
  -- Update status
  UPDATE public.user_accounts
  SET 
    status = 'inactive',
    status_reason = p_reason,
    status_changed_at = NOW(),
    status_changed_by = p_changed_by,
    updated_at = NOW()
  WHERE id = p_user_id;
  
  -- Record history
  INSERT INTO public.user_status_history (
    user_id, old_status, new_status, reason, changed_by
  ) VALUES (
    p_user_id, v_old_status, 'inactive', p_reason, p_changed_by
  );
  
  -- Note: Session revocation must be done via Supabase Admin API
  -- from an Edge Function or backend with service role key
  
  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'old_status', v_old_status,
    'new_status', 'inactive'
  );
END;
$$;
ALTER FUNCTION "public"."deactivate_user"("p_user_id" "uuid", "p_reason" "text", "p_changed_by" "uuid") OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."delete_user_account"("p_user_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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
ALTER FUNCTION "public"."delete_user_account"("p_user_id" "uuid") OWNER TO "postgres";
COMMENT ON FUNCTION "public"."delete_user_account"("p_user_id" "uuid") IS 'Permanently deletes a user and anonymizes references; writes to audit_log.meta.';
CREATE OR REPLACE FUNCTION "public"."enqueue_notification"("p_type" "text", "p_subject" "text", "p_template_name" "text", "p_template_data" "jsonb", "p_recipient_id" "uuid" DEFAULT NULL::"uuid", "p_recipient_email" "text" DEFAULT NULL::"text", "p_priority" integer DEFAULT 5, "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_notification_id uuid;
BEGIN
  -- Validate input
  IF p_recipient_id IS NULL AND p_recipient_email IS NULL THEN
    RAISE EXCEPTION 'Either recipient_id or recipient_email must be provided';
  END IF;
  
  IF p_subject IS NULL OR trim(p_subject) = '' THEN
    RAISE EXCEPTION 'Subject is required';
  END IF;
  
  IF p_template_name IS NULL OR trim(p_template_name) = '' THEN
    RAISE EXCEPTION 'Template name is required';
  END IF;

  -- Insert notification
  INSERT INTO notification_outbox (
    type,
    recipient_id,
    recipient_email,
    subject,
    template_name,
    template_data,
    priority,
    metadata,
    scheduled_for
  )
  VALUES (
    p_type,
    p_recipient_id,
    p_recipient_email,
    p_subject,
    p_template_name,
    p_template_data,
    p_priority,
    p_metadata,
    NOW()
  )
  RETURNING id INTO v_notification_id;
  
  RETURN v_notification_id;
END;
$$;
ALTER FUNCTION "public"."enqueue_notification"("p_type" "text", "p_subject" "text", "p_template_name" "text", "p_template_data" "jsonb", "p_recipient_id" "uuid", "p_recipient_email" "text", "p_priority" integer, "p_metadata" "jsonb") OWNER TO "postgres";
COMMENT ON FUNCTION "public"."enqueue_notification"("p_type" "text", "p_subject" "text", "p_template_name" "text", "p_template_data" "jsonb", "p_recipient_id" "uuid", "p_recipient_email" "text", "p_priority" integer, "p_metadata" "jsonb") IS 'Helper to enqueue notifications with validation';
CREATE OR REPLACE FUNCTION "public"."enqueue_workflow_notification"("p_content_id" "uuid", "p_workflow_id" "uuid", "p_step_id" "uuid", "p_recipient_id" "uuid", "p_action" "text", "p_content_title" "text", "p_brand_name" "text", "p_step_name" "text", "p_comment" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_notification_id uuid;
  v_recipient_email text;
  v_subject text;
  v_template_name text;
BEGIN
  -- Get recipient email
  SELECT email INTO v_recipient_email
  FROM auth.users
  WHERE id = p_recipient_id;
  
  IF v_recipient_email IS NULL THEN
    RAISE EXCEPTION 'Recipient not found';
  END IF;
  
  -- Determine subject and template based on action
  IF p_action = 'review_required' THEN
    v_subject := 'Review Required: ' || p_content_title;
    v_template_name := 'workflow_review_required';
  ELSIF p_action = 'approved' THEN
    v_subject := 'Content Approved: ' || p_content_title;
    v_template_name := 'workflow_approved';
  ELSIF p_action = 'rejected' THEN
    v_subject := 'Content Rejected: ' || p_content_title;
    v_template_name := 'workflow_rejected';
  ELSE
    v_subject := 'Workflow Update: ' || p_content_title;
    v_template_name := 'workflow_update';
  END IF;
  
  -- Enqueue the notification
  v_notification_id := enqueue_notification(
    p_type := 'email',
    p_recipient_id := p_recipient_id,
    p_recipient_email := v_recipient_email,
    p_subject := v_subject,
    p_template_name := v_template_name,
    p_template_data := jsonb_build_object(
      'contentId', p_content_id,
      'contentTitle', p_content_title,
      'brandName', p_brand_name,
      'workflowStep', p_step_name,
      'action', p_action,
      'comment', p_comment,
      'actionUrl', format('%s/dashboard/content/%s/review', 
        current_setting('app.base_url', true), 
        p_content_id)
    ),
    p_priority := CASE 
      WHEN p_action = 'review_required' THEN 8
      WHEN p_action = 'rejected' THEN 7
      ELSE 5
    END,
    p_metadata := jsonb_build_object(
      'content_id', p_content_id,
      'workflow_id', p_workflow_id,
      'step_id', p_step_id,
      'action', p_action
    )
  );
  
  RETURN v_notification_id;
END;
$$;
ALTER FUNCTION "public"."enqueue_workflow_notification"("p_content_id" "uuid", "p_workflow_id" "uuid", "p_step_id" "uuid", "p_recipient_id" "uuid", "p_action" "text", "p_content_title" "text", "p_brand_name" "text", "p_step_name" "text", "p_comment" "text") OWNER TO "postgres";
COMMENT ON FUNCTION "public"."enqueue_workflow_notification"("p_content_id" "uuid", "p_workflow_id" "uuid", "p_step_id" "uuid", "p_recipient_id" "uuid", "p_action" "text", "p_content_title" "text", "p_brand_name" "text", "p_step_name" "text", "p_comment" "text") IS 'Specialized function for workflow-related notifications';
CREATE OR REPLACE FUNCTION "public"."get_auth_tenant_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    SELECT tenant_id 
    FROM users 
    WHERE id = auth.uid()
    LIMIT 1
$$;
ALTER FUNCTION "public"."get_auth_tenant_id"() OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."get_user_activity"("p_user_id" "uuid", "p_days" integer DEFAULT 30) RETURNS TABLE("id" "uuid", "action_type" "text", "action_category" "text", "resource_type" "text", "resource_id" "uuid", "resource_name" "text", "brand_id" "uuid", "duration_ms" integer, "metadata" "jsonb", "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ual.id,
    ual.action_type,
    ual.action_category,
    ual.resource_type,
    ual.resource_id,
    ual.resource_name,
    ual.brand_id,
    ual.duration_ms,
    ual.metadata,
    ual.created_at
  FROM public.user_activity_log ual
  WHERE ual.user_id = p_user_id
  AND ual.created_at >= NOW() - INTERVAL '1 day' * p_days
  ORDER BY ual.created_at DESC
  LIMIT 1000; -- Reasonable limit for UI display
END;
$$;
ALTER FUNCTION "public"."get_user_activity"("p_user_id" "uuid", "p_days" integer) OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."get_user_activity_summary"("p_user_id" "uuid", "p_days" integer DEFAULT 30) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
DECLARE
  v_summary jsonb;
BEGIN
  WITH activity_data AS (
    SELECT * FROM public.user_activity_log
    WHERE user_id = p_user_id
    AND created_at >= NOW() - INTERVAL '1 day' * p_days
  ),
  category_counts AS (
    SELECT 
      action_category,
      COUNT(*) as count
    FROM activity_data
    GROUP BY action_category
  ),
  daily_counts AS (
    SELECT 
      DATE(created_at) as day,
      COUNT(*) as count
    FROM activity_data
    GROUP BY DATE(created_at)
  ),
  hourly_distribution AS (
    SELECT 
      EXTRACT(HOUR FROM created_at)::int as hour,
      COUNT(*) as count
    FROM activity_data
    GROUP BY EXTRACT(HOUR FROM created_at)
  ),
  recent_resources AS (
    SELECT DISTINCT ON (resource_id)
      resource_type,
      resource_id,
      resource_name,
      created_at
    FROM activity_data
    WHERE resource_id IS NOT NULL
    ORDER BY resource_id, created_at DESC
    LIMIT 10
  )
  SELECT jsonb_build_object(
    'total_actions', (SELECT COUNT(*) FROM activity_data),
    'by_category', (SELECT jsonb_object_agg(action_category, count) FROM category_counts),
    'by_day', (SELECT jsonb_object_agg(day::text, count) FROM daily_counts),
    'by_hour', (SELECT jsonb_object_agg(hour::text, count) FROM hourly_distribution),
    'recent_items', (SELECT jsonb_agg(row_to_json(r)) FROM recent_resources r),
    'date_range', jsonb_build_object(
      'start', (SELECT MIN(created_at) FROM activity_data),
      'end', (SELECT MAX(created_at) FROM activity_data)
    )
  ) INTO v_summary;
  
  RETURN v_summary;
END;
$$;
ALTER FUNCTION "public"."get_user_activity_summary"("p_user_id" "uuid", "p_days" integer) OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."get_user_brand_assignments"("p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
  -- Check if brands table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'brands') THEN
    RETURN (
      SELECT jsonb_agg(jsonb_build_object(
        'brand_id', ubp.brand_id,
        'brand_name', b.name,
        'brand_color', b.brand_color,
        'role', ubp.role,
        'created_at', ubp.created_at
      ) ORDER BY b.name)
      FROM user_brand_permissions ubp
      JOIN brands b ON b.id = ubp.brand_id
      WHERE ubp.user_id = p_user_id
    );
  ELSE
    -- Return without brand details if brands table doesn't exist
    RETURN (
      SELECT jsonb_agg(jsonb_build_object(
        'brand_id', ubp.brand_id,
        'brand_name', NULL,
        'brand_color', NULL,
        'role', ubp.role,
        'created_at', ubp.created_at
      ))
      FROM user_brand_permissions ubp
      WHERE ubp.user_id = p_user_id
    );
  END IF;
END;
$$;
ALTER FUNCTION "public"."get_user_brand_assignments"("p_user_id" "uuid") OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Insert a new user record when someone signs up
  -- tenant_id will be NULL initially and set during onboarding
  INSERT INTO public.users (
    id,
    email,
    full_name,
    first_name,
    last_name,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'first_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    -- Update if the record already exists (shouldn't happen but safe guard)
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, users.full_name),
    first_name = COALESCE(EXCLUDED.first_name, users.first_name),
    last_name = COALESCE(EXCLUDED.last_name, users.last_name),
    updated_at = NOW()
  WHERE users.tenant_id IS NULL; -- Only update if no tenant is set yet
  
  RETURN NEW;
END;
$$;
ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";
COMMENT ON FUNCTION "public"."handle_new_user"() IS 'Automatically creates a users table record when someone signs up via Supabase Auth';
CREATE OR REPLACE FUNCTION "public"."handle_user_tenant_claim"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
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
ALTER FUNCTION "public"."handle_user_tenant_claim"() OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."increment_ai_prompt_version"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
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
ALTER FUNCTION "public"."increment_ai_prompt_version"() OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."increment_guardrails_usage"("guardrail_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql"
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
ALTER FUNCTION "public"."increment_guardrails_usage"("guardrail_ids" "uuid"[]) OWNER TO "postgres";
COMMENT ON FUNCTION "public"."increment_guardrails_usage"("guardrail_ids" "uuid"[]) IS 'Atomically increments the usage counter for content guardrails. Fixes the critical bug where all guardrails were updated with the same value.';
CREATE OR REPLACE FUNCTION "public"."increment_guardrails_usage"("guardrail_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
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
ALTER FUNCTION "public"."increment_guardrails_usage"("guardrail_id" "uuid") OWNER TO "postgres";
COMMENT ON FUNCTION "public"."increment_guardrails_usage"("guardrail_id" "uuid") IS 'Atomically increments times_applied and updates last_applied_at for a guardrail.';
CREATE OR REPLACE FUNCTION "public"."is_superadmin"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.users 
    WHERE id = auth.uid() 
    AND is_superadmin = true
  );
END;
$$;
ALTER FUNCTION "public"."is_superadmin"() OWNER TO "postgres";
COMMENT ON FUNCTION "public"."is_superadmin"() IS 'Helper function to check if current user is a superadmin';
CREATE OR REPLACE FUNCTION "public"."is_user_active"("user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_accounts 
    WHERE id = user_id AND status = 'active'
  );
END;
$$;
ALTER FUNCTION "public"."is_user_active"("user_id" "uuid") OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."log_guardrail_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
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
ALTER FUNCTION "public"."log_guardrail_change"() OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."log_superadmin_action"("p_action" "text", "p_target_table" "text" DEFAULT NULL::"text", "p_target_id" "uuid" DEFAULT NULL::"uuid", "p_target_tenant_id" "uuid" DEFAULT NULL::"uuid", "p_details" "jsonb" DEFAULT NULL::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
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
ALTER FUNCTION "public"."log_superadmin_action"("p_action" "text", "p_target_table" "text", "p_target_id" "uuid", "p_target_tenant_id" "uuid", "p_details" "jsonb") OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."log_user_activity"("p_user_id" "uuid", "p_action_type" "text", "p_action_category" "text", "p_resource_type" "text" DEFAULT NULL::"text", "p_resource_id" "uuid" DEFAULT NULL::"uuid", "p_resource_name" "text" DEFAULT NULL::"text", "p_brand_id" "uuid" DEFAULT NULL::"uuid", "p_ip_address" "inet" DEFAULT NULL::"inet", "p_user_agent" "text" DEFAULT NULL::"text", "p_session_id" "text" DEFAULT NULL::"text", "p_duration_ms" integer DEFAULT NULL::integer, "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_activity_id uuid;
BEGIN
  INSERT INTO public.user_activity_log (
    user_id, action_type, action_category,
    resource_type, resource_id, resource_name,
    brand_id, ip_address, user_agent,
    session_id, duration_ms, metadata
  ) VALUES (
    p_user_id, p_action_type, p_action_category,
    p_resource_type, p_resource_id, p_resource_name,
    p_brand_id, p_ip_address, p_user_agent,
    p_session_id, p_duration_ms, p_metadata
  ) RETURNING id INTO v_activity_id;
  
  RETURN v_activity_id;
END;
$$;
ALTER FUNCTION "public"."log_user_activity"("p_user_id" "uuid", "p_action_type" "text", "p_action_category" "text", "p_resource_type" "text", "p_resource_id" "uuid", "p_resource_name" "text", "p_brand_id" "uuid", "p_ip_address" "inet", "p_user_agent" "text", "p_session_id" "text", "p_duration_ms" integer, "p_metadata" "jsonb") OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."reactivate_user"("p_user_id" "uuid", "p_reason" "text" DEFAULT NULL::"text", "p_changed_by" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_old_status text;
BEGIN
  -- Get current status
  SELECT status INTO v_old_status
  FROM public.user_accounts
  WHERE id = p_user_id;
  
  IF v_old_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;
  
  IF v_old_status = 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'User already active');
  END IF;
  
  -- Update status
  UPDATE public.user_accounts
  SET 
    status = 'active',
    status_reason = p_reason,
    status_changed_at = NOW(),
    status_changed_by = p_changed_by,
    updated_at = NOW()
  WHERE id = p_user_id;
  
  -- Record history
  INSERT INTO public.user_status_history (
    user_id, old_status, new_status, reason, changed_by
  ) VALUES (
    p_user_id, v_old_status, 'active', p_reason, p_changed_by
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'old_status', v_old_status,
    'new_status', 'active'
  );
END;
$$;
ALTER FUNCTION "public"."reactivate_user"("p_user_id" "uuid", "p_reason" "text", "p_changed_by" "uuid") OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."release_inspiration_lock"() RETURNS boolean
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  SELECT pg_advisory_unlock(9876543210);
$$;
ALTER FUNCTION "public"."release_inspiration_lock"() OWNER TO "postgres";
COMMENT ON FUNCTION "public"."release_inspiration_lock"() IS 'Releases the advisory lock for inspiration job.';
CREATE OR REPLACE FUNCTION "public"."set_user_tenant_id_from_membership"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  UPDATE public.users u
     SET tenant_id = COALESCE(u.tenant_id, NEW.tenant_id)
   WHERE u.id = NEW.user_id;
  RETURN NEW;
END;
$$;
ALTER FUNCTION "public"."set_user_tenant_id_from_membership"() OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."soft_delete_user_account"("p_user_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_result json;
BEGIN
  -- Check if user exists
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'User not found'
    );
  END IF;

  -- Mark user as deleted and anonymize PII
  UPDATE users
  SET 
    deleted_at = NOW(),
    email = CONCAT('deleted_', p_user_id, '@deleted.local'),
    first_name = 'Deleted',
    last_name = 'User',
    updated_at = NOW()
  WHERE id = p_user_id;

  -- Disable user's auth account (requires service role)
  -- This would be done through the API endpoint

  v_result := json_build_object(
    'success', true,
    'message', 'Account marked for deletion. Will be permanently deleted in 30 days.'
  );

  RETURN v_result;

EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;
ALTER FUNCTION "public"."soft_delete_user_account"("p_user_id" "uuid") OWNER TO "postgres";
COMMENT ON FUNCTION "public"."soft_delete_user_account"("p_user_id" "uuid") IS 'Marks a user account for deletion and anonymizes PII. Account will be permanently deleted after 30 days.';
CREATE OR REPLACE FUNCTION "public"."sync_user_email"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  UPDATE public.users 
  SET email = NEW.email 
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;
ALTER FUNCTION "public"."sync_user_email"() OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."test_tenant_creation_now"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  RETURN jsonb_build_object(
    'status', 'warning',
    'message', 'This is a test function and should not be used in production'
  );
END;
$$;
ALTER FUNCTION "public"."test_tenant_creation_now"() OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."update_guardrails_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
ALTER FUNCTION "public"."update_guardrails_updated_at"() OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."update_media_last_used"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  UPDATE public.media_assets 
  SET last_used_at = NOW() 
  WHERE id = NEW.media_asset_id;
  RETURN NEW;
END;
$$;
ALTER FUNCTION "public"."update_media_last_used"() OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."update_support_tickets_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
ALTER FUNCTION "public"."update_support_tickets_updated_at"() OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."update_user_brand_assignments"("p_user_id" "uuid", "p_brand_ids" "uuid"[], "p_default_role" "text" DEFAULT 'viewer'::"text", "p_updated_by" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_removed_count integer;
  v_added_count integer;
  v_result jsonb;
BEGIN
  -- Validate default role
  IF p_default_role NOT IN ('owner', 'admin', 'editor', 'viewer') THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'Invalid role specified'
    );
  END IF;
  
  -- Start transaction
  -- Delete brands not in the new list
  DELETE FROM user_brand_permissions
  WHERE user_id = p_user_id
  AND brand_id != ALL(p_brand_ids);
  
  GET DIAGNOSTICS v_removed_count = ROW_COUNT;
  
  -- Insert new brand assignments
  INSERT INTO user_brand_permissions (user_id, brand_id, role, created_by)
  SELECT 
    p_user_id,
    brand_id,
    p_default_role,
    p_updated_by
  FROM unnest(p_brand_ids) AS brand_id
  ON CONFLICT (user_id, brand_id) 
  DO UPDATE SET 
    created_by = EXCLUDED.created_by,
    created_at = CASE 
      WHEN user_brand_permissions.created_at IS NULL 
      THEN NOW() 
      ELSE user_brand_permissions.created_at 
    END;
  
  GET DIAGNOSTICS v_added_count = ROW_COUNT;
  
  -- Return result
  v_result := jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'assigned_brands', (
      SELECT jsonb_agg(jsonb_build_object(
        'brand_id', brand_id,
        'role', role
      ))
      FROM user_brand_permissions
      WHERE user_id = p_user_id
    ),
    'removed_count', v_removed_count,
    'added_count', v_added_count
  );
  
  RETURN v_result;
END;
$$;
ALTER FUNCTION "public"."update_user_brand_assignments"("p_user_id" "uuid", "p_brand_ids" "uuid"[], "p_default_role" "text", "p_updated_by" "uuid") OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."update_workflow_published_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Set published_at when transitioning to active
  IF NEW.status = 'active' AND (OLD.status IS NULL OR OLD.status != 'active') THEN
    NEW.published_at = NOW();
  -- Clear published_at when transitioning away from active
  ELSIF NEW.status != 'active' AND OLD.status = 'active' THEN
    NEW.published_at = NULL;
  END IF;
  
  RETURN NEW;
END;
$$;
ALTER FUNCTION "public"."update_workflow_published_at"() OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."user_brand_permissions" (
    "user_id" "uuid" NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'viewer'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    CONSTRAINT "user_brand_permissions_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'editor'::"text", 'viewer'::"text"])))
);
ALTER TABLE "public"."user_brand_permissions" OWNER TO "postgres";
CREATE OR REPLACE VIEW "public"."active_brand_users_v" AS
 SELECT "u"."id",
    "u"."email",
    NULL::"text" AS "full_name",
    NULL::"text" AS "avatar_url",
    "ubp"."brand_id",
    NULL::"text" AS "job_title",
    "u"."created_at",
    "u"."updated_at"
   FROM ("auth"."users" "u"
     JOIN "public"."user_brand_permissions" "ubp" ON (("ubp"."user_id" = "u"."id")))
  WHERE (COALESCE(("u"."raw_user_meta_data" ->> 'status'::"text"), 'active'::"text") = 'active'::"text");
ALTER VIEW "public"."active_brand_users_v" OWNER TO "postgres";
COMMENT ON VIEW "public"."active_brand_users_v" IS 'Brand-scoped view of active, non-deleted users for workflow assignments';
CREATE TABLE IF NOT EXISTS "public"."ai_generation_feedback" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "campaign_id" "uuid",
    "post_id" "uuid",
    "generated_content" "text" NOT NULL,
    "prompt_used" "text",
    "platform" character varying(50),
    "generation_type" character varying(50),
    "feedback_type" character varying(50),
    "feedback_text" "text",
    "suggested_improvement" "text",
    "converted_to_guardrail" boolean DEFAULT false,
    "guardrail_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "ai_generation_feedback_feedback_type_check" CHECK ((("feedback_type")::"text" = ANY ((ARRAY['positive'::character varying, 'negative'::character varying, 'needs_improvement'::character varying])::"text"[]))),
    CONSTRAINT "ai_generation_feedback_generation_type_check" CHECK ((("generation_type")::"text" = ANY ((ARRAY['campaign'::character varying, 'quick_post'::character varying, 'caption'::character varying, 'hashtags'::character varying, 'other'::character varying])::"text"[])))
);
ALTER TABLE "public"."ai_generation_feedback" OWNER TO "postgres";
COMMENT ON TABLE "public"."ai_generation_feedback" IS 'Stores immediate feedback on AI-generated content';
COMMENT ON COLUMN "public"."ai_generation_feedback"."feedback_type" IS 'User sentiment about generated content: positive, negative, needs_improvement';
COMMENT ON COLUMN "public"."ai_generation_feedback"."converted_to_guardrail" IS 'Whether this feedback has been converted to a reusable guardrail';
CREATE TABLE IF NOT EXISTS "public"."ai_platform_prompt_history" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "prompt_id" "uuid" NOT NULL,
    "version" integer NOT NULL,
    "system_prompt" "text" NOT NULL,
    "user_prompt_template" "text" NOT NULL,
    "change_description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid"
);
ALTER TABLE "public"."ai_platform_prompt_history" OWNER TO "postgres";
COMMENT ON TABLE "public"."ai_platform_prompt_history" IS 'Version history of AI prompts, accessible only to superadmins, protected by RLS';
CREATE TABLE IF NOT EXISTS "public"."ai_platform_prompts" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "platform" "text" NOT NULL,
    "content_type" "text" NOT NULL,
    "system_prompt" "text" NOT NULL,
    "user_prompt_template" "text" NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    CONSTRAINT "ai_platform_prompts_content_type_check" CHECK (("content_type" = ANY (ARRAY['post'::"text", 'story'::"text", 'reel'::"text", 'carousel'::"text", 'event'::"text", 'offer'::"text"]))),
    CONSTRAINT "ai_platform_prompts_platform_check" CHECK (("platform" = ANY (ARRAY['facebook'::"text", 'instagram'::"text", 'twitter'::"text", 'linkedin'::"text", 'google_my_business'::"text", 'general'::"text"])))
);
ALTER TABLE "public"."ai_platform_prompts" OWNER TO "postgres";
COMMENT ON TABLE "public"."ai_platform_prompts" IS 'Platform-specific AI prompts manageable only by superadmins, protected by RLS';
CREATE TABLE IF NOT EXISTS "public"."analytics" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid",
    "campaign_post_id" "uuid",
    "platform" character varying(50) NOT NULL,
    "metric_type" character varying(50) NOT NULL,
    "metric_value" integer DEFAULT 0,
    "recorded_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"()
);
ALTER TABLE "public"."analytics" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."api_usage" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid",
    "endpoint" "text" NOT NULL,
    "count" integer DEFAULT 1,
    "date" "date" DEFAULT CURRENT_DATE,
    "created_at" timestamp with time zone DEFAULT "now"()
);
ALTER TABLE "public"."api_usage" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tenant_id" "uuid",
    "user_id" "uuid",
    "entity_type" "text" NOT NULL,
    "entity_id" "text" NOT NULL,
    "action" "text" NOT NULL,
    "meta" "jsonb"
);
ALTER TABLE "public"."audit_log" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."brand_profiles" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid",
    "business_type" character varying(50),
    "tone_attributes" "text"[],
    "target_audience" "text",
    "brand_colors" "jsonb" DEFAULT '{}'::"jsonb",
    "language_code" character varying(10) DEFAULT 'en-GB'::character varying,
    "content_boundaries" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "primary_color" character varying(7),
    "business_name" "text",
    "brand_identity" "text",
    "deleted_at" timestamp with time zone,
    "brand_voice" "text",
    "phone_e164" "text",
    "whatsapp_e164" "text",
    "website_url" "text",
    "booking_url" "text",
    "menu_food_url" "text",
    "menu_drink_url" "text",
    "serves_food" boolean DEFAULT false,
    "serves_drinks" boolean DEFAULT true,
    "opening_hours" "jsonb",
    "address" "jsonb"
);
ALTER TABLE "public"."brand_profiles" OWNER TO "postgres";
COMMENT ON COLUMN "public"."brand_profiles"."brand_voice" IS 'Free-form text description of the brand voice and communication style, allowing for fine-tuning and detailed customization';
COMMENT ON COLUMN "public"."brand_profiles"."phone_e164" IS 'Primary phone in E.164 format (e.g., +447700900123)';
COMMENT ON COLUMN "public"."brand_profiles"."whatsapp_e164" IS 'WhatsApp phone in E.164 format if enabled';
COMMENT ON COLUMN "public"."brand_profiles"."opening_hours" IS 'Structured opening hours per day and exceptions';
COMMENT ON COLUMN "public"."brand_profiles"."address" IS 'Postal address object with fields like line1, city, postcode, country';
CREATE TABLE IF NOT EXISTS "public"."brand_voice_profiles" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "tone_attributes" "text"[],
    "vocabulary" "text"[],
    "sentence_patterns" "jsonb" DEFAULT '{}'::"jsonb",
    "avg_sentence_length" integer DEFAULT 15,
    "emoji_usage" boolean DEFAULT false,
    "emoji_frequency" character varying(20) DEFAULT 'none'::character varying,
    "hashtag_style" character varying(20) DEFAULT 'minimal'::character varying,
    "characteristics" "text"[],
    "sample_count" integer DEFAULT 0,
    "trained_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."brand_voice_profiles" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."brand_voice_samples" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "type" character varying(50),
    "platform" character varying(50),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "brand_voice_samples_type_check" CHECK ((("type")::"text" = ANY ((ARRAY['caption'::character varying, 'blog'::character varying, 'email'::character varying, 'menu'::character varying, 'custom'::character varying])::"text"[])))
);
ALTER TABLE "public"."brand_voice_samples" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."brands" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "website_url" "text",
    "country" "text",
    "language" "text",
    "brand_identity" "text",
    "tone_of_voice" "text",
    "guardrails" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "brand_color" "text" DEFAULT '#3498db'::"text",
    "brand_summary" "text",
    "brand_admin_id" "uuid",
    "normalized_website_domain" "text",
    "content_vetting_agencies" "text"[],
    "approved_content_types" "jsonb",
    "master_claim_brand_id" "uuid",
    "website_urls" "jsonb" DEFAULT '[]'::"jsonb",
    "logo_url" "text",
    "additional_website_urls" "text"[] DEFAULT ARRAY[]::"text"[],
    CONSTRAINT "check_website_urls_is_array" CHECK (("jsonb_typeof"("website_urls") = 'array'::"text"))
);
ALTER TABLE ONLY "public"."brands" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."brands" OWNER TO "postgres";
COMMENT ON COLUMN "public"."brands"."brand_color" IS 'HEX color code for brand visual identity, generated by AI or manually set';
COMMENT ON COLUMN "public"."brands"."brand_summary" IS 'Short summary of the brand for display in listings';
COMMENT ON COLUMN "public"."brands"."brand_admin_id" IS 'Designated admin for handling rejected content in workflows';
COMMENT ON COLUMN "public"."brands"."content_vetting_agencies" IS 'Array of IDs or names of selected content vetting agencies associated with the brand.';
COMMENT ON COLUMN "public"."brands"."approved_content_types" IS 'JSONB array or object storing approved content types for the brand (e.g., array of content type IDs or names).';
CREATE TABLE IF NOT EXISTS "public"."campaign_posts" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "campaign_id" "uuid",
    "post_timing" character varying(50) NOT NULL,
    "content" "text" NOT NULL,
    "scheduled_for" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "media_assets" "uuid"[] DEFAULT '{}'::"uuid"[],
    "platforms" "text"[] DEFAULT '{}'::"text"[],
    "tenant_id" "uuid",
    "is_quick_post" boolean DEFAULT false,
    "platform" "text",
    "status" "text" DEFAULT 'draft'::"text",
    "media_url" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "approval_status" character varying(20) DEFAULT 'pending'::character varying,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "is_publishing" boolean DEFAULT false,
    CONSTRAINT "campaign_posts_approval_status_check" CHECK ((("approval_status")::"text" = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying])::"text"[])))
);
ALTER TABLE "public"."campaign_posts" OWNER TO "postgres";
COMMENT ON COLUMN "public"."campaign_posts"."is_quick_post" IS 'True if created via quick post modal, false for campaign posts';
COMMENT ON COLUMN "public"."campaign_posts"."platform" IS 'Single platform for this post (replacing platforms array for better optimization)';
COMMENT ON COLUMN "public"."campaign_posts"."metadata" IS 'Stores additional post settings like guardrails, custom rules, and validation data';
COMMENT ON COLUMN "public"."campaign_posts"."approval_status" IS 'Approval status for publishing: pending, approved, rejected';
COMMENT ON COLUMN "public"."campaign_posts"."approved_by" IS 'User ID who approved or rejected the post';
COMMENT ON COLUMN "public"."campaign_posts"."approved_at" IS 'Timestamp when the post was approved or rejected';
CREATE TABLE IF NOT EXISTS "public"."campaign_templates" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid",
    "name" "text" NOT NULL,
    "description" "text",
    "template_type" character varying(50) NOT NULL,
    "post_templates" "jsonb" DEFAULT '[]'::"jsonb",
    "is_public" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);
ALTER TABLE "public"."campaign_templates" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."campaigns" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid",
    "name" "text" NOT NULL,
    "event_date" timestamp with time zone,
    "campaign_type" character varying(50) NOT NULL,
    "hero_image_id" "uuid",
    "status" character varying(20) DEFAULT 'draft'::character varying,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "description" "text",
    "platforms" "text"[] DEFAULT '{}'::"text"[],
    "auto_generate" boolean DEFAULT false,
    "selected_timings" "text"[] DEFAULT ARRAY['week_before'::"text", 'day_before'::"text", 'day_of'::"text"],
    "custom_dates" timestamp with time zone[] DEFAULT ARRAY[]::timestamp with time zone[],
    "deleted_at" timestamp with time zone,
    "created_by" "uuid",
    "start_date" timestamp with time zone,
    "end_date" timestamp with time zone
);
ALTER TABLE "public"."campaigns" OWNER TO "postgres";
COMMENT ON COLUMN "public"."campaigns"."platforms" IS 'Array of social media platforms this campaign targets';
COMMENT ON COLUMN "public"."campaigns"."selected_timings" IS 'Array of selected posting timings like week_before, day_before, etc';
COMMENT ON COLUMN "public"."campaigns"."custom_dates" IS 'Array of custom posting dates selected by the user';
COMMENT ON COLUMN "public"."campaigns"."created_by" IS 'User ID of the campaign creator';
CREATE TABLE IF NOT EXISTS "public"."content_guardrails" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "context_type" character varying(50) NOT NULL,
    "platform" character varying(50),
    "feedback_type" character varying(50) NOT NULL,
    "feedback_text" "text" NOT NULL,
    "original_content" "text",
    "original_prompt" "text",
    "is_active" boolean DEFAULT true,
    "times_applied" integer DEFAULT 0,
    "last_applied_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "content_guardrails_context_type_check" CHECK ((("context_type")::"text" = ANY ((ARRAY['campaign'::character varying, 'quick_post'::character varying, 'brand_voice'::character varying, 'general'::character varying])::"text"[]))),
    CONSTRAINT "content_guardrails_feedback_type_check" CHECK ((("feedback_type")::"text" = ANY ((ARRAY['avoid'::character varying, 'include'::character varying, 'tone'::character varying, 'style'::character varying, 'format'::character varying, 'other'::character varying])::"text"[])))
);
ALTER TABLE "public"."content_guardrails" OWNER TO "postgres";
COMMENT ON TABLE "public"."content_guardrails" IS 'Stores user-defined guardrails and feedback for AI content generation';
COMMENT ON COLUMN "public"."content_guardrails"."context_type" IS 'Where this guardrail applies: campaign, quick_post, brand_voice, or general';
COMMENT ON COLUMN "public"."content_guardrails"."feedback_type" IS 'Type of feedback: avoid, include, tone, style, format, other';
COMMENT ON COLUMN "public"."content_guardrails"."times_applied" IS 'Number of times this guardrail has been used in AI generation';
CREATE TABLE IF NOT EXISTS "public"."content_guardrails_history" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "guardrail_id" "uuid",
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "action" character varying(50) NOT NULL,
    "previous_value" "jsonb",
    "new_value" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "content_guardrails_history_action_check" CHECK ((("action")::"text" = ANY ((ARRAY['created'::character varying, 'updated'::character varying, 'disabled'::character varying, 'enabled'::character varying, 'applied'::character varying])::"text"[])))
);
ALTER TABLE "public"."content_guardrails_history" OWNER TO "postgres";
COMMENT ON TABLE "public"."content_guardrails_history" IS 'Tracks changes to guardrails over time';
CREATE TABLE IF NOT EXISTS "public"."data_exports" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "tenant_id" "uuid",
    "export_type" character varying(30) NOT NULL,
    "file_url" "text",
    "expires_at" timestamp with time zone DEFAULT ("now"() + '30 days'::interval),
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);
ALTER TABLE "public"."data_exports" OWNER TO "postgres";
COMMENT ON TABLE "public"."data_exports" IS 'Tracks data export requests and generated files for GDPR compliance';
CREATE TABLE IF NOT EXISTS "public"."data_retention_policies" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "data_type" character varying(50) NOT NULL,
    "retention_days" integer NOT NULL,
    "description" "text",
    "uk_ico_compliant" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);
ALTER TABLE "public"."data_retention_policies" OWNER TO "postgres";
COMMENT ON TABLE "public"."data_retention_policies" IS 'Defines data retention periods compliant with UK ICO guidelines';
CREATE TABLE IF NOT EXISTS "public"."error_logs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid",
    "user_id" "uuid",
    "error_message" "text" NOT NULL,
    "context" character varying(255),
    "severity" character varying(20),
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    CONSTRAINT "error_logs_severity_check" CHECK ((("severity")::"text" = ANY ((ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying, 'critical'::character varying])::"text"[])))
);
ALTER TABLE "public"."error_logs" OWNER TO "postgres";
COMMENT ON TABLE "public"."error_logs" IS 'Stores error logs and system issues for debugging';
COMMENT ON COLUMN "public"."error_logs"."severity" IS 'Error severity level: low, medium, high, critical';
CREATE TABLE IF NOT EXISTS "public"."event_briefs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "text" "text" NOT NULL,
    "constraints_applied" "text"[] DEFAULT '{no_emojis,no_links,no_prices}'::"text"[],
    "drinkaware_applicable" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."event_briefs" OWNER TO "postgres";
COMMENT ON TABLE "public"."event_briefs" IS 'Centrally stored ~250-word briefs for each event, versioned.';
CREATE TABLE IF NOT EXISTS "public"."event_occurrences" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "country" "text" DEFAULT 'UK'::"text" NOT NULL,
    "certainty" "text" DEFAULT 'confirmed'::"text" NOT NULL,
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."event_occurrences" OWNER TO "postgres";
COMMENT ON TABLE "public"."event_occurrences" IS 'Expanded dated instances of events (next 13 months rolling).';
CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "aliases" "text"[] DEFAULT '{}'::"text"[],
    "category" "text" NOT NULL,
    "alcohol_flag" boolean DEFAULT false NOT NULL,
    "date_type" "text" NOT NULL,
    "rrule" "text",
    "fixed_date" "date",
    "source_url" "text",
    "uk_centric" boolean DEFAULT true NOT NULL,
    "notes" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "dedupe_key" "text"
);
ALTER TABLE "public"."events" OWNER TO "postgres";
COMMENT ON TABLE "public"."events" IS 'Global catalog of UK-centric hospitality-relevant events.';
CREATE TABLE IF NOT EXISTS "public"."global_content_settings" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "setting_key" "text" NOT NULL,
    "setting_value" "jsonb" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid"
);
ALTER TABLE "public"."global_content_settings" OWNER TO "postgres";
COMMENT ON TABLE "public"."global_content_settings" IS 'System-wide settings manageable only by superadmins';
CREATE TABLE IF NOT EXISTS "public"."guardrail_audit_log" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "guardrail_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "old_values" "jsonb",
    "new_values" "jsonb",
    "changed_by" "uuid",
    "tenant_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "guardrail_audit_log_action_check" CHECK (("action" = ANY (ARRAY['INSERT'::"text", 'UPDATE'::"text", 'DELETE'::"text"])))
);
ALTER TABLE "public"."guardrail_audit_log" OWNER TO "postgres";
COMMENT ON TABLE "public"."guardrail_audit_log" IS 'Audit trail of content_guardrails changes created by trigger log_guardrail_change()';
COMMENT ON COLUMN "public"."guardrail_audit_log"."action" IS 'TG_OP from trigger: INSERT, UPDATE, or DELETE';
CREATE TABLE IF NOT EXISTS "public"."idea_instances" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "occurrence_id" "uuid" NOT NULL,
    "rank_score" integer DEFAULT 0 NOT NULL,
    "diversity_bucket" "text",
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "selected" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."idea_instances" OWNER TO "postgres";
COMMENT ON TABLE "public"."idea_instances" IS 'Selected top ideas per day based on scoring and diversity rules.';
CREATE TABLE IF NOT EXISTS "public"."idempotency_keys" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "request_hash" "text" NOT NULL,
    "response_json" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."idempotency_keys" OWNER TO "postgres";
CREATE OR REPLACE VIEW "public"."index_usage_stats" WITH ("security_invoker"='on') AS
 SELECT "schemaname",
    "relname" AS "tablename",
    "indexrelname" AS "indexname",
    "idx_scan" AS "index_scans",
    "idx_tup_read" AS "tuples_read",
    "idx_tup_fetch" AS "tuples_fetched",
    "pg_size_pretty"("pg_relation_size"(("indexrelid")::"regclass")) AS "index_size",
        CASE
            WHEN ("idx_scan" = 0) THEN 'UNUSED'::"text"
            WHEN ("idx_scan" < 10) THEN 'RARELY USED'::"text"
            WHEN ("idx_scan" < 100) THEN 'OCCASIONALLY USED'::"text"
            ELSE 'FREQUENTLY USED'::"text"
        END AS "usage_category"
   FROM "pg_stat_user_indexes" "s"
  WHERE ("schemaname" = 'public'::"name")
  ORDER BY "idx_scan", ("pg_relation_size"(("indexrelid")::"regclass")) DESC;
ALTER VIEW "public"."index_usage_stats" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."media_assets" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid",
    "file_url" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "file_type" character varying(50),
    "file_size" integer,
    "tags" "text"[],
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "storage_path" "text",
    "has_watermark" boolean DEFAULT false,
    "watermark_position" character varying(20),
    "original_url" "text",
    "alt_text" "text",
    "deleted_at" timestamp with time zone,
    "last_used_at" timestamp with time zone DEFAULT "now"()
);
ALTER TABLE "public"."media_assets" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."notification_settings" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "email_notifications" boolean DEFAULT true,
    "push_notifications" boolean DEFAULT false,
    "campaign_reminders" boolean DEFAULT true,
    "publishing_alerts" boolean DEFAULT true,
    "weekly_summary" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);
ALTER TABLE "public"."notification_settings" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."performance_metrics" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid",
    "user_id" "uuid",
    "metric_type" character varying(50) NOT NULL,
    "value" numeric NOT NULL,
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone
);
ALTER TABLE "public"."performance_metrics" OWNER TO "postgres";
COMMENT ON TABLE "public"."performance_metrics" IS 'Stores performance monitoring data for the application';
COMMENT ON COLUMN "public"."performance_metrics"."metric_type" IS 'Type of metric: page_load, api_call, database_query, etc';
CREATE TABLE IF NOT EXISTS "public"."post_approvals" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "post_id" "uuid" NOT NULL,
    "required" integer DEFAULT 1 NOT NULL,
    "approved_count" integer DEFAULT 0 NOT NULL,
    "state" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."post_approvals" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."post_comments" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "post_id" "uuid" NOT NULL,
    "parent_id" "uuid",
    "author_id" "uuid" NOT NULL,
    "type" "text" DEFAULT 'note'::"text" NOT NULL,
    "platform_scope" "text",
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."post_comments" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."post_revisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "post_id" "uuid" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid",
    "version" integer NOT NULL,
    "diff" "jsonb" NOT NULL
);
ALTER TABLE "public"."post_revisions" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."posting_schedules" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "day_of_week" integer NOT NULL,
    "time" time without time zone NOT NULL,
    "platform" character varying(50) NOT NULL,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "posting_schedules_day_of_week_check" CHECK ((("day_of_week" >= 0) AND ("day_of_week" <= 6)))
);
ALTER TABLE "public"."posting_schedules" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."pql_events" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "event_type" "text" NOT NULL,
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."pql_events" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."publishing_history" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "campaign_post_id" "uuid",
    "social_connection_id" "uuid",
    "platform" character varying(20) NOT NULL,
    "status" character varying(20) NOT NULL,
    "published_at" timestamp with time zone,
    "platform_post_id" "text",
    "error_message" "text",
    "retry_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "connection_id" "uuid",
    "account_name" "text",
    "external_id" "text",
    "post_type" "text"
);
ALTER TABLE "public"."publishing_history" OWNER TO "postgres";
COMMENT ON COLUMN "public"."publishing_history"."connection_id" IS 'Reference to the social connection at time of publish';
COMMENT ON COLUMN "public"."publishing_history"."account_name" IS 'Denormalised account/page name at time of publish';
COMMENT ON COLUMN "public"."publishing_history"."external_id" IS 'External platform post ID (alias of legacy platform_post_id)';
CREATE TABLE IF NOT EXISTS "public"."publishing_queue" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "campaign_post_id" "uuid",
    "social_connection_id" "uuid",
    "scheduled_for" timestamp with time zone NOT NULL,
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "attempts" integer DEFAULT 0,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "last_attempt_at" timestamp with time zone,
    "next_attempt_at" timestamp with time zone
);
ALTER TABLE "public"."publishing_queue" OWNER TO "postgres";
COMMENT ON COLUMN "public"."publishing_queue"."last_attempt_at" IS 'Timestamp of the most recent processing attempt';
COMMENT ON COLUMN "public"."publishing_queue"."next_attempt_at" IS 'Timestamp when the next processing attempt should be made (exponential backoff)';
CREATE TABLE IF NOT EXISTS "public"."role_permissions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL,
    "permission" "text" NOT NULL
);
ALTER TABLE "public"."role_permissions" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text"
);
ALTER TABLE "public"."roles" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."short_clicks" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "link_id" "uuid" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ip_hash" "text",
    "ua_hash" "text",
    "referer" "text",
    "platform_hint" "text",
    "country" "text",
    "city" "text"
);
ALTER TABLE "public"."short_clicks" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."short_links" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "slug" "text" NOT NULL,
    "target_url" "text" NOT NULL,
    "campaign_id" "uuid",
    "platform" "text",
    "connection_id" "uuid",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "publishing_history_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."short_links" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."social_accounts" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid",
    "platform" character varying(50) NOT NULL,
    "account_id" "text" NOT NULL,
    "account_name" "text",
    "access_token" "text",
    "refresh_token" "text",
    "token_expires_at" timestamp with time zone,
    "page_id" "text",
    "page_name" "text",
    "profile_id" "text",
    "instagram_id" "text",
    "access_token_secret" "text",
    "username" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "location_id" "text",
    "location_name" "text"
);
ALTER TABLE "public"."social_accounts" OWNER TO "postgres";
COMMENT ON COLUMN "public"."social_accounts"."location_id" IS 'Google My Business location ID';
COMMENT ON COLUMN "public"."social_accounts"."location_name" IS 'Google My Business location name/title';
CREATE TABLE IF NOT EXISTS "public"."social_connections" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid",
    "platform" character varying(20) NOT NULL,
    "account_name" "text" NOT NULL,
    "account_id" "text" NOT NULL,
    "access_token" "text",
    "refresh_token" "text",
    "token_expires_at" timestamp with time zone,
    "page_id" "text",
    "page_name" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "metadata" "jsonb",
    "deleted_at" timestamp with time zone,
    "verified_at" timestamp with time zone,
    "verify_status" "text",
    "verify_details" "jsonb",
    CONSTRAINT "social_connections_verify_status_check" CHECK (("verify_status" = ANY (ARRAY['pass'::"text", 'fail'::"text", 'warning'::"text"])))
);
ALTER TABLE "public"."social_connections" OWNER TO "postgres";
COMMENT ON TABLE "public"."social_connections" IS 'OAuth connections. Plaintext tokens are nulled when encrypted values exist.';
COMMENT ON COLUMN "public"."social_connections"."access_token" IS 'For Instagram: stores Facebook Page access token, not user token';
COMMENT ON COLUMN "public"."social_connections"."token_expires_at" IS 'Expiry timestamp for the active access token (platform-dependent)';
COMMENT ON COLUMN "public"."social_connections"."page_id" IS 'Facebook Page ID - required for Instagram Business accounts';
COMMENT ON COLUMN "public"."social_connections"."metadata" IS 'Stores platform-specific data like Instagram profile picture, follower count, etc.';
COMMENT ON COLUMN "public"."social_connections"."verified_at" IS 'Last time the connection was verified via health check';
COMMENT ON COLUMN "public"."social_connections"."verify_status" IS 'Result of last verification: pass/fail/warning';
COMMENT ON COLUMN "public"."social_connections"."verify_details" IS 'Structured check results for last verification';
CREATE TABLE IF NOT EXISTS "public"."superadmin_audit_log" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "superadmin_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "target_table" "text",
    "target_id" "uuid",
    "target_tenant_id" "uuid",
    "details" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);
ALTER TABLE "public"."superadmin_audit_log" OWNER TO "postgres";
COMMENT ON TABLE "public"."superadmin_audit_log" IS 'Audit trail of all superadmin actions';
CREATE OR REPLACE VIEW "public"."superadmin_dashboard" AS
SELECT
    NULL::"uuid" AS "tenant_id",
    NULL::"text" AS "tenant_name",
    NULL::character varying(20) AS "subscription_tier",
    NULL::character varying(20) AS "subscription_status",
    NULL::timestamp with time zone AS "trial_ends_at",
    NULL::timestamp with time zone AS "tenant_created",
    NULL::bigint AS "user_count",
    NULL::bigint AS "campaign_count",
    NULL::bigint AS "post_count",
    NULL::bigint AS "media_count",
    NULL::bigint AS "connection_count";
ALTER VIEW "public"."superadmin_dashboard" OWNER TO "postgres";
COMMENT ON VIEW "public"."superadmin_dashboard" IS 'Dashboard view for superadmins showing tenant overview. Uses SECURITY INVOKER and filters by superadmin status.';
CREATE TABLE IF NOT EXISTS "public"."support_tickets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "subject" character varying(200) NOT NULL,
    "message" "text" NOT NULL,
    "priority" character varying(20) DEFAULT 'normal'::character varying,
    "status" character varying(20) DEFAULT 'open'::character varying,
    "support_channel" character varying(20) DEFAULT 'email'::character varying,
    "subscription_tier" character varying(20) NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "resolved_at" timestamp with time zone,
    CONSTRAINT "support_tickets_priority_check" CHECK ((("priority")::"text" = ANY ((ARRAY['low'::character varying, 'normal'::character varying, 'high'::character varying, 'urgent'::character varying])::"text"[]))),
    CONSTRAINT "support_tickets_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['open'::character varying, 'in_progress'::character varying, 'resolved'::character varying, 'closed'::character varying])::"text"[]))),
    CONSTRAINT "support_tickets_support_channel_check" CHECK ((("support_channel")::"text" = ANY ((ARRAY['email'::character varying, 'whatsapp'::character varying, 'phone'::character varying, 'community'::character varying])::"text"[])))
);
ALTER TABLE "public"."support_tickets" OWNER TO "postgres";
COMMENT ON TABLE "public"."support_tickets" IS 'Support tickets for tiered support system with RLS';
COMMENT ON COLUMN "public"."support_tickets"."priority" IS 'Ticket priority: low, normal, high, urgent';
COMMENT ON COLUMN "public"."support_tickets"."status" IS 'Ticket status: open, in_progress, resolved, closed';
COMMENT ON COLUMN "public"."support_tickets"."support_channel" IS 'Support channel used: email, whatsapp, phone, community';
COMMENT ON COLUMN "public"."support_tickets"."subscription_tier" IS 'User subscription tier when ticket was created';
COMMENT ON COLUMN "public"."support_tickets"."metadata" IS 'Additional ticket data like user agent, device info, etc.';
CREATE TABLE IF NOT EXISTS "public"."team_invitations" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid",
    "email" "text" NOT NULL,
    "role" character varying(20) DEFAULT 'member'::character varying,
    "invited_by" "uuid",
    "token" "text" NOT NULL,
    "accepted_at" timestamp with time zone,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);
ALTER TABLE "public"."team_invitations" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."tenant_logos" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "logo_type" character varying(50) DEFAULT 'default'::character varying NOT NULL,
    "file_url" "text" NOT NULL,
    "file_name" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);
ALTER TABLE "public"."tenant_logos" OWNER TO "postgres";
COMMENT ON TABLE "public"."tenant_logos" IS 'Stores logo variants for each tenant';
COMMENT ON COLUMN "public"."tenant_logos"."logo_type" IS 'Type of logo: default, black, white, or color variant';
CREATE TABLE IF NOT EXISTS "public"."tenants" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "subscription_status" character varying(20) DEFAULT 'trial'::character varying,
    "subscription_tier" character varying(20) DEFAULT 'free'::character varying,
    "trial_ends_at" timestamp with time zone DEFAULT ("now"() + '14 days'::interval),
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "owner_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "total_campaigns_created" integer DEFAULT 0,
    "approvals_required" integer DEFAULT 1,
    "alcohol_free" boolean DEFAULT false NOT NULL
);
ALTER TABLE "public"."tenants" OWNER TO "postgres";
COMMENT ON COLUMN "public"."tenants"."owner_id" IS 'The auth.users.id of the user who created/owns this tenant';
COMMENT ON COLUMN "public"."tenants"."total_campaigns_created" IS 'Total number of campaigns created by this tenant. Used for enforcing trial limits (max 10 campaigns during trial).';
CREATE TABLE IF NOT EXISTS "public"."two_factor_auth" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "secret" "text" NOT NULL,
    "backup_codes" "text"[] NOT NULL,
    "enabled" boolean DEFAULT false,
    "verified_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);
ALTER TABLE "public"."two_factor_auth" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."usage_quota" (
    "tenant_id" "uuid" NOT NULL,
    "period_start" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tokens_used" bigint DEFAULT 0 NOT NULL,
    "tokens_limit" bigint DEFAULT 100000 NOT NULL,
    "requests_used" integer DEFAULT 0 NOT NULL,
    "requests_limit" integer DEFAULT 1000 NOT NULL
);
ALTER TABLE "public"."usage_quota" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."user_accounts" (
    "id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "status_reason" "text",
    "status_changed_at" timestamp with time zone DEFAULT "now"(),
    "status_changed_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "user_accounts_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text", 'suspended'::"text"])))
);
ALTER TABLE "public"."user_accounts" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."user_activity_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "action_type" "text" NOT NULL,
    "action_category" "text" NOT NULL,
    "resource_type" "text",
    "resource_id" "uuid",
    "resource_name" "text",
    "brand_id" "uuid",
    "ip_address" "inet",
    "user_agent" "text",
    "session_id" "text",
    "duration_ms" integer,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "user_activity_log_action_category_check" CHECK (("action_category" = ANY (ARRAY['authentication'::"text", 'content_management'::"text", 'workflow'::"text", 'user_management'::"text", 'template_management'::"text", 'settings'::"text", 'api_usage'::"text", 'file_operations'::"text"])))
);
ALTER TABLE "public"."user_activity_log" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."user_deletion_requests" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "tenant_id" "uuid",
    "requested_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone,
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "deletion_reason" "text",
    "data_export_provided" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);
ALTER TABLE "public"."user_deletion_requests" OWNER TO "postgres";
COMMENT ON TABLE "public"."user_deletion_requests" IS 'Tracks user requests for account deletion under GDPR/UK data protection';
CREATE TABLE IF NOT EXISTS "public"."user_prefs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "show_sports" boolean DEFAULT true NOT NULL,
    "show_alcohol" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "week_start" "text" DEFAULT 'monday'::"text",
    CONSTRAINT "user_prefs_week_start_check" CHECK (("week_start" = ANY (ARRAY['sunday'::"text", 'monday'::"text"])))
);
ALTER TABLE "public"."user_prefs" OWNER TO "postgres";
COMMENT ON TABLE "public"."user_prefs" IS 'Per-user toggles for inspiration (sports/alcohol).';
COMMENT ON COLUMN "public"."user_prefs"."week_start" IS 'User preference for the start of the week (sunday|monday). Default monday.';
CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL
);
ALTER TABLE "public"."user_roles" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."user_status_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "old_status" "text",
    "new_status" "text" NOT NULL,
    "reason" "text",
    "changed_by" "uuid",
    "changed_at" timestamp with time zone DEFAULT "now"(),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb"
);
ALTER TABLE "public"."user_status_history" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."user_tenants" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "tenant_id" "uuid",
    "role" character varying(20) DEFAULT 'member'::character varying,
    "joined_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);
ALTER TABLE "public"."user_tenants" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "tenant_id" "uuid",
    "full_name" "text",
    "role" character varying(20) DEFAULT 'owner'::character varying,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "email" "text",
    "avatar_url" "text",
    "phone" "text",
    "notification_preferences" "jsonb" DEFAULT '{"push": false, "email": true}'::"jsonb",
    "is_superadmin" boolean DEFAULT false,
    "first_name" "text",
    "last_name" "text",
    "deleted_at" timestamp with time zone,
    "onboarding_complete" boolean DEFAULT false NOT NULL
);
ALTER TABLE "public"."users" OWNER TO "postgres";
COMMENT ON COLUMN "public"."users"."is_superadmin" IS 'Indicates if user has superadmin privileges for the entire application';
COMMENT ON COLUMN "public"."users"."onboarding_complete" IS 'Marks whether the user has completed onboarding. Used to gate /onboarding.';
CREATE TABLE IF NOT EXISTS "public"."watermark_settings" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "enabled" boolean DEFAULT false,
    "position" character varying(20) DEFAULT 'bottom-right'::character varying,
    "opacity" numeric(3,2) DEFAULT 0.8,
    "size_percent" integer DEFAULT 15,
    "margin_pixels" integer DEFAULT 20,
    "auto_apply" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);
ALTER TABLE "public"."watermark_settings" OWNER TO "postgres";
COMMENT ON TABLE "public"."watermark_settings" IS 'Stores watermark preferences for each tenant';
COMMENT ON COLUMN "public"."watermark_settings"."position" IS 'Corner position for watermark placement';
COMMENT ON COLUMN "public"."watermark_settings"."size_percent" IS 'Logo size as percentage of image width';
CREATE TABLE IF NOT EXISTS "public"."workflow_step_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "step_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "workflow_step_assignments_role_check" CHECK (("role" = ANY (ARRAY['reviewer'::"text", 'approver'::"text", 'editor'::"text", 'viewer'::"text"])))
);
ALTER TABLE "public"."workflow_step_assignments" OWNER TO "postgres";
COMMENT ON TABLE "public"."workflow_step_assignments" IS 'Canonical source of user-role assignments for workflow steps';
ALTER TABLE ONLY "public"."ai_generation_feedback"
    ADD CONSTRAINT "ai_generation_feedback_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."ai_platform_prompt_history"
    ADD CONSTRAINT "ai_platform_prompt_history_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."ai_platform_prompts"
    ADD CONSTRAINT "ai_platform_prompts_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."analytics"
    ADD CONSTRAINT "analytics_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."api_usage"
    ADD CONSTRAINT "api_usage_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."api_usage"
    ADD CONSTRAINT "api_usage_tenant_id_endpoint_date_key" UNIQUE ("tenant_id", "endpoint", "date");
ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."brand_profiles"
    ADD CONSTRAINT "brand_profiles_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."brand_profiles"
    ADD CONSTRAINT "brand_profiles_tenant_id_key" UNIQUE ("tenant_id");
ALTER TABLE ONLY "public"."brand_voice_profiles"
    ADD CONSTRAINT "brand_voice_profiles_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."brand_voice_profiles"
    ADD CONSTRAINT "brand_voice_profiles_tenant_id_key" UNIQUE ("tenant_id");
ALTER TABLE ONLY "public"."brand_voice_samples"
    ADD CONSTRAINT "brand_voice_samples_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."campaign_posts"
    ADD CONSTRAINT "campaign_posts_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."campaign_templates"
    ADD CONSTRAINT "campaign_templates_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."content_guardrails_history"
    ADD CONSTRAINT "content_guardrails_history_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."content_guardrails"
    ADD CONSTRAINT "content_guardrails_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."data_exports"
    ADD CONSTRAINT "data_exports_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."data_retention_policies"
    ADD CONSTRAINT "data_retention_policies_data_type_key" UNIQUE ("data_type");
ALTER TABLE ONLY "public"."data_retention_policies"
    ADD CONSTRAINT "data_retention_policies_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."error_logs"
    ADD CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."event_briefs"
    ADD CONSTRAINT "event_briefs_event_id_version_key" UNIQUE ("event_id", "version");
ALTER TABLE ONLY "public"."event_briefs"
    ADD CONSTRAINT "event_briefs_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."event_occurrences"
    ADD CONSTRAINT "event_occurrences_event_id_start_date_key" UNIQUE ("event_id", "start_date");
ALTER TABLE ONLY "public"."event_occurrences"
    ADD CONSTRAINT "event_occurrences_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_slug_key" UNIQUE ("slug");
ALTER TABLE ONLY "public"."global_content_settings"
    ADD CONSTRAINT "global_content_settings_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."global_content_settings"
    ADD CONSTRAINT "global_content_settings_setting_key_key" UNIQUE ("setting_key");
ALTER TABLE ONLY "public"."guardrail_audit_log"
    ADD CONSTRAINT "guardrail_audit_log_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."idea_instances"
    ADD CONSTRAINT "idea_instances_occurrence_id_key" UNIQUE ("occurrence_id");
ALTER TABLE ONLY "public"."idea_instances"
    ADD CONSTRAINT "idea_instances_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."idempotency_keys"
    ADD CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."media_assets"
    ADD CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."notification_outbox"
    ADD CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."notification_settings"
    ADD CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."notification_settings"
    ADD CONSTRAINT "notification_settings_user_id_key" UNIQUE ("user_id");
ALTER TABLE ONLY "public"."performance_metrics"
    ADD CONSTRAINT "performance_metrics_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."post_approvals"
    ADD CONSTRAINT "post_approvals_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."post_approvals"
    ADD CONSTRAINT "post_approvals_tenant_id_post_id_key" UNIQUE ("tenant_id", "post_id");
ALTER TABLE ONLY "public"."post_comments"
    ADD CONSTRAINT "post_comments_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."post_revisions"
    ADD CONSTRAINT "post_revisions_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."posting_schedules"
    ADD CONSTRAINT "posting_schedules_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."pql_events"
    ADD CONSTRAINT "pql_events_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."publishing_history"
    ADD CONSTRAINT "publishing_history_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."publishing_queue"
    ADD CONSTRAINT "publishing_queue_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_tenant_id_name_key" UNIQUE ("tenant_id", "name");
ALTER TABLE ONLY "public"."short_clicks"
    ADD CONSTRAINT "short_clicks_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."short_links"
    ADD CONSTRAINT "short_links_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."short_links"
    ADD CONSTRAINT "short_links_slug_key" UNIQUE ("slug");
ALTER TABLE ONLY "public"."social_accounts"
    ADD CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."social_accounts"
    ADD CONSTRAINT "social_accounts_tenant_id_platform_account_id_key" UNIQUE ("tenant_id", "platform", "account_id");
ALTER TABLE ONLY "public"."social_connections"
    ADD CONSTRAINT "social_connections_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."social_connections"
    ADD CONSTRAINT "social_connections_tenant_id_platform_account_id_key" UNIQUE ("tenant_id", "platform", "account_id");
ALTER TABLE ONLY "public"."superadmin_audit_log"
    ADD CONSTRAINT "superadmin_audit_log_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."support_tickets"
    ADD CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."team_invitations"
    ADD CONSTRAINT "team_invitations_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."team_invitations"
    ADD CONSTRAINT "team_invitations_token_key" UNIQUE ("token");
ALTER TABLE ONLY "public"."tenant_logos"
    ADD CONSTRAINT "tenant_logos_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_slug_key" UNIQUE ("slug");
ALTER TABLE ONLY "public"."two_factor_auth"
    ADD CONSTRAINT "two_factor_auth_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."two_factor_auth"
    ADD CONSTRAINT "two_factor_auth_user_id_key" UNIQUE ("user_id");
ALTER TABLE ONLY "public"."usage_quota"
    ADD CONSTRAINT "usage_quota_pkey" PRIMARY KEY ("tenant_id", "period_start");
ALTER TABLE ONLY "public"."user_accounts"
    ADD CONSTRAINT "user_accounts_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."user_activity_log"
    ADD CONSTRAINT "user_activity_log_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."user_brand_permissions"
    ADD CONSTRAINT "user_brand_permissions_pkey" PRIMARY KEY ("user_id", "brand_id");
ALTER TABLE ONLY "public"."user_deletion_requests"
    ADD CONSTRAINT "user_deletion_requests_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."user_prefs"
    ADD CONSTRAINT "user_prefs_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."user_prefs"
    ADD CONSTRAINT "user_prefs_user_id_key" UNIQUE ("user_id");
ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_tenant_id_user_id_role_id_key" UNIQUE ("tenant_id", "user_id", "role_id");
ALTER TABLE ONLY "public"."user_status_history"
    ADD CONSTRAINT "user_status_history_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."user_tenants"
    ADD CONSTRAINT "user_tenants_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."user_tenants"
    ADD CONSTRAINT "user_tenants_user_id_tenant_id_key" UNIQUE ("user_id", "tenant_id");
ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_unique" UNIQUE ("email");
ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."watermark_settings"
    ADD CONSTRAINT "watermark_settings_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."watermark_settings"
    ADD CONSTRAINT "watermark_settings_tenant_id_key" UNIQUE ("tenant_id");
ALTER TABLE ONLY "public"."workflow_step_assignments"
    ADD CONSTRAINT "workflow_step_assignments_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."workflow_step_assignments"
    ADD CONSTRAINT "workflow_step_assignments_step_id_user_id_key" UNIQUE ("step_id", "user_id");
CREATE INDEX "idx_activity_brand" ON "public"."user_activity_log" USING "btree" ("brand_id", "created_at" DESC) WHERE ("brand_id" IS NOT NULL);
CREATE INDEX "idx_activity_category" ON "public"."user_activity_log" USING "btree" ("action_category", "created_at" DESC);
CREATE INDEX "idx_activity_resource" ON "public"."user_activity_log" USING "btree" ("resource_type", "resource_id") WHERE ("resource_id" IS NOT NULL);
CREATE INDEX "idx_activity_user_30d" ON "public"."user_activity_log" USING "btree" ("user_id", "created_at" DESC);
CREATE INDEX "idx_ai_generation_feedback_campaign_id" ON "public"."ai_generation_feedback" USING "btree" ("campaign_id") WHERE ("campaign_id" IS NOT NULL);
COMMENT ON INDEX "public"."idx_ai_generation_feedback_campaign_id" IS 'Foreign key index for campaign AI feedback';
CREATE INDEX "idx_ai_generation_feedback_guardrail_id" ON "public"."ai_generation_feedback" USING "btree" ("guardrail_id");
CREATE INDEX "idx_ai_generation_feedback_post_id" ON "public"."ai_generation_feedback" USING "btree" ("post_id");
CREATE INDEX "idx_ai_generation_feedback_tenant_id" ON "public"."ai_generation_feedback" USING "btree" ("tenant_id");
COMMENT ON INDEX "public"."idx_ai_generation_feedback_tenant_id" IS 'Foreign key index for tenant AI feedback';
CREATE INDEX "idx_ai_generation_feedback_user_id" ON "public"."ai_generation_feedback" USING "btree" ("user_id");
CREATE INDEX "idx_ai_platform_prompt_history_created_by" ON "public"."ai_platform_prompt_history" USING "btree" ("created_by");
CREATE INDEX "idx_ai_platform_prompt_history_prompt_id" ON "public"."ai_platform_prompt_history" USING "btree" ("prompt_id");
COMMENT ON INDEX "public"."idx_ai_platform_prompt_history_prompt_id" IS 'Foreign key index for prompt version history';
CREATE INDEX "idx_ai_platform_prompts_created_by" ON "public"."ai_platform_prompts" USING "btree" ("created_by");
CREATE UNIQUE INDEX "idx_ai_platform_prompts_unique_default" ON "public"."ai_platform_prompts" USING "btree" ("platform", "content_type") WHERE ("is_default" = true);
CREATE INDEX "idx_analytics_campaign_post_id" ON "public"."analytics" USING "btree" ("campaign_post_id");
COMMENT ON INDEX "public"."idx_analytics_campaign_post_id" IS 'Foreign key index for analytics aggregation';
CREATE INDEX "idx_analytics_tenant_id" ON "public"."analytics" USING "btree" ("tenant_id");
COMMENT ON INDEX "public"."idx_analytics_tenant_id" IS 'Foreign key index for tenant analytics queries';
CREATE INDEX "idx_audit_log_tenant" ON "public"."audit_log" USING "btree" ("tenant_id", "ts" DESC);
CREATE INDEX "idx_brand_profiles_tenant_id" ON "public"."brand_profiles" USING "btree" ("tenant_id");
CREATE INDEX "idx_brand_voice_profiles_tenant" ON "public"."brand_voice_profiles" USING "btree" ("tenant_id");
CREATE INDEX "idx_brand_voice_samples_tenant" ON "public"."brand_voice_samples" USING "btree" ("tenant_id");
CREATE INDEX "idx_campaign_posts_approval_status" ON "public"."campaign_posts" USING "btree" ("approval_status");
CREATE INDEX "idx_campaign_posts_approved_by" ON "public"."campaign_posts" USING "btree" ("approved_by") WHERE ("approved_by" IS NOT NULL);
COMMENT ON INDEX "public"."idx_campaign_posts_approved_by" IS 'Foreign key index for approval workflow queries';
CREATE INDEX "idx_campaign_posts_campaign_id" ON "public"."campaign_posts" USING "btree" ("campaign_id");
CREATE INDEX "idx_campaign_posts_scheduled_for" ON "public"."campaign_posts" USING "btree" ("scheduled_for");
CREATE INDEX "idx_campaign_posts_tenant" ON "public"."campaign_posts" USING "btree" ("tenant_id");
CREATE INDEX "idx_campaign_templates_tenant_id" ON "public"."campaign_templates" USING "btree" ("tenant_id");
CREATE INDEX "idx_campaigns_created_by" ON "public"."campaigns" USING "btree" ("created_by");
CREATE INDEX "idx_campaigns_hero_image_id" ON "public"."campaigns" USING "btree" ("hero_image_id");
CREATE INDEX "idx_campaigns_status" ON "public"."campaigns" USING "btree" ("status");
CREATE INDEX "idx_campaigns_tenant_id" ON "public"."campaigns" USING "btree" ("tenant_id");
CREATE INDEX "idx_content_guardrails_history_guardrail_id" ON "public"."content_guardrails_history" USING "btree" ("guardrail_id") WHERE ("guardrail_id" IS NOT NULL);
COMMENT ON INDEX "public"."idx_content_guardrails_history_guardrail_id" IS 'Foreign key index for guardrail history tracking';
CREATE INDEX "idx_content_guardrails_history_tenant_id" ON "public"."content_guardrails_history" USING "btree" ("tenant_id");
COMMENT ON INDEX "public"."idx_content_guardrails_history_tenant_id" IS 'Foreign key index for tenant guardrail queries';
CREATE INDEX "idx_content_guardrails_history_user_id" ON "public"."content_guardrails_history" USING "btree" ("user_id");
CREATE INDEX "idx_content_guardrails_user_id" ON "public"."content_guardrails" USING "btree" ("user_id");
CREATE INDEX "idx_data_exports_expires_at" ON "public"."data_exports" USING "btree" ("expires_at");
CREATE INDEX "idx_data_exports_tenant_id" ON "public"."data_exports" USING "btree" ("tenant_id");
CREATE INDEX "idx_data_exports_user_id" ON "public"."data_exports" USING "btree" ("user_id");
CREATE INDEX "idx_error_logs_user_id" ON "public"."error_logs" USING "btree" ("user_id");
CREATE INDEX "idx_errors_tenant_date" ON "public"."error_logs" USING "btree" ("tenant_id", "created_at" DESC);
CREATE INDEX "idx_event_briefs_event_id" ON "public"."event_briefs" USING "btree" ("event_id");
CREATE INDEX "idx_event_occurrences_event" ON "public"."event_occurrences" USING "btree" ("event_id");
CREATE INDEX "idx_event_occurrences_start" ON "public"."event_occurrences" USING "btree" ("start_date");
CREATE INDEX "idx_events_active" ON "public"."events" USING "btree" ("active");
CREATE INDEX "idx_events_dedupe_key" ON "public"."events" USING "btree" ("dedupe_key") WHERE ("dedupe_key" IS NOT NULL);
CREATE INDEX "idx_global_content_settings_updated_by" ON "public"."global_content_settings" USING "btree" ("updated_by");
CREATE INDEX "idx_guardrail_audit_log_created_at" ON "public"."guardrail_audit_log" USING "btree" ("created_at" DESC);
CREATE INDEX "idx_guardrail_audit_log_guardrail_id" ON "public"."guardrail_audit_log" USING "btree" ("guardrail_id");
CREATE INDEX "idx_guardrail_audit_log_tenant_id" ON "public"."guardrail_audit_log" USING "btree" ("tenant_id");
CREATE INDEX "idx_guardrails_tenant" ON "public"."content_guardrails" USING "btree" ("tenant_id");
CREATE INDEX "idx_idea_instances_occurrence" ON "public"."idea_instances" USING "btree" ("occurrence_id");
CREATE INDEX "idx_idea_instances_selected_true" ON "public"."idea_instances" USING "btree" ("selected") WHERE ("selected" = true);
CREATE INDEX "idx_idempotency_created_at" ON "public"."idempotency_keys" USING "btree" ("created_at");
CREATE UNIQUE INDEX "idx_idempotency_unique" ON "public"."idempotency_keys" USING "btree" ("tenant_id", "idempotency_key");
CREATE INDEX "idx_media_assets_tenant_id" ON "public"."media_assets" USING "btree" ("tenant_id");
CREATE INDEX "idx_metrics_tenant_date" ON "public"."performance_metrics" USING "btree" ("tenant_id", "created_at" DESC);
CREATE INDEX "idx_notification_outbox_pending" ON "public"."notification_outbox" USING "btree" ("scheduled_for", "priority" DESC) WHERE ("status" = 'pending'::"text");
CREATE INDEX "idx_notification_outbox_recipient" ON "public"."notification_outbox" USING "btree" ("recipient_id", "created_at" DESC);
CREATE INDEX "idx_performance_metrics_user_id" ON "public"."performance_metrics" USING "btree" ("user_id");
CREATE INDEX "idx_post_revisions_post" ON "public"."post_revisions" USING "btree" ("post_id", "version" DESC);
CREATE INDEX "idx_posting_schedules_tenant_id" ON "public"."posting_schedules" USING "btree" ("tenant_id");
CREATE INDEX "idx_publishing_history_campaign_post_id" ON "public"."publishing_history" USING "btree" ("campaign_post_id");
COMMENT ON INDEX "public"."idx_publishing_history_campaign_post_id" IS 'Foreign key index for post history lookups';
CREATE INDEX "idx_publishing_history_social_connection_id" ON "public"."publishing_history" USING "btree" ("social_connection_id");
CREATE INDEX "idx_publishing_history_status" ON "public"."publishing_history" USING "btree" ("status");
CREATE INDEX "idx_publishing_queue_campaign_post_id" ON "public"."publishing_queue" USING "btree" ("campaign_post_id");
CREATE INDEX "idx_publishing_queue_next_attempt_at" ON "public"."publishing_queue" USING "btree" ("next_attempt_at");
CREATE INDEX "idx_publishing_queue_scheduled_for" ON "public"."publishing_queue" USING "btree" ("scheduled_for");
CREATE INDEX "idx_publishing_queue_social_connection_id" ON "public"."publishing_queue" USING "btree" ("social_connection_id");
CREATE INDEX "idx_publishing_queue_status" ON "public"."publishing_queue" USING "btree" ("status");
CREATE INDEX "idx_short_clicks_link" ON "public"."short_clicks" USING "btree" ("link_id");
CREATE INDEX "idx_short_clicks_ts" ON "public"."short_clicks" USING "btree" ("ts");
CREATE INDEX "idx_short_links_tenant" ON "public"."short_links" USING "btree" ("tenant_id");
CREATE INDEX "idx_social_accounts_tenant_id" ON "public"."social_accounts" USING "btree" ("tenant_id");
CREATE INDEX "idx_social_connections_platform" ON "public"."social_connections" USING "btree" ("platform");
CREATE INDEX "idx_social_connections_tenant_id" ON "public"."social_connections" USING "btree" ("tenant_id");
CREATE INDEX "idx_superadmin_audit_log_superadmin_id" ON "public"."superadmin_audit_log" USING "btree" ("superadmin_id");
CREATE INDEX "idx_superadmin_audit_log_target_tenant_id" ON "public"."superadmin_audit_log" USING "btree" ("target_tenant_id");
CREATE INDEX "idx_support_tickets_tenant_id" ON "public"."support_tickets" USING "btree" ("tenant_id");
COMMENT ON INDEX "public"."idx_support_tickets_tenant_id" IS 'Foreign key index for tenant support queries';
CREATE INDEX "idx_support_tickets_user_id" ON "public"."support_tickets" USING "btree" ("user_id");
COMMENT ON INDEX "public"."idx_support_tickets_user_id" IS 'Foreign key index for user support history';
CREATE INDEX "idx_team_invitations_invited_by" ON "public"."team_invitations" USING "btree" ("invited_by");
CREATE INDEX "idx_team_invitations_tenant_id" ON "public"."team_invitations" USING "btree" ("tenant_id");
COMMENT ON INDEX "public"."idx_team_invitations_tenant_id" IS 'Foreign key index for tenant invitation queries';
CREATE INDEX "idx_tenant_logos_tenant" ON "public"."tenant_logos" USING "btree" ("tenant_id");
CREATE INDEX "idx_tenants_slug" ON "public"."tenants" USING "btree" ("slug");
CREATE INDEX "idx_two_factor_auth_user_id" ON "public"."two_factor_auth" USING "btree" ("user_id");
CREATE INDEX "idx_usage_quota_tenant" ON "public"."usage_quota" USING "btree" ("tenant_id");
CREATE INDEX "idx_user_accounts_status" ON "public"."user_accounts" USING "btree" ("status") WHERE ("status" <> 'active'::"text");
CREATE INDEX "idx_user_brand_permissions_brand" ON "public"."user_brand_permissions" USING "btree" ("brand_id");
CREATE INDEX "idx_user_brand_permissions_role" ON "public"."user_brand_permissions" USING "btree" ("role") WHERE ("role" = ANY (ARRAY['admin'::"text", 'owner'::"text"]));
CREATE INDEX "idx_user_brand_permissions_user" ON "public"."user_brand_permissions" USING "btree" ("user_id");
CREATE INDEX "idx_user_deletion_requests_status" ON "public"."user_deletion_requests" USING "btree" ("status");
CREATE INDEX "idx_user_deletion_requests_tenant_id" ON "public"."user_deletion_requests" USING "btree" ("tenant_id");
CREATE INDEX "idx_user_deletion_requests_user_id" ON "public"."user_deletion_requests" USING "btree" ("user_id");
CREATE INDEX "idx_user_status_history_user" ON "public"."user_status_history" USING "btree" ("user_id", "changed_at" DESC);
CREATE INDEX "idx_user_tenants_tenant_id" ON "public"."user_tenants" USING "btree" ("tenant_id");
CREATE INDEX "idx_user_tenants_user_id" ON "public"."user_tenants" USING "btree" ("user_id");
CREATE INDEX "idx_users_tenant_id" ON "public"."users" USING "btree" ("tenant_id");
CREATE INDEX "idx_watermark_settings_tenant" ON "public"."watermark_settings" USING "btree" ("tenant_id");
CREATE INDEX "idx_workflow_step_assignments_step_id" ON "public"."workflow_step_assignments" USING "btree" ("step_id");
CREATE INDEX "idx_workflow_step_assignments_user_id" ON "public"."workflow_step_assignments" USING "btree" ("user_id");
CREATE UNIQUE INDEX "notif_dedupe" ON "public"."notification_outbox" USING "btree" ((("metadata" ->> 'content_id'::"text")), (("metadata" ->> 'step_id'::"text")), COALESCE(("recipient_id")::"text", "recipient_email")) WHERE ("status" = ANY (ARRAY['pending'::"text", 'processing'::"text"]));
CREATE OR REPLACE VIEW "public"."superadmin_dashboard" WITH ("security_invoker"='true') AS
 SELECT "t"."id" AS "tenant_id",
    "t"."name" AS "tenant_name",
    "t"."subscription_tier",
    "t"."subscription_status",
    "t"."trial_ends_at",
    "t"."created_at" AS "tenant_created",
    "count"(DISTINCT "u"."id") AS "user_count",
    "count"(DISTINCT "c"."id") AS "campaign_count",
    "count"(DISTINCT "cp"."id") AS "post_count",
    "count"(DISTINCT "ma"."id") AS "media_count",
    "count"(DISTINCT "sc"."id") AS "connection_count"
   FROM ((((("public"."tenants" "t"
     LEFT JOIN "public"."users" "u" ON (("u"."tenant_id" = "t"."id")))
     LEFT JOIN "public"."campaigns" "c" ON (("c"."tenant_id" = "t"."id")))
     LEFT JOIN "public"."campaign_posts" "cp" ON (("cp"."campaign_id" = "c"."id")))
     LEFT JOIN "public"."media_assets" "ma" ON (("ma"."tenant_id" = "t"."id")))
     LEFT JOIN "public"."social_connections" "sc" ON (("sc"."tenant_id" = "t"."id")))
  WHERE (EXISTS ( SELECT 1
           FROM "public"."users"
          WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_superadmin" = true))))
  GROUP BY "t"."id"
  ORDER BY "t"."created_at" DESC;
CREATE OR REPLACE TRIGGER "log_guardrail_changes" AFTER INSERT OR UPDATE ON "public"."content_guardrails" FOR EACH ROW EXECUTE FUNCTION "public"."log_guardrail_change"();
CREATE OR REPLACE TRIGGER "sync_user_tenant_claim" AFTER INSERT OR UPDATE OF "tenant_id" ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."handle_user_tenant_claim"();
CREATE OR REPLACE TRIGGER "trg_set_user_tenant_id" AFTER INSERT ON "public"."user_tenants" FOR EACH ROW EXECUTE FUNCTION "public"."set_user_tenant_id_from_membership"();
CREATE OR REPLACE TRIGGER "trigger_create_ai_prompt_history" AFTER INSERT OR UPDATE OF "system_prompt", "user_prompt_template", "version" ON "public"."ai_platform_prompts" FOR EACH ROW EXECUTE FUNCTION "public"."create_ai_prompt_history"();
CREATE OR REPLACE TRIGGER "trigger_increment_ai_prompt_version" BEFORE UPDATE ON "public"."ai_platform_prompts" FOR EACH ROW EXECUTE FUNCTION "public"."increment_ai_prompt_version"();
CREATE OR REPLACE TRIGGER "trigger_update_support_tickets_updated_at" BEFORE UPDATE ON "public"."support_tickets" FOR EACH ROW EXECUTE FUNCTION "public"."update_support_tickets_updated_at"();
CREATE OR REPLACE TRIGGER "update_brand_profiles_updated_at" BEFORE UPDATE ON "public"."brand_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
CREATE OR REPLACE TRIGGER "update_brand_voice_profiles_updated_at" BEFORE UPDATE ON "public"."brand_voice_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
CREATE OR REPLACE TRIGGER "update_campaigns_updated_at" BEFORE UPDATE ON "public"."campaigns" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
CREATE OR REPLACE TRIGGER "update_data_exports_updated_at" BEFORE UPDATE ON "public"."data_exports" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
CREATE OR REPLACE TRIGGER "update_data_retention_policies_updated_at" BEFORE UPDATE ON "public"."data_retention_policies" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
CREATE OR REPLACE TRIGGER "update_guardrails_timestamp" BEFORE UPDATE ON "public"."content_guardrails" FOR EACH ROW EXECUTE FUNCTION "public"."update_guardrails_updated_at"();
CREATE OR REPLACE TRIGGER "update_media_assets_updated_at" BEFORE UPDATE ON "public"."media_assets" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
CREATE OR REPLACE TRIGGER "update_media_usage_on_campaign_update" AFTER UPDATE ON "public"."campaigns" FOR EACH ROW WHEN (("old"."hero_image_id" IS DISTINCT FROM "new"."hero_image_id")) EXECUTE FUNCTION "public"."update_media_last_used"();
CREATE OR REPLACE TRIGGER "update_notification_settings_updated_at" BEFORE UPDATE ON "public"."notification_settings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
CREATE OR REPLACE TRIGGER "update_posting_schedules_updated_at" BEFORE UPDATE ON "public"."posting_schedules" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
CREATE OR REPLACE TRIGGER "update_social_accounts_updated_at" BEFORE UPDATE ON "public"."social_accounts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
CREATE OR REPLACE TRIGGER "update_team_invitations_updated_at" BEFORE UPDATE ON "public"."team_invitations" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
CREATE OR REPLACE TRIGGER "update_tenants_updated_at" BEFORE UPDATE ON "public"."tenants" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
CREATE OR REPLACE TRIGGER "update_two_factor_auth_updated_at" BEFORE UPDATE ON "public"."two_factor_auth" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
CREATE OR REPLACE TRIGGER "update_user_deletion_requests_updated_at" BEFORE UPDATE ON "public"."user_deletion_requests" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
CREATE OR REPLACE TRIGGER "update_user_tenants_updated_at" BEFORE UPDATE ON "public"."user_tenants" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
CREATE OR REPLACE TRIGGER "update_users_updated_at" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
ALTER TABLE ONLY "public"."ai_generation_feedback"
    ADD CONSTRAINT "ai_generation_feedback_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."ai_generation_feedback"
    ADD CONSTRAINT "ai_generation_feedback_guardrail_id_fkey" FOREIGN KEY ("guardrail_id") REFERENCES "public"."content_guardrails"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."ai_generation_feedback"
    ADD CONSTRAINT "ai_generation_feedback_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."campaign_posts"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."ai_generation_feedback"
    ADD CONSTRAINT "ai_generation_feedback_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."ai_generation_feedback"
    ADD CONSTRAINT "ai_generation_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."ai_platform_prompt_history"
    ADD CONSTRAINT "ai_platform_prompt_history_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."ai_platform_prompt_history"
    ADD CONSTRAINT "ai_platform_prompt_history_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "public"."ai_platform_prompts"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."ai_platform_prompts"
    ADD CONSTRAINT "ai_platform_prompts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."analytics"
    ADD CONSTRAINT "analytics_campaign_post_id_fkey" FOREIGN KEY ("campaign_post_id") REFERENCES "public"."campaign_posts"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."analytics"
    ADD CONSTRAINT "analytics_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."api_usage"
    ADD CONSTRAINT "api_usage_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");
ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");
ALTER TABLE ONLY "public"."brand_profiles"
    ADD CONSTRAINT "brand_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."brand_voice_profiles"
    ADD CONSTRAINT "brand_voice_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."brand_voice_samples"
    ADD CONSTRAINT "brand_voice_samples_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."campaign_posts"
    ADD CONSTRAINT "campaign_posts_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."campaign_posts"
    ADD CONSTRAINT "campaign_posts_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."campaign_posts"
    ADD CONSTRAINT "campaign_posts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."campaign_templates"
    ADD CONSTRAINT "campaign_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_hero_image_id_fkey" FOREIGN KEY ("hero_image_id") REFERENCES "public"."media_assets"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."content_guardrails_history"
    ADD CONSTRAINT "content_guardrails_history_guardrail_id_fkey" FOREIGN KEY ("guardrail_id") REFERENCES "public"."content_guardrails"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."content_guardrails_history"
    ADD CONSTRAINT "content_guardrails_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."content_guardrails_history"
    ADD CONSTRAINT "content_guardrails_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."content_guardrails"
    ADD CONSTRAINT "content_guardrails_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."content_guardrails"
    ADD CONSTRAINT "content_guardrails_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."data_exports"
    ADD CONSTRAINT "data_exports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."data_exports"
    ADD CONSTRAINT "data_exports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."error_logs"
    ADD CONSTRAINT "error_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."error_logs"
    ADD CONSTRAINT "error_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."event_briefs"
    ADD CONSTRAINT "event_briefs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."event_occurrences"
    ADD CONSTRAINT "event_occurrences_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."global_content_settings"
    ADD CONSTRAINT "global_content_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id");
ALTER TABLE ONLY "public"."guardrail_audit_log"
    ADD CONSTRAINT "guardrail_audit_log_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."guardrail_audit_log"
    ADD CONSTRAINT "guardrail_audit_log_guardrail_id_fkey" FOREIGN KEY ("guardrail_id") REFERENCES "public"."content_guardrails"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."guardrail_audit_log"
    ADD CONSTRAINT "guardrail_audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."idea_instances"
    ADD CONSTRAINT "idea_instances_occurrence_id_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "public"."event_occurrences"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."idempotency_keys"
    ADD CONSTRAINT "idempotency_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."media_assets"
    ADD CONSTRAINT "media_assets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."notification_outbox"
    ADD CONSTRAINT "notification_outbox_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "auth"."users"("id");
ALTER TABLE ONLY "public"."notification_settings"
    ADD CONSTRAINT "notification_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."performance_metrics"
    ADD CONSTRAINT "performance_metrics_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."performance_metrics"
    ADD CONSTRAINT "performance_metrics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."post_approvals"
    ADD CONSTRAINT "post_approvals_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."campaign_posts"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."post_approvals"
    ADD CONSTRAINT "post_approvals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."post_comments"
    ADD CONSTRAINT "post_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."post_comments"
    ADD CONSTRAINT "post_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."post_comments"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."post_comments"
    ADD CONSTRAINT "post_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."campaign_posts"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."post_comments"
    ADD CONSTRAINT "post_comments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."post_revisions"
    ADD CONSTRAINT "post_revisions_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."campaign_posts"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."post_revisions"
    ADD CONSTRAINT "post_revisions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");
ALTER TABLE ONLY "public"."posting_schedules"
    ADD CONSTRAINT "posting_schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."pql_events"
    ADD CONSTRAINT "pql_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."pql_events"
    ADD CONSTRAINT "pql_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."publishing_history"
    ADD CONSTRAINT "publishing_history_campaign_post_id_fkey" FOREIGN KEY ("campaign_post_id") REFERENCES "public"."campaign_posts"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."publishing_history"
    ADD CONSTRAINT "publishing_history_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "public"."social_connections"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."publishing_history"
    ADD CONSTRAINT "publishing_history_social_connection_id_fkey" FOREIGN KEY ("social_connection_id") REFERENCES "public"."social_connections"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."publishing_queue"
    ADD CONSTRAINT "publishing_queue_campaign_post_id_fkey" FOREIGN KEY ("campaign_post_id") REFERENCES "public"."campaign_posts"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."publishing_queue"
    ADD CONSTRAINT "publishing_queue_social_connection_id_fkey" FOREIGN KEY ("social_connection_id") REFERENCES "public"."social_connections"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."short_clicks"
    ADD CONSTRAINT "short_clicks_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "public"."short_links"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."short_links"
    ADD CONSTRAINT "short_links_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."short_links"
    ADD CONSTRAINT "short_links_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "public"."social_connections"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."short_links"
    ADD CONSTRAINT "short_links_publishing_history_id_fkey" FOREIGN KEY ("publishing_history_id") REFERENCES "public"."publishing_history"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."short_links"
    ADD CONSTRAINT "short_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."social_accounts"
    ADD CONSTRAINT "social_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."social_connections"
    ADD CONSTRAINT "social_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."superadmin_audit_log"
    ADD CONSTRAINT "superadmin_audit_log_superadmin_id_fkey" FOREIGN KEY ("superadmin_id") REFERENCES "public"."users"("id");
ALTER TABLE ONLY "public"."superadmin_audit_log"
    ADD CONSTRAINT "superadmin_audit_log_target_tenant_id_fkey" FOREIGN KEY ("target_tenant_id") REFERENCES "public"."tenants"("id");
ALTER TABLE ONLY "public"."support_tickets"
    ADD CONSTRAINT "support_tickets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."support_tickets"
    ADD CONSTRAINT "support_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."team_invitations"
    ADD CONSTRAINT "team_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."team_invitations"
    ADD CONSTRAINT "team_invitations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."tenant_logos"
    ADD CONSTRAINT "tenant_logos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_owner_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;
ALTER TABLE ONLY "public"."two_factor_auth"
    ADD CONSTRAINT "two_factor_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."usage_quota"
    ADD CONSTRAINT "usage_quota_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."user_accounts"
    ADD CONSTRAINT "user_accounts_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."user_accounts"
    ADD CONSTRAINT "user_accounts_status_changed_by_fkey" FOREIGN KEY ("status_changed_by") REFERENCES "auth"."users"("id");
ALTER TABLE ONLY "public"."user_activity_log"
    ADD CONSTRAINT "user_activity_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."user_brand_permissions"
    ADD CONSTRAINT "user_brand_permissions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");
ALTER TABLE ONLY "public"."user_brand_permissions"
    ADD CONSTRAINT "user_brand_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."user_deletion_requests"
    ADD CONSTRAINT "user_deletion_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."user_deletion_requests"
    ADD CONSTRAINT "user_deletion_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."user_prefs"
    ADD CONSTRAINT "user_prefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."user_status_history"
    ADD CONSTRAINT "user_status_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "auth"."users"("id");
ALTER TABLE ONLY "public"."user_status_history"
    ADD CONSTRAINT "user_status_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."user_tenants"
    ADD CONSTRAINT "user_tenants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."user_tenants"
    ADD CONSTRAINT "user_tenants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."watermark_settings"
    ADD CONSTRAINT "watermark_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."workflow_step_assignments"
    ADD CONSTRAINT "workflow_step_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");
CREATE POLICY "Admins can manage brand assignments" ON "public"."user_brand_permissions" USING ((EXISTS ( SELECT 1
   FROM "auth"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND (("users"."raw_user_meta_data" ->> 'role'::"text") = 'admin'::"text")))));
CREATE POLICY "Admins can view all activity" ON "public"."user_activity_log" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "auth"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND (("users"."raw_user_meta_data" ->> 'role'::"text") = 'admin'::"text")))));
CREATE POLICY "Admins can view status history" ON "public"."user_status_history" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "auth"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND (("users"."raw_user_meta_data" ->> 'role'::"text") = 'admin'::"text")))));
CREATE POLICY "Admins can view user accounts" ON "public"."user_accounts" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "auth"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND (("users"."raw_user_meta_data" ->> 'role'::"text") = 'admin'::"text")))));
CREATE POLICY "Basic access policy" ON "public"."workflow_step_assignments" USING (("auth"."uid"() = "user_id"));
CREATE POLICY "Brand admins can manage their brand assignments" ON "public"."user_brand_permissions" USING ((EXISTS ( SELECT 1
   FROM "public"."user_brand_permissions" "user_brand_permissions_1"
  WHERE (("user_brand_permissions_1"."user_id" = "auth"."uid"()) AND ("user_brand_permissions_1"."brand_id" = "user_brand_permissions_1"."brand_id") AND ("user_brand_permissions_1"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text"]))))));
CREATE POLICY "Only service role can manage" ON "public"."notification_outbox" USING (false) WITH CHECK (false);
CREATE POLICY "Only superadmins can delete prompt history" ON "public"."ai_platform_prompt_history" FOR DELETE TO "authenticated" USING ("public"."is_superadmin"());
CREATE POLICY "Only superadmins can delete prompts" ON "public"."ai_platform_prompts" FOR DELETE TO "authenticated" USING ("public"."is_superadmin"());
CREATE POLICY "Only superadmins can insert prompt history" ON "public"."ai_platform_prompt_history" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_superadmin"());
CREATE POLICY "Only superadmins can insert prompts" ON "public"."ai_platform_prompts" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_superadmin"());
CREATE POLICY "Only superadmins can update prompt history" ON "public"."ai_platform_prompt_history" FOR UPDATE TO "authenticated" USING ("public"."is_superadmin"()) WITH CHECK ("public"."is_superadmin"());
CREATE POLICY "Only superadmins can update prompts" ON "public"."ai_platform_prompts" FOR UPDATE TO "authenticated" USING ("public"."is_superadmin"()) WITH CHECK ("public"."is_superadmin"());
CREATE POLICY "Only superadmins can view audit logs" ON "public"."superadmin_audit_log" FOR SELECT TO "authenticated" USING ("public"."is_superadmin"());
CREATE POLICY "Only superadmins can view prompt history" ON "public"."ai_platform_prompt_history" FOR SELECT TO "authenticated" USING ("public"."is_superadmin"());
CREATE POLICY "Only superadmins can view prompts" ON "public"."ai_platform_prompts" FOR SELECT TO "authenticated" USING ("public"."is_superadmin"());
CREATE POLICY "Tenant can insert post comments" ON "public"."post_comments" FOR INSERT WITH CHECK (("tenant_id" = "public"."get_auth_tenant_id"()));
CREATE POLICY "Tenant can manage own post approvals" ON "public"."post_approvals" USING (("tenant_id" = "public"."get_auth_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_auth_tenant_id"()));
CREATE POLICY "Tenant can view own post comments" ON "public"."post_comments" FOR SELECT USING (("tenant_id" = "public"."get_auth_tenant_id"()));
CREATE POLICY "Tenant insert own idempotency keys" ON "public"."idempotency_keys" FOR INSERT WITH CHECK (("tenant_id" = "public"."get_auth_tenant_id"()));
CREATE POLICY "Tenant manage pql events" ON "public"."pql_events" USING (("tenant_id" = "public"."get_auth_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_auth_tenant_id"()));
CREATE POLICY "Tenant manage role permissions" ON "public"."role_permissions" USING (("tenant_id" = "public"."get_auth_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_auth_tenant_id"()));
CREATE POLICY "Tenant manage roles" ON "public"."roles" USING (("tenant_id" = "public"."get_auth_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_auth_tenant_id"()));
CREATE POLICY "Tenant manage short links" ON "public"."short_links" USING (("tenant_id" = "public"."get_auth_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_auth_tenant_id"()));
CREATE POLICY "Tenant manage user roles" ON "public"."user_roles" USING (("tenant_id" = "public"."get_auth_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_auth_tenant_id"()));
CREATE POLICY "Tenant read own idempotency keys" ON "public"."idempotency_keys" FOR SELECT USING (("tenant_id" = "public"."get_auth_tenant_id"()));
CREATE POLICY "Tenant update own idempotency keys" ON "public"."idempotency_keys" FOR UPDATE USING (("tenant_id" = "public"."get_auth_tenant_id"()));
CREATE POLICY "Users can view brand permissions" ON "public"."user_brand_permissions" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR ("brand_id" IN ( SELECT "user_brand_permissions_1"."brand_id"
   FROM "public"."user_brand_permissions" "user_brand_permissions_1"
  WHERE ("user_brand_permissions_1"."user_id" = "auth"."uid"())))));
CREATE POLICY "Users can view campaigns from their tenant" ON "public"."campaigns" USING (("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));
CREATE POLICY "Users can view own activity" ON "public"."user_activity_log" FOR SELECT USING (("auth"."uid"() = "user_id"));
CREATE POLICY "Users can view own brand assignments" ON "public"."user_brand_permissions" FOR SELECT USING (("auth"."uid"() = "user_id"));
CREATE POLICY "Users can view retention policies" ON "public"."data_retention_policies" FOR SELECT TO "authenticated" USING (true);
ALTER TABLE "public"."ai_generation_feedback" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_generation_feedback_tenant_isolation" ON "public"."ai_generation_feedback" USING ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid"))))));
ALTER TABLE "public"."ai_platform_prompt_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ai_platform_prompts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."analytics" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "analytics_tenant_isolation" ON "public"."analytics" USING ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid"))))));
ALTER TABLE "public"."api_usage" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "api_usage_tenant_isolation" ON "public"."api_usage" USING ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid"))))));
ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_log_tenant_read" ON "public"."audit_log" FOR SELECT USING (("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))));
ALTER TABLE "public"."brand_profiles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brand_profiles_all" ON "public"."brand_profiles" USING ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid"))))));
CREATE POLICY "brand_profiles_select" ON "public"."brand_profiles" FOR SELECT USING (("tenant_id" = "public"."get_auth_tenant_id"()));
ALTER TABLE "public"."brand_voice_profiles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brand_voice_profiles_tenant_isolation" ON "public"."brand_voice_profiles" USING ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid"))))));
ALTER TABLE "public"."brand_voice_samples" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brand_voice_samples_tenant_isolation" ON "public"."brand_voice_samples" USING ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid"))))));
ALTER TABLE "public"."campaign_posts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaign_posts_select" ON "public"."campaign_posts" FOR SELECT USING ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("campaign_id" IN ( SELECT "campaigns"."id"
   FROM "public"."campaigns"
  WHERE ("campaigns"."tenant_id" = "public"."get_auth_tenant_id"())))));
CREATE POLICY "campaign_posts_tenant_isolation" ON "public"."campaign_posts" USING ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid"))))));
ALTER TABLE "public"."campaign_templates" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaign_templates_tenant_isolation" ON "public"."campaign_templates" USING ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid"))))));
ALTER TABLE "public"."campaigns" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaigns_delete_fixed" ON "public"."campaigns" FOR DELETE USING ((("tenant_id" = "public"."get_auth_tenant_id"()) OR (("auth"."jwt"() ->> 'email'::"text") = 'pipitcher@gmail.com'::"text")));
CREATE POLICY "campaigns_insert_fixed" ON "public"."campaigns" FOR INSERT WITH CHECK ((("tenant_id" = "public"."get_auth_tenant_id"()) OR (("auth"."jwt"() ->> 'email'::"text") = 'pipitcher@gmail.com'::"text")));
CREATE POLICY "campaigns_select_fixed" ON "public"."campaigns" FOR SELECT USING ((("tenant_id" = "public"."get_auth_tenant_id"()) OR (("auth"."jwt"() ->> 'email'::"text") = 'pipitcher@gmail.com'::"text")));
CREATE POLICY "campaigns_update_fixed" ON "public"."campaigns" FOR UPDATE USING ((("tenant_id" = "public"."get_auth_tenant_id"()) OR (("auth"."jwt"() ->> 'email'::"text") = 'pipitcher@gmail.com'::"text")));
ALTER TABLE "public"."content_guardrails" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."content_guardrails_history" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "content_guardrails_history_insert" ON "public"."content_guardrails_history" FOR INSERT WITH CHECK ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid"))))));
CREATE POLICY "content_guardrails_tenant_isolation" ON "public"."content_guardrails" USING ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid"))))));
ALTER TABLE "public"."data_exports" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "data_exports_insert" ON "public"."data_exports" FOR INSERT WITH CHECK ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid"))))));
ALTER TABLE "public"."data_retention_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."error_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "error_logs_tenant_isolation" ON "public"."error_logs" USING ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid"))))));
ALTER TABLE "public"."event_briefs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "event_briefs_read_all_authenticated" ON "public"."event_briefs" FOR SELECT USING (true);
CREATE POLICY "event_briefs_superadmin_delete" ON "public"."event_briefs" FOR DELETE USING ("public"."is_superadmin"());
CREATE POLICY "event_briefs_superadmin_insert" ON "public"."event_briefs" FOR INSERT WITH CHECK ("public"."is_superadmin"());
CREATE POLICY "event_briefs_superadmin_update" ON "public"."event_briefs" FOR UPDATE USING ("public"."is_superadmin"()) WITH CHECK ("public"."is_superadmin"());
ALTER TABLE "public"."event_occurrences" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "event_occurrences_read_all_authenticated" ON "public"."event_occurrences" FOR SELECT USING (true);
CREATE POLICY "event_occurrences_superadmin_delete" ON "public"."event_occurrences" FOR DELETE USING ("public"."is_superadmin"());
CREATE POLICY "event_occurrences_superadmin_insert" ON "public"."event_occurrences" FOR INSERT WITH CHECK ("public"."is_superadmin"());
CREATE POLICY "event_occurrences_superadmin_update" ON "public"."event_occurrences" FOR UPDATE USING ("public"."is_superadmin"()) WITH CHECK ("public"."is_superadmin"());
ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "events_read_all_authenticated" ON "public"."events" FOR SELECT USING (true);
CREATE POLICY "events_superadmin_delete" ON "public"."events" FOR DELETE USING ("public"."is_superadmin"());
CREATE POLICY "events_superadmin_insert" ON "public"."events" FOR INSERT WITH CHECK ("public"."is_superadmin"());
CREATE POLICY "events_superadmin_update" ON "public"."events" FOR UPDATE USING ("public"."is_superadmin"()) WITH CHECK ("public"."is_superadmin"());
ALTER TABLE "public"."global_content_settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "global_content_settings_delete_superadmin" ON "public"."global_content_settings" FOR DELETE USING (((( SELECT "auth"."jwt"() AS "jwt") ->> 'email'::"text") = 'pipitcher@gmail.com'::"text"));
CREATE POLICY "global_content_settings_insert_superadmin" ON "public"."global_content_settings" FOR INSERT WITH CHECK (((( SELECT "auth"."jwt"() AS "jwt") ->> 'email'::"text") = 'pipitcher@gmail.com'::"text"));
CREATE POLICY "global_content_settings_select_all" ON "public"."global_content_settings" FOR SELECT USING (true);
CREATE POLICY "global_content_settings_update_superadmin" ON "public"."global_content_settings" FOR UPDATE USING (((( SELECT "auth"."jwt"() AS "jwt") ->> 'email'::"text") = 'pipitcher@gmail.com'::"text")) WITH CHECK (((( SELECT "auth"."jwt"() AS "jwt") ->> 'email'::"text") = 'pipitcher@gmail.com'::"text"));
ALTER TABLE "public"."guardrail_audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."idea_instances" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "idea_instances_read_all_authenticated" ON "public"."idea_instances" FOR SELECT USING (true);
CREATE POLICY "idea_instances_superadmin_delete" ON "public"."idea_instances" FOR DELETE USING ("public"."is_superadmin"());
CREATE POLICY "idea_instances_superadmin_insert" ON "public"."idea_instances" FOR INSERT WITH CHECK ("public"."is_superadmin"());
CREATE POLICY "idea_instances_superadmin_update" ON "public"."idea_instances" FOR UPDATE USING ("public"."is_superadmin"()) WITH CHECK ("public"."is_superadmin"());
ALTER TABLE "public"."idempotency_keys" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "insert_via_trigger_guardrail_audit" ON "public"."guardrail_audit_log" FOR INSERT WITH CHECK ((("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) AND ("changed_by" = "auth"."uid"())));
ALTER TABLE "public"."media_assets" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "media_assets_tenant_isolation" ON "public"."media_assets" USING ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid"))))));
ALTER TABLE "public"."notification_outbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."notification_settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notification_settings_own" ON "public"."notification_settings" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));
ALTER TABLE "public"."performance_metrics" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "performance_metrics_tenant_isolation" ON "public"."performance_metrics" USING ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid"))))));
ALTER TABLE "public"."post_approvals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."post_comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."post_revisions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "post_revisions_tenant_rw" ON "public"."post_revisions" USING (("post_id" IN ( SELECT "campaign_posts"."id"
   FROM "public"."campaign_posts"
  WHERE ("campaign_posts"."tenant_id" = "public"."get_auth_tenant_id"())))) WITH CHECK (("post_id" IN ( SELECT "campaign_posts"."id"
   FROM "public"."campaign_posts"
  WHERE ("campaign_posts"."tenant_id" = "public"."get_auth_tenant_id"()))));
ALTER TABLE "public"."posting_schedules" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "posting_schedules_tenant_isolation" ON "public"."posting_schedules" USING ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid"))))));
ALTER TABLE "public"."pql_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."publishing_history" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "publishing_history_insert" ON "public"."publishing_history" FOR INSERT WITH CHECK (("campaign_post_id" IN ( SELECT "campaign_posts"."id"
   FROM "public"."campaign_posts"
  WHERE (("campaign_posts"."tenant_id" = "public"."get_auth_tenant_id"()) OR ("campaign_posts"."tenant_id" IN ( SELECT "users"."tenant_id"
           FROM "public"."users"
          WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid"))))))));
CREATE POLICY "publishing_history_select" ON "public"."publishing_history" FOR SELECT USING (("campaign_post_id" IN ( SELECT "campaign_posts"."id"
   FROM "public"."campaign_posts"
  WHERE (("campaign_posts"."tenant_id" = "public"."get_auth_tenant_id"()) OR ("campaign_posts"."tenant_id" IN ( SELECT "users"."tenant_id"
           FROM "public"."users"
          WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid"))))))));
CREATE POLICY "publishing_history_update" ON "public"."publishing_history" FOR UPDATE USING (("campaign_post_id" IN ( SELECT "campaign_posts"."id"
   FROM "public"."campaign_posts"
  WHERE (("campaign_posts"."tenant_id" = "public"."get_auth_tenant_id"()) OR ("campaign_posts"."tenant_id" IN ( SELECT "users"."tenant_id"
           FROM "public"."users"
          WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))))))) WITH CHECK (("campaign_post_id" IN ( SELECT "campaign_posts"."id"
   FROM "public"."campaign_posts"
  WHERE (("campaign_posts"."tenant_id" = "public"."get_auth_tenant_id"()) OR ("campaign_posts"."tenant_id" IN ( SELECT "users"."tenant_id"
           FROM "public"."users"
          WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid"))))))));
ALTER TABLE "public"."publishing_queue" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "publishing_queue_select" ON "public"."publishing_queue" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."campaign_posts" "cp"
  WHERE (("cp"."id" = "publishing_queue"."campaign_post_id") AND ("cp"."tenant_id" = "public"."get_auth_tenant_id"())))));
CREATE POLICY "publishing_queue_tenant_isolation" ON "public"."publishing_queue" USING (("campaign_post_id" IN ( SELECT "campaign_posts"."id"
   FROM "public"."campaign_posts"
  WHERE (("campaign_posts"."tenant_id" = "public"."get_auth_tenant_id"()) OR ("campaign_posts"."tenant_id" IN ( SELECT "users"."tenant_id"
           FROM "public"."users"
          WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))))))) WITH CHECK (("campaign_post_id" IN ( SELECT "campaign_posts"."id"
   FROM "public"."campaign_posts"
  WHERE (("campaign_posts"."tenant_id" = "public"."get_auth_tenant_id"()) OR ("campaign_posts"."tenant_id" IN ( SELECT "users"."tenant_id"
           FROM "public"."users"
          WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid"))))))));
ALTER TABLE "public"."role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."short_clicks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "short_clicks_insert_any" ON "public"."short_clicks" FOR INSERT WITH CHECK (true);
CREATE POLICY "short_clicks_select_tenant" ON "public"."short_clicks" FOR SELECT USING (("link_id" IN ( SELECT "short_links"."id"
   FROM "public"."short_links"
  WHERE ("short_links"."tenant_id" = "public"."get_auth_tenant_id"()))));
ALTER TABLE "public"."short_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."social_accounts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "social_accounts_tenant_isolation" ON "public"."social_accounts" USING ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid"))))));
ALTER TABLE "public"."social_connections" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "social_connections_tenant_isolation" ON "public"."social_connections" USING ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid"))))));
ALTER TABLE "public"."superadmin_audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."support_tickets" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "support_tickets_tenant_isolation" ON "public"."support_tickets" USING ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid"))))));
ALTER TABLE "public"."team_invitations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_invitations_insert" ON "public"."team_invitations" FOR INSERT WITH CHECK ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE (("users"."id" = ( SELECT "auth"."uid"() AS "uid")) AND (("users"."role")::"text" = ANY ((ARRAY['owner'::character varying, 'admin'::character varying])::"text"[])))))));
CREATE POLICY "team_invitations_view" ON "public"."team_invitations" FOR SELECT USING ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("email" = (( SELECT "users"."email"
   FROM "auth"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid"))))::"text")));
CREATE POLICY "tenant_can_select_guardrail_audit" ON "public"."guardrail_audit_log" FOR SELECT USING (("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));
ALTER TABLE "public"."tenant_logos" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_logos_tenant_isolation" ON "public"."tenant_logos" USING ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid"))))));
ALTER TABLE "public"."tenants" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenants_delete_fixed" ON "public"."tenants" FOR DELETE USING ((("auth"."jwt"() ->> 'email'::"text") = 'pipitcher@gmail.com'::"text"));
CREATE POLICY "tenants_insert_owner_match" ON "public"."tenants" FOR INSERT TO "authenticated" WITH CHECK (("owner_id" = "auth"."uid"()));
CREATE POLICY "tenants_insert_superadmin" ON "public"."tenants" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."jwt"() ->> 'email'::"text") = 'pipitcher@gmail.com'::"text"));
CREATE POLICY "tenants_select_fixed" ON "public"."tenants" FOR SELECT USING ((("id" = "public"."get_auth_tenant_id"()) OR (("auth"."jwt"() ->> 'email'::"text") = 'pipitcher@gmail.com'::"text")));
CREATE POLICY "tenants_update_fixed" ON "public"."tenants" FOR UPDATE USING ((("id" = "public"."get_auth_tenant_id"()) OR (("auth"."jwt"() ->> 'email'::"text") = 'pipitcher@gmail.com'::"text")));
ALTER TABLE "public"."two_factor_auth" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "two_factor_auth_own" ON "public"."two_factor_auth" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));
ALTER TABLE "public"."usage_quota" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "usage_quota_tenant_rw" ON "public"."usage_quota" USING (("tenant_id" = "public"."get_auth_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_auth_tenant_id"()));
ALTER TABLE "public"."user_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."user_activity_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."user_brand_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."user_deletion_requests" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_deletion_requests_insert" ON "public"."user_deletion_requests" FOR INSERT WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));
ALTER TABLE "public"."user_prefs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_prefs_select_own" ON "public"."user_prefs" FOR SELECT USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));
CREATE POLICY "user_prefs_update_own" ON "public"."user_prefs" FOR UPDATE USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));
CREATE POLICY "user_prefs_upsert_own" ON "public"."user_prefs" FOR INSERT WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));
ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."user_status_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."user_tenants" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_tenants_delete_fixed" ON "public"."user_tenants" FOR DELETE USING ((("user_id" = "auth"."uid"()) OR (("auth"."jwt"() ->> 'email'::"text") = 'pipitcher@gmail.com'::"text")));
CREATE POLICY "user_tenants_insert_fixed" ON "public"."user_tenants" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) OR (("auth"."jwt"() ->> 'email'::"text") = 'pipitcher@gmail.com'::"text")));
CREATE POLICY "user_tenants_select_fixed" ON "public"."user_tenants" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR ("tenant_id" = "public"."get_auth_tenant_id"()) OR (("auth"."jwt"() ->> 'email'::"text") = 'pipitcher@gmail.com'::"text")));
CREATE POLICY "user_tenants_update_fixed" ON "public"."user_tenants" FOR UPDATE USING ((("user_id" = "auth"."uid"()) OR (("auth"."jwt"() ->> 'email'::"text") = 'pipitcher@gmail.com'::"text")));
ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_delete_fixed" ON "public"."users" FOR DELETE USING ((("auth"."jwt"() ->> 'email'::"text") = 'pipitcher@gmail.com'::"text"));
CREATE POLICY "users_insert_fixed" ON "public"."users" FOR INSERT WITH CHECK (("id" = "auth"."uid"()));
CREATE POLICY "users_select_fixed" ON "public"."users" FOR SELECT USING ((("id" = "auth"."uid"()) OR ("tenant_id" = "public"."get_auth_tenant_id"()) OR (("auth"."jwt"() ->> 'email'::"text") = 'pipitcher@gmail.com'::"text")));
CREATE POLICY "users_update_fixed" ON "public"."users" FOR UPDATE USING ((("id" = "auth"."uid"()) OR (("auth"."jwt"() ->> 'email'::"text") = 'pipitcher@gmail.com'::"text")));
ALTER TABLE "public"."watermark_settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "watermark_settings_tenant_isolation" ON "public"."watermark_settings" USING ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((("tenant_id" = "public"."get_auth_tenant_id"()) OR ("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid"))))));
ALTER TABLE "public"."workflow_step_assignments" ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT ALL ON FUNCTION "public"."acquire_inspiration_lock"() TO "anon";
GRANT ALL ON FUNCTION "public"."acquire_inspiration_lock"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."acquire_inspiration_lock"() TO "service_role";
GRANT ALL ON FUNCTION "public"."can_deactivate_user"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_deactivate_user"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_deactivate_user"("p_user_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."can_remove_brand_admin"("p_user_id" "uuid", "p_brand_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_remove_brand_admin"("p_user_id" "uuid", "p_brand_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_remove_brand_admin"("p_user_id" "uuid", "p_brand_id" "uuid") TO "service_role";
GRANT ALL ON TABLE "public"."notification_outbox" TO "anon";
GRANT ALL ON TABLE "public"."notification_outbox" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_outbox" TO "service_role";
REVOKE ALL ON FUNCTION "public"."claim_notifications"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_notifications"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_notifications"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_notifications"("p_limit" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."cleanup_deleted_users"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_deleted_users"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_deleted_users"() TO "service_role";
GRANT ALL ON FUNCTION "public"."cleanup_expired_data"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_expired_data"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_expired_data"() TO "service_role";
GRANT ALL ON FUNCTION "public"."cleanup_old_activity_logs"("p_retention_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_old_activity_logs"("p_retention_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_old_activity_logs"("p_retention_days" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."create_ai_prompt_history"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_ai_prompt_history"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_ai_prompt_history"() TO "service_role";
REVOKE ALL ON FUNCTION "public"."create_tenant_and_assign"("p_name" "text", "p_business_type" "text", "p_brand_voice" "text", "p_target_audience" "text", "p_brand_identity" "text", "p_brand_color" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_tenant_and_assign"("p_name" "text", "p_business_type" "text", "p_brand_voice" "text", "p_target_audience" "text", "p_brand_identity" "text", "p_brand_color" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_tenant_and_assign"("p_name" "text", "p_business_type" "text", "p_brand_voice" "text", "p_target_audience" "text", "p_brand_identity" "text", "p_brand_color" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_tenant_and_assign"("p_name" "text", "p_business_type" "text", "p_brand_voice" "text", "p_target_audience" "text", "p_brand_identity" "text", "p_brand_color" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."create_user_account"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_user_account"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_user_account"() TO "service_role";
GRANT ALL ON FUNCTION "public"."create_workflow_and_log_invitations"("p_brand_id" "uuid", "p_workflow_name" "text", "p_workflow_description" "text", "p_created_by" "uuid", "p_workflow_steps" "jsonb", "p_template_id" "uuid", "p_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_workflow_and_log_invitations"("p_brand_id" "uuid", "p_workflow_name" "text", "p_workflow_description" "text", "p_created_by" "uuid", "p_workflow_steps" "jsonb", "p_template_id" "uuid", "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_workflow_and_log_invitations"("p_brand_id" "uuid", "p_workflow_name" "text", "p_workflow_description" "text", "p_created_by" "uuid", "p_workflow_steps" "jsonb", "p_template_id" "uuid", "p_status" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."deactivate_user"("p_user_id" "uuid", "p_reason" "text", "p_changed_by" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."deactivate_user"("p_user_id" "uuid", "p_reason" "text", "p_changed_by" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."deactivate_user"("p_user_id" "uuid", "p_reason" "text", "p_changed_by" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."delete_user_account"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_user_account"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_user_account"("p_user_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."enqueue_notification"("p_type" "text", "p_subject" "text", "p_template_name" "text", "p_template_data" "jsonb", "p_recipient_id" "uuid", "p_recipient_email" "text", "p_priority" integer, "p_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."enqueue_notification"("p_type" "text", "p_subject" "text", "p_template_name" "text", "p_template_data" "jsonb", "p_recipient_id" "uuid", "p_recipient_email" "text", "p_priority" integer, "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."enqueue_notification"("p_type" "text", "p_subject" "text", "p_template_name" "text", "p_template_data" "jsonb", "p_recipient_id" "uuid", "p_recipient_email" "text", "p_priority" integer, "p_metadata" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."enqueue_workflow_notification"("p_content_id" "uuid", "p_workflow_id" "uuid", "p_step_id" "uuid", "p_recipient_id" "uuid", "p_action" "text", "p_content_title" "text", "p_brand_name" "text", "p_step_name" "text", "p_comment" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."enqueue_workflow_notification"("p_content_id" "uuid", "p_workflow_id" "uuid", "p_step_id" "uuid", "p_recipient_id" "uuid", "p_action" "text", "p_content_title" "text", "p_brand_name" "text", "p_step_name" "text", "p_comment" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."enqueue_workflow_notification"("p_content_id" "uuid", "p_workflow_id" "uuid", "p_step_id" "uuid", "p_recipient_id" "uuid", "p_action" "text", "p_content_title" "text", "p_brand_name" "text", "p_step_name" "text", "p_comment" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_auth_tenant_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_auth_tenant_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_auth_tenant_id"() TO "service_role";
GRANT ALL ON FUNCTION "public"."get_user_activity"("p_user_id" "uuid", "p_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_activity"("p_user_id" "uuid", "p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_activity"("p_user_id" "uuid", "p_days" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."get_user_activity_summary"("p_user_id" "uuid", "p_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_activity_summary"("p_user_id" "uuid", "p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_activity_summary"("p_user_id" "uuid", "p_days" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."get_user_brand_assignments"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_brand_assignments"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_brand_assignments"("p_user_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";
GRANT ALL ON FUNCTION "public"."handle_user_tenant_claim"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_user_tenant_claim"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_user_tenant_claim"() TO "service_role";
GRANT ALL ON FUNCTION "public"."increment_ai_prompt_version"() TO "anon";
GRANT ALL ON FUNCTION "public"."increment_ai_prompt_version"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_ai_prompt_version"() TO "service_role";
GRANT ALL ON FUNCTION "public"."increment_guardrails_usage"("guardrail_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."increment_guardrails_usage"("guardrail_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_guardrails_usage"("guardrail_ids" "uuid"[]) TO "service_role";
GRANT ALL ON FUNCTION "public"."increment_guardrails_usage"("guardrail_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_guardrails_usage"("guardrail_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_guardrails_usage"("guardrail_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."is_superadmin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_superadmin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_superadmin"() TO "service_role";
GRANT ALL ON FUNCTION "public"."is_user_active"("user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_user_active"("user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_user_active"("user_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."log_guardrail_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_guardrail_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_guardrail_change"() TO "service_role";
GRANT ALL ON FUNCTION "public"."log_superadmin_action"("p_action" "text", "p_target_table" "text", "p_target_id" "uuid", "p_target_tenant_id" "uuid", "p_details" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."log_superadmin_action"("p_action" "text", "p_target_table" "text", "p_target_id" "uuid", "p_target_tenant_id" "uuid", "p_details" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_superadmin_action"("p_action" "text", "p_target_table" "text", "p_target_id" "uuid", "p_target_tenant_id" "uuid", "p_details" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."log_user_activity"("p_user_id" "uuid", "p_action_type" "text", "p_action_category" "text", "p_resource_type" "text", "p_resource_id" "uuid", "p_resource_name" "text", "p_brand_id" "uuid", "p_ip_address" "inet", "p_user_agent" "text", "p_session_id" "text", "p_duration_ms" integer, "p_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."log_user_activity"("p_user_id" "uuid", "p_action_type" "text", "p_action_category" "text", "p_resource_type" "text", "p_resource_id" "uuid", "p_resource_name" "text", "p_brand_id" "uuid", "p_ip_address" "inet", "p_user_agent" "text", "p_session_id" "text", "p_duration_ms" integer, "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_user_activity"("p_user_id" "uuid", "p_action_type" "text", "p_action_category" "text", "p_resource_type" "text", "p_resource_id" "uuid", "p_resource_name" "text", "p_brand_id" "uuid", "p_ip_address" "inet", "p_user_agent" "text", "p_session_id" "text", "p_duration_ms" integer, "p_metadata" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."reactivate_user"("p_user_id" "uuid", "p_reason" "text", "p_changed_by" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."reactivate_user"("p_user_id" "uuid", "p_reason" "text", "p_changed_by" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reactivate_user"("p_user_id" "uuid", "p_reason" "text", "p_changed_by" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."release_inspiration_lock"() TO "anon";
GRANT ALL ON FUNCTION "public"."release_inspiration_lock"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."release_inspiration_lock"() TO "service_role";
GRANT ALL ON FUNCTION "public"."set_user_tenant_id_from_membership"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_user_tenant_id_from_membership"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_user_tenant_id_from_membership"() TO "service_role";
GRANT ALL ON FUNCTION "public"."soft_delete_user_account"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."soft_delete_user_account"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."soft_delete_user_account"("p_user_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."sync_user_email"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_user_email"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_user_email"() TO "service_role";
GRANT ALL ON FUNCTION "public"."test_tenant_creation_now"() TO "anon";
GRANT ALL ON FUNCTION "public"."test_tenant_creation_now"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."test_tenant_creation_now"() TO "service_role";
GRANT ALL ON FUNCTION "public"."update_guardrails_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_guardrails_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_guardrails_updated_at"() TO "service_role";
GRANT ALL ON FUNCTION "public"."update_media_last_used"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_media_last_used"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_media_last_used"() TO "service_role";
GRANT ALL ON FUNCTION "public"."update_support_tickets_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_support_tickets_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_support_tickets_updated_at"() TO "service_role";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";
GRANT ALL ON FUNCTION "public"."update_user_brand_assignments"("p_user_id" "uuid", "p_brand_ids" "uuid"[], "p_default_role" "text", "p_updated_by" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."update_user_brand_assignments"("p_user_id" "uuid", "p_brand_ids" "uuid"[], "p_default_role" "text", "p_updated_by" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_user_brand_assignments"("p_user_id" "uuid", "p_brand_ids" "uuid"[], "p_default_role" "text", "p_updated_by" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."update_workflow_published_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_workflow_published_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_workflow_published_at"() TO "service_role";
GRANT ALL ON TABLE "public"."user_brand_permissions" TO "anon";
GRANT ALL ON TABLE "public"."user_brand_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."user_brand_permissions" TO "service_role";
GRANT ALL ON TABLE "public"."active_brand_users_v" TO "anon";
GRANT ALL ON TABLE "public"."active_brand_users_v" TO "authenticated";
GRANT ALL ON TABLE "public"."active_brand_users_v" TO "service_role";
GRANT ALL ON TABLE "public"."ai_generation_feedback" TO "anon";
GRANT ALL ON TABLE "public"."ai_generation_feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_generation_feedback" TO "service_role";
GRANT ALL ON TABLE "public"."ai_platform_prompt_history" TO "anon";
GRANT ALL ON TABLE "public"."ai_platform_prompt_history" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_platform_prompt_history" TO "service_role";
GRANT ALL ON TABLE "public"."ai_platform_prompts" TO "anon";
GRANT ALL ON TABLE "public"."ai_platform_prompts" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_platform_prompts" TO "service_role";
GRANT ALL ON TABLE "public"."analytics" TO "anon";
GRANT ALL ON TABLE "public"."analytics" TO "authenticated";
GRANT ALL ON TABLE "public"."analytics" TO "service_role";
GRANT ALL ON TABLE "public"."api_usage" TO "anon";
GRANT ALL ON TABLE "public"."api_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."api_usage" TO "service_role";
GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";
GRANT ALL ON TABLE "public"."brand_profiles" TO "anon";
GRANT ALL ON TABLE "public"."brand_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."brand_profiles" TO "service_role";
GRANT ALL ON TABLE "public"."brand_voice_profiles" TO "anon";
GRANT ALL ON TABLE "public"."brand_voice_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."brand_voice_profiles" TO "service_role";
GRANT ALL ON TABLE "public"."brand_voice_samples" TO "anon";
GRANT ALL ON TABLE "public"."brand_voice_samples" TO "authenticated";
GRANT ALL ON TABLE "public"."brand_voice_samples" TO "service_role";
GRANT ALL ON TABLE "public"."brands" TO "anon";
GRANT ALL ON TABLE "public"."brands" TO "authenticated";
GRANT ALL ON TABLE "public"."brands" TO "service_role";
GRANT ALL ON TABLE "public"."campaign_posts" TO "anon";
GRANT ALL ON TABLE "public"."campaign_posts" TO "authenticated";
GRANT ALL ON TABLE "public"."campaign_posts" TO "service_role";
GRANT ALL ON TABLE "public"."campaign_templates" TO "anon";
GRANT ALL ON TABLE "public"."campaign_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."campaign_templates" TO "service_role";
GRANT ALL ON TABLE "public"."campaigns" TO "anon";
GRANT ALL ON TABLE "public"."campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."campaigns" TO "service_role";
GRANT ALL ON TABLE "public"."content_guardrails" TO "anon";
GRANT ALL ON TABLE "public"."content_guardrails" TO "authenticated";
GRANT ALL ON TABLE "public"."content_guardrails" TO "service_role";
GRANT ALL ON TABLE "public"."content_guardrails_history" TO "anon";
GRANT ALL ON TABLE "public"."content_guardrails_history" TO "authenticated";
GRANT ALL ON TABLE "public"."content_guardrails_history" TO "service_role";
GRANT ALL ON TABLE "public"."data_exports" TO "anon";
GRANT ALL ON TABLE "public"."data_exports" TO "authenticated";
GRANT ALL ON TABLE "public"."data_exports" TO "service_role";
GRANT ALL ON TABLE "public"."data_retention_policies" TO "anon";
GRANT ALL ON TABLE "public"."data_retention_policies" TO "authenticated";
GRANT ALL ON TABLE "public"."data_retention_policies" TO "service_role";
GRANT ALL ON TABLE "public"."error_logs" TO "anon";
GRANT ALL ON TABLE "public"."error_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."error_logs" TO "service_role";
GRANT ALL ON TABLE "public"."event_briefs" TO "anon";
GRANT ALL ON TABLE "public"."event_briefs" TO "authenticated";
GRANT ALL ON TABLE "public"."event_briefs" TO "service_role";
GRANT ALL ON TABLE "public"."event_occurrences" TO "anon";
GRANT ALL ON TABLE "public"."event_occurrences" TO "authenticated";
GRANT ALL ON TABLE "public"."event_occurrences" TO "service_role";
GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";
GRANT ALL ON TABLE "public"."global_content_settings" TO "anon";
GRANT ALL ON TABLE "public"."global_content_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."global_content_settings" TO "service_role";
GRANT ALL ON TABLE "public"."guardrail_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."guardrail_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."guardrail_audit_log" TO "service_role";
GRANT ALL ON TABLE "public"."idea_instances" TO "anon";
GRANT ALL ON TABLE "public"."idea_instances" TO "authenticated";
GRANT ALL ON TABLE "public"."idea_instances" TO "service_role";
GRANT ALL ON TABLE "public"."idempotency_keys" TO "anon";
GRANT ALL ON TABLE "public"."idempotency_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."idempotency_keys" TO "service_role";
GRANT ALL ON TABLE "public"."index_usage_stats" TO "anon";
GRANT ALL ON TABLE "public"."index_usage_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."index_usage_stats" TO "service_role";
GRANT ALL ON TABLE "public"."media_assets" TO "anon";
GRANT ALL ON TABLE "public"."media_assets" TO "authenticated";
GRANT ALL ON TABLE "public"."media_assets" TO "service_role";
GRANT ALL ON TABLE "public"."notification_settings" TO "anon";
GRANT ALL ON TABLE "public"."notification_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_settings" TO "service_role";
GRANT ALL ON TABLE "public"."performance_metrics" TO "anon";
GRANT ALL ON TABLE "public"."performance_metrics" TO "authenticated";
GRANT ALL ON TABLE "public"."performance_metrics" TO "service_role";
GRANT ALL ON TABLE "public"."post_approvals" TO "anon";
GRANT ALL ON TABLE "public"."post_approvals" TO "authenticated";
GRANT ALL ON TABLE "public"."post_approvals" TO "service_role";
GRANT ALL ON TABLE "public"."post_comments" TO "anon";
GRANT ALL ON TABLE "public"."post_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."post_comments" TO "service_role";
GRANT ALL ON TABLE "public"."post_revisions" TO "anon";
GRANT ALL ON TABLE "public"."post_revisions" TO "authenticated";
GRANT ALL ON TABLE "public"."post_revisions" TO "service_role";
GRANT ALL ON TABLE "public"."posting_schedules" TO "anon";
GRANT ALL ON TABLE "public"."posting_schedules" TO "authenticated";
GRANT ALL ON TABLE "public"."posting_schedules" TO "service_role";
GRANT ALL ON TABLE "public"."pql_events" TO "anon";
GRANT ALL ON TABLE "public"."pql_events" TO "authenticated";
GRANT ALL ON TABLE "public"."pql_events" TO "service_role";
GRANT ALL ON TABLE "public"."publishing_history" TO "anon";
GRANT ALL ON TABLE "public"."publishing_history" TO "authenticated";
GRANT ALL ON TABLE "public"."publishing_history" TO "service_role";
GRANT ALL ON TABLE "public"."publishing_queue" TO "anon";
GRANT ALL ON TABLE "public"."publishing_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."publishing_queue" TO "service_role";
GRANT ALL ON TABLE "public"."role_permissions" TO "anon";
GRANT ALL ON TABLE "public"."role_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."role_permissions" TO "service_role";
GRANT ALL ON TABLE "public"."roles" TO "anon";
GRANT ALL ON TABLE "public"."roles" TO "authenticated";
GRANT ALL ON TABLE "public"."roles" TO "service_role";
GRANT ALL ON TABLE "public"."short_clicks" TO "anon";
GRANT ALL ON TABLE "public"."short_clicks" TO "authenticated";
GRANT ALL ON TABLE "public"."short_clicks" TO "service_role";
GRANT ALL ON TABLE "public"."short_links" TO "anon";
GRANT ALL ON TABLE "public"."short_links" TO "authenticated";
GRANT ALL ON TABLE "public"."short_links" TO "service_role";
GRANT ALL ON TABLE "public"."social_accounts" TO "anon";
GRANT ALL ON TABLE "public"."social_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."social_accounts" TO "service_role";
GRANT ALL ON TABLE "public"."social_connections" TO "anon";
GRANT ALL ON TABLE "public"."social_connections" TO "authenticated";
GRANT ALL ON TABLE "public"."social_connections" TO "service_role";
GRANT ALL ON TABLE "public"."superadmin_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."superadmin_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."superadmin_audit_log" TO "service_role";
GRANT ALL ON TABLE "public"."superadmin_dashboard" TO "anon";
GRANT ALL ON TABLE "public"."superadmin_dashboard" TO "authenticated";
GRANT ALL ON TABLE "public"."superadmin_dashboard" TO "service_role";
GRANT ALL ON TABLE "public"."support_tickets" TO "anon";
GRANT ALL ON TABLE "public"."support_tickets" TO "authenticated";
GRANT ALL ON TABLE "public"."support_tickets" TO "service_role";
GRANT ALL ON TABLE "public"."team_invitations" TO "anon";
GRANT ALL ON TABLE "public"."team_invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."team_invitations" TO "service_role";
GRANT ALL ON TABLE "public"."tenant_logos" TO "anon";
GRANT ALL ON TABLE "public"."tenant_logos" TO "authenticated";
GRANT ALL ON TABLE "public"."tenant_logos" TO "service_role";
GRANT ALL ON TABLE "public"."tenants" TO "anon";
GRANT ALL ON TABLE "public"."tenants" TO "authenticated";
GRANT ALL ON TABLE "public"."tenants" TO "service_role";
GRANT ALL ON TABLE "public"."two_factor_auth" TO "anon";
GRANT ALL ON TABLE "public"."two_factor_auth" TO "authenticated";
GRANT ALL ON TABLE "public"."two_factor_auth" TO "service_role";
GRANT ALL ON TABLE "public"."usage_quota" TO "anon";
GRANT ALL ON TABLE "public"."usage_quota" TO "authenticated";
GRANT ALL ON TABLE "public"."usage_quota" TO "service_role";
GRANT ALL ON TABLE "public"."user_accounts" TO "anon";
GRANT ALL ON TABLE "public"."user_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."user_accounts" TO "service_role";
GRANT ALL ON TABLE "public"."user_activity_log" TO "anon";
GRANT ALL ON TABLE "public"."user_activity_log" TO "authenticated";
GRANT ALL ON TABLE "public"."user_activity_log" TO "service_role";
GRANT ALL ON TABLE "public"."user_deletion_requests" TO "anon";
GRANT ALL ON TABLE "public"."user_deletion_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."user_deletion_requests" TO "service_role";
GRANT ALL ON TABLE "public"."user_prefs" TO "anon";
GRANT ALL ON TABLE "public"."user_prefs" TO "authenticated";
GRANT ALL ON TABLE "public"."user_prefs" TO "service_role";
GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";
GRANT ALL ON TABLE "public"."user_status_history" TO "anon";
GRANT ALL ON TABLE "public"."user_status_history" TO "authenticated";
GRANT ALL ON TABLE "public"."user_status_history" TO "service_role";
GRANT ALL ON TABLE "public"."user_tenants" TO "anon";
GRANT ALL ON TABLE "public"."user_tenants" TO "authenticated";
GRANT ALL ON TABLE "public"."user_tenants" TO "service_role";
GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";
GRANT ALL ON TABLE "public"."watermark_settings" TO "anon";
GRANT ALL ON TABLE "public"."watermark_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."watermark_settings" TO "service_role";
GRANT ALL ON TABLE "public"."workflow_step_assignments" TO "anon";
GRANT ALL ON TABLE "public"."workflow_step_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."workflow_step_assignments" TO "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
RESET ALL;
