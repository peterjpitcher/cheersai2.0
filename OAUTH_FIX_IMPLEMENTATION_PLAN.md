# OAuth Integration Fix - Implementation Plan

## Confirmed Issues

### 🐦 Twitter/X: Incorrect Upsert Conflict Resolution
**File**: `/app/api/auth/twitter/callback/route.ts`
**Line**: 113

**Current (WRONG)**:
```typescript
onConflict: 'tenant_id,platform'
```

**Required (based on table constraint)**:
```typescript
onConflict: 'tenant_id,platform,account_id'
```

**Why it fails**: The table has `UNIQUE(tenant_id, platform, account_id)` but we're only specifying two columns for conflict resolution.

### 🗺️ Google My Business: Missing Database Columns
**File**: `/app/api/auth/google-my-business/callback/route.ts`
**Lines**: 96-97

**Attempting to insert**:
```typescript
location_id: location?.locationId,    // Column doesn't exist
location_name: location?.title,       // Column doesn't exist
```

**Why it fails**: These columns don't exist in the social_accounts table.

---

## Implementation Steps

### Step 1: Fix Database Schema for GMB

```sql
-- Run this in Supabase SQL Editor immediately
ALTER TABLE social_accounts 
ADD COLUMN IF NOT EXISTS location_id TEXT,
ADD COLUMN IF NOT EXISTS location_name TEXT;

-- Verify columns were added
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'social_accounts' 
AND column_name IN ('location_id', 'location_name');
```

### Step 2: Fix Twitter Upsert Conflict

**File to update**: `/app/api/auth/twitter/callback/route.ts`

**Change line 113 from**:
```typescript
onConflict: 'tenant_id,platform',
```

**To**:
```typescript
onConflict: 'tenant_id,platform,account_id',
```

**Also update line 127 (social_connections) from**:
```typescript
onConflict: 'tenant_id,platform',
```

**To**:
```typescript
onConflict: 'tenant_id,platform,account_id',
```

### Step 3: Fix GMB Upsert Conflict

**File to update**: `/app/api/auth/google-my-business/callback/route.ts`

**Change line 103 from**:
```typescript
onConflict: 'tenant_id,platform',
```

**To**:
```typescript
onConflict: 'tenant_id,platform,account_id',
```

### Step 4: Add Better Error Logging

**For Twitter** (`/app/api/auth/twitter/callback/route.ts`), replace line 131:
```typescript
// OLD
console.error('Error storing Twitter connection:', dbError);

// NEW
console.error('Error storing Twitter connection:', {
  error: dbError,
  code: dbError.code,
  message: dbError.message,
  details: dbError.details,
  hint: dbError.hint,
  constraint: dbError.constraint,
  table: 'social_accounts'
});
```

**For GMB** (`/app/api/auth/google-my-business/callback/route.ts`), replace line 108:
```typescript
// OLD
console.error('Error storing Google My Business connection:', dbError);

// NEW
console.error('Error storing Google My Business connection:', {
  error: dbError,
  code: dbError.code,
  message: dbError.message,
  details: dbError.details,
  hint: dbError.hint,
  constraint: dbError.constraint,
  table: 'social_accounts'
});
```

---

## Testing Plan

### Test Twitter/X:
1. Apply the upsert conflict fix
2. Go to Settings → Connections
3. Click Connect for Twitter/X
4. Complete OAuth flow
5. Should redirect with success

### Test Google My Business:
1. Run the ALTER TABLE SQL first
2. Apply the upsert conflict fix
3. Go to Settings → Connections
4. Click Connect for Google My Business
5. Complete OAuth flow
6. Should redirect with success

---

## Why These Fixes Will Work

### Twitter/X Fix:
- The unique constraint requires all three columns (tenant_id, platform, account_id)
- By providing all three in onConflict, Supabase can properly handle updates
- This allows reconnecting the same Twitter account without errors

### GMB Fix:
- Adding the missing columns eliminates the "column does not exist" error
- Fixing the onConflict ensures proper upsert behavior
- The OAuth flow is working correctly, only the storage was failing

---

## Immediate Actions

1. **Run the SQL migration first** (GMB will work immediately after)
2. **Update the code files** with conflict fixes
3. **Test both integrations**
4. **Monitor logs** for any remaining issues

---

## Success Criteria

- ✅ Twitter connection saves without storage_failed
- ✅ GMB connection saves without oauth_failed
- ✅ Both accounts appear in Settings → Connections
- ✅ Can reconnect same accounts without errors
- ✅ Detailed error logging shows specific issues if any remain

---

*These are surgical fixes targeting the exact issues identified. The OAuth flows are working correctly; only the database operations were failing.*