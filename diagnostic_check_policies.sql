-- =====================================================
-- DIAGNOSTIC: Check Current RLS Policies
-- Run this in Supabase SQL Editor to see actual state
-- =====================================================

-- 1. Check all tenant INSERT policies
SELECT 
    'TENANT INSERT POLICIES' as check_type,
    policyname,
    qual as using_clause,
    with_check as check_clause
FROM pg_policies
WHERE schemaname = 'public' 
AND tablename = 'tenants'
AND cmd = 'INSERT'
ORDER BY policyname;

-- 2. Check if RLS is enabled
SELECT 
    'RLS STATUS' as check_type,
    tablename,
    CASE 
        WHEN rowsecurity = true THEN 'ENABLED'
        ELSE 'DISABLED'
    END as rls_status
FROM pg_tables t
JOIN pg_class c ON c.relname = t.tablename
WHERE schemaname = 'public'
AND tablename IN ('tenants', 'users', 'user_tenants');

-- 3. Check for duplicate/conflicting policies
WITH policy_counts AS (
    SELECT 
        tablename,
        cmd,
        COUNT(*) as policy_count,
        string_agg(policyname, ', ') as policy_names
    FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename IN ('tenants', 'users')
    GROUP BY tablename, cmd
    HAVING COUNT(*) > 1
)
SELECT 
    'DUPLICATE POLICIES' as check_type,
    tablename,
    cmd as operation,
    policy_count,
    policy_names
FROM policy_counts
ORDER BY tablename, cmd;

-- 4. Test if authenticated user can insert
SELECT 
    'CAN INSERT TEST' as check_type,
    CASE 
        WHEN auth.uid() IS NULL THEN 'NOT AUTHENTICATED'
        WHEN auth.uid() IS NOT NULL THEN 'AUTHENTICATED AS: ' || auth.uid()::text
    END as auth_status,
    CASE
        WHEN EXISTS (
            SELECT 1 FROM users WHERE id = auth.uid() AND tenant_id IS NOT NULL
        ) THEN 'USER HAS TENANT'
        ELSE 'USER HAS NO TENANT'
    END as tenant_status;

-- 5. Show the exact INSERT policy check conditions
SELECT 
    'POLICY DETAILS' as check_type,
    policyname,
    with_check
FROM pg_policies
WHERE schemaname = 'public' 
AND tablename = 'tenants'
AND cmd = 'INSERT';

-- 6. Check for any policies that reference tenant_id in users table
SELECT 
    'CIRCULAR DEPENDENCIES' as check_type,
    tablename,
    policyname,
    cmd,
    CASE
        WHEN with_check LIKE '%tenant_id%' THEN 'POSSIBLE CIRCULAR REFERENCE'
        WHEN qual LIKE '%tenant_id%' THEN 'POSSIBLE CIRCULAR REFERENCE'
        ELSE 'OK'
    END as issue
FROM pg_policies
WHERE schemaname = 'public' 
AND tablename = 'tenants'
AND (with_check LIKE '%users%' OR qual LIKE '%users%');