-- =====================================================
-- EMERGENCY: Check what's actually happening
-- =====================================================

-- 1. Check if RLS is enabled
SELECT 
    'RLS Status Check' as test,
    tablename,
    rowsecurity as rls_enabled,
    forcerowsecurity as force_rls
FROM pg_tables
WHERE schemaname = 'public' 
AND tablename = 'tenants';

-- 2. Check EXACT policies on tenants table
SELECT 
    'Current Tenant Policies' as test,
    policyname,
    cmd,
    permissive,
    qual as using_clause,
    with_check as check_clause
FROM pg_policies
WHERE tablename = 'tenants'
ORDER BY cmd, policyname;

-- 3. Check if the migration actually ran
SELECT 
    'Migration Status' as test,
    name,
    executed_at
FROM supabase_migrations.schema_migrations
WHERE name LIKE '%010%' OR name LIKE '%tenant%'
ORDER BY executed_at DESC
LIMIT 5;

-- 4. Test what auth.uid() returns
SELECT 
    'Auth Check' as test,
    auth.uid() as current_user_id,
    CASE 
        WHEN auth.uid() IS NULL THEN 'NOT AUTHENTICATED'
        ELSE 'AUTHENTICATED: ' || auth.uid()::text
    END as status;

-- 5. CRITICAL TEST - Try with RLS disabled temporarily
DO $$
DECLARE
    test_result text;
BEGIN
    -- First, try with RLS enabled
    BEGIN
        INSERT INTO tenants (name, slug) 
        VALUES ('RLS Test', 'rls-test-' || extract(epoch from now())::text);
        test_result := 'WITH RLS: SUCCESS';
        -- Rollback
        RAISE EXCEPTION 'Rolling back test';
    EXCEPTION 
        WHEN OTHERS THEN
            test_result := 'WITH RLS: FAILED - ' || SQLERRM;
    END;
    RAISE NOTICE '%', test_result;
    
    -- Now try with RLS disabled
    BEGIN
        SET LOCAL row_security TO OFF;
        INSERT INTO tenants (name, slug) 
        VALUES ('No RLS Test', 'no-rls-test-' || extract(epoch from now())::text);
        test_result := 'WITHOUT RLS: SUCCESS';
        -- Rollback
        RAISE EXCEPTION 'Rolling back test';
    EXCEPTION 
        WHEN OTHERS THEN
            test_result := 'WITHOUT RLS: FAILED - ' || SQLERRM;
    END;
    RAISE NOTICE '%', test_result;
END $$;

-- 6. Check if there's a DEFAULT policy blocking
SELECT 
    'Default Policies Check' as test,
    polname,
    polcmd,
    polpermissive,
    polroles::text
FROM pg_policy
WHERE polrelid = 'tenants'::regclass;

-- 7. Check the EXACT with_check condition
SELECT 
    'INSERT Policy Details' as test,
    policyname,
    pg_get_expr(pol.polwithcheck, pol.polrelid) as actual_with_check
FROM pg_policy pol
JOIN pg_class pc ON pol.polrelid = pc.oid
WHERE pc.relname = 'tenants' 
AND pol.polcmd = 'a';  -- 'a' is INSERT command