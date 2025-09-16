-- Migration to fix issue #254: Workflow role assignments not persisting
-- Creates proper relational mapping for workflow step assignments

DO $$
BEGIN
  -- Only create workflow step assignments table if workflow_steps exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workflow_steps') THEN
    -- Create table for workflow step assignments (canonical source of truth)
    CREATE TABLE IF NOT EXISTS workflow_step_assignments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      step_id uuid NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES auth.users(id),
      role text NOT NULL CHECK (role IN ('reviewer', 'approver', 'editor', 'viewer')),
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      UNIQUE (step_id, user_id)
    );
  ELSE
    -- Create table without foreign key constraint if workflow_steps doesn't exist
    CREATE TABLE IF NOT EXISTS workflow_step_assignments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      step_id uuid NOT NULL,
      user_id uuid NOT NULL REFERENCES auth.users(id),
      role text NOT NULL CHECK (role IN ('reviewer', 'approver', 'editor', 'viewer')),
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      UNIQUE (step_id, user_id)
    );
  END IF;
END $$;
-- Create index for efficient queries
CREATE INDEX IF NOT EXISTS idx_workflow_step_assignments_step_id 
ON workflow_step_assignments (step_id);
CREATE INDEX IF NOT EXISTS idx_workflow_step_assignments_user_id 
ON workflow_step_assignments (user_id);
-- Enforce unique step order within a workflow (only if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workflow_steps') THEN
    ALTER TABLE workflow_steps 
    DROP CONSTRAINT IF EXISTS unique_step_order;

    ALTER TABLE workflow_steps 
    ADD CONSTRAINT unique_step_order 
    UNIQUE (workflow_id, order_index);
  END IF;
END $$;
-- Migrate existing data from arrays to relational table if arrays exist
DO $$
DECLARE
  step_record RECORD;
  user_id_val uuid;
  user_index int;
BEGIN
  -- Check if assigned_user_ids column exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'workflow_steps' 
    AND column_name = 'assigned_user_ids'
  ) THEN
    -- Migrate existing assignments
    FOR step_record IN 
      SELECT id as step_id, assigned_user_ids, assigned_roles 
      FROM workflow_steps 
      WHERE assigned_user_ids IS NOT NULL 
        AND array_length(assigned_user_ids, 1) > 0
    LOOP
      -- Process each user assignment
      FOR user_index IN 1..array_length(step_record.assigned_user_ids, 1)
      LOOP
        user_id_val := step_record.assigned_user_ids[user_index];
        
        -- Insert into new table, skip on conflict
        INSERT INTO workflow_step_assignments (step_id, user_id, role)
        VALUES (
          step_record.step_id,
          user_id_val,
          COALESCE(
            step_record.assigned_roles[user_index],
            'reviewer' -- Default role if not specified
          )
        )
        ON CONFLICT (step_id, user_id) DO NOTHING;
      END LOOP;
    END LOOP;
  END IF;
