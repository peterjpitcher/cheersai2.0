-- Add email column to users table if it doesn't exist
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS email TEXT;

-- Update the column to be UNIQUE if not already
ALTER TABLE users 
ADD CONSTRAINT users_email_unique UNIQUE (email);

-- Create an index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Update RLS policy to ensure users can see their own email
CREATE POLICY "Users can view own email" ON users
  FOR SELECT TO authenticated
  USING (auth.uid() = id);