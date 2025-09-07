-- Extend brand_profiles with business details for onboarding
ALTER TABLE public.brand_profiles
  ADD COLUMN IF NOT EXISTS phone_e164 TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_e164 TEXT,
  ADD COLUMN IF NOT EXISTS website_url TEXT,
  ADD COLUMN IF NOT EXISTS booking_url TEXT,
  ADD COLUMN IF NOT EXISTS menu_food_url TEXT,
  ADD COLUMN IF NOT EXISTS menu_drink_url TEXT,
  ADD COLUMN IF NOT EXISTS serves_food BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS serves_drinks BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS opening_hours JSONB,
  ADD COLUMN IF NOT EXISTS address JSONB;

COMMENT ON COLUMN public.brand_profiles.phone_e164 IS 'Primary phone in E.164 format (e.g., +447700900123)';
COMMENT ON COLUMN public.brand_profiles.whatsapp_e164 IS 'WhatsApp phone in E.164 format if enabled';
COMMENT ON COLUMN public.brand_profiles.opening_hours IS 'Structured opening hours per day and exceptions';
COMMENT ON COLUMN public.brand_profiles.address IS 'Postal address object with fields like line1, city, postcode, country';

