-- Complete Production Schema - Functions, Views, Triggers, and Policies
-- Generated: 2025-01-04
-- This migration creates all functions, views, triggers, and policies

BEGIN;
-- Create helper functions first

CREATE OR REPLACE FUNCTION "public"."trigger_set_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION "public"."update_modified_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION "public"."set_updated_at_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION "public"."update_user_tasks_modtime"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION "public"."update_feedback_item_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;
-- Brand related functions

CREATE OR REPLACE FUNCTION "public"."normalize_website_domain"("url" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
    v_domain TEXT;
BEGIN
    IF url IS NULL OR url = '' THEN
        RETURN NULL;
    END IF;

    -- Remove protocol
    v_domain := regexp_replace(url, '^https?://', '', 'i');
    
    -- Remove www prefix
    v_domain := regexp_replace(v_domain, '^www\.', '', 'i');
    
    -- Remove trailing slash and path
    v_domain := regexp_replace(v_domain, '/.*$', '');
    
    -- Remove port if present
    v_domain := regexp_replace(v_domain, ':[0-9]+$', '');
    
    -- Convert to lowercase
    v_domain := lower(v_domain);
    
    -- Basic validation - must contain at least one dot
    IF v_domain !~ '\.' THEN
        RETURN NULL;
    END IF;
    
    RETURN v_domain;
END;
$$;
CREATE OR REPLACE FUNCTION "public"."update_brand_summary"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Generate brand summary based on brand name and other details
    IF NEW.brand_summary IS NULL OR NEW.brand_summary = '' THEN
        NEW.brand_summary := CASE
            WHEN NEW.brand_identity IS NOT NULL AND LENGTH(NEW.brand_identity) > 0 THEN
                SUBSTRING(NEW.brand_identity FROM 1 FOR 150) || 
                CASE WHEN LENGTH(NEW.brand_identity) > 150 THEN '...' ELSE '' END
            ELSE
                NEW.name || COALESCE(' - ' || NEW.country, '') || 
                COALESCE(' (' || NEW.language || ')', '')
        END;
    END IF;
    
    RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION "public"."get_brand_urls"("brand_uuid" "uuid") RETURNS "text"[]
    LANGUAGE "sql" STABLE
    AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT jsonb_array_elements_text(website_urls) 
      FROM brands 
      WHERE id = brand_uuid
    ),
    ARRAY[]::text[]
  );
$$;
-- Claim related helper functions

CREATE OR REPLACE FUNCTION "public"."get_claim_countries"("claim_uuid" "uuid") RETURNS "text"[]
    LANGUAGE "sql" STABLE
    AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT country_code 
      FROM claim_countries 
      WHERE claim_id = claim_uuid 
      ORDER BY country_code
    ),
    ARRAY[]::text[]
  );
$$;
CREATE OR REPLACE FUNCTION "public"."get_claim_ingredients"("claim_uuid" "uuid") RETURNS "uuid"[]
    LANGUAGE "sql" STABLE
    AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT ingredient_id 
      FROM claim_ingredients 
      WHERE claim_id = claim_uuid
    ),
    ARRAY[]::uuid[]
  );
$$;
CREATE OR REPLACE FUNCTION "public"."get_claim_products"("claim_uuid" "uuid") RETURNS "uuid"[]
    LANGUAGE "sql" STABLE
    AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT product_id 
      FROM claim_products 
      WHERE claim_id = claim_uuid
    ),
    ARRAY[]::uuid[]
  );
$$;
-- User and permission functions

CREATE OR REPLACE FUNCTION "public"."is_global_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
    SELECT EXISTS (
        SELECT 1 FROM user_system_roles
        WHERE user_id = auth.uid() AND role = 'superadmin'
    );
$$;
CREATE OR REPLACE FUNCTION "public"."is_global_admin"("user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
    SELECT EXISTS (
        SELECT 1 FROM user_system_roles
        WHERE user_system_roles.user_id = $1 AND role = 'superadmin'
    );
$$;
CREATE OR REPLACE FUNCTION "public"."has_brand_permission"("user_id" "uuid", "target_brand_id" "uuid", "allowed_roles" "text"[]) RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
    SELECT EXISTS (
        SELECT 1 FROM user_brand_permissions
        WHERE user_brand_permissions.user_id = $1 
        AND brand_id = $2 
        AND role::text = ANY($3)
    );
$$;
CREATE OR REPLACE FUNCTION "public"."create_profile_for_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url, email, job_title, company)
  VALUES (
    NEW.id, 
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', ''),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'job_title', ''),
    COALESCE(NEW.raw_user_meta_data->>'company', '')
  );
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url, email)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', ''),
    COALESCE(new.raw_user_meta_data->>'avatar_url', ''),
    new.email
  );
  RETURN new;
END;
$$;
-- Workflow and task management functions

CREATE OR REPLACE FUNCTION "public"."handle_new_content_workflow_assignment"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_assignee_id UUID;
BEGIN
    -- Only proceed if the content has a workflow and assigned users
    IF NEW.workflow_id IS NOT NULL AND NEW.assigned_to IS NOT NULL AND array_length(NEW.assigned_to, 1) > 0 THEN
        -- Create a task for each assigned user
        FOREACH v_assignee_id IN ARRAY NEW.assigned_to
        LOOP
            INSERT INTO user_tasks (
                user_id, 
                content_id, 
                workflow_id, 
                workflow_step_id,
                workflow_step_name,
                status,
                due_date
            ) VALUES (
                v_assignee_id,
                NEW.id,
                NEW.workflow_id,
                COALESCE(NEW.current_step, gen_random_uuid()), -- Use current_step or generate a placeholder
                'Initial Review', -- Default step name
                'pending',
                NEW.due_date
            )
            ON CONFLICT (user_id, content_id, workflow_step_id) DO NOTHING;
        END LOOP;
    END IF;
    
    RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION "public"."handle_new_workflow_assignment_task_creation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_content_record RECORD;
    v_step_name TEXT;
BEGIN
    -- Get step name
    SELECT name INTO v_step_name
    FROM workflow_steps
    WHERE id = NEW.step_id;

    -- Find all content items for this workflow that are at this step
    FOR v_content_record IN 
        SELECT id, due_date 
        FROM content 
        WHERE workflow_id = NEW.workflow_id 
        AND current_step = NEW.step_id
    LOOP
        -- Create task for the new assignment
        INSERT INTO user_tasks (
            user_id, 
            content_id, 
            workflow_id, 
            workflow_step_id,
            workflow_step_name,
            status,
            due_date
        ) VALUES (
            NEW.user_id,
            v_content_record.id,
            NEW.workflow_id,
            NEW.step_id,
            v_step_name,
            'pending',
            v_content_record.due_date
        )
        ON CONFLICT (user_id, content_id, workflow_step_id) DO NOTHING;
    END LOOP;
    
    RETURN NEW;
END;
$$;
-- Market claim override validation functions

CREATE OR REPLACE FUNCTION "public"."validate_market_country_code"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Allow the special __ALL_COUNTRIES__ value
    IF NEW.market_country_code = '__ALL_COUNTRIES__' THEN
        RETURN NEW;
    END IF;
    
    -- Otherwise, check if the country code exists in the countries table
    IF NOT EXISTS (
        SELECT 1 FROM countries 
        WHERE code = NEW.market_country_code
    ) THEN
        RAISE EXCEPTION 'Invalid country code: %', NEW.market_country_code;
    END IF;
    
    RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION "public"."validate_market_claim_override_references"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_claim_level claim_level_enum;
    v_claim_product_ids uuid[];
