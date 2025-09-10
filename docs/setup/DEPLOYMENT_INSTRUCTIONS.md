# 🚨 URGENT: Instagram Storage Fix Deployment Instructions

## Current Status
- ❌ Users cannot connect Instagram (storage_failed error)
- ✅ OAuth works but database save fails
- ✅ Fix is ready and tested

## Deployment Steps (IN ORDER)

### Step 1: Deploy Hotfix Migration (DO THIS NOW)
```sql
-- In Supabase Dashboard → SQL Editor
-- Run this IMMEDIATELY to unblock users:

-- Hotfix: Reintroduce compatibility function for broken RLS policies
-- This is a temporary shim to unblock production while we prepare the full migration
-- The old function get_user_tenant_id() was dropped in migration 008 but policies still reference it

CREATE OR REPLACE FUNCTION public.get_user_tenant_id(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  -- Delegate to the new function that was introduced in migration 008
  -- Note: The parameter p_user_id is ignored as the new function uses auth context
  SELECT public.get_auth_tenant_id();
$$;

-- Add a comment to remind us this is temporary
COMMENT ON FUNCTION public.get_user_tenant_id(uuid) IS 'TEMPORARY compatibility shim for legacy RLS policies. Remove after migration 022 updates all policies.';
```

### Step 2: Verify Hotfix Works
1. Go to https://cheersai.uk/settings/connections
2. Click "Connect Instagram"
3. Complete OAuth flow
4. Verify NO storage_failed error
5. Check Supabase dashboard for new record in social_connections table

### Step 3: Deploy Code Changes (Already Pushed)
The code is already deployed via Vercel auto-deploy from GitHub. Changes include:
- Better authentication in callback
- Tenant validation
- Enhanced error logging

### Step 4: Deploy Permanent Fix (After Verification)
```sql
-- In Supabase Dashboard → SQL Editor
-- Run the full migration from 022_fix_social_connections_rls.sql
-- This updates all policies and removes the temporary function
-- (Full SQL is in the file - too long to paste here)
```

### Step 5: Final Verification
```sql
-- Check that new policies are working
SELECT COUNT(*) FROM social_connections 
WHERE platform = 'instagram_business' 
AND created_at > NOW() - INTERVAL '1 hour';

-- Verify policies use correct function
SELECT policyname, qual 
FROM pg_policies 
WHERE tablename = 'social_connections'
AND qual::text LIKE '%get_auth_tenant_id%';
```

## What This Fixes
- ✅ "storage_failed" error when connecting Instagram
- ✅ RLS policies using non-existent function
- ✅ Tenant validation security issue
- ✅ Missing error logging

## Monitoring
Watch Supabase logs for:
- "Failed to store connections - Database error" → Check detailed error
- "OAuth callback: Tenant mismatch" → Security validation working
- "OAuth callback: No authenticated user" → Session issue

## Rollback (If Needed)
```sql
-- Only if hotfix causes issues (unlikely)
DROP FUNCTION IF EXISTS public.get_user_tenant_id(uuid);
```

## Success Indicators
- Users can connect Instagram without errors
- New records appear in social_connections table
- Platform = 'instagram_business'
- Page tokens stored correctly

---

**ACTION REQUIRED: Run Step 1 SQL immediately in Supabase to unblock users!**

Migration files are in:
- `/supabase/migrations/021_hotfix_reintroduce_compat_function.sql`
- `/supabase/migrations/022_fix_social_connections_rls.sql`