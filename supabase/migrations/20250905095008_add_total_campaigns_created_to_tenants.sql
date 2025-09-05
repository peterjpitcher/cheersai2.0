-- Add total_campaigns_created column to tenants table for tracking trial limits
ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS total_campaigns_created INTEGER DEFAULT 0;

-- Update existing tenants with their current campaign count
UPDATE tenants 
SET total_campaigns_created = (
  SELECT COUNT(*) 
  FROM campaigns 
  WHERE campaigns.tenant_id = tenants.id
);

-- Add comment to document the column's purpose
COMMENT ON COLUMN tenants.total_campaigns_created IS 'Total number of campaigns created by this tenant. Used for enforcing trial limits (max 10 campaigns during trial).';