BEGIN
    -- Get the claim level
    SELECT level INTO v_claim_level
    FROM claims
    WHERE id = NEW.master_claim_id;
    
    -- If claim is not at product level, it cannot be overridden
    IF v_claim_level != 'product' THEN
        RAISE EXCEPTION 'Only product-level claims can be overridden';
    END IF;
    
    -- Get all products associated with the claim
    v_claim_product_ids := get_claim_products(NEW.master_claim_id);
    
    -- Check if target product is in the claim's product list
    IF NOT (NEW.target_product_id = ANY(v_claim_product_ids)) THEN
        RAISE EXCEPTION 'Target product % is not associated with claim %', 
            NEW.target_product_id, NEW.master_claim_id;
    END IF;
    
    -- If replacement claim is provided, verify it exists
    IF NEW.replacement_claim_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM claims WHERE id = NEW.replacement_claim_id) THEN
            RAISE EXCEPTION 'Replacement claim % does not exist', NEW.replacement_claim_id;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;
-- Brand management functions

CREATE OR REPLACE FUNCTION "public"."create_brand_and_set_admin"("creator_user_id" "uuid", "brand_name" "text", "brand_website_url" "text" DEFAULT NULL::"text", "brand_country" "text" DEFAULT NULL::"text", "brand_language" "text" DEFAULT NULL::"text", "brand_identity_text" "text" DEFAULT NULL::"text", "brand_tone_of_voice" "text" DEFAULT NULL::"text", "brand_guardrails" "text" DEFAULT NULL::"text", "brand_content_vetting_agencies_input" "text"[] DEFAULT NULL::"text"[], "brand_color_input" "text" DEFAULT NULL::"text", "approved_content_types_input" "jsonb" DEFAULT NULL::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  new_brand_id uuid;
BEGIN
  INSERT INTO public.brands (
    name,
    website_url,
    country,
    language,
    brand_identity,
    tone_of_voice,
    guardrails,
    content_vetting_agencies,
    brand_color,
    approved_content_types
  ) VALUES (
    brand_name,
    brand_website_url,
    brand_country,
    brand_language,
    brand_identity_text,
    brand_tone_of_voice,
    brand_guardrails,
    brand_content_vetting_agencies_input,
    brand_color_input,
    approved_content_types_input
  )
  RETURNING id INTO new_brand_id;

  -- Fixed: Changed 'brand_admin' to 'admin' to match the enum
  INSERT INTO public.user_brand_permissions (user_id, brand_id, role)
  VALUES (creator_user_id, new_brand_id, 'admin'::public.user_brand_role_enum);

  RETURN new_brand_id;
END;
$$;
CREATE OR REPLACE FUNCTION "public"."create_brand_with_permissions"("p_creator_user_id" "uuid", "p_brand_name" "text", "p_website_url" "text" DEFAULT NULL::"text", "p_country" "text" DEFAULT NULL::"text", "p_language" "text" DEFAULT NULL::"text", "p_brand_identity" "text" DEFAULT NULL::"text", "p_tone_of_voice" "text" DEFAULT NULL::"text", "p_guardrails" "text" DEFAULT NULL::"text", "p_brand_color" "text" DEFAULT NULL::"text", "p_logo_url" "text" DEFAULT NULL::"text", "p_approved_content_types" "jsonb" DEFAULT NULL::"jsonb", "p_master_claim_brand_id" "uuid" DEFAULT NULL::"uuid", "p_agency_ids" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS TABLE("brand_id" "uuid", "success" boolean, "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_new_brand_id UUID;
  v_normalized_domain TEXT;
  v_agency_id UUID;
BEGIN
  -- Start transaction block
  BEGIN
    -- Insert the brand
    INSERT INTO brands (
      name,
      website_url,
      country,
      language,
      brand_identity,
      tone_of_voice,
      guardrails,
      brand_color,
      logo_url,
      approved_content_types,
      master_claim_brand_id
    ) VALUES (
      p_brand_name,
      p_website_url,
      p_country,
      p_language,
      p_brand_identity,
      p_tone_of_voice,
      p_guardrails,
      p_brand_color,
      p_logo_url,
      p_approved_content_types,
      p_master_claim_brand_id
    ) RETURNING id INTO v_new_brand_id;

    -- Create admin permission for the creator
    INSERT INTO user_brand_permissions (
      user_id,
      brand_id,
      role
    ) VALUES (
      p_creator_user_id,
      v_new_brand_id,
      'admin'
    );

    -- Update normalized website domain if URL provided
    IF p_website_url IS NOT NULL THEN
      v_normalized_domain := normalize_website_domain(p_website_url);
      IF v_normalized_domain IS NOT NULL THEN
        UPDATE brands 
        SET normalized_website_domain = v_normalized_domain
        WHERE id = v_new_brand_id;
      END IF;
    END IF;

    -- Add agency associations if provided
    IF p_agency_ids IS NOT NULL AND array_length(p_agency_ids, 1) > 0 THEN
      FOREACH v_agency_id IN ARRAY p_agency_ids
      LOOP
        INSERT INTO brand_selected_agencies (brand_id, agency_id)
        VALUES (v_new_brand_id, v_agency_id)
        ON CONFLICT (brand_id, agency_id) DO NOTHING;
      END LOOP;
    END IF;

    -- Return success
    RETURN QUERY SELECT v_new_brand_id, true::boolean, NULL::text;
    
  EXCEPTION
    WHEN OTHERS THEN
      -- Rollback is automatic in PL/pgSQL functions
      RETURN QUERY SELECT NULL::uuid, false::boolean, SQLERRM::text;
  END;
END;
$$;
-- Claims workflow functions

CREATE OR REPLACE FUNCTION "public"."advance_claim_workflow"("p_claim_id" "uuid", "p_action" "text", "p_feedback" "text" DEFAULT ''::"text", "p_reviewer_id" "uuid" DEFAULT NULL::"uuid", "p_comment" "text" DEFAULT NULL::"text", "p_updated_claim_text" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_current_step_id UUID;
  v_workflow_id UUID;
  v_next_step_id UUID;
  v_first_step_id UUID;
  v_step_name TEXT;
  v_result JSONB;
BEGIN
  -- Get current workflow info
  SELECT current_workflow_step, workflow_id
  INTO v_current_step_id, v_workflow_id
  FROM claims
  WHERE id = p_claim_id;

  IF v_current_step_id IS NULL OR v_workflow_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Claim has no active workflow'
    );
  END IF;

  -- Get step name
  SELECT name INTO v_step_name
  FROM claims_workflow_steps
  WHERE id = v_current_step_id;

  -- Record the action in history with new fields
  INSERT INTO claim_workflow_history (
    claim_id,
    workflow_step_id,
    step_name,
    action_status,
    feedback,
    reviewer_id,
    created_at,
    comment,
    updated_claim_text
  ) VALUES (
    p_claim_id,
    v_current_step_id,
    v_step_name,
    CASE
      WHEN p_action = 'approve' THEN 'approved'
      WHEN p_action = 'reject' THEN 'rejected'
      ELSE 'pending_review'
    END,
    p_feedback,
    p_reviewer_id,
    NOW(),
    p_comment,
    p_updated_claim_text
  );

  -- Handle approval
  IF p_action = 'approve' THEN
    -- Add current step to completed steps
    UPDATE claims
    SET completed_workflow_steps = array_append(
      COALESCE(completed_workflow_steps, ARRAY[]::UUID[]),
      v_current_step_id
    )
    WHERE id = p_claim_id;

    -- Get next step
    SELECT id INTO v_next_step_id
    FROM claims_workflow_steps
    WHERE workflow_id = v_workflow_id
      AND step_order > (
        SELECT step_order
        FROM claims_workflow_steps
        WHERE id = v_current_step_id
      )
    ORDER BY step_order
    LIMIT 1;

    IF v_next_step_id IS NOT NULL THEN
      -- Move to next step
      UPDATE claims
      SET
        current_workflow_step = v_next_step_id,
        workflow_status = 'pending_review',
        updated_at = NOW(),
        updated_by = p_reviewer_id
      WHERE id = p_claim_id;
    ELSE
      -- Workflow completed
      UPDATE claims
      SET
        current_workflow_step = NULL,
        workflow_status = 'approved',
        updated_at = NOW(),
        updated_by = p_reviewer_id
      WHERE id = p_claim_id;
    END IF;

  -- Handle rejection
  ELSIF p_action = 'reject' THEN
    -- Get first step of the workflow
    SELECT id INTO v_first_step_id
    FROM claims_workflow_steps
    WHERE workflow_id = v_workflow_id
    ORDER BY step_order
    LIMIT 1;

    -- Reset to first step and clear completed steps
    UPDATE claims
    SET
      current_workflow_step = v_first_step_id,
      completed_workflow_steps = ARRAY[]::UUID[],
      workflow_status = 'pending_review',
      updated_at = NOW(),
      updated_by = p_reviewer_id
    WHERE id = p_claim_id;

  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid action. Must be "approve" or "reject"'
    );
  END IF;

  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'action', p_action,
    'next_step_id', CASE
      WHEN p_action = 'approve' THEN v_next_step_id
      ELSE v_first_step_id
    END
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;
CREATE OR REPLACE FUNCTION "public"."assign_workflow_to_claim"("p_claim_id" "uuid", "p_workflow_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_first_step UUID;
    v_result JSONB;
BEGIN
    -- Get first step of workflow
    SELECT id INTO v_first_step
    FROM public.claims_workflow_steps
    WHERE workflow_id = p_workflow_id
    ORDER BY step_order
    LIMIT 1;

    IF v_first_step IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Workflow has no steps defined'
        );
    END IF;

    -- Update claim with workflow
    UPDATE public.claims
    SET workflow_id = p_workflow_id,
        current_workflow_step = v_first_step,
        workflow_status = 'pending_review',
        updated_at = NOW()
    WHERE id = p_claim_id;

    -- Create initial history entry
    INSERT INTO public.claim_workflow_history (
        claim_id,
        workflow_step_id,
        step_name,
        action_status,
        feedback,
        reviewer_id
    )
    SELECT 
        p_claim_id,
        v_first_step,
        ws.name,
        'pending_review',
        'Workflow assigned to claim',
        NULL
    FROM public.claims_workflow_steps ws
    WHERE ws.id = v_first_step;

    v_result := jsonb_build_object(
        'success', true,
        'message', 'Workflow assigned successfully',
        'workflow_id', p_workflow_id,
        'first_step_id', v_first_step
    );

    RETURN v_result;
END;
$$;
CREATE OR REPLACE FUNCTION "public"."create_claim_with_associations"("p_claim_text" "text", "p_claim_type" "public"."claim_type_enum", "p_level" "public"."claim_level_enum", "p_master_brand_id" "uuid" DEFAULT NULL::"uuid", "p_ingredient_id" "uuid" DEFAULT NULL::"uuid", "p_ingredient_ids" "uuid"[] DEFAULT ARRAY[]::"uuid"[], "p_product_ids" "uuid"[] DEFAULT ARRAY[]::"uuid"[], "p_country_codes" "text"[] DEFAULT ARRAY[]::"text"[], "p_description" "text" DEFAULT NULL::"text", "p_created_by" "uuid" DEFAULT "auth"."uid"(), "p_workflow_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_claim_id UUID;
  v_product_id UUID;
  v_ingredient_id UUID;
  v_country_code TEXT;
BEGIN
  -- Handle backward compatibility - if old parameter is used, convert to array
  IF p_ingredient_id IS NOT NULL AND (p_ingredient_ids IS NULL OR array_length(p_ingredient_ids, 1) = 0) THEN
    p_ingredient_ids := ARRAY[p_ingredient_id];
  END IF;

  -- Validate input based on level
  IF p_level = 'brand' AND p_master_brand_id IS NULL THEN
    RAISE EXCEPTION 'master_brand_id is required for brand-level claims';
  END IF;
  
  IF p_level = 'product' AND (p_product_ids IS NULL OR array_length(p_product_ids, 1) = 0) THEN
    RAISE EXCEPTION 'At least one product_id is required for product-level claims';
  END IF;
  
  IF p_level = 'ingredient' AND (p_ingredient_ids IS NULL OR array_length(p_ingredient_ids, 1) = 0) THEN
    RAISE EXCEPTION 'At least one ingredient_id is required for ingredient-level claims';
  END IF;
  
  IF p_country_codes IS NULL OR array_length(p_country_codes, 1) = 0 THEN
    RAISE EXCEPTION 'At least one country_code is required';
  END IF;

  -- For backward compatibility with the check constraint, we need to set the legacy columns
  -- Use the first ID from arrays for the deprecated single-value columns
  DECLARE
    v_legacy_product_id UUID := NULL;
    v_legacy_ingredient_id UUID := NULL;
    v_legacy_country_code TEXT := NULL;
  BEGIN
    IF p_level = 'product' AND array_length(p_product_ids, 1) > 0 THEN
      v_legacy_product_id := p_product_ids[1];
    END IF;
    
    IF p_level = 'ingredient' AND array_length(p_ingredient_ids, 1) > 0 THEN
      v_legacy_ingredient_id := p_ingredient_ids[1];
    END IF;

    -- Use the first country code for the legacy country_code column
    IF array_length(p_country_codes, 1) > 0 THEN
      v_legacy_country_code := p_country_codes[1];
    END IF;

    -- Insert the claim with legacy columns for backward compatibility
    INSERT INTO claims (
      claim_text,
      claim_type,
      level,
      master_brand_id,
      product_id,  -- Legacy column
      ingredient_id,  -- Legacy column
      country_code,  -- This was missing! Now populated with first country code
      description,
      created_by,
      workflow_id
    ) VALUES (
      p_claim_text,
      p_claim_type,
      p_level,
      CASE WHEN p_level = 'brand' THEN p_master_brand_id ELSE NULL END,
      v_legacy_product_id,  -- Set for backward compatibility
      v_legacy_ingredient_id,  -- Set for backward compatibility
      v_legacy_country_code,  -- Set for backward compatibility
      p_description,
      p_created_by,
      p_workflow_id
    ) RETURNING id INTO v_claim_id;
  END;

  -- Insert product associations
  IF p_level = 'product' AND p_product_ids IS NOT NULL THEN
    FOREACH v_product_id IN ARRAY p_product_ids
    LOOP
      INSERT INTO claim_products (claim_id, product_id)
      VALUES (v_claim_id, v_product_id);
    END LOOP;
  END IF;

  -- Insert ingredient associations
  IF p_level = 'ingredient' AND p_ingredient_ids IS NOT NULL THEN
    FOREACH v_ingredient_id IN ARRAY p_ingredient_ids
    LOOP
      INSERT INTO claim_ingredients (claim_id, ingredient_id)
      VALUES (v_claim_id, v_ingredient_id);
    END LOOP;
  END IF;

  -- Insert country associations
  IF p_country_codes IS NOT NULL THEN
    FOREACH v_country_code IN ARRAY p_country_codes
    LOOP
      INSERT INTO claim_countries (claim_id, country_code)
      VALUES (v_claim_id, v_country_code);
    END LOOP;
  END IF;

  RETURN v_claim_id;
END;
$$;
COMMENT ON FUNCTION "public"."create_claim_with_associations"("p_claim_text" "text", "p_claim_type" "public"."claim_type_enum", "p_level" "public"."claim_level_enum", "p_master_brand_id" "uuid", "p_ingredient_id" "uuid", "p_ingredient_ids" "uuid"[], "p_product_ids" "uuid"[], "p_country_codes" "text"[], "p_description" "text", "p_created_by" "uuid", "p_workflow_id" "uuid") IS 'Creates a claim with proper associations to products, ingredients, and countries using junction tables. Maintains backward compatibility with legacy single-value columns.';
CREATE OR REPLACE FUNCTION "public"."create_claims_batch"("p_claims" "jsonb", "p_workflow_id" "uuid" DEFAULT NULL::"uuid", "p_created_by" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("success" boolean, "error_message" "text", "created_claim_ids" "uuid"[])
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_claim JSONB;
  v_claim_id UUID;
  v_claim_ids UUID[] := '{}';
BEGIN
  BEGIN
    -- Validate input
    IF p_claims IS NULL OR jsonb_array_length(p_claims) = 0 THEN
      RETURN QUERY SELECT false, 'No claims provided'::text, NULL::uuid[];
      RETURN;
    END IF;
    
    -- Process each claim
    FOR v_claim IN SELECT * FROM jsonb_array_elements(p_claims)
    LOOP
      INSERT INTO claims (
        claim_text,
        claim_type,
        level,
        master_brand_id,
        product_id,
        ingredient_id,
        country_code,
        description,
        created_by,
        workflow_id
      ) VALUES (
        v_claim->>'claim_text',
        (v_claim->>'claim_type')::claim_type_enum,
        (v_claim->>'level')::claim_level_enum,
        (v_claim->>'master_brand_id')::uuid,
        (v_claim->>'product_id')::uuid,
        (v_claim->>'ingredient_id')::uuid,
        v_claim->>'country_code',
        v_claim->>'description',
        p_created_by,
        p_workflow_id
      ) RETURNING id INTO v_claim_id;
      
      v_claim_ids := array_append(v_claim_ids, v_claim_id);
      
      -- If workflow provided, initialize workflow status
      IF p_workflow_id IS NOT NULL THEN
        UPDATE claims
        SET 
          workflow_status = 'pending',
          current_workflow_step = 0
        WHERE id = v_claim_id;
      END IF;
    END LOOP;
    
    RETURN QUERY SELECT true, NULL::text, v_claim_ids;
    
  EXCEPTION
    WHEN OTHERS THEN
      RETURN QUERY SELECT false, SQLERRM::text, NULL::uuid[];
  END;
END;
$$;
-- Create workflow management function

CREATE OR REPLACE FUNCTION "public"."create_workflow_and_log_invitations"("p_name" "text", "p_brand_id" "uuid", "p_steps_definition" "jsonb", "p_created_by" "uuid", "p_invitation_items" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  new_workflow_id UUID;
  step_data JSONB;           -- Individual step definition from p_steps_definition
  assignee_data JSONB;       -- Individual assignee object from step_data->'assignees'
  step_assignee_uuids UUID[]; -- Array to hold UUIDs of assignees for the current step
  step_order_counter INTEGER := 0;
  invitation_item JSONB;
  target_step_id_for_invitation UUID;
BEGIN
  -- Insert the new workflow (without the old 'steps' JSON column)
  INSERT INTO workflows (name, brand_id, created_by)
  VALUES (p_name, p_brand_id, p_created_by)
  RETURNING id INTO new_workflow_id;

  -- Iterate through the provided step definitions and insert them into workflow_steps
  IF jsonb_array_length(p_steps_definition) > 0 THEN
    FOR step_data IN SELECT * FROM jsonb_array_elements(p_steps_definition)
    LOOP
      step_order_counter := step_order_counter + 1;
      step_assignee_uuids := ARRAY[]::UUID[]; -- Initialize as empty array for each step

      -- Check if step_data has an 'assignees' array and it's not empty
      IF jsonb_typeof(step_data->'assignees') = 'array' AND jsonb_array_length(step_data->'assignees') > 0 THEN
        FOR assignee_data IN SELECT * FROM jsonb_array_elements(step_data->'assignees')
        LOOP
          -- Only add if the assignee object has an 'id' (UUID)
          IF assignee_data->>'id' IS NOT NULL THEN
            step_assignee_uuids := array_append(step_assignee_uuids, (assignee_data->>'id')::UUID);
          END IF;
        END LOOP;
      END IF;

      INSERT INTO workflow_steps (
        workflow_id,
        name,
        description,
        role,
        step_order,
        approval_required,
        assigned_user_ids -- New column
      )
      VALUES (
        new_workflow_id,
        step_data->>'name',
        step_data->>'description',
        (step_data->>'role')::user_role,
        step_order_counter,
        COALESCE((step_data->>'approvalRequired')::BOOLEAN, FALSE),
        step_assignee_uuids -- Store the collected UUIDs
      );
    END LOOP;
  END IF;

  -- Insert invitation items if any are provided
  IF jsonb_array_length(p_invitation_items) > 0 THEN
    FOR invitation_item IN SELECT * FROM jsonb_array_elements(p_invitation_items)
    LOOP
      SELECT id INTO target_step_id_for_invitation
      FROM workflow_steps ws
      WHERE ws.workflow_id = new_workflow_id AND ws.step_order = (invitation_item->>'step_order')::INTEGER;

      IF target_step_id_for_invitation IS NOT NULL THEN
        INSERT INTO workflow_invitations (
          workflow_id,
          step_id,
          email,
          role,
          invite_token,
          expires_at,
          status
        ) VALUES (
          new_workflow_id,
          target_step_id_for_invitation,
          invitation_item->>'email',
          (invitation_item->>'role')::user_role,
          invitation_item->>'invite_token',
          (invitation_item->>'expires_at')::TIMESTAMPTZ,
          'pending'
        );
      ELSE
        RAISE WARNING 'No matching step found for step_order % in workflow % for invitation to %',
          (invitation_item->>'step_order'), new_workflow_id, invitation_item->>'email';
      END IF;
    END LOOP;
  END IF;

  RETURN new_workflow_id;
END;
$$;
-- Delete and cleanup functions

CREATE OR REPLACE FUNCTION "public"."delete_brand_and_dependents"("brand_id_to_delete" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Delete associated user_brand_permissions
  DELETE FROM public.user_brand_permissions WHERE brand_id = brand_id_to_delete;

  -- Delete associated workflows (this will set content.workflow_id to NULL due to ON DELETE SET NULL)
  -- It will also cascade to workflow_invitations if that table has ON DELETE CASCADE for workflow_id.
  DELETE FROM public.workflows WHERE brand_id = brand_id_to_delete;
  
  -- Delete the brand itself (this will cascade to content.brand_id due to ON DELETE CASCADE)
  DELETE FROM public.brands WHERE id = brand_id_to_delete;

  -- Check if the brand was actually deleted. If not, it means it wasn't found or some RLS prevented it.
  IF NOT FOUND THEN
    RAISE WARNING 'Brand with ID % not found or not deleted during delete_brand_and_dependents.', brand_id_to_delete;
    -- You might want to raise an exception here if not finding the brand is a critical error for the function's contract
    -- RAISE EXCEPTION 'Brand not found: %', brand_id_to_delete;
  END IF;

EXCEPTION
  WHEN OTHERS THEN
    -- Log the error (optional, requires appropriate logging setup in Postgres)
    RAISE WARNING 'Error in delete_brand_and_dependents for brand %: % - % ', brand_id_to_delete, SQLSTATE, SQLERRM;
    -- Re-raise the exception to ensure transaction rollback and alert the caller
    RAISE;
END;
$$;
COMMENT ON FUNCTION "public"."delete_brand_and_dependents"("brand_id_to_delete" "uuid") IS 'Atomically deletes a brand and its direct dependents like user_brand_permissions and workflows. Content linked to the brand is cascade deleted. Content linked to workflows of the brand has its workflow_id set to NULL.';
CREATE OR REPLACE FUNCTION "public"."delete_brand_cascade"("p_brand_id" "uuid", "p_deleting_user_id" "uuid") RETURNS TABLE("success" boolean, "error_message" "text", "deleted_content_count" integer, "deleted_workflow_count" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_content_count INTEGER;
  v_workflow_count INTEGER;
BEGIN
  BEGIN
    -- Count items to be deleted for reporting
    SELECT COUNT(*) INTO v_content_count FROM content WHERE brand_id = p_brand_id;
    SELECT COUNT(*) INTO v_workflow_count FROM workflows WHERE brand_id = p_brand_id;

    -- Delete in correct order to respect foreign key constraints
    
    -- 1. Delete content versions (references content)
    DELETE FROM content_versions 
    WHERE content_id IN (SELECT id FROM content WHERE brand_id = p_brand_id);
    
    -- 2. Delete content
    DELETE FROM content WHERE brand_id = p_brand_id;
    
    -- 3. Delete workflow steps and related data
    DELETE FROM workflow_user_assignments 
    WHERE workflow_id IN (SELECT id FROM workflows WHERE brand_id = p_brand_id);
    
    DELETE FROM workflow_steps 
    WHERE workflow_id IN (SELECT id FROM workflows WHERE brand_id = p_brand_id);
    
    -- 4. Delete workflows
    DELETE FROM workflows WHERE brand_id = p_brand_id;
    
    -- 5. Delete brand permissions
    DELETE FROM user_brand_permissions WHERE brand_id = p_brand_id;
    
    -- 6. Delete agency associations
    DELETE FROM brand_selected_agencies WHERE brand_id = p_brand_id;
    
    -- 7. Finally delete the brand
    DELETE FROM brands WHERE id = p_brand_id;
    
    RETURN QUERY SELECT true, NULL::text, v_content_count, v_workflow_count;
    
  EXCEPTION
    WHEN foreign_key_violation THEN
      RETURN QUERY SELECT false, 
        'Cannot delete brand due to existing dependencies: ' || SQLERRM::text, 
        0, 0;
    WHEN OTHERS THEN
      RETURN QUERY SELECT false, SQLERRM::text, 0, 0;
  END;
END;
$$;
-- Security and logging functions

CREATE OR REPLACE FUNCTION "public"."log_security_event"("p_event_type" "text", "p_details" "jsonb" DEFAULT '{}'::"jsonb", "p_user_id" "uuid" DEFAULT NULL::"uuid", "p_ip_address" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_event_id UUID;
BEGIN
    INSERT INTO security_logs (event_type, user_id, ip_address, details)
    VALUES (p_event_type, COALESCE(p_user_id, auth.uid()), p_ip_address, p_details)
    RETURNING id INTO v_event_id;
    
    RETURN v_event_id;
END;
$$;
-- Create views

CREATE OR REPLACE VIEW "public"."claims_pending_approval" AS
 SELECT "c"."id",
    "c"."claim_text",
    "c"."claim_type",
    "c"."level",
    "c"."description",
    "c"."workflow_id",
    "c"."current_workflow_step",
    "c"."workflow_status",
    "c"."created_at",
    "c"."created_by",
    "cw"."name" AS "workflow_name",
    "ws"."name" AS "current_step_name",
    "ws"."role" AS "current_step_role",
    "ws"."assigned_user_ids" AS "current_step_assignees",
    "p"."full_name" AS "creator_name",
        CASE
            WHEN ("c"."level" = 'brand'::"public"."claim_level_enum") THEN "mcb"."name"
            WHEN ("c"."level" = 'product'::"public"."claim_level_enum") THEN "prod"."name"
            WHEN ("c"."level" = 'ingredient'::"public"."claim_level_enum") THEN "ing"."name"
            ELSE NULL::"text"
        END AS "entity_name",
    COALESCE("cw"."brand_id", "b"."id", "mcb_brand"."id") AS "brand_id",
    COALESCE("b"."name", "mcb_brand"."name") AS "brand_name",
    COALESCE("b"."logo_url", "mcb_brand"."logo_url") AS "brand_logo_url",
    COALESCE("b"."brand_color", "mcb_brand"."brand_color") AS "brand_primary_color"
   FROM (((((((("public"."claims" "c"
     LEFT JOIN "public"."claims_workflows" "cw" ON (("c"."workflow_id" = "cw"."id")))
     LEFT JOIN "public"."claims_workflow_steps" "ws" ON (("c"."current_workflow_step" = "ws"."id")))
     LEFT JOIN "public"."profiles" "p" ON (("c"."created_by" = "p"."id")))
     LEFT JOIN "public"."master_claim_brands" "mcb" ON (("c"."master_brand_id" = "mcb"."id")))
     LEFT JOIN "public"."products" "prod" ON (("c"."product_id" = "prod"."id")))
     LEFT JOIN "public"."ingredients" "ing" ON (("c"."ingredient_id" = "ing"."id")))
     LEFT JOIN "public"."brands" "b" ON (("cw"."brand_id" = "b"."id")))
     LEFT JOIN "public"."brands" "mcb_brand" ON (("mcb"."mixerai_brand_id" = "mcb_brand"."id")))
  WHERE (("c"."workflow_status" = 'pending_review'::"public"."content_status") AND ("c"."workflow_id" IS NOT NULL));
CREATE OR REPLACE VIEW "public"."claims_with_arrays" AS
 SELECT "c"."id",
    "c"."claim_text",
    "c"."claim_type",
    "c"."level",
    "c"."master_brand_id",
    "c"."ingredient_id",
    "c"."description",
    "c"."created_at",
    "c"."updated_at",
    "c"."created_by",
    "c"."workflow_id",
    "c"."current_workflow_step",
    "c"."workflow_status",
    "c"."completed_workflow_steps",
    "c"."updated_by",
    "public"."get_claim_products"("c"."id") AS "product_ids",
    "public"."get_claim_countries"("c"."id") AS "country_codes",
    "public"."get_claim_ingredients"("c"."id") AS "ingredient_ids",
        CASE
            WHEN ("c"."level" = 'brand'::"public"."claim_level_enum") THEN "mcb"."name"
            WHEN ("c"."level" = 'ingredient'::"public"."claim_level_enum") THEN ( SELECT "string_agg"("i"."name", ', '::"text" ORDER BY "i"."name") AS "string_agg"
               FROM ("public"."claim_ingredients" "ci"
                 JOIN "public"."ingredients" "i" ON (("ci"."ingredient_id" = "i"."id")))
              WHERE ("ci"."claim_id" = "c"."id"))
            ELSE NULL::"text"
        END AS "entity_name",
        CASE
            WHEN ("c"."level" = 'product'::"public"."claim_level_enum") THEN ( SELECT "string_agg"("p"."name", ', '::"text" ORDER BY "p"."name") AS "string_agg"
               FROM ("public"."claim_products" "cp"
                 JOIN "public"."products" "p" ON (("cp"."product_id" = "p"."id")))
              WHERE ("cp"."claim_id" = "c"."id"))
            ELSE NULL::"text"
        END AS "product_names",
        CASE
            WHEN ("c"."level" = 'ingredient'::"public"."claim_level_enum") THEN ( SELECT "string_agg"("i"."name", ', '::"text" ORDER BY "i"."name") AS "string_agg"
               FROM ("public"."claim_ingredients" "ci"
                 JOIN "public"."ingredients" "i" ON (("ci"."ingredient_id" = "i"."id")))
              WHERE ("ci"."claim_id" = "c"."id"))
            ELSE NULL::"text"
        END AS "ingredient_names"
   FROM ("public"."claims" "c"
     LEFT JOIN "public"."master_claim_brands" "mcb" ON (("c"."master_brand_id" = "mcb"."id")));
CREATE OR REPLACE VIEW "public"."profiles_view" AS
 SELECT "p"."id",
    "p"."full_name",
    "p"."avatar_url",
    "u"."email",
    "p"."created_at",
    "p"."updated_at"
   FROM ("public"."profiles" "p"
     JOIN "auth"."users" "u" ON (("p"."id" = "u"."id")));
COMMENT ON VIEW "public"."profiles_view" IS 'View that joins profiles with auth.users to provide access to email addresses';
CREATE OR REPLACE VIEW "public"."user_invitation_status" AS
 SELECT DISTINCT ON ("p"."id") "p"."id",
    "p"."email",
    "p"."full_name",
    "au"."last_sign_in_at",
    "wi"."expires_at",
    "wi"."status" AS "invitation_status",
        CASE
            WHEN ("au"."last_sign_in_at" IS NOT NULL) THEN 'active'::"text"
            WHEN ("wi"."expires_at" < "now"()) THEN 'expired'::"text"
            WHEN ("wi"."status" = 'pending'::"text") THEN 'pending'::"text"
            ELSE 'no_invitation'::"text"
        END AS "user_status"
   FROM (("public"."profiles" "p"
     LEFT JOIN "auth"."users" "au" ON (("p"."id" = "au"."id")))
     LEFT JOIN "public"."workflow_invitations" "wi" ON (("p"."email" = "wi"."email")))
  ORDER BY "p"."id", COALESCE("wi"."created_at", "au"."created_at") DESC;
-- Create triggers

-- Ensure trigger exists with correct definition
DROP TRIGGER IF EXISTS "handle_updated_at_global_claim_brands" ON "public"."master_claim_brands";
CREATE TRIGGER "handle_updated_at_global_claim_brands" BEFORE UPDATE ON "public"."master_claim_brands" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');
DROP TRIGGER IF EXISTS "set_claims_updated_at" ON "public"."claims";
CREATE TRIGGER "set_claims_updated_at" BEFORE UPDATE ON "public"."claims" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_set_timestamp"();
DROP TRIGGER IF EXISTS "set_ingredients_updated_at" ON "public"."ingredients";
CREATE TRIGGER "set_ingredients_updated_at" BEFORE UPDATE ON "public"."ingredients" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_set_timestamp"();
DROP TRIGGER IF EXISTS "set_products_updated_at" ON "public"."products";
CREATE TRIGGER "set_products_updated_at" BEFORE UPDATE ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_set_timestamp"();
DROP TRIGGER IF EXISTS "trg_validate_market_claim_override_references" ON "public"."market_claim_overrides";
CREATE TRIGGER "trg_validate_market_claim_override_references" BEFORE INSERT OR UPDATE ON "public"."market_claim_overrides" FOR EACH ROW EXECUTE FUNCTION "public"."validate_market_claim_override_references"();
DROP TRIGGER IF EXISTS "trigger_create_tasks_on_new_content" ON "public"."content";
CREATE TRIGGER "trigger_create_tasks_on_new_content" AFTER INSERT ON "public"."content" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_content_workflow_assignment"();
DROP TRIGGER IF EXISTS "trigger_feedback_item_updated_at" ON "public"."feedback_items";
CREATE TRIGGER "trigger_feedback_item_updated_at" BEFORE UPDATE ON "public"."feedback_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_feedback_item_updated_at"();
DROP TRIGGER IF EXISTS "trigger_handle_new_assignment_task" ON "public"."workflow_user_assignments";
CREATE TRIGGER "trigger_handle_new_assignment_task" AFTER INSERT ON "public"."workflow_user_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_workflow_assignment_task_creation"();
COMMENT ON TRIGGER "trigger_handle_new_assignment_task" ON "public"."workflow_user_assignments" IS 'After a user is assigned to a workflow step, creates relevant pending tasks.';
DROP TRIGGER IF EXISTS "trigger_set_workflow_steps_updated_at" ON "public"."workflow_steps";
CREATE TRIGGER "trigger_set_workflow_steps_updated_at" BEFORE UPDATE ON "public"."workflow_steps" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at_timestamp"();
DROP TRIGGER IF EXISTS "trigger_update_user_tasks_modtime" ON "public"."user_tasks";
CREATE TRIGGER "trigger_update_user_tasks_modtime" BEFORE UPDATE ON "public"."user_tasks" FOR EACH ROW EXECUTE FUNCTION "public"."update_user_tasks_modtime"();
DROP TRIGGER IF EXISTS "update_brand_summary_trigger" ON "public"."brands";
CREATE TRIGGER "update_brand_summary_trigger" BEFORE INSERT OR UPDATE ON "public"."brands" FOR EACH ROW EXECUTE FUNCTION "public"."update_brand_summary"();
DROP TRIGGER IF EXISTS "update_notifications_updated_at" ON "public"."notifications";
CREATE TRIGGER "update_notifications_updated_at" BEFORE UPDATE ON "public"."notifications" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
DROP TRIGGER IF EXISTS "update_user_invitations_modtime" ON "public"."user_invitations";
CREATE TRIGGER "update_user_invitations_modtime" BEFORE UPDATE ON "public"."user_invitations" FOR EACH ROW EXECUTE FUNCTION "public"."update_modified_column"();
DROP TRIGGER IF EXISTS "update_user_system_roles_modtime" ON "public"."user_system_roles";
CREATE TRIGGER "update_user_system_roles_modtime" BEFORE UPDATE ON "public"."user_system_roles" FOR EACH ROW EXECUTE FUNCTION "public"."update_modified_column"();
DROP TRIGGER IF EXISTS "validate_market_country_code_trigger" ON "public"."market_claim_overrides";
CREATE TRIGGER "validate_market_country_code_trigger" BEFORE INSERT OR UPDATE ON "public"."market_claim_overrides" FOR EACH ROW EXECUTE FUNCTION "public"."validate_market_country_code"();
-- Create auth trigger for new users
DROP TRIGGER IF EXISTS "on_auth_user_created" ON "auth"."users";
CREATE TRIGGER "on_auth_user_created" AFTER INSERT ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user"();
-- Enable RLS on tables
ALTER TABLE "public"."brands" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."content" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."content_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."workflows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."user_invitations" ENABLE ROW LEVEL SECURITY;
-- Create RLS policies

-- Brands policies
CREATE POLICY "Everyone can view brands" ON "public"."brands" FOR SELECT USING (true);
CREATE POLICY "Admins can insert brands" ON "public"."brands" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE ("p"."id" = "auth"."uid"()))));
CREATE POLICY "Admins can update their brands" ON "public"."brands" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_brand_permissions"
  WHERE (("user_brand_permissions"."user_id" = "auth"."uid"()) AND ("user_brand_permissions"."brand_id" = "brands"."id") AND ("user_brand_permissions"."role" = 'admin'))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_brand_permissions"
  WHERE (("user_brand_permissions"."user_id" = "auth"."uid"()) AND ("user_brand_permissions"."brand_id" = "brands"."id") AND ("user_brand_permissions"."role" = 'admin')))));
CREATE POLICY "Admins can delete their brands" ON "public"."brands" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_brand_permissions"
  WHERE (("user_brand_permissions"."user_id" = "auth"."uid"()) AND ("user_brand_permissions"."brand_id" = "brands"."id") AND ("user_brand_permissions"."role" = 'admin'::"public"."user_brand_role_enum")))));
