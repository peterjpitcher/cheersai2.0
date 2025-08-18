# Instagram OAuth Storage Fix - Implementation Guide

## Senior Developer Feedback Summary

The diagnosis was **confirmed**: RLS policies on `social_connections` table reference a dropped function `get_user_tenant_id()`, causing storage failures.

## Implementation Order

### 🚑 Step 1: Deploy Hotfix (IMMEDIATE)

Deploy the compatibility function to unblock production:

```bash
# In Supabase SQL Editor, run:
supabase/migrations/021_hotfix_reintroduce_compat_function.sql
```

This creates a temporary shim function that makes the old policies work again. **Deploy this NOW** to unblock users.

### ✅ Step 2: Verify Hotfix Works

Test the Instagram connection flow:
1. Go to Settings → Connections
2. Click "Connect Instagram"
3. Complete OAuth flow
4. Verify no `storage_failed` error
5. Check database for new connection record

### 🔧 Step 3: Deploy Callback Security Fix

The callback handler has been updated to:
- Properly authenticate the user session
- Derive tenant_id from database (not trust state)
- Validate tenant ownership
- Log actual database errors for debugging

**Changes made:**
- Gets authenticated user from Supabase session
- Queries user's actual tenant_id from database
- Verifies state tenant matches user's tenant
- Enhanced error logging for debugging

### 🧹 Step 4: Deploy Proper RLS Fix

After confirming the hotfix works, deploy the permanent fix:

```bash
# In Supabase SQL Editor, run:
supabase/migrations/022_fix_social_connections_rls.sql
```

This migration:
- Drops old broken policies
- Creates new policies using `get_auth_tenant_id()`
- Removes the compatibility shim
- Also fixes publishing_history and publishing_queue policies

### 🔍 Step 5: Testing Checklist

**SQL Verification:**
```sql
-- Check that policies are using the new function
SELECT policyname, qual, with_check
FROM pg_policies 
WHERE tablename = 'social_connections';

-- Test the auth function works
SELECT get_auth_tenant_id();

-- Verify connections can be inserted
SELECT * FROM social_connections 
WHERE platform = 'instagram_business' 
ORDER BY created_at DESC 
LIMIT 5;
```

**Application Testing:**
1. ✅ Connect new Instagram account
2. ✅ Verify connection saved to database
3. ✅ Check page tokens stored correctly
4. ✅ Test posting to Instagram
5. ✅ Verify different tenants can't see each other's connections

## What Changed

### Database Migrations
1. **021_hotfix_reintroduce_compat_function.sql** - Temporary compatibility function
2. **022_fix_social_connections_rls.sql** - Permanent RLS policy fix

### Code Changes
1. **app/api/social/callback/route.ts**:
   - Added user authentication check
   - Derives tenant_id from database (security)
   - Validates tenant ownership
   - Enhanced error logging

## Security Improvements

1. **Tenant Validation**: No longer trusts `tenant_id` from state parameter
2. **User Authentication**: Ensures user is logged in during callback
3. **Database Derivation**: Gets tenant from user's database record
4. **Error Visibility**: Logs actual Postgres errors for debugging

## Monitoring

Watch for these in logs:
- "OAuth callback: No authenticated user" - Session issue
- "OAuth callback: User has no tenant" - Data integrity issue
- "OAuth callback: Tenant mismatch" - Security validation working
- "Failed to store connections - Database error" - Check the detailed error

## Rollback Plan

If issues occur:
1. Keep the hotfix (021) in place - it's safe
2. Revert code changes if auth validation causes issues
3. The proper fix (022) can be rolled back by recreating old policies

## Next Steps After Fix

1. **Rotate Facebook App Secret** (still exposed)
2. **Add request signing** for state parameter (HMAC)
3. **Add monitoring** for RLS policy failures
4. **Create health check** endpoint for RLS testing
5. **Document** the OAuth flow for future developers

## Success Metrics

- ✅ No more `storage_failed` errors
- ✅ Instagram connections save successfully
- ✅ Users can connect multiple Instagram accounts
- ✅ Different tenants remain isolated
- ✅ Detailed errors logged for debugging

## Timeline

1. **NOW**: Deploy hotfix migration (021)
2. **After verification**: Deploy code changes
3. **After testing**: Deploy proper fix migration (022)
4. **Within 24 hours**: All users can connect Instagram

---

*Implementation ready. The hotfix is safe and reversible. Deploy migration 021 immediately to unblock users.*