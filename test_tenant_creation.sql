-- =====================================================
-- TEST TENANT CREATION WITH NEW POLICIES
-- Run this in Supabase SQL Editor after logging in
-- =====================================================

-- 1. Check if you're authenticated
SELECT 
    'Authentication Status' as check,
    auth.uid() as user_id,
    CASE 
        WHEN auth.uid() IS NOT NULL THEN 'AUTHENTICATED ✅'
        ELSE 'NOT AUTHENTICATED ❌'
    END as status;

-- 2. Check current tenant policies
SELECT 
    'Tenant Policies' as check,
    policyname,
    cmd as operation,
    CASE WHEN permissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END as type
FROM pg_policies
WHERE tablename = 'tenants'
ORDER BY cmd, policyname;

-- 3. Check if you already have data
SELECT 'Existing Data Check' as check;
SELECT 'Users in auth.users' as table_name, COUNT(*)::text as count FROM auth.users
UNION ALL
SELECT 'Users in public.users', COUNT(*)::text FROM users
UNION ALL
SELECT 'Tenants', COUNT(*)::text FROM tenants
UNION ALL
SELECT 'User-Tenant relationships', COUNT(*)::text FROM user_tenants;

-- 4. Test tenant creation (with detailed error info)
DO $$
DECLARE
    test_tenant_id uuid;
    test_user_id uuid;
    error_msg text;
    error_detail text;
    error_hint text;
BEGIN
    -- Get current user
    test_user_id := auth.uid();
    
    IF test_user_id IS NULL THEN
        RAISE NOTICE '❌ Cannot test - not authenticated';
        RETURN;
    END IF;
    
    RAISE NOTICE '📝 Testing tenant creation for user: %', test_user_id;
    
    -- Try to create a test tenant
    BEGIN
        INSERT INTO tenants (name, slug) 
        VALUES ('Test Tenant ' || extract(epoch from now())::text, 
                'test-tenant-' || extract(epoch from now())::text)
        RETURNING id INTO test_tenant_id;
        
        RAISE NOTICE '✅ SUCCESS! Tenant created with ID: %', test_tenant_id;
        
        -- Clean up test tenant
        DELETE FROM tenants WHERE id = test_tenant_id;
        RAISE NOTICE '🧹 Test tenant cleaned up';
        
    EXCEPTION 
        WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS 
                error_msg = MESSAGE_TEXT,
                error_detail = PG_EXCEPTION_DETAIL,
                error_hint = PG_EXCEPTION_HINT;
            
            RAISE NOTICE '❌ FAILED to create tenant!';
            RAISE NOTICE '   Error: %', error_msg;
            IF error_detail IS NOT NULL THEN
                RAISE NOTICE '   Detail: %', error_detail;
            END IF;
            IF error_hint IS NOT NULL THEN
                RAISE NOTICE '   Hint: %', error_hint;
            END IF;
    END;
END $$;

-- 5. Check what the INSERT policy actually allows
SELECT 
    'INSERT Policy Check' as check,
    policyname,
    substring(with_check from 1 for 200) as with_check_clause
FROM pg_policies
WHERE tablename = 'tenants' AND cmd = 'INSERT';

-- 6. Manual test - try this if the automated test fails
-- Uncomment and run to test manually:
/*
INSERT INTO tenants (name, slug) 
VALUES ('Manual Test Pub', 'manual-test-' || extract(epoch from now())::text)
RETURNING *;
*/

-- 7. Check if RLS is enabled
SELECT 
    'RLS Status' as check,
    schemaname,
    tablename,
    CASE WHEN rowsecurity THEN 'ENABLED ✅' ELSE 'DISABLED ❌' END as rls_status,
    CASE WHEN forcerowsecurity THEN 'FORCED' ELSE 'NOT FORCED' END as force_rls
FROM pg_tables
WHERE schemaname = 'public' 
AND tablename IN ('tenants', 'users', 'user_tenants', 'brand_profiles')
ORDER BY tablename;