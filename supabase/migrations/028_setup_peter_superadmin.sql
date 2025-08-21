-- Direct setup for peter.pitcher@outlook.com as superadmin
-- Run this in Supabase SQL Editor

-- 1. First confirm the email in auth.users
UPDATE auth.users 
SET 
  email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
  updated_at = NOW()
WHERE id = 'e64eef91-693b-4a09-99b0-82fe2989e0db';

-- 2. Create profile with tenant
DO $$
DECLARE
  v_user_id UUID := 'e64eef91-693b-4a09-99b0-82fe2989e0db';
  v_tenant_id UUID;
BEGIN
  -- Create a tenant for the superadmin if doesn't exist
  INSERT INTO tenants (
    name, 
    slug,
    subscription_tier, 
    subscription_status,
    trial_ends_at
  )
  VALUES (
    'Superadmin Tenant', 
    'superadmin-tenant',
    'pro', 
    'active',
    NOW() + INTERVAL '10 years'  -- Long trial for superadmin
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id INTO v_tenant_id;
  
  -- If no new tenant was created, get existing one
  IF v_tenant_id IS NULL THEN
    SELECT id INTO v_tenant_id 
    FROM tenants 
    WHERE slug = 'superadmin-tenant'
    LIMIT 1;
  END IF;
  
  -- Create or update user profile
  INSERT INTO users (
    id, 
    email, 
    full_name,
    tenant_id,
    role,
    is_superadmin,
    created_at,
    updated_at
  )
  VALUES (
    v_user_id,
    'peter.pitcher@outlook.com',
    'Peter Pitcher',
    v_tenant_id,
    'owner',
    true,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE
  SET 
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    tenant_id = COALESCE(users.tenant_id, EXCLUDED.tenant_id),
    role = 'owner',
    is_superadmin = true,
    updated_at = NOW();
    
  -- Update auth.users metadata to include tenant_id
  UPDATE auth.users
  SET raw_app_meta_data = jsonb_set(
    COALESCE(raw_app_meta_data, '{}'::jsonb),
    '{tenant_id}',
    to_jsonb(v_tenant_id)
  )
  WHERE id = v_user_id;
  
  RAISE NOTICE 'Successfully set up peter.pitcher@outlook.com as superadmin';
  RAISE NOTICE 'User ID: %', v_user_id;
  RAISE NOTICE 'Tenant ID: %', v_tenant_id;
END $$;

-- 3. Verify the setup
SELECT 
  u.id,
  u.email,
  u.full_name,
  u.is_superadmin,
  u.role,
  t.name as tenant_name,
  t.slug as tenant_slug,
  au.email_confirmed_at,
  au.confirmed_at
FROM users u
JOIN tenants t ON t.id = u.tenant_id
JOIN auth.users au ON au.id = u.id
WHERE u.id = 'e64eef91-693b-4a09-99b0-82fe2989e0db';