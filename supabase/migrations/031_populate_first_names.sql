-- Populate first_name for existing users who have it in auth metadata but not in users table
UPDATE users u
SET 
  first_name = COALESCE(
    u.first_name,
    (auth.users.raw_user_meta_data->>'first_name')::text,
    split_part(u.full_name, ' ', 1),
    split_part(u.email, '@', 1)
  ),
  last_name = COALESCE(
    u.last_name,
    (auth.users.raw_user_meta_data->>'last_name')::text,
    CASE 
      WHEN position(' ' in u.full_name) > 0 THEN
        substring(u.full_name from position(' ' in u.full_name) + 1)
      ELSE NULL
    END
  )
FROM auth.users
WHERE u.id = auth.users.id
  AND (u.first_name IS NULL OR u.first_name = '');

-- Also update any users who have 'User' as their first_name to use their actual name
UPDATE users u
SET 
  first_name = COALESCE(
    NULLIF((auth.users.raw_user_meta_data->>'first_name')::text, ''),
    NULLIF(split_part(u.full_name, ' ', 1), ''),
    split_part(u.email, '@', 1)
  )
FROM auth.users
WHERE u.id = auth.users.id
  AND u.first_name = 'User';