COMMENT ON POLICY "Admins can delete their brands" ON "public"."brands" IS 'Users with admin role for a specific brand in user_brand_permissions can delete that brand. Note: "admin" in user_brand_permissions means brand admin, not global admin.';
-- Content policies
CREATE POLICY "Users can view content from their brands" ON "public"."content" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_brand_permissions"
  WHERE (("user_brand_permissions"."user_id" = "auth"."uid"()) AND ("user_brand_permissions"."brand_id" = "content"."brand_id")))));
CREATE POLICY "Editors and Admins can insert content" ON "public"."content" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_brand_permissions"
  WHERE (("user_brand_permissions"."user_id" = "auth"."uid"()) AND ("user_brand_permissions"."brand_id" = "content"."brand_id") AND ("user_brand_permissions"."role" = ANY (ARRAY['admin'::"public"."user_brand_role_enum", 'editor'::"public"."user_brand_role_enum"]))))));
CREATE POLICY "Editors and Admins can update content" ON "public"."content" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_brand_permissions"
  WHERE (("user_brand_permissions"."user_id" = "auth"."uid"()) AND ("user_brand_permissions"."brand_id" = "content"."brand_id") AND ("user_brand_permissions"."role" = ANY (ARRAY['admin'::"public"."user_brand_role_enum", 'editor'::"public"."user_brand_role_enum"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_brand_permissions"
  WHERE (("user_brand_permissions"."user_id" = "auth"."uid"()) AND ("user_brand_permissions"."brand_id" = "content"."brand_id") AND ("user_brand_permissions"."role" = ANY (ARRAY['admin'::"public"."user_brand_role_enum", 'editor'::"public"."user_brand_role_enum"]))))));
CREATE POLICY "Admins can delete content" ON "public"."content" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_brand_permissions"
  WHERE (("user_brand_permissions"."user_id" = "auth"."uid"()) AND ("user_brand_permissions"."brand_id" = "content"."brand_id") AND ("user_brand_permissions"."role" = 'admin'::"public"."user_brand_role_enum")))));
