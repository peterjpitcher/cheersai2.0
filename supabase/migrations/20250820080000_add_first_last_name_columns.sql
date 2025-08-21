-- Add first_name and last_name columns to users table
ALTER TABLE users 
ADD COLUMN first_name TEXT,
ADD COLUMN last_name TEXT;

-- Create index for first_name for efficient queries
CREATE INDEX idx_users_first_name ON users(first_name);

-- Update existing users that have full_name to split it
UPDATE users 
SET 
  first_name = CASE 
    WHEN full_name IS NOT NULL AND trim(full_name) != '' THEN
      trim(split_part(full_name, ' ', 1))
    ELSE NULL
  END,
  last_name = CASE 
    WHEN full_name IS NOT NULL AND trim(full_name) != '' AND position(' ' in full_name) > 0 THEN
      trim(substring(full_name from position(' ' in full_name) + 1))
    ELSE NULL
  END
WHERE full_name IS NOT NULL AND trim(full_name) != '';