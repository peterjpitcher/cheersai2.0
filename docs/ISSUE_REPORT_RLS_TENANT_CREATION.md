# 🔴 CRITICAL ISSUE: RLS Policy Blocking Tenant Creation During Onboarding

## Problem Summary
Users cannot complete onboarding because the Row-Level Security (RLS) policy for the `tenants` table is blocking INSERT operations with error:
```
new row violates row-level security policy for table "tenants"
Code: 42501
```

## Current Situation

### What's Happening:
1. User signs up successfully (auth.users record created)
2. User record is created in public.users table (via trigger)
3. User navigates to onboarding page
4. User fills out business details (type, brand voice, etc.)
5. **FAILURE**: When trying to create tenant record, RLS policy blocks the INSERT

### Error Location:
- **File**: `app/onboarding/page.tsx`
- **Line**: ~170-177
- **Operation**: 
```javascript
const { data: tenant, error: tenantError } = await supabase
  .from("tenants")
  .insert({
    name: pubName,
    slug: slug + '-' + Date.now(),
  })
  .select()
  .single();
```

## Root Cause Analysis

### The RLS Policy Conflict:
Our latest migration (`20250831_emergency_fix_infinite_recursion.sql`) created this policy:

```sql
CREATE POLICY "tenants_insert_fixed"
    ON tenants FOR INSERT
    WITH CHECK (
        auth.uid() IS NOT NULL
    );
```

**This SHOULD allow any authenticated user to create a tenant**, but it's not working.

### Possible Reasons for Failure:

1. **Multiple Conflicting Policies**: There may be other INSERT policies on the tenants table that are MORE restrictive
2. **Policy Evaluation Order**: Supabase evaluates ALL policies for a table, and ALL must pass
3. **Stale Policy State**: The emergency fix may not have properly dropped old policies
4. **Service Role Required**: The operation might need service role for initial tenant creation

### Evidence from Migration History:
Looking at previous migrations, there have been MULTIPLE attempts to fix tenant creation:
- Migration 008: `tenants_insert_authenticated` - Simple auth check
- Migration 009: `tenants_insert_first_tenant` - Check if user has no tenant
- Migration 009: `tenants_insert_additional` - For multi-tenant (disabled)
- Migration 20250827100000: `tenants_insert` - Checks if tenant_id already in users table (CIRCULAR!)
- Migration 20250831: `tenants_insert_fixed` - Simple auth check

## The Circular Dependency Problem

**THE CORE ISSUE**: Some policies check if the user already has a tenant_id to allow creating a tenant!

Example from migration 20250827100000:
```sql
CREATE POLICY "tenants_insert"
    ON tenants FOR INSERT
    WITH CHECK (
        id IN (SELECT tenant_id FROM users WHERE id = (SELECT auth.uid()))
        -- This requires tenant_id to already exist!
    );
```

This creates an impossible situation:
1. User needs tenant_id in users table to create tenant
2. But tenant_id comes from creating the tenant
3. **Result**: Deadlock!

## Recommended Solution

### Option 1: Service Role for Onboarding (RECOMMENDED)
```javascript
// In onboarding/page.tsx, use service role for tenant creation ONLY
const { data: tenant, error: tenantError } = await supabaseServiceRole
  .from("tenants")
  .insert({
    name: pubName,
    slug: slug + '-' + Date.now(),
  })
  .select()
  .single();
```

**Pros**:
- Bypasses RLS entirely for this critical operation
- Guaranteed to work
- Simple to implement

**Cons**:
- Requires service role key in API route
- Need to move onboarding logic to API route

### Option 2: Fix RLS Policies (Clean but Complex)
Create a new migration that:
1. Drops ALL existing tenant INSERT policies
2. Creates a single, simple policy:
```sql
-- Drop all existing INSERT policies
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT policyname 
        FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'tenants'
        AND cmd = 'INSERT'
    )
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON tenants', r.policyname);
    END LOOP;
END $$;

-- Create single clean policy
CREATE POLICY "tenants_allow_first_tenant"
    ON tenants FOR INSERT
    WITH CHECK (
        -- User is authenticated
        auth.uid() IS NOT NULL
        -- AND doesn't already have a tenant
        AND NOT EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() 
            AND tenant_id IS NOT NULL
        )
    );
```

**Pros**:
- Maintains RLS security model
- No service role needed
- Clean architecture

**Cons**:
- Risk of breaking existing tenant operations
- Need to carefully test all scenarios

### Option 3: Hybrid Approach
1. Create API route `/api/onboarding/complete` that uses service role
2. Only for tenant creation step
3. All other operations use normal client

## Immediate Workaround

For testing, temporarily disable RLS on tenants table:
```sql
ALTER TABLE tenants DISABLE ROW LEVEL SECURITY;
```
**WARNING**: Only for development/testing!

## Action Items for Senior Review

1. **Confirm which approach to take** (Service Role vs RLS Fix)
2. **Review migration history** - Why so many attempts to fix this?
3. **Consider architectural change** - Should onboarding be an API route?
4. **Audit all current policies** - Need to know exact state
5. **Test scenarios needed**:
   - New user signup → onboarding
   - Existing user without tenant
   - Superadmin operations
   - Multi-tenant future support

## Current Policy State Query

To see actual current policies:
```sql
SELECT 
    policyname,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public' 
AND tablename = 'tenants'
AND cmd = 'INSERT'
ORDER BY policyname;
```

## Risk Assessment

- **Business Impact**: HIGH - New users cannot onboard
- **Security Impact**: LOW - Policies are too restrictive, not too permissive
- **Urgency**: CRITICAL - Blocks all new user signups
- **Complexity**: MEDIUM - Requires careful policy management

## Questions for Senior Developer

1. Should we use service role for onboarding operations?
2. Is there a reason for the complex tenant creation policies in earlier migrations?
3. Should onboarding be moved entirely to an API route?
4. Do we need to support multi-tenant scenarios now or can we simplify?
5. What's the preferred pattern for "first-time setup" operations that bypass normal RLS?

---

**Reported by**: AI Assistant
**Date**: 2024-12-29
**Severity**: CRITICAL
**Blocks**: User Onboarding Flow