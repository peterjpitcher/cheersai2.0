-- =====================================================
-- FIX REMAINING WARNING ISSUES
-- Addresses function search path and policy overlaps
-- =====================================================

-- === PART 1: FIX FUNCTION SEARCH PATH ===
-- The function still shows as having mutable search_path
-- We need to drop and recreate with proper security settings

DROP FUNCTION IF EXISTS public.increment_guardrails_usage(uuid);

-- Recreate with immutable search_path settings
CREATE OR REPLACE FUNCTION public.increment_guardrails_usage(guardrail_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.content_guardrails
    SET 
        usage_count = COALESCE(usage_count, 0) + 1,
        last_used = NOW(),
        updated_at = NOW()
    WHERE id = guardrail_id;
END;
$$;

-- Also ensure the function owner is set correctly
ALTER FUNCTION public.increment_guardrails_usage(uuid) OWNER TO postgres;

-- === PART 2: FIX GLOBAL_CONTENT_SETTINGS MULTIPLE POLICIES ===
-- The issue is we have both a read policy for everyone AND a superadmin policy
-- These overlap for SELECT operations

DROP POLICY IF EXISTS "global_content_settings_read" ON global_content_settings;
DROP POLICY IF EXISTS "global_content_settings_superadmin" ON global_content_settings;

-- Create separate policies for each operation to avoid overlap

-- SELECT policy for everyone (read-only)
CREATE POLICY "global_content_settings_select_all"
    ON global_content_settings FOR SELECT
    USING (true); -- Anyone can read

-- INSERT policy for superadmin only
CREATE POLICY "global_content_settings_insert_superadmin"
    ON global_content_settings FOR INSERT
    WITH CHECK (
        (select auth.jwt())->>'email' = 'pipitcher@gmail.com'
    );

-- UPDATE policy for superadmin only
CREATE POLICY "global_content_settings_update_superadmin"
    ON global_content_settings FOR UPDATE
    USING (
        (select auth.jwt())->>'email' = 'pipitcher@gmail.com'
    )
    WITH CHECK (
        (select auth.jwt())->>'email' = 'pipitcher@gmail.com'
    );

-- DELETE policy for superadmin only
CREATE POLICY "global_content_settings_delete_superadmin"
    ON global_content_settings FOR DELETE
    USING (
        (select auth.jwt())->>'email' = 'pipitcher@gmail.com'
    );

-- === PART 3: VERIFY FINAL POLICY STATE ===
-- Check that we don't have overlapping policies anymore
DO $$
DECLARE
    rec RECORD;
BEGIN
    -- Check for multiple policies on same table/action
    FOR rec IN
        WITH policy_summary AS (
            SELECT 
                tablename,
                cmd,
                COUNT(*) as policy_count,
                string_agg(policyname, ', ') as policies
            FROM pg_policies
            WHERE schemaname = 'public'
            GROUP BY tablename, cmd
            HAVING COUNT(*) > 1
        )
        SELECT * FROM policy_summary
    LOOP
        RAISE NOTICE 'Table % has % policies for %: %', 
            rec.tablename, rec.policy_count, rec.cmd, rec.policies;
    END LOOP;
END $$;

-- === DOCUMENTATION OF REMAINING NON-SQL ISSUES ===
-- The following issues require Supabase Dashboard configuration:
-- 1. auth_leaked_password_protection - Enable in Auth > Settings > Security
-- 2. auth_insufficient_mfa_options - Enable TOTP/SMS in Auth > Settings > MFA

COMMENT ON FUNCTION public.increment_guardrails_usage(uuid) IS 
'Atomically increments usage count for a guardrail. Uses SECURITY DEFINER with restricted search_path for security.';