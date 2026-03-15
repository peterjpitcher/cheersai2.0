ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS publish_error TEXT;
