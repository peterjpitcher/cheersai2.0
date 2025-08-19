-- Add missing columns for Google My Business integration
-- These columns are needed to store GMB location information

ALTER TABLE social_accounts 
ADD COLUMN IF NOT EXISTS location_id TEXT,
ADD COLUMN IF NOT EXISTS location_name TEXT;

-- Add index for performance when querying GMB locations
CREATE INDEX IF NOT EXISTS idx_social_accounts_location 
ON social_accounts(location_id) 
WHERE platform = 'google_my_business';

-- Add comment to document the columns
COMMENT ON COLUMN social_accounts.location_id IS 'Google My Business location ID';
COMMENT ON COLUMN social_accounts.location_name IS 'Google My Business location name/title';