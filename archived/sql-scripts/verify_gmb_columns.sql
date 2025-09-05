-- Verify GMB columns were added successfully
SELECT 
  column_name, 
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'social_accounts' 
  AND column_name IN ('location_id', 'location_name')
ORDER BY column_name;

-- Check if any GMB connections exist
SELECT 
  platform,
  account_name,
  location_id,
  location_name,
  created_at
FROM social_accounts
WHERE platform = 'google_my_business'
ORDER BY created_at DESC
LIMIT 5;