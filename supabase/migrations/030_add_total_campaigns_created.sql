-- Add total_campaigns_created column to track lifetime campaigns for trial limits
ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS total_campaigns_created INTEGER DEFAULT 0;

-- Initialize the column with current campaign count
UPDATE tenants 
SET total_campaigns_created = (
  SELECT COUNT(*) 
  FROM campaigns 
  WHERE tenant_id = tenants.id
);

-- Create a trigger to increment the counter when a campaign is created
CREATE OR REPLACE FUNCTION increment_campaign_counter()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE tenants 
  SET total_campaigns_created = total_campaigns_created + 1
  WHERE id = NEW.tenant_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop the trigger if it exists
DROP TRIGGER IF EXISTS increment_campaign_counter_trigger ON campaigns;

-- Create the trigger
CREATE TRIGGER increment_campaign_counter_trigger
AFTER INSERT ON campaigns
FOR EACH ROW
EXECUTE FUNCTION increment_campaign_counter();

-- Add index for efficient queries
CREATE INDEX IF NOT EXISTS idx_tenants_total_campaigns ON tenants(total_campaigns_created);