-- Create table for storing tenant logos
CREATE TABLE IF NOT EXISTS tenant_logos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  logo_type VARCHAR(50) NOT NULL DEFAULT 'default', -- 'default', 'black', 'white', 'color'
  file_url TEXT NOT NULL,
  file_name TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create table for watermark settings
CREATE TABLE IF NOT EXISTS watermark_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL UNIQUE,
  enabled BOOLEAN DEFAULT false,
  position VARCHAR(20) DEFAULT 'bottom-right', -- 'top-left', 'top-right', 'bottom-left', 'bottom-right'
  opacity DECIMAL(3,2) DEFAULT 0.8,
  size_percent INTEGER DEFAULT 15, -- Logo size as percentage of image width
  margin_pixels INTEGER DEFAULT 20,
  auto_apply BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add watermark columns to media_assets
ALTER TABLE media_assets 
ADD COLUMN IF NOT EXISTS has_watermark BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS watermark_position VARCHAR(20),
ADD COLUMN IF NOT EXISTS original_url TEXT;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_tenant_logos_tenant ON tenant_logos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_logos_active ON tenant_logos(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_watermark_settings_tenant ON watermark_settings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_watermark ON media_assets(has_watermark) WHERE has_watermark = true;

-- Enable RLS
ALTER TABLE tenant_logos ENABLE ROW LEVEL SECURITY;
ALTER TABLE watermark_settings ENABLE ROW LEVEL SECURITY;

-- RLS policies for tenant_logos
CREATE POLICY "Users can view their tenant logos" ON tenant_logos
  FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  ));

CREATE POLICY "Users can upload logos for their tenant" ON tenant_logos
  FOR INSERT
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  ));

CREATE POLICY "Users can update their tenant logos" ON tenant_logos
  FOR UPDATE
  USING (tenant_id IN (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  ));

CREATE POLICY "Users can delete their tenant logos" ON tenant_logos
  FOR DELETE
  USING (tenant_id IN (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  ));

-- RLS policies for watermark_settings
CREATE POLICY "Users can view their watermark settings" ON watermark_settings
  FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  ));

CREATE POLICY "Users can manage their watermark settings" ON watermark_settings
  FOR ALL
  USING (tenant_id IN (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  ))
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  ));

-- Add comments
COMMENT ON TABLE tenant_logos IS 'Stores logo variants for each tenant';
COMMENT ON TABLE watermark_settings IS 'Stores watermark preferences for each tenant';
COMMENT ON COLUMN tenant_logos.logo_type IS 'Type of logo: default, black, white, or color variant';
COMMENT ON COLUMN watermark_settings.position IS 'Corner position for watermark placement';
COMMENT ON COLUMN watermark_settings.size_percent IS 'Logo size as percentage of image width';