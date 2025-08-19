-- Fix missing columns and schema issues
-- Migration: 025_fix_missing_columns.sql

-- Ensure tenant_id exists on campaign_posts (from migration 005)
ALTER TABLE campaign_posts 
ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

-- Ensure is_quick_post exists (from migration 024)
ALTER TABLE campaign_posts 
ADD COLUMN IF NOT EXISTS is_quick_post BOOLEAN DEFAULT false;

-- Ensure platform exists (from migration 024)
ALTER TABLE campaign_posts 
ADD COLUMN IF NOT EXISTS platform TEXT;

-- Ensure selected_timings and custom_dates exist on campaigns (from migration 024)
ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS selected_timings TEXT[] DEFAULT ARRAY['week_before', 'day_before', 'day_of']::TEXT[],
ADD COLUMN IF NOT EXISTS custom_dates TIMESTAMPTZ[] DEFAULT ARRAY[]::TIMESTAMPTZ[];

-- Update tenant_id for existing campaign_posts based on their campaign
UPDATE campaign_posts cp
SET tenant_id = c.tenant_id
FROM campaigns c
WHERE cp.campaign_id = c.id
AND cp.tenant_id IS NULL;

-- Add index for tenant_id if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_campaign_posts_tenant 
ON campaign_posts(tenant_id);

-- Add composite index for calendar queries
CREATE INDEX IF NOT EXISTS idx_campaign_posts_calendar 
ON campaign_posts(tenant_id, scheduled_for)
WHERE status IN ('scheduled', 'published', 'draft');

-- Ensure status column has proper values
ALTER TABLE campaign_posts 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';

-- Update any null status values
UPDATE campaign_posts 
SET status = 'draft' 
WHERE status IS NULL;