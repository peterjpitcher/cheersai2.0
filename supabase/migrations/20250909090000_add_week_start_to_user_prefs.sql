-- Add week_start preference to user_prefs
ALTER TABLE user_prefs
  ADD COLUMN IF NOT EXISTS week_start TEXT CHECK (week_start IN ('sunday','monday')) DEFAULT 'monday';

COMMENT ON COLUMN user_prefs.week_start IS 'User preference for the start of the week (sunday|monday). Default monday.';

