-- Check if there's any data in key tables
SELECT 'auth.users' as table_name, COUNT(*) as count FROM auth.users
UNION ALL
SELECT 'users' as table_name, COUNT(*) as count FROM users
UNION ALL
SELECT 'tenants' as table_name, COUNT(*) as count FROM tenants
UNION ALL
SELECT 'user_tenants' as table_name, COUNT(*) as count FROM user_tenants
UNION ALL
SELECT 'brand_profiles' as table_name, COUNT(*) as count FROM brand_profiles;

-- Check current tenant policies
SELECT 
    policyname,
    cmd as operation,
    permissive,
    substring(qual from 1 for 100) as using_clause,
    substring(with_check from 1 for 100) as check_clause
FROM pg_policies
WHERE tablename = 'tenants'
ORDER BY policyname;

-- Check if get_auth_tenant_id() returns anything
SELECT 
    auth.uid() as current_user,
    auth.jwt() -> 'app_metadata' -> 'tenant_id' as jwt_tenant_id,
    get_auth_tenant_id() as tenant_from_function;
