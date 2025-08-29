-- Add brand_voice text column to replace tone_attributes array
-- This allows for free-form brand voice descriptions that can be fine-tuned

-- Add the new brand_voice column
ALTER TABLE brand_profiles 
ADD COLUMN IF NOT EXISTS brand_voice TEXT;

-- Migrate existing tone_attributes to brand_voice if any exist
-- This converts the array of attributes into a descriptive sentence
UPDATE brand_profiles 
SET brand_voice = CASE 
  WHEN tone_attributes IS NOT NULL AND array_length(tone_attributes, 1) > 0 THEN
    'Our brand voice is ' || array_to_string(tone_attributes, ', ', 'and ') || '. We communicate in a way that reflects these values and creates a welcoming atmosphere for our guests.'
  ELSE 
    NULL
END
WHERE brand_voice IS NULL AND tone_attributes IS NOT NULL;

-- Comment on the new column
COMMENT ON COLUMN brand_profiles.brand_voice IS 'Free-form text description of the brand voice and communication style, allowing for fine-tuning and detailed customization';

-- Note: We're keeping tone_attributes for backward compatibility
-- It can be removed in a future migration once all code is updated