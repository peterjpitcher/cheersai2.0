# Issues Log - August 23, 2025

## Critical Issues

### 1. Campaign Creation Failure - No Tenant Error
**Severity:** Critical
**Location:** `/campaigns/new` page
**Error Message:** `Error creating campaign: Error: No tenant`
**Stack Trace:** `page-37238114dc1e8cd7.js:1:6630`

**Description:** 
The campaign creation process is failing because the tenant information is not being properly retrieved or associated with the user session.

**Root Cause:**
The error occurs when trying to fetch user tenant information, which returns a 400 Bad Request:
```
GET https://onvnfijtzumtnmgwhiaq.supabase.co/rest/v1/users?select=tenant_id%2Ctenant%3Atenants%28subscription_tier%2Csubscription_status%2Ctotal_campaigns_created%29&id=eq.8f13a521-4e46-4d5a-8bdd-0f2e2db17d08 400 (Bad Request)
```

**Impact:** Users cannot create new campaigns, which is a core feature of the application.

**Potential Fix:**
1. Check if the user has a properly associated tenant_id in the database
2. Verify the RLS policies for the users and tenants tables
3. Ensure the query syntax for nested relations is correct
4. Add proper error handling and tenant validation before campaign creation

---

### 2. Supabase Query Syntax Error
**Severity:** High
**Location:** API call from campaign creation page
**Error:** 400 Bad Request on user tenant fetch

**Description:**
The nested query to fetch user tenant information is failing, likely due to incorrect syntax or missing permissions.

**Query Being Attempted:**
```sql
select=tenant_id,tenant:tenants(subscription_tier,subscription_status,total_campaigns_created)
```

**Potential Issues:**
1. The nested relation syntax might be incorrect
2. RLS policies might be blocking the nested query
3. The `total_campaigns_created` field might not exist in the tenants table

**Recommended Fix:**
1. Verify the tenants table schema has all required fields
2. Check if the nested query syntax should use `!inner` or different join syntax
3. Test the query directly in Supabase SQL editor
4. Consider splitting into separate queries if nested query continues to fail

---

## Minor Issues

### 3. Font Preload Warning
**Severity:** Low
**Location:** All pages
**Warning:** Font resource preloaded but not used within load event

**Description:**
A font file is being preloaded but not utilized quickly enough, causing a performance warning.

**File:** `e4af272ccee01ff0-s.p.woff2`

**Impact:** Minor performance impact, no functional issues

**Recommended Fix:**
1. Review font loading strategy
2. Either remove preload if font is not critical, or ensure it's used immediately
3. Check if the `as` attribute is correctly set to "font" in the preload link

---

## Informational Logs

### 4. Successful Data Fetching
**Status:** Working correctly
**Components:** Calendar widget, Campaign posts, Campaigns list

**Successful Operations:**
- Campaign posts fetched: 19 items
- Campaigns fetched: 3 items
- Calendar widget properly displaying August 2025 data

These logs indicate that the basic data fetching for existing campaigns and posts is working correctly.

---

## Priority Action Items

1. **IMMEDIATE:** Fix tenant association issue preventing campaign creation
2. **HIGH:** Resolve Supabase nested query syntax error
3. **LOW:** Optimize font preloading strategy

## Testing Recommendations

1. Verify user-tenant associations in the database:
```sql
SELECT u.id, u.email, u.tenant_id, t.* 
FROM users u 
LEFT JOIN tenants t ON u.tenant_id = t.id 
WHERE u.id = '8f13a521-4e46-4d5a-8bdd-0f2e2db17d08';
```

2. Test the nested query directly in Supabase:
```sql
SELECT 
  tenant_id,
  tenants.subscription_tier,
  tenants.subscription_status,
  tenants.total_campaigns_created
FROM users
LEFT JOIN tenants ON users.tenant_id = tenants.id
WHERE users.id = '8f13a521-4e46-4d5a-8bdd-0f2e2db17d08';
```

3. Check if `total_campaigns_created` field exists in tenants table

## Next Steps

1. Investigate the database schema and verify all required fields exist
2. Review and fix the API query syntax for fetching user tenant data
3. Add proper error handling and fallback mechanisms
4. Implement tenant validation before allowing campaign creation
5. Add logging to track tenant association issues