-- Workflow policies
CREATE POLICY "Admins can manage workflows" ON "public"."workflows" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_brand_permissions"
  WHERE (("user_brand_permissions"."user_id" = "auth"."uid"()) AND ("user_brand_permissions"."brand_id" = "workflows"."brand_id") AND ("user_brand_permissions"."role" = 'admin'::"public"."user_brand_role_enum"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_brand_permissions"
  WHERE (("user_brand_permissions"."user_id" = "auth"."uid"()) AND ("user_brand_permissions"."brand_id" = "workflows"."brand_id") AND ("user_brand_permissions"."role" = 'admin'::"public"."user_brand_role_enum")))));
CREATE POLICY "Users can view workflows from their brands" ON "public"."workflows" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_brand_permissions"
  WHERE (("user_brand_permissions"."user_id" = "auth"."uid"()) AND ("user_brand_permissions"."brand_id" = "workflows"."brand_id")))));
-- Content template policies
CREATE POLICY "Content templates - Allow all authenticated to read" ON "public"."content_templates" FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "Content templates - Brand admins can manage" ON "public"."content_templates" FOR ALL TO "authenticated" USING (((("brand_id" IS NULL) AND ("auth"."uid"() = "created_by")) OR (("brand_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."user_brand_permissions"
  WHERE (("user_brand_permissions"."user_id" = "auth"."uid"()) AND ("user_brand_permissions"."brand_id" = "content_templates"."brand_id") AND ("user_brand_permissions"."role" = 'admin'::"public"."user_brand_role_enum"))))))) WITH CHECK (((("brand_id" IS NULL) AND ("auth"."uid"() = "created_by")) OR (("brand_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."user_brand_permissions"
  WHERE (("user_brand_permissions"."user_id" = "auth"."uid"()) AND ("user_brand_permissions"."brand_id" = "content_templates"."brand_id") AND ("user_brand_permissions"."role" = 'admin'::"public"."user_brand_role_enum")))))));
