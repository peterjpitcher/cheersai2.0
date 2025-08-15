-- =====================================================
-- FINAL TENANT CREATION TEST
-- Run this in Supabase SQL Editor while logged in
-- =====================================================

-- 1. Verify you're authenticated
SELECT 
    '1. AUTH STATUS' as test,
    auth.uid() as user_id,
    auth.role() as role,
    CASE 
        WHEN auth.uid() IS NOT NULL THEN '✅ AUTHENTICATED'
        ELSE '❌ NOT AUTHENTICATED - LOG IN FIRST!'
    END as status;

-- 2. Check exact INSERT policy
SELECT 
    '2. INSERT POLICY' as test,
    policyname,
    permissive,
    roles::text,
    qual as using_clause,
    with_check as check_clause
FROM pg_policies
WHERE tablename = 'tenants' AND cmd = 'INSERT';

-- 3. Try direct INSERT
DO $$
DECLARE
    test_id uuid;
    error_msg text;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '3. TESTING DIRECT INSERT...';
    RAISE NOTICE '----------------------------';
    
    BEGIN
        INSERT INTO tenants (id, name, slug, created_at, updated_at)
        VALUES (
            gen_random_uuid(),
            'Direct Test ' || extract(epoch from now())::text,
            'direct-test-' || extract(epoch from now())::text,
            now(),
            now()
        )
        RETURNING id INTO test_id;
        
        RAISE NOTICE '✅ SUCCESS! Created tenant with ID: %', test_id;
        
        -- Clean up
        DELETE FROM tenants WHERE id = test_id;
        RAISE NOTICE '🧹 Cleaned up test tenant';
        
    EXCEPTION 
        WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS error_msg = MESSAGE_TEXT;
            RAISE NOTICE '❌ FAILED: %', error_msg;
            RAISE NOTICE '';
            RAISE NOTICE 'This means RLS is still blocking. Checking why...';
    END;
END $$;

-- 4. Check if it's a role issue
SELECT 
    '4. ROLE CHECK' as test,
    rolname,
    rolsuper,
    rolinherit,
    rolcreaterole,
    rolcreatedb,
    rolcanlogin,
    rolreplication,
    rolbypassrls
FROM pg_roles
WHERE rolname IN ('authenticated', 'anon', current_user);

-- 5. Test with explicit role set
SET ROLE authenticated;
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '5. TESTING AS AUTHENTICATED ROLE...';
    RAISE NOTICE '------------------------------------';
    
    BEGIN
        INSERT INTO tenants (name, slug)
        VALUES ('Role Test', 'role-test-' || extract(epoch from now())::text);
        RAISE NOTICE '✅ Works as authenticated role';
        ROLLBACK;
    EXCEPTION 
        WHEN OTHERS THEN
            RAISE NOTICE '❌ Still fails as authenticated role: %', SQLERRM;
    END;
END $$;
RESET ROLE;

-- 6. Check if RLS can be temporarily disabled (DANGEROUS - only for testing!)
SELECT 
    '6. CAN DISABLE RLS?' as test,
    current_user,
    CASE 
        WHEN current_setting('row_security', true) = 'off' THEN 'Already OFF'
        WHEN current_setting('row_security', true) = 'on' THEN 'Currently ON'
        ELSE 'Unknown state'
    END as rls_state;

-- 7. Nuclear option - check if we can bypass RLS completely
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '7. TESTING RLS BYPASS...';
    RAISE NOTICE '------------------------';
    
    -- Try to disable RLS for this transaction
    BEGIN
        SET LOCAL row_security = off;
        INSERT INTO tenants (name, slug)
        VALUES ('Bypass Test', 'bypass-' || extract(epoch from now())::text);
        RAISE NOTICE '✅ INSERT works with RLS disabled';
        RAISE NOTICE '   This confirms RLS is the issue';
        ROLLBACK;
    EXCEPTION 
        WHEN OTHERS THEN
            RAISE NOTICE '❌ Cannot bypass RLS: %', SQLERRM;
            RAISE NOTICE '   User may not have bypass permission';
    END;
END $$;

-- 8. Final check - what's the actual policy SQL?
SELECT 
    '8. RAW POLICY SQL' as test,
    polname as policy_name,
    CASE polcmd
        WHEN 'r' THEN 'SELECT'
        WHEN 'a' THEN 'INSERT'
        WHEN 'w' THEN 'UPDATE'
        WHEN 'd' THEN 'DELETE'
    END as command,
    pg_get_expr(polqual, polrelid) as using_clause,
    pg_get_expr(polwithcheck, polrelid) as with_check_clause
FROM pg_policy
WHERE polrelid = 'tenants'::regclass
ORDER BY polcmd;