-- Add missing columns to campaigns table that are required by the API

-- Add created_by column to track who created the campaign
ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Add selected_timings column for storing pre-defined posting schedule options
ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS selected_timings TEXT[] DEFAULT '{}';

-- Add custom_dates column for storing custom posting dates
ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS custom_dates TIMESTAMPTZ[] DEFAULT '{}';

-- Add columns that might be missing from other operations
ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS start_date TIMESTAMPTZ;

ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS end_date TIMESTAMPTZ;

ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS platforms TEXT[] DEFAULT '{}';

-- Add comments for documentation
COMMENT ON COLUMN campaigns.created_by IS 'User ID of the campaign creator';
COMMENT ON COLUMN campaigns.selected_timings IS 'Array of selected posting timings like week_before, day_before, etc';
COMMENT ON COLUMN campaigns.custom_dates IS 'Array of custom posting dates selected by the user';
COMMENT ON COLUMN campaigns.platforms IS 'Array of social media platforms this campaign targets';

-- Create index for created_by for better query performance
CREATE INDEX IF NOT EXISTS idx_campaigns_created_by ON campaigns(created_by);

-- Update RLS policy to include created_by check if needed
DROP POLICY IF EXISTS "Users can view campaigns from their tenant" ON campaigns;
CREATE POLICY "Users can view campaigns from their tenant" ON campaigns
    FOR ALL USING (
        tenant_id IN (
            SELECT tenant_id FROM users WHERE users.id = auth.uid()
        )
    );