-- Analytics policies
CREATE POLICY "Everyone can view analytics" ON "public"."analytics" FOR SELECT USING (true);
-- User invitation policies
CREATE POLICY "Brand admins can manage brand invitations" ON "public"."user_invitations" TO "authenticated" USING ((("invitation_source" = 'brand'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."user_brand_permissions"
  WHERE (("user_brand_permissions"."user_id" = "auth"."uid"()) AND ("user_brand_permissions"."brand_id" = "user_invitations"."source_id") AND ("user_brand_permissions"."role" = 'admin'::"public"."user_brand_role_enum")))))) WITH CHECK ((("invitation_source" = 'brand'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."user_brand_permissions"
  WHERE (("user_brand_permissions"."user_id" = "auth"."uid"()) AND ("user_brand_permissions"."brand_id" = "user_invitations"."source_id") AND ("user_brand_permissions"."role" = 'admin'::"public"."user_brand_role_enum"))))));
CREATE POLICY "Users can view their own invitations" ON "public"."user_invitations" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."email" = "user_invitations"."email")))));
-- Feedback policies
CREATE POLICY "Allow authenticated users to read all feedback" ON "public"."feedback_items" FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "Allow authenticated users to insert feedback" ON "public"."feedback_items" FOR INSERT TO "authenticated" WITH CHECK (true);
CREATE POLICY "Allow any authenticated user to update feedback items" ON "public"."feedback_items" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);
CREATE POLICY "Allow admins to delete feedback" ON "public"."feedback_items" FOR DELETE TO "authenticated" USING (((( SELECT ("auth"."jwt"() ->> 'role'::"text")) = 'admin'::"text") OR (((("auth"."jwt"() ->> 'app_metadata'::"text"))::"jsonb" ->> 'role'::"text") = 'admin'::"text")));
CREATE POLICY "Allow admins to update feedback" ON "public"."feedback_items" FOR UPDATE TO "authenticated" USING (((( SELECT ("auth"."jwt"() ->> 'role'::"text")) = 'admin'::"text") OR (((("auth"."jwt"() ->> 'app_metadata'::"text"))::"jsonb" ->> 'role'::"text") = 'admin'::"text"))) WITH CHECK (((( SELECT ("auth"."jwt"() ->> 'role'::"text")) = 'admin'::"text") OR (((("auth"."jwt"() ->> 'app_metadata'::"text"))::"jsonb" ->> 'role'::"text") = 'admin'::"text")));
-- Master claim brands policies
CREATE POLICY "Allow authenticated users to read global_claim_brands" ON "public"."master_claim_brands" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));
CREATE POLICY "Allow global admins full access on global_claim_brands" ON "public"."master_claim_brands" USING ("public"."is_global_admin"()) WITH CHECK ("public"."is_global_admin"());
CREATE POLICY "Brand admins can manage brand master claim brand links" ON "public"."brand_master_claim_brands" USING ((("auth"."uid"() IN ( SELECT "user_brand_permissions"."user_id"
   FROM "public"."user_brand_permissions"
  WHERE (("user_brand_permissions"."brand_id" = "brand_master_claim_brands"."brand_id") AND ("user_brand_permissions"."role" = 'admin'::"public"."user_brand_role_enum")))) OR "public"."is_global_admin"())) WITH CHECK ((("auth"."uid"() IN ( SELECT "user_brand_permissions"."user_id"
   FROM "public"."user_brand_permissions"
  WHERE (("user_brand_permissions"."brand_id" = "brand_master_claim_brands"."brand_id") AND ("user_brand_permissions"."role" = 'admin'::"public"."user_brand_role_enum")))) OR "public"."is_global_admin"()));