END $$;
-- Update or create the RPC function with proper security
CREATE OR REPLACE FUNCTION create_workflow_and_log_invitations(
  p_brand_id uuid,
  p_workflow_name text,
  p_workflow_description text,
  p_created_by uuid,
  p_workflow_steps jsonb,
  p_template_id uuid DEFAULT NULL,
  p_status text DEFAULT 'active'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_workflow_id uuid;
  v_step record;
  v_step_id uuid;
  v_assignment record;
  v_user_index int;
BEGIN
  -- Validate input
  IF p_workflow_name IS NULL OR trim(p_workflow_name) = '' THEN
    RAISE EXCEPTION 'Workflow name is required';
  END IF;
  
  IF p_brand_id IS NULL THEN
    RAISE EXCEPTION 'Brand ID is required';
  END IF;
  
  IF p_workflow_steps IS NULL OR jsonb_array_length(p_workflow_steps) = 0 THEN
    RAISE EXCEPTION 'At least one workflow step is required';
  END IF;

  -- Start transaction
  BEGIN
    -- Create workflow
    INSERT INTO workflows (
      brand_id, 
      name, 
      description, 
      created_by, 
      template_id, 
      status,
      published_at,
      created_at,
      updated_at
    )
    VALUES (
      p_brand_id, 
      p_workflow_name, 
      p_workflow_description, 
      p_created_by, 
      p_template_id, 
      p_status,
      CASE WHEN p_status = 'active' THEN NOW() ELSE NULL END,
      NOW(),
      NOW()
    )
    RETURNING id INTO v_workflow_id;

    -- Create steps with proper assignments
    FOR v_step IN SELECT * FROM jsonb_array_elements(p_workflow_steps)
    LOOP
      -- Validate step data
      IF v_step.value->>'name' IS NULL THEN
        RAISE EXCEPTION 'Step name is required';
      END IF;
      
      -- Create the step
      INSERT INTO workflow_steps (
        workflow_id,
        name,
        type,
        order_index,
        created_at,
        updated_at
      )
      VALUES (
        v_workflow_id,
        v_step.value->>'name',
        COALESCE(v_step.value->>'type', 'review'),
        COALESCE((v_step.value->>'order')::int, (v_step.value->>'order_index')::int, 0),
        NOW(),
        NOW()
      )
      RETURNING id INTO v_step_id;

      -- Create assignments in the relational table
      IF v_step.value->'assigned_user_ids' IS NOT NULL THEN
        FOR v_user_index IN 0..jsonb_array_length(v_step.value->'assigned_user_ids') - 1
        LOOP
          INSERT INTO workflow_step_assignments (
            step_id,
            user_id,
            role
          )
          VALUES (
            v_step_id,
            (v_step.value->'assigned_user_ids'->>v_user_index)::uuid,
            COALESCE(
              v_step.value->'assigned_roles'->>v_user_index,
              v_step.value->'role_mapping'->>(v_step.value->'assigned_user_ids'->>v_user_index),
              'reviewer' -- Default role
            )::text
          )
          ON CONFLICT (step_id, user_id) DO UPDATE
          SET role = EXCLUDED.role, updated_at = NOW();
        END LOOP;
      END IF;

      -- Log invitations if needed
      IF v_step.value->'assigned_user_ids' IS NOT NULL THEN
        INSERT INTO invitation_logs (
          workflow_step_id,
          user_id,
          invited_at,
          role
        )
        SELECT 
          v_step_id,
          (user_id_text)::uuid,
          NOW(),
          COALESCE(
            v_step.value->'assigned_roles'->>idx::text,
            v_step.value->'role_mapping'->>user_id_text,
            'reviewer'
          )::text
        FROM jsonb_array_elements_text(v_step.value->'assigned_user_ids') 
        WITH ORDINALITY AS t(user_id_text, idx);
      END IF;
    END LOOP;

    RETURN v_workflow_id;
  EXCEPTION
    WHEN OTHERS THEN
      -- Rollback and re-raise with context
      RAISE EXCEPTION 'Failed to create workflow: %', SQLERRM;
  END;
END;
$$;
-- Grant appropriate permissions
GRANT SELECT, INSERT, UPDATE ON workflow_step_assignments TO authenticated;
GRANT EXECUTE ON FUNCTION create_workflow_and_log_invitations TO authenticated;
-- Add RLS policies for workflow_step_assignments (only if supporting tables exist)
DO $$
BEGIN
  ALTER TABLE workflow_step_assignments ENABLE ROW LEVEL SECURITY;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workflow_steps')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workflows')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_brand_permissions') THEN

    -- Create policies with proper table references
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE tablename = 'workflow_step_assignments' 
      AND policyname = 'Users can view assignments for their workflows'
    ) THEN
      CREATE POLICY "Users can view assignments for their workflows"
      ON workflow_step_assignments
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM workflow_steps ws
          JOIN workflows w ON w.id = ws.workflow_id
          JOIN user_brand_permissions ubp ON ubp.brand_id = w.brand_id
          WHERE ws.id = workflow_step_assignments.step_id
          AND ubp.user_id = auth.uid()
        )
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE tablename = 'workflow_step_assignments' 
      AND policyname = 'Users can manage assignments for workflows they admin'
    ) THEN
      CREATE POLICY "Users can manage assignments for workflows they admin"
      ON workflow_step_assignments
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM workflow_steps ws
          JOIN workflows w ON w.id = ws.workflow_id
          JOIN user_brand_permissions ubp ON ubp.brand_id = w.brand_id
          WHERE ws.id = workflow_step_assignments.step_id
          AND ubp.user_id = auth.uid()
          AND ubp.role IN ('admin', 'manager')
        )
      );
    END IF;
  ELSE
    -- Create basic policies without table references if tables don't exist
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE tablename = 'workflow_step_assignments' 
      AND policyname = 'Basic access policy'
    ) THEN
      CREATE POLICY "Basic access policy"
      ON workflow_step_assignments
      FOR ALL
      USING (auth.uid() = user_id);
    END IF;
  END IF;
END $$;
-- Add comment for documentation
COMMENT ON TABLE workflow_step_assignments IS 'Canonical source of user-role assignments for workflow steps';
COMMENT ON FUNCTION create_workflow_and_log_invitations IS 'Atomically creates workflow with steps and assignments';
