-- Add whitelabel configuration for enterprise tenants
ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS whitelabel_config JSONB;

-- Add comment
COMMENT ON COLUMN tenants.whitelabel_config IS 'Whitelabel branding configuration for enterprise tier - includes brand_name, logo_url, primary_color';

-- Example whitelabel config structure:
-- {
--   "brand_name": "Custom Brand",
--   "logo_url": "https://example.com/logo.png",
--   "primary_color": "#FF5733",
--   "support_email": "support@example.com",
--   "footer_text": "© 2024 Custom Brand"
-- }