-- Claims policies
CREATE POLICY "Claims - Global Admins - Full Access" ON "public"."claims" USING ("public"."is_global_admin"("auth"."uid"())) WITH CHECK ("public"."is_global_admin"("auth"."uid"()));
CREATE POLICY "Claims - Users can view based on master brand permissions" ON "public"."claims" FOR SELECT USING ((("level" = 'brand'::"public"."claim_level_enum") AND ("master_brand_id" IN ( SELECT "mcb"."id"
   FROM ("public"."master_claim_brands" "mcb"
     JOIN "public"."user_brand_permissions" "ubp" ON (("ubp"."brand_id" = "mcb"."mixerai_brand_id")))
  WHERE ("ubp"."user_id" = "auth"."uid"())))));
-- Claim reviews policies
CREATE POLICY "Editors and admins can create claim reviews" ON "public"."claim_reviews" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."master_claim_brands" "mcb"
     JOIN "public"."user_brand_permissions" "ubp" ON (("ubp"."brand_id" = "mcb"."mixerai_brand_id")))
  WHERE (("mcb"."id" = "claim_reviews"."master_claim_brand_id") AND ("ubp"."user_id" = "auth"."uid"()) AND ("ubp"."role" = ANY (ARRAY['admin'::"public"."user_brand_role_enum", 'editor'::"public"."user_brand_role_enum"]))))));
