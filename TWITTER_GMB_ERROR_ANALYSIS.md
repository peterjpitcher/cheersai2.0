# Twitter/X and Google My Business OAuth Error Analysis

## Executive Summary

Both OAuth integrations are failing at the database storage step after successful OAuth flows:
- **Twitter/X**: `storage_failed` - Database insert fails (likely RLS or constraint issue)
- **Google My Business**: `oauth_failed` - Database schema mismatch (missing columns)

---

## 🐦 Twitter/X Storage Failed Analysis

### Error Location
File: `/app/api/auth/twitter/callback/route.ts`
Line: 122-127 (database insert operation)

### Root Causes Identified

#### 1. Missing Refresh Token Scope
**Current Implementation:**
```typescript
const SCOPES = [
  'tweet.read',
  'tweet.write', 
  'users.read',
  'offline.access', // This is defined but may not be working
].join(' ');
```

**Issue**: The `offline.access` scope is included but Twitter/X OAuth 2.0 requires specific formatting and may not be granting refresh tokens.

#### 2. Database Constraint Conflict
**Table Structure:**
```sql
UNIQUE(tenant_id, platform, account_id)
```

**Potential Issues:**
- If reconnecting same account, upsert uses wrong conflict resolution
- The `onConflict: 'tenant_id,platform'` doesn't match the actual constraint

#### 3. RLS Policy Context
**Current Policy:**
```sql
CREATE POLICY "social_accounts_tenant_isolation"
    ON social_accounts FOR ALL
    USING (
        tenant_id = get_auth_tenant_id()
        OR tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    );
```

**Issue**: During OAuth callback, the auth context may not be properly established, causing `get_auth_tenant_id()` to fail.

### Twitter/X API Changes (2024)

Based on current research:
1. **Endpoint Migration**: Some endpoints moved from `api.twitter.com` to `api.x.com`
2. **Token Lifetime**: Without proper refresh token, access tokens expire in 2 hours
3. **Scope Sensitivity**: Twitter is strict about scope formatting and order

---

## 🗺️ Google My Business OAuth Failed Analysis

### Error Location
File: `/app/api/auth/google-my-business/callback/route.ts`
Lines: 75-76 (database insert with non-existent columns)

### Critical Issue: Database Schema Mismatch

#### Missing Columns
**Code Attempts to Insert:**
```typescript
{
  tenant_id: tenantId,
  platform: 'google_my_business',
  account_id: account.accountId,
  account_name: account.name,
  location_id: location?.locationId,    // ❌ Column doesn't exist
  location_name: location?.title,       // ❌ Column doesn't exist
  access_token: tokens.accessToken,
  refresh_token: tokens.refreshToken,
  // ... other fields
}
```

**Actual Table Schema:**
```sql
CREATE TABLE social_accounts (
  -- Standard columns exist
  -- But NO location_id column
  -- And NO location_name column
);
```

### Additional GMB Issues

#### 1. API Response Handling
The `getAccounts()` and `getLocations()` methods may be failing silently if:
- Google Business Profile API is not enabled in Google Cloud Console
- OAuth consent screen not properly configured
- Account doesn't have any Google Business Profile listings

#### 2. Error Propagation
The catch block at line 96-101 catches all errors with generic `oauth_failed`, hiding the actual database error.

---

## 📊 Database Schema Analysis

### Current social_accounts Table
```sql
-- From migration 005_social_auth.sql
CREATE TABLE IF NOT EXISTS social_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL,
  account_id TEXT NOT NULL,
  account_name TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  page_id TEXT,           -- For Facebook/Instagram
  page_name TEXT,         -- For Facebook/Instagram  
  profile_id TEXT,        -- Generic profile ID
  instagram_id TEXT,      -- Instagram specific
  access_token_secret TEXT, -- Twitter OAuth 1.0a (legacy)
  username TEXT,          -- Username field
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, platform, account_id)
);
```

### What's Missing for GMB
- `location_id` - Needed for Google Business Profile location
- `location_name` - Needed for display name

### Dual Table Confusion
The codebase uses both:
1. `social_accounts` - Newer table with more fields
2. `social_connections` - Older table, still in use

