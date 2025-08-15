# Supabase Authentication Setup Guide

## Important Configuration Steps

### 1. Update Your Supabase Project Settings

Go to your Supabase Dashboard → Authentication → URL Configuration and set:

- **Site URL**: `http://localhost:3000` (or your production URL)
- **Redirect URLs** (add all of these):
  - `http://localhost:3000/auth/callback`
  - `http://localhost:3001/auth/callback`
  - `http://localhost:3002/auth/callback`
  - `http://localhost:3003/auth/callback`
  - `http://localhost:3004/auth/callback`
  - Your production URL + `/auth/callback`

### 2. Email Templates

Go to Authentication → Email Templates and ensure:

1. **Confirm signup** template uses:
   ```
   {{ .ConfirmationURL }}
   ```
   
2. **Magic Link** template uses:
   ```
   {{ .ConfirmationURL }}
   ```

3. **Reset Password** template uses:
   ```
   {{ .ConfirmationURL }}
   ```

### 3. Authentication Flow

The app handles multiple authentication scenarios:

1. **Email Confirmation** (after signup):
   - User signs up → Email sent with confirmation link
   - Link format: `/auth/callback?code=XXX&type=signup`
   - After confirmation → Redirects to `/auth/confirm` → Then to login

2. **Magic Link Login**:
   - User requests magic link → Email sent
   - Link format: `/auth/callback?code=XXX` or `/auth/callback?token_hash=XXX&type=magiclink`
   - After verification → Redirects to dashboard or onboarding

3. **Password Login**:
   - Direct login → Creates session → Redirects to dashboard

### 4. Common Issues and Solutions

#### Issue: "Authentication Error" after clicking email link
**Solutions**:
1. Check that your Supabase URL in `.env.local` is correct:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://[YOUR-PROJECT-ID].supabase.co
   ```
   NOT the dashboard URL!

2. Ensure redirect URLs are configured in Supabase Dashboard

3. Check browser console for specific error messages

#### Issue: Email not received
**Solutions**:
1. Check spam folder
2. In Supabase Dashboard → Authentication → Settings:
   - Enable "Email Confirmations"
   - Check SMTP settings if using custom SMTP

#### Issue: User can't access dashboard after login
**Solutions**:
1. Check if user record exists in `users` table
2. Ensure RLS policies are correctly set up
3. Run database migrations if not already done

### 5. Testing Authentication

1. **Test Signup**:
   ```bash
   # Sign up with a real email
   # Check email for confirmation
   # Click link → Should go to /auth/confirm
   # Then login → Should go to onboarding (first time) or dashboard
   ```

2. **Test Magic Link**:
   ```bash
   # Go to login page
   # Enter email only
   # Click "Send magic link"
   # Check email and click link
   # Should go directly to dashboard
   ```

3. **Test Password Login**:
   ```bash
   # Use existing account
   # Enter email and password
   # Should go directly to dashboard
   ```

### 6. Database Setup

Ensure these tables exist in your Supabase project:

```sql
-- Run these in SQL Editor in Supabase Dashboard

-- Users table (if not exists)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  tenant_id UUID REFERENCES tenants(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Tenants table (if not exists)
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  subscription_status TEXT DEFAULT 'trial',
  subscription_tier TEXT DEFAULT 'free',
  trial_ends_at TIMESTAMPTZ DEFAULT (now() + interval '14 days'),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can read own data" ON users
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own data" ON users
  FOR UPDATE TO authenticated
  USING (auth.uid() = id);
```

### 7. Environment Variables

Ensure your `.env.local` has:

```env
# Correct format - use your actual project values
NEXT_PUBLIC_SUPABASE_URL=https://[YOUR-PROJECT-ID].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[YOUR-ANON-KEY]
SUPABASE_SERVICE_ROLE_KEY=[YOUR-SERVICE-ROLE-KEY]
```

Find these in Supabase Dashboard → Settings → API.

### 8. Production Deployment

When deploying to production:

1. Update Supabase URL Configuration with production URLs
2. Set environment variables in your hosting platform
3. Ensure all redirect URLs are whitelisted
4. Test authentication flow in production environment