CREATE POLICY "Users can view claim reviews for their brands" ON "public"."claim_reviews" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."master_claim_brands" "mcb"
     JOIN "public"."user_brand_permissions" "ubp" ON (("ubp"."brand_id" = "mcb"."mixerai_brand_id")))
  WHERE (("mcb"."id" = "claim_reviews"."master_claim_brand_id") AND ("ubp"."user_id" = "auth"."uid"())))));
-- User brand permissions policies
CREATE POLICY "Users can view their own permissions" ON "public"."user_brand_permissions" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));
CREATE POLICY "Global admins can view all permissions" ON "public"."user_brand_permissions" FOR SELECT TO "authenticated" USING ("public"."is_global_admin"());
CREATE POLICY "Only brand admins can modify permissions" ON "public"."user_brand_permissions" FOR ALL TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_brand_permissions" "ubp"
  WHERE (("ubp"."user_id" = "auth"."uid"()) AND ("ubp"."brand_id" = "user_brand_permissions"."brand_id") AND ("ubp"."role" = 'admin'::"public"."user_brand_role_enum"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_brand_permissions" "ubp"
  WHERE (("ubp"."user_id" = "auth"."uid"()) AND ("ubp"."brand_id" = "user_brand_permissions"."brand_id") AND ("ubp"."role" = 'admin'::"public"."user_brand_role_enum")))));
