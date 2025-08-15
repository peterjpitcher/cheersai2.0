-- =====================================================
-- Add Global Content Generation Settings for Superadmin
-- =====================================================

-- Create a table for global content generation settings
CREATE TABLE IF NOT EXISTS global_content_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    setting_key VARCHAR(255) UNIQUE NOT NULL,
    setting_value TEXT,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT now(),
    updated_by UUID REFERENCES auth.users(id)
);

-- Insert default global content instructions
INSERT INTO global_content_settings (setting_key, setting_value, description)
VALUES 
    ('content_guidelines', 
     E'- Always maintain a friendly and welcoming tone\n- Use British English spelling and grammar\n- Include relevant emojis but don''t overuse them\n- Keep posts concise and engaging\n- Focus on community and local connections\n- Avoid controversial topics\n- Highlight unique selling points\n- Include clear calls-to-action',
     'Global content generation guidelines for all AI-generated posts'),
    
    ('prohibited_content',
     E'- Political statements or endorsements\n- Discriminatory language or content\n- Excessive alcohol promotion without responsibility messaging\n- False or misleading claims\n- Competitor bashing\n- Personal information of staff or customers',
     'Content that should never be included in generated posts'),
     
    ('brand_voice_defaults',
     E'{"tone": ["friendly", "welcoming", "community-focused"], "style": "conversational", "formality": "casual-professional"}',
     'Default brand voice settings when not specified by tenant'),
     
    ('posting_best_practices',
     E'- Best times: Lunch (12-2pm) and Evening (5-8pm)\n- Include location tags when relevant\n- Use high-quality images\n- Respond to comments within 24 hours\n- Cross-promote events across platforms\n- Schedule posts at least 1 week in advance',
     'Best practices for social media posting'),
     
    ('compliance_requirements',
     E'- Include "Please drink responsibly" for alcohol promotions\n- Add allergen information for food posts\n- Include age restrictions where applicable (18+/21+)\n- Follow ASA guidelines for promotions\n- Comply with GDPR for customer data',
     'Legal and compliance requirements for content');

-- Create RLS policies for global_content_settings
ALTER TABLE global_content_settings ENABLE ROW LEVEL SECURITY;

-- Only superadmins can modify, everyone can read
CREATE POLICY "global_content_settings_read_all"
    ON global_content_settings
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "global_content_settings_modify_superadmin"
    ON global_content_settings
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() 
            AND role = 'superadmin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() 
            AND role = 'superadmin'
        )
    );

-- Add superadmin role to users table if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type 
        WHERE typname = 'user_role'
    ) THEN
        CREATE TYPE user_role AS ENUM ('owner', 'admin', 'member', 'viewer', 'superadmin');
    ELSE
        -- Add superadmin to existing enum if not present
        ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'superadmin';
    END IF;
END $$;

-- Create function to get global content instructions
CREATE OR REPLACE FUNCTION get_global_content_instructions()
RETURNS jsonb AS $$
DECLARE
    instructions jsonb;
BEGIN
    SELECT jsonb_object_agg(setting_key, setting_value)
    INTO instructions
    FROM global_content_settings
    WHERE setting_key IN ('content_guidelines', 'prohibited_content', 'brand_voice_defaults');
    
    RETURN COALESCE(instructions, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- VERIFICATION
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '🎯 GLOBAL CONTENT SETTINGS CREATED';
    RAISE NOTICE '==================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Features added:';
    RAISE NOTICE '  ✅ Global content generation guidelines';
    RAISE NOTICE '  ✅ Prohibited content list';
    RAISE NOTICE '  ✅ Default brand voice settings';
    RAISE NOTICE '  ✅ Posting best practices';
    RAISE NOTICE '  ✅ Compliance requirements';
    RAISE NOTICE '  ✅ Superadmin role for management';
    RAISE NOTICE '';
    RAISE NOTICE '📝 Superadmins can modify via Settings > Content Guidelines';
    RAISE NOTICE '';
END $$;