ALTER TABLE meta_campaigns
  ADD COLUMN IF NOT EXISTS publish_error TEXT;
