-- Fix for Issue #262: Workflow Status Inconsistency (Active vs Draft)
-- Ensures status is properly persisted and tracked

-- Create enum for workflow status if not exists
DO $$ BEGIN
  CREATE TYPE workflow_status AS ENUM ('draft', 'active', 'archived');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
-- Add status column with proper type (only if workflows table exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workflows') THEN
    -- Check if status column exists and is correct type
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'workflows' 
      AND column_name = 'status'
      AND data_type != 'USER-DEFINED'
    ) THEN
      -- Migrate existing text column to enum
      ALTER TABLE workflows 
      ALTER COLUMN status TYPE workflow_status 
      USING status::workflow_status;
    ELSIF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'workflows' 
      AND column_name = 'status'
    ) THEN
      -- Add column if it doesn't exist
      ALTER TABLE workflows 
      ADD COLUMN status workflow_status DEFAULT 'draft';
    END IF;
    
    -- Add published_at timestamp to track when workflow becomes active
    ALTER TABLE workflows
    ADD COLUMN IF NOT EXISTS published_at timestamptz;
  END IF;
END $$;
-- Create trigger to set published_at when status changes to active
CREATE OR REPLACE FUNCTION update_workflow_published_at()
RETURNS TRIGGER AS $$
BEGIN
  -- Set published_at when transitioning to active
  IF NEW.status = 'active' AND (OLD.status IS NULL OR OLD.status != 'active') THEN
    NEW.published_at = NOW();
  -- Clear published_at when transitioning away from active
  ELSIF NEW.status != 'active' AND OLD.status = 'active' THEN
    NEW.published_at = NULL;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Create trigger only if workflows table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workflows') THEN
    -- Drop trigger if exists and recreate
    DROP TRIGGER IF EXISTS workflow_status_change ON workflows;
    CREATE TRIGGER workflow_status_change
      BEFORE INSERT OR UPDATE OF status ON workflows
      FOR EACH ROW
      EXECUTE FUNCTION update_workflow_published_at();

    -- Update existing workflows to set published_at for active ones
    UPDATE workflows 
    SET published_at = updated_at 
    WHERE status = 'active' 
    AND published_at IS NULL;

    -- Add index for status queries
    CREATE INDEX IF NOT EXISTS idx_workflows_status 
    ON workflows(status) 
    WHERE status != 'draft';

    -- Add index for published workflows
    CREATE INDEX IF NOT EXISTS idx_workflows_published 
    ON workflows(published_at DESC) 
    WHERE published_at IS NOT NULL;
  END IF;
END $$;
-- Add comment for clarity (only if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workflows') THEN
    COMMENT ON COLUMN workflows.status IS 'Workflow status: draft (editing), active (published), archived (hidden)';
    COMMENT ON COLUMN workflows.published_at IS 'Timestamp when workflow was last published (status set to active)';
  END IF;
END $$;
