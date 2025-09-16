-- Fix for Issue #266: Unexpected "Title" field appears in output
-- Make title optional and add configuration to templates

DO $$ 
BEGIN
  -- Add include_title flag to content templates (only if table exists)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'content_templates') THEN
    ALTER TABLE content_templates
    ADD COLUMN IF NOT EXISTS include_title boolean DEFAULT true;
    
    -- Update existing templates to maintain backward compatibility
    UPDATE content_templates 
    SET include_title = true 
    WHERE include_title IS NULL;
    
    -- Add comment for clarity
    COMMENT ON COLUMN content_templates.include_title IS 'Whether to include a title field when creating content from this template';
  END IF;

  -- Make title optional in content table (only if table exists)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'content') THEN
    ALTER TABLE content 
    ALTER COLUMN title DROP NOT NULL;
    
    -- Add comment for clarity
    COMMENT ON COLUMN content.title IS 'Optional title for content, controlled by template.include_title setting';
    
    -- Create index for content without titles (for search fallback)
    CREATE INDEX IF NOT EXISTS idx_content_title_null 
    ON content(id) 
    WHERE title IS NULL;
  END IF;
END $$;
