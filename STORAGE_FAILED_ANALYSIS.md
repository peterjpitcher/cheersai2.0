# Instagram OAuth Storage Failed Error - Analysis & Solution

## Executive Summary
The Instagram OAuth flow completes successfully (tokens obtained, Instagram accounts discovered) but fails at the final database storage step with `error=storage_failed`. The root cause is **broken RLS policies** on the `social_connections` table that reference a function that no longer exists.

---

## Error Context
- **URL**: `https://cheersai.orangejelly.co.uk/settings/connections?error=storage_failed#_=_`
- **Occurs**: After successful Facebook OAuth, when trying to save Instagram connection to database
- **File**: `/app/api/social/callback/route.ts` line 132-143

---

## Root Cause Analysis

### PRIMARY ISSUE: Broken RLS Policies

The `social_connections` table has RLS policies created in migration `003_social_integrations.sql` that use:
```sql
get_user_tenant_id(auth.uid())
```

However, in migration `008_complete_rls_redesign.sql`, this function was **DROPPED** and replaced with:
```sql
get_auth_tenant_id()  -- New function with different signature
```

**Result**: When the callback tries to insert/update social_connections, the RLS policies fail because they reference a non-existent function, causing the storage to fail.

### Evidence

1. **Migration 003** creates policies:
```sql
CREATE POLICY "Users can create social connections for their tenant"
  ON social_connections FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()));
```

2. **Migration 008** drops the function:
```sql
DROP FUNCTION IF EXISTS get_user_tenant_id(UUID);
```

3. But **Migration 008 doesn't update** the social_connections policies to use the new function.

---

## Secondary Issues

### 1. Authentication Context
The callback route may not have proper user authentication:
- OAuth callbacks happen in a new request context
- Session cookies might not be properly set
- The Supabase client might not have auth context

### 2. Tenant ID Trust
The `tenant_id` comes from the decoded state parameter without validation:
```typescript
const { tenant_id, platform } = stateData;
// No verification that tenant_id is valid or accessible
```

---

## Proposed Solution

### Option A: Fix RLS Policies (RECOMMENDED)
Create a new migration to update the social_connections RLS policies to match the new architecture:

```sql
-- Migration: 021_fix_social_connections_rls.sql

-- Drop old policies that use non-existent function
DROP POLICY IF EXISTS "Users can view their tenant's social connections" ON social_connections;
DROP POLICY IF EXISTS "Users can create social connections for their tenant" ON social_connections;
DROP POLICY IF EXISTS "Users can update their tenant's social connections" ON social_connections;
DROP POLICY IF EXISTS "Users can delete their tenant's social connections" ON social_connections;

-- Create new policies using the current architecture
CREATE POLICY "Users can view their tenant's social connections"
  ON social_connections FOR SELECT
  USING (
    tenant_id = get_auth_tenant_id()
    OR EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.tenant_id = social_connections.tenant_id
    )
  );

CREATE POLICY "Users can create social connections"
  ON social_connections FOR INSERT
  WITH CHECK (
    tenant_id = get_auth_tenant_id()
    OR EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.tenant_id = social_connections.tenant_id
    )
  );

CREATE POLICY "Users can update their tenant's social connections"
  ON social_connections FOR UPDATE
  USING (
    tenant_id = get_auth_tenant_id()
    OR EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.tenant_id = social_connections.tenant_id
    )
  );

CREATE POLICY "Users can delete their tenant's social connections"
  ON social_connections FOR DELETE
  USING (
    tenant_id = get_auth_tenant_id()
    OR EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.tenant_id = social_connections.tenant_id
    )
  );
```

### Option B: Use Service Role (Quick Fix)
Temporarily bypass RLS in the callback by using the service role key:
```typescript
// In callback/route.ts
const supabase = createClient({ serviceRole: true });
```
**Pros**: Quick fix, will work immediately
**Cons**: Security risk, bypasses all RLS checks

### Option C: Validate & Authenticate
Add proper validation in the callback:
```typescript
// Verify the tenant_id belongs to the authenticated user
const { data: validTenant } = await supabase
  .from("users")
  .select("tenant_id")
  .eq("id", user.id)
  .eq("tenant_id", tenant_id)
  .single();

if (!validTenant) {
  return NextResponse.redirect(
    `${baseUrl}/settings/connections?error=invalid_tenant`
  );
}
```

---

## Testing the Fix

### 1. Check Current RLS Policies
```sql
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'social_connections';
```

### 2. Test Function Existence
```sql
-- This should FAIL (function doesn't exist)
SELECT get_user_tenant_id('00000000-0000-0000-0000-000000000000'::uuid);

-- This should WORK (new function)
SELECT get_auth_tenant_id();
```

### 3. Manual Insert Test
```sql
-- Try inserting as a test (will fail with current policies)
INSERT INTO social_connections (
  tenant_id, 
  platform, 
  account_id, 
  account_name, 
  access_token
) VALUES (
  'your-tenant-id',
  'test',
  'test-123',
  'Test Account',
  'test-token'
);
```

---

## Recommendation

**Implement Option A** - Fix the RLS policies to use the new function architecture. This:
1. Addresses the root cause
2. Maintains security
3. Aligns with the new RLS design
4. Is a permanent fix

After fixing the RLS policies, also implement validation (Option C) for defense in depth.

---

## Impact Assessment

- **Severity**: HIGH - Blocks all social media connections
- **Users Affected**: All users trying to connect Instagram/Facebook
- **Workaround**: None available to end users
- **Risk of Fix**: LOW - Only updates policies, no data changes

---

## Implementation Steps

1. **Immediate**: Apply the RLS policy fix migration
2. **Test**: Verify Instagram connection flow works
3. **Enhance**: Add tenant validation in callback
4. **Monitor**: Check for any other tables with old RLS policies

---

## Questions for Senior Developer

1. Should we use Option A (fix RLS) or Option B (service role) for immediate relief?
2. Are there other tables that might have the same RLS policy issue?
3. Should the callback validate tenant_id ownership before storage?
4. Do we need to add logging to capture the actual Postgres error for debugging?

---

*Analysis complete. The storage is failing because RLS policies reference a dropped function. The fix is straightforward - update the policies to use the new function.*