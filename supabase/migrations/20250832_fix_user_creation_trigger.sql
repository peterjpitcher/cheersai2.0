-- =====================================================
-- FIX USER CREATION ON SIGNUP
-- Ensures users table is populated when auth.users is created
-- =====================================================

-- Create function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert a new user record when someone signs up
  -- tenant_id will be NULL initially and set during onboarding
  INSERT INTO public.users (
    id,
    email,
    full_name,
    first_name,
    last_name,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'first_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    -- Update if the record already exists (shouldn't happen but safe guard)
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, users.full_name),
    first_name = COALESCE(EXCLUDED.first_name, users.first_name),
    last_name = COALESCE(EXCLUDED.last_name, users.last_name),
    updated_at = NOW()
  WHERE users.tenant_id IS NULL; -- Only update if no tenant is set yet
  
  RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger for new user signups
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON public.users TO authenticated;

-- Add helpful comment
COMMENT ON FUNCTION public.handle_new_user() IS 'Automatically creates a users table record when someone signs up via Supabase Auth';

-- Fix any existing users who might not have records
-- This will create records for any auth users who don't have a corresponding users table entry
INSERT INTO public.users (id, email, full_name, first_name, last_name)
SELECT 
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data->>'full_name', au.email),
  COALESCE(au.raw_user_meta_data->>'first_name', split_part(au.email, '@', 1)),
  COALESCE(au.raw_user_meta_data->>'last_name', '')
FROM auth.users au
LEFT JOIN public.users u ON au.id = u.id
WHERE u.id IS NULL;

-- Verify the fix worked
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM auth.users au
  LEFT JOIN public.users u ON au.id = u.id
  WHERE u.id IS NULL;
  
  IF orphan_count > 0 THEN
    RAISE NOTICE 'WARNING: There are still % auth users without user records', orphan_count;
  ELSE
    RAISE NOTICE 'SUCCESS: All auth users have corresponding user records';
  END IF;
END $$;