-- Profiles policies
CREATE POLICY "Profiles - Users can read all profiles" ON "public"."profiles" FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "Profiles - Users can update own profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));
-- Notifications policies
CREATE POLICY "Users can view their own notifications" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));
CREATE POLICY "Users can update their own notifications" ON "public"."notifications" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));
-- User tasks policies
CREATE POLICY "Users can create tasks" ON "public"."user_tasks" FOR INSERT TO "authenticated" WITH CHECK (true);
CREATE POLICY "Users can update their own tasks" ON "public"."user_tasks" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));
CREATE POLICY "Users can view their own tasks" ON "public"."user_tasks" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));
-- Workflow invitations policies
CREATE POLICY "Workflow creators can manage invitations" ON "public"."workflow_invitations" FOR ALL TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."workflows"
  WHERE (("workflows"."id" = "workflow_invitations"."workflow_id") AND ("workflows"."created_by" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."workflows"
  WHERE (("workflows"."id" = "workflow_invitations"."workflow_id") AND ("workflows"."created_by" = "auth"."uid"())))));
CREATE POLICY "Users can view invitations sent to their email" ON "public"."workflow_invitations" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."email" = "workflow_invitations"."email")))));
-- Workflow steps policies
CREATE POLICY "Brand users can view workflow steps" ON "public"."workflow_steps" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."workflows" "w"
     JOIN "public"."user_brand_permissions" "ubp" ON (("ubp"."brand_id" = "w"."brand_id")))
  WHERE (("w"."id" = "workflow_steps"."workflow_id") AND ("ubp"."user_id" = "auth"."uid"())))));
CREATE POLICY "Brand admins can manage workflow steps" ON "public"."workflow_steps" FOR ALL TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."workflows" "w"
     JOIN "public"."user_brand_permissions" "ubp" ON (("ubp"."brand_id" = "w"."brand_id")))
  WHERE (("w"."id" = "workflow_steps"."workflow_id") AND ("ubp"."user_id" = "auth"."uid"()) AND ("ubp"."role" = 'admin'::"public"."user_brand_role_enum"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."workflows" "w"
     JOIN "public"."user_brand_permissions" "ubp" ON (("ubp"."brand_id" = "w"."brand_id")))
  WHERE (("w"."id" = "workflow_steps"."workflow_id") AND ("ubp"."user_id" = "auth"."uid"()) AND ("ubp"."role" = 'admin'::"public"."user_brand_role_enum")))));
-- Workflow user assignments policies
CREATE POLICY "Brand admins can manage workflow assignments" ON "public"."workflow_user_assignments" FOR ALL TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."workflows" "w"
     JOIN "public"."user_brand_permissions" "ubp" ON (("ubp"."brand_id" = "w"."brand_id")))
  WHERE (("w"."id" = "workflow_user_assignments"."workflow_id") AND ("ubp"."user_id" = "auth"."uid"()) AND ("ubp"."role" = 'admin'::"public"."user_brand_role_enum"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."workflows" "w"
     JOIN "public"."user_brand_permissions" "ubp" ON (("ubp"."brand_id" = "w"."brand_id")))
  WHERE (("w"."id" = "workflow_user_assignments"."workflow_id") AND ("ubp"."user_id" = "auth"."uid"()) AND ("ubp"."role" = 'admin'::"public"."user_brand_role_enum")))));
CREATE POLICY "Assigned users can view their assignments" ON "public"."workflow_user_assignments" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));
-- Content versions policies
CREATE POLICY "Content Versions - Brand users can view" ON "public"."content_versions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."content" "c"
     JOIN "public"."user_brand_permissions" "ubp" ON (("ubp"."brand_id" = "c"."brand_id")))
  WHERE (("c"."id" = "content_versions"."content_id") AND ("ubp"."user_id" = "auth"."uid"())))));
CREATE POLICY "Content Versions - Editors can create" ON "public"."content_versions" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."content" "c"
     JOIN "public"."user_brand_permissions" "ubp" ON (("ubp"."brand_id" = "c"."brand_id")))
  WHERE (("c"."id" = "content_versions"."content_id") AND ("ubp"."user_id" = "auth"."uid"()) AND ("ubp"."role" = ANY (ARRAY['admin'::"public"."user_brand_role_enum", 'editor'::"public"."user_brand_role_enum"]))))));
-- Content ownership history policies
CREATE POLICY "Content ownership - Brand users can view" ON "public"."content_ownership_history" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."content" "c"
     JOIN "public"."user_brand_permissions" "ubp" ON (("ubp"."brand_id" = "c"."brand_id")))
  WHERE (("c"."id" = "content_ownership_history"."content_id") AND ("ubp"."user_id" = "auth"."uid"())))));
CREATE POLICY "Content ownership - Admins can create" ON "public"."content_ownership_history" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."content" "c"
     JOIN "public"."user_brand_permissions" "ubp" ON (("ubp"."brand_id" = "c"."brand_id")))
  WHERE (("c"."id" = "content_ownership_history"."content_id") AND ("ubp"."user_id" = "auth"."uid"()) AND ("ubp"."role" = 'admin'::"public"."user_brand_role_enum")))));
-- Tool run history policies
CREATE POLICY "Tool runs - Users can view own runs" ON "public"."tool_run_history" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));
CREATE POLICY "Tool runs - Users can create runs" ON "public"."tool_run_history" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));
-- Security logs policies
CREATE POLICY "Security logs - Global admins can view all" ON "public"."security_logs" FOR SELECT TO "authenticated" USING ("public"."is_global_admin"());
CREATE POLICY "Security logs - Users can view own events" ON "public"."security_logs" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));
-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
-- Grant specific permissions for auth schema objects needed by functions
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON auth.users TO authenticated;
COMMIT;
