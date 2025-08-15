# Onboarding Troubleshooting Guide

## Common Errors and Solutions

### Error: "Onboarding error: {}"

This generic error usually means there's a database issue. Here's how to fix it:

#### 1. Run the Email Migration
The users table needs an email column. Run this SQL in your Supabase SQL editor:

```sql
-- Add email column to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS email TEXT;

-- Make it unique
ALTER TABLE users 
DROP CONSTRAINT IF EXISTS users_email_unique;
ALTER TABLE users 
ADD CONSTRAINT users_email_unique UNIQUE (email);
```

#### 2. Check for Duplicate User Records
If you've tried onboarding before, there might be a duplicate record:

```sql
-- Check if your user already exists
SELECT * FROM users WHERE id = '[YOUR_USER_ID]';

-- If it exists, delete it to retry onboarding
DELETE FROM users WHERE id = '[YOUR_USER_ID]';
```

#### 3. Verify Table Structure
Ensure all required tables exist:

```sql
-- Check tables
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public';

-- Should include: tenants, users, brand_profiles
```

### Error: "An account already exists"

This means you've already completed onboarding. Solutions:

1. **Go directly to dashboard**: Navigate to `/dashboard`
2. **Reset your account** (if testing):
   ```sql
   -- Find your user ID first
   SELECT id FROM auth.users WHERE email = 'your@email.com';
   
   -- Then delete related records (replace USER_ID)
   DELETE FROM brand_profiles WHERE tenant_id IN 
     (SELECT tenant_id FROM users WHERE id = 'USER_ID');
   DELETE FROM users WHERE id = 'USER_ID';
   DELETE FROM tenants WHERE id IN 
     (SELECT tenant_id FROM users WHERE id = 'USER_ID');
   ```

### Error: "Database configuration error"

This indicates missing columns or tables:

1. **Run all migrations** in order:
   - `001_initial_schema.sql`
   - `002_payment_schema.sql`
   - `003_social_integrations.sql`
   - `004_add_email_to_users.sql`

2. **Check RLS policies**:
   ```sql
   -- Ensure RLS is enabled
   ALTER TABLE users ENABLE ROW LEVEL SECURITY;
   ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
   ALTER TABLE brand_profiles ENABLE ROW LEVEL SECURITY;
   ```

### Error: "Email configuration error"

This happens when the email field is missing or null:

1. **Ensure email is captured during signup**
2. **Check auth user**:
   ```sql
   SELECT email FROM auth.users WHERE id = '[YOUR_USER_ID]';
   ```

## Prevention Tips

### Before Onboarding:
1. ✅ Run all database migrations
2. ✅ Enable Row Level Security (RLS)
3. ✅ Clear any test data from previous attempts
4. ✅ Ensure Supabase auth is working (check email confirmations)

### During Development:
1. Use the browser console to see detailed error messages
2. Check Supabase logs: Dashboard → Logs → API
3. Verify your `.env.local` has correct Supabase credentials

### Quick Reset Script:
If you need to completely reset and retry onboarding:

```sql
-- Get your user ID
SELECT id, email FROM auth.users WHERE email = 'your@email.com';

-- Clean up all related data (replace YOUR_USER_ID)
DO $$
DECLARE
  user_id UUID := 'YOUR_USER_ID';
  tenant_id_var UUID;
BEGIN
  -- Get tenant ID if exists
  SELECT tenant_id INTO tenant_id_var FROM users WHERE id = user_id;
  
  -- Delete in correct order
  IF tenant_id_var IS NOT NULL THEN
    DELETE FROM brand_profiles WHERE tenant_id = tenant_id_var;
    DELETE FROM campaign_posts WHERE campaign_id IN 
      (SELECT id FROM campaigns WHERE tenant_id = tenant_id_var);
    DELETE FROM campaigns WHERE tenant_id = tenant_id_var;
    DELETE FROM media_assets WHERE tenant_id = tenant_id_var;
    DELETE FROM social_connections WHERE tenant_id = tenant_id_var;
    DELETE FROM users WHERE tenant_id = tenant_id_var;
    DELETE FROM tenants WHERE id = tenant_id_var;
  END IF;
  
  -- Delete user record if exists without tenant
  DELETE FROM users WHERE id = user_id;
END $$;
```

## Testing Onboarding:

1. **Sign up** with a new email or use existing account
2. **Confirm email** (check spam folder)
3. **Complete onboarding**:
   - Step 1: Choose business type
   - Step 2: Select 1-3 tone attributes
   - Step 3: Enter target audience (or analyze website)
4. **Verify success**: Should redirect to `/dashboard`

## Still Having Issues?

1. Check browser console for detailed errors
2. Look at Network tab for failed API calls
3. Verify Supabase Dashboard → Authentication → Users shows your account
4. Check Supabase Dashboard → Table Editor for data
5. Review server logs: `npm run dev` output