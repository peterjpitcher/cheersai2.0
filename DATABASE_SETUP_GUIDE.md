# 🗄️ Database Setup Guide for CheersAI

## ⚠️ IMPORTANT: No Tables Currently Exist!

The database migrations have been created but NOT yet run. You need to execute them to create all required tables.

## 📋 Quick Setup Steps

### Option 1: Manual Setup (Recommended)

1. **Open Supabase Dashboard**
   - Go to your project at https://supabase.com/dashboard
   - Navigate to **SQL Editor**

2. **Run Migrations in Order**
   
   Execute each file in the `supabase/migrations/` folder in this exact order:
   
   ```
   1. 001_initial_schema.sql       - Core tables (tenants, users, campaigns)
   2. 002_row_level_security.sql   - Security policies and helper functions
   3. 003_social_integrations.sql  - Social media connections
   4. 004_add_email_to_users.sql   - Email column for users
   5. 005_missing_tables.sql       - 2FA, teams, analytics, and other missing tables
   ```

3. **How to Run Each Migration**
   - Copy the entire contents of each .sql file
   - Paste into the SQL Editor
   - Click "Run" or press Cmd/Ctrl + Enter
   - Wait for success message before proceeding to next file

### Option 2: Using Supabase CLI (Advanced)

1. **Install Supabase CLI**
   ```bash
   npm install -g supabase
   ```

2. **Link Your Project**
   ```bash
   supabase link --project-ref your-project-ref
   ```

3. **Run Migrations**
   ```bash
   supabase db push
   ```

## 📊 Tables That Will Be Created

### Core Tables
- ✅ **tenants** - Organizations/Pubs
- ✅ **users** - User accounts (extends auth.users)
- ✅ **brand_profiles** - Brand settings and preferences
- ✅ **campaigns** - Marketing campaigns
- ✅ **campaign_posts** - Individual posts for campaigns
- ✅ **media_assets** - Uploaded images and videos

### Authentication & Teams
- ✅ **two_factor_auth** - 2FA settings and backup codes
- ✅ **team_invitations** - Pending team invites
- ✅ **user_tenants** - User-tenant relationships for teams

### Social Media
- ✅ **social_connections** - Connected social accounts (legacy)
- ✅ **social_accounts** - OAuth social media accounts
- ✅ **publishing_queue** - Scheduled posts
- ✅ **publishing_history** - Published post records

### Analytics & Settings
- ✅ **analytics** - Post performance metrics
- ✅ **notification_settings** - User notification preferences
- ✅ **api_usage** - API usage tracking
- ✅ **campaign_templates** - Reusable campaign templates

## 🔍 Verify Setup

After running all migrations, verify the setup:

### 1. Check Tables Exist
In SQL Editor, run:
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;
```

You should see all tables listed above.

### 2. Check RLS is Enabled
```sql
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;
```

All tables should show `rowsecurity = true`.

### 3. Check Helper Functions
```sql
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public';
```

Should include:
- `get_user_tenant_id`
- `update_updated_at_column`

### 4. Test User Creation
```sql
-- This should work after a user signs up
SELECT * FROM auth.users LIMIT 1;
```

## 🚨 Common Issues

### Issue: "Permission denied"
**Solution:** Make sure you're using the service role key or running in Supabase Dashboard

### Issue: "Table already exists"
**Solution:** This is OK - the migrations use `CREATE TABLE IF NOT EXISTS`

### Issue: "Function does not exist"
**Solution:** Make sure to run migrations in order, especially 002_row_level_security.sql

### Issue: Auth not working
**Solution:** 
1. Check that auth.users table exists
2. Verify email confirmation is disabled for testing
3. Ensure middleware is properly configured

## 🧪 Test the Setup

1. **Create a Test User**
   ```typescript
   // In your app or via Supabase Dashboard
   const { data, error } = await supabase.auth.signUp({
     email: 'test@example.com',
     password: 'testpassword123'
   })
   ```

2. **Check User Was Created**
   ```sql
   SELECT * FROM auth.users WHERE email = 'test@example.com';
   SELECT * FROM users WHERE id = (
     SELECT id FROM auth.users WHERE email = 'test@example.com'
   );
   ```

3. **Create a Test Tenant**
   ```sql
   INSERT INTO tenants (name, slug) 
   VALUES ('Test Pub', 'test-pub')
   RETURNING *;
   ```

## 📝 Important Notes

1. **Email Confirmation**: For local development, disable email confirmation in Supabase Dashboard:
   - Go to Authentication → Settings
   - Disable "Enable email confirmations"

2. **RLS Policies**: Row Level Security is enabled on all tables. Make sure users are properly authenticated.

3. **Service Role Key**: Never expose the service role key in client-side code!

4. **Migrations are Idempotent**: You can safely re-run migrations; they check for existing objects.

## 🆘 Need Help?

If you encounter issues:
1. Check Supabase logs in the Dashboard
2. Verify all environment variables are set correctly
3. Ensure you're running migrations in the correct order
4. Check that your Supabase project is active and not paused

---

**Status:** ⚠️ PENDING - Database tables need to be created!
**Priority:** CRITICAL - App won't work without database!
**Next Step:** Run the migrations NOW!