This dual-table approach is causing confusion and potential data inconsistency.

---

## 🔧 Proposed Solutions

### Priority 1: Fix Google My Business (Immediate)

#### Solution A: Add Missing Columns
```sql
-- Migration: 023_add_gmb_location_columns.sql
ALTER TABLE social_accounts 
ADD COLUMN IF NOT EXISTS location_id TEXT,
ADD COLUMN IF NOT EXISTS location_name TEXT;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_social_accounts_location 
ON social_accounts(location_id) WHERE platform = 'google_my_business';
```

#### Solution B: Use metadata JSONB (Alternative)
```typescript
// Store location data in metadata instead
{
  metadata: {
    location_id: location?.locationId,
    location_name: location?.title,
  }
}
```

### Priority 2: Fix Twitter/X Storage

#### Fix 1: Correct Upsert Conflict
```typescript
// Change from:
onConflict: 'tenant_id,platform'
// To:
onConflict: 'tenant_id,platform,account_id'
```

#### Fix 2: Add Detailed Error Logging
```typescript
if (dbError) {
  console.error('Twitter storage error details:', {
    error: dbError,
    code: dbError.code,
    message: dbError.message,
    details: dbError.details,
    hint: dbError.hint,
    table: 'social_accounts',
    operation: 'upsert'
  });
}
```

#### Fix 3: Ensure Auth Context
```typescript
// Before database operation, verify auth context
const { data: { user } } = await supabase.auth.getUser();
if (!user) {
  // Re-authenticate or handle missing session
}
```

### Priority 3: Enhanced Error Handling

#### For Both Integrations
```typescript
try {
  // Database operation
} catch (error) {
  // Log specific error details
  const errorDetails = {
    platform,
    operation: 'oauth_callback',
    error: error instanceof Error ? {
      message: error.message,
      stack: error.stack,
      name: error.name
    } : error,
    timestamp: new Date().toISOString()
  };
  
  console.error('OAuth callback failed:', errorDetails);
  
  // Return specific error to user
  return NextResponse.redirect(
    `${baseUrl}/settings/connections?error=${
      error.code === '23505' ? 'duplicate_account' :
      error.code === '42703' ? 'schema_error' :
      error.code === '42501' ? 'permission_denied' :
      'storage_failed'
    }&details=${encodeURIComponent(error.message || '')}`
  );
}
```

---

## 🎯 Implementation Plan

### Step 1: Database Migration (5 minutes)
```sql
-- Run in Supabase SQL Editor
ALTER TABLE social_accounts 
ADD COLUMN IF NOT EXISTS location_id TEXT,
ADD COLUMN IF NOT EXISTS location_name TEXT;
```

### Step 2: Fix Twitter Upsert (10 minutes)
- Update conflict resolution in callback
- Add detailed error logging
- Test with actual Twitter account

### Step 3: Test GMB After Migration (5 minutes)
- The GMB integration should work immediately after adding columns
- Test with a Google account that has Business Profile access

### Step 4: Monitor & Iterate
- Watch logs for specific error codes
- Adjust based on actual error messages

---

## 🚨 Critical Findings

1. **GMB will fail 100% of the time** until columns are added
2. **Twitter may be failing** due to incorrect conflict resolution
3. **Both need better error logging** to diagnose issues
4. **RLS policies may need adjustment** for OAuth callbacks

---

## 📝 Questions for Implementation

1. Should we add GMB location columns or use metadata JSONB?
2. Should we consolidate social_accounts and social_connections tables?
3. Do we need to handle multiple locations per GMB account?
4. Should we implement OAuth session persistence between redirect and callback?

---

## 🔍 Testing Checklist

### After Fixes:
- [ ] GMB: Columns added to database
- [ ] GMB: Can connect account without oauth_failed
- [ ] Twitter: Updated conflict resolution
- [ ] Twitter: Can connect account without storage_failed
- [ ] Both: Detailed errors logged to console
- [ ] Both: Accounts appear in Settings → Connections

---

*Analysis complete. The GMB issue is a simple schema fix. The Twitter issue requires conflict resolution adjustment. Both need better error handling.*