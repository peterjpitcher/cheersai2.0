-- =====================================================
-- TEST SCRIPT: Verify Authentication Flow is Fixed
-- Run this in Supabase SQL Editor after applying migrations
-- =====================================================

-- 1. Check all tables exist
SELECT '=== TABLES CHECK ===' as test;
SELECT table_name, 
       CASE WHEN table_name IS NOT NULL THEN '✅ Exists' ELSE '❌ Missing' END as status
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
  'tenants', 'users', 'user_tenants', 'brand_profiles', 
  'team_invitations', 'two_factor_auth', 'social_accounts',
  'social_connections', 'publishing_queue', 'publishing_history',
  'campaigns', 'campaign_posts', 'media_assets', 'analytics',
  'api_usage', 'notification_settings', 'campaign_templates'
)
ORDER BY table_name;

-- 2. Check RLS is enabled
SELECT '=== RLS STATUS ===' as test;
SELECT tablename, 
       CASE WHEN rowsecurity THEN '✅ Enabled' ELSE '❌ Disabled' END as rls_status
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN (
  'tenants', 'users', 'user_tenants', 'brand_profiles',
  'team_invitations', 'social_accounts'
)
ORDER BY tablename;

-- 3. Check helper functions exist
SELECT '=== HELPER FUNCTIONS ===' as test;
SELECT routine_name,
       CASE WHEN routine_name IS NOT NULL THEN '✅ Exists' ELSE '❌ Missing' END as status
FROM information_schema.routines 
WHERE routine_schema = 'public'
AND routine_name IN ('get_user_tenant_id', 'user_has_tenant', 'update_updated_at_column')
ORDER BY routine_name;

-- 4. Check for circular dependencies in policies
SELECT '=== POLICY CIRCULAR DEPENDENCY CHECK ===' as test;
SELECT 
  tablename,
  policyname,
  CASE 
    WHEN qual LIKE '%' || tablename || '%' AND tablename = 'user_tenants' 
    THEN '❌ CIRCULAR REFERENCE DETECTED'
    ELSE '✅ Safe'
  END as status,
  substring(qual from 1 for 100) as policy_snippet
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'user_tenants'
ORDER BY tablename, policyname;

-- 5. Count policies per table
SELECT '=== POLICIES COUNT ===' as test;
SELECT 
  tablename,
  COUNT(*) as policy_count,
  CASE 
    WHEN COUNT(*) = 0 THEN '❌ No policies!'
    WHEN COUNT(*) < 2 THEN '⚠️ Few policies'
    ELSE '✅ OK'
  END as status
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN (
  'tenants', 'users', 'user_tenants', 'brand_profiles',
  'team_invitations', 'social_accounts'
)
GROUP BY tablename
ORDER BY tablename;

-- 6. Check if there are any users
SELECT '=== USERS CHECK ===' as test;
SELECT 
  COUNT(*) as auth_users_count,
  (SELECT COUNT(*) FROM users) as app_users_count,
  (SELECT COUNT(*) FROM tenants) as tenants_count,
  (SELECT COUNT(*) FROM user_tenants) as user_tenants_count
FROM auth.users;

-- 7. Check latest tenant creation (if any)
SELECT '=== LATEST TENANT ===' as test;
SELECT 
  t.name as tenant_name,
  t.slug,
  t.created_at,
  u.email as owner_email,
  u.role as owner_role
FROM tenants t
LEFT JOIN users u ON u.tenant_id = t.id
ORDER BY t.created_at DESC
LIMIT 1;

-- 8. Verify policy conditions
SELECT '=== POLICY DETAILS FOR user_tenants ===' as test;
SELECT 
  policyname,
  permissive,
  roles,
  cmd as operation,
  substring(qual from 1 for 200) as condition
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'user_tenants'
ORDER BY policyname;

-- 9. Check for orphaned records
SELECT '=== ORPHANED RECORDS CHECK ===' as test;
SELECT 
  'Users without tenant' as check_type,
  COUNT(*) as count,
  CASE WHEN COUNT(*) > 0 THEN '⚠️ Found orphans' ELSE '✅ None' END as status
FROM users WHERE tenant_id IS NULL
UNION ALL
SELECT 
  'User_tenants without valid user' as check_type,
  COUNT(*) as count,
  CASE WHEN COUNT(*) > 0 THEN '⚠️ Found orphans' ELSE '✅ None' END as status
FROM user_tenants ut
WHERE NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = ut.user_id)
UNION ALL
SELECT 
  'User_tenants without valid tenant' as check_type,
  COUNT(*) as count,
  CASE WHEN COUNT(*) > 0 THEN '⚠️ Found orphans' ELSE '✅ None' END as status
FROM user_tenants ut
WHERE NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = ut.tenant_id);

-- 10. Final status
SELECT '=== FINAL STATUS ===' as test;
SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE schemaname = 'public' 
      AND tablename = 'user_tenants'
      AND qual LIKE '%user_tenants%'
    ) THEN '❌ CIRCULAR REFERENCES STILL EXIST'
    ELSE '✅ All policies are safe - No circular references detected!'
  END as overall_status;