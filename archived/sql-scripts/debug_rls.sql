-- =====================================================
-- DEBUG SCRIPT: Check RLS and Data State
-- Run this in Supabase SQL Editor to debug issues
-- =====================================================

-- 1. Check if any users exist
SELECT '=== AUTH USERS ===' as check;
SELECT id, email, created_at, raw_app_meta_data
FROM auth.users 
ORDER BY created_at DESC 
LIMIT 5;

-- 2. Check app users table
SELECT '=== APP USERS TABLE ===' as check;
SELECT u.*, t.name as tenant_name
FROM users u
LEFT JOIN tenants t ON u.tenant_id = t.id
ORDER BY u.created_at DESC
LIMIT 5;

-- 3. Check tenants
SELECT '=== TENANTS ===' as check;
SELECT * FROM tenants
ORDER BY created_at DESC
LIMIT 5;

-- 4. Check user_tenants relationships
SELECT '=== USER_TENANTS ===' as check;
SELECT ut.*, u.email
FROM user_tenants ut
LEFT JOIN auth.users u ON u.id = ut.user_id
ORDER BY ut.created_at DESC
LIMIT 5;

-- 5. Check current tenant policies
SELECT '=== TENANT POLICIES ===' as check;
SELECT 
    policyname,
    cmd as operation,
    CASE WHEN permissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END as type,
    substring(qual from 1 for 150) as using_clause,
    substring(with_check from 1 for 150) as with_check_clause
FROM pg_policies
WHERE tablename = 'tenants'
ORDER BY cmd, policyname;

-- 6. Test if current user can insert into tenants
SELECT '=== CAN CURRENT USER CREATE TENANT? ===' as check;
SELECT 
    auth.uid() as current_user_id,
    CASE 
        WHEN auth.uid() IS NULL THEN 'NO - Not authenticated'
        WHEN EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND tenant_id IS NOT NULL) 
        THEN 'NO - User already has tenant'
        ELSE 'YES - User can create tenant'
    END as can_create_tenant;

-- 7. Check JWT claims
SELECT '=== JWT CLAIMS ===' as check;
SELECT 
    auth.uid() as user_id,
    auth.jwt() -> 'app_metadata' as app_metadata,
    auth.jwt() -> 'app_metadata' -> 'tenant_id' as tenant_id_in_jwt,
    get_auth_tenant_id() as tenant_from_function;

-- 8. Test tenant creation (dry run - will rollback)
SELECT '=== TEST TENANT CREATION ===' as check;
DO $$
DECLARE
    test_result TEXT;
BEGIN
    -- Try to insert a test tenant
    BEGIN
        INSERT INTO tenants (name, slug) 
        VALUES ('Test Tenant', 'test-tenant-' || extract(epoch from now())::text);
        test_result := 'SUCCESS - Tenant can be created';
        -- Rollback so we don't actually create it
        RAISE EXCEPTION 'Rolling back test insert';
    EXCEPTION 
        WHEN OTHERS THEN
            test_result := 'FAILED - ' || SQLERRM;
    END;
    
    RAISE NOTICE 'Tenant creation test: %', test_result;
END $$;

-- 9. Check for any failed tenant creation attempts
SELECT '=== RECENT ERRORS (if logged) ===' as check;
-- This would show errors if error logging is enabled
-- Usually found in Supabase dashboard logs

-- 10. Summary
SELECT '=== SUMMARY ===' as check;
SELECT 
    (SELECT COUNT(*) FROM auth.users) as total_auth_users,
    (SELECT COUNT(*) FROM users) as total_app_users,
    (SELECT COUNT(*) FROM tenants) as total_tenants,
    (SELECT COUNT(*) FROM user_tenants) as total_user_tenant_relationships,
    (SELECT COUNT(*) FROM brand_profiles) as total_brand_profiles;