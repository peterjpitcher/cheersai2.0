-- Add alcohol_free flag to tenants for global suppression of alcohol-related inspiration where needed

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS alcohol_free BOOLEAN NOT NULL DEFAULT false;

-- No RLS policy change required; existing tenant read policies apply

