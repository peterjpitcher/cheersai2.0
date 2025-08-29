-- =====================================================
-- FIX TENANT CREATION WITH SECURITY DEFINER FUNCTION
-- Implements senior developer recommended approach
-- =====================================================

-- 1) Drop all existing INSERT policies on tenants (clean slate)
DO $$
DECLARE 
    r record;
BEGIN
    FOR r IN (
        SELECT policyname 
        FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'tenants' 
        AND cmd = 'INSERT'
    )
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.tenants', r.policyname);
        RAISE NOTICE 'Dropped policy: %', r.policyname;
    END LOOP;
END $$;

-- 2) Add owner_id column if it doesn't exist (for future tracking)
ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS owner_id uuid;

-- Update existing tenants to set owner_id from users table
UPDATE public.tenants t
SET owner_id = u.id
FROM public.users u
WHERE u.tenant_id = t.id
AND u.role = 'owner'
AND t.owner_id IS NULL;

-- For any remaining tenants without an owner, set to first user in that tenant
UPDATE public.tenants t
SET owner_id = (
    SELECT u.id 
    FROM public.users u 
    WHERE u.tenant_id = t.id 
    ORDER BY u.created_at 
    LIMIT 1
)
WHERE t.owner_id IS NULL;

-- If still any nulls (shouldn't happen), set to superadmin
UPDATE public.tenants
SET owner_id = (
    SELECT id FROM auth.users 
    WHERE email = 'pipitcher@gmail.com' 
    LIMIT 1
)
WHERE owner_id IS NULL;

-- Now safe to make NOT NULL with default
ALTER TABLE public.tenants
    ALTER COLUMN owner_id SET DEFAULT auth.uid();

-- Only set NOT NULL if all values are non-null
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE owner_id IS NULL) THEN
        ALTER TABLE public.tenants ALTER COLUMN owner_id SET NOT NULL;
    ELSE
        RAISE NOTICE 'Warning: Some tenants still have NULL owner_id';
    END IF;
END $$;

-- Add foreign key constraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'tenants_owner_fk'
    ) THEN
        ALTER TABLE public.tenants
            ADD CONSTRAINT tenants_owner_fk
            FOREIGN KEY (owner_id) 
            REFERENCES auth.users(id) 
            ON DELETE RESTRICT;
    END IF;
END $$;

-- 3) Create SECURITY DEFINER function for atomic tenant creation
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

-- 4) Grant execute permission to authenticated users
REVOKE ALL ON FUNCTION public.create_tenant_and_assign FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_tenant_and_assign TO authenticated;

-- 5) Create simple RLS policy for future direct inserts (admin use)
CREATE POLICY "tenants_insert_owner_match"
    ON public.tenants 
    FOR INSERT
    TO authenticated
    WITH CHECK (owner_id = auth.uid());

-- 6) Also allow superadmin to insert tenants
CREATE POLICY "tenants_insert_superadmin"
    ON public.tenants 
    FOR INSERT
    TO authenticated
    WITH CHECK ((auth.jwt()->>'email') = 'pipitcher@gmail.com');

-- 7) Add helpful comments
COMMENT ON FUNCTION public.create_tenant_and_assign IS 
'Atomically creates a tenant and assigns it to the current user. 
Prevents circular dependency issues with RLS policies.
Called during onboarding to set up new accounts.';

COMMENT ON COLUMN public.tenants.owner_id IS 
'The auth.users.id of the user who created/owns this tenant';

-- 8) Verify the fix
DO $$
BEGIN
    RAISE NOTICE '=== TENANT CREATION FIX APPLIED ===';
    RAISE NOTICE 'Function created: create_tenant_and_assign()';
    RAISE NOTICE 'This bypasses RLS deadlock by using SECURITY DEFINER';
    RAISE NOTICE 'Call from client: supabase.rpc(''create_tenant_and_assign'', {...})';
END $$;