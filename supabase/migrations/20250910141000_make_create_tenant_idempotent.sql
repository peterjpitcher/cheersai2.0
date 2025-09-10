-- Make tenant creation RPC idempotent: return existing tenant instead of raising

CREATE OR REPLACE FUNCTION public.create_tenant_and_assign(
    p_name text,
    p_business_type text DEFAULT NULL,
    p_brand_voice text DEFAULT NULL,
    p_target_audience text DEFAULT NULL,
    p_brand_identity text DEFAULT NULL,
    p_brand_color text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id uuid;
    v_slug text;
    v_user_id uuid;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- If user already has a tenant, return it (idempotent behaviour)
    SELECT tenant_id INTO v_tenant_id FROM public.users WHERE id = v_user_id;
    IF v_tenant_id IS NOT NULL THEN
        RETURN json_build_object(
            'success', true,
            'tenant_id', v_tenant_id,
            'slug', (SELECT slug FROM public.tenants WHERE id = v_tenant_id),
            'message', 'User already had a tenant; reused'
        );
    END IF;

    -- Generate unique slug
    v_slug := lower(regexp_replace(p_name, '[^a-z0-9]+', '-', 'g'));
    v_slug := v_slug || '-' || extract(epoch from now())::bigint;

    -- Create tenant
    INSERT INTO public.tenants (name, slug, owner_id)
    VALUES (p_name, v_slug, v_user_id)
    RETURNING id INTO v_tenant_id;

    -- Assign tenant to user
    UPDATE public.users
    SET tenant_id = v_tenant_id,
        role = COALESCE(role, 'owner'),
        updated_at = now()
    WHERE id = v_user_id;

    -- Upsert initial brand profile if provided
    IF p_business_type IS NOT NULL OR p_brand_voice IS NOT NULL OR p_target_audience IS NOT NULL OR p_brand_identity IS NOT NULL OR p_brand_color IS NOT NULL THEN
        INSERT INTO public.brand_profiles (
            tenant_id, business_type, brand_voice, target_audience, brand_identity, primary_color
        ) VALUES (
            v_tenant_id, p_business_type, p_brand_voice, p_target_audience, p_brand_identity, p_brand_color
        )
        ON CONFLICT (tenant_id) DO UPDATE SET
            business_type   = COALESCE(EXCLUDED.business_type, brand_profiles.business_type),
            brand_voice     = COALESCE(EXCLUDED.brand_voice, brand_profiles.brand_voice),
            target_audience = COALESCE(EXCLUDED.target_audience, brand_profiles.target_audience),
            brand_identity  = COALESCE(EXCLUDED.brand_identity, brand_profiles.brand_identity),
            primary_color   = COALESCE(EXCLUDED.primary_color, brand_profiles.primary_color),
            updated_at      = now();
    END IF;

    -- Maintain user_tenants membership
    INSERT INTO public.user_tenants (user_id, tenant_id, role)
    VALUES (v_user_id, v_tenant_id, 'owner')
    ON CONFLICT (user_id, tenant_id) DO NOTHING;

    RETURN json_build_object(
        'success', true,
        'tenant_id', v_tenant_id,
        'slug', v_slug,
        'message', 'Tenant created and assigned successfully'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_tenant_and_assign FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_tenant_and_assign TO authenticated;

COMMENT ON FUNCTION public.create_tenant_and_assign IS 
'Idempotent: returns existing tenant if user already has one; otherwise creates and assigns a new tenant.';

