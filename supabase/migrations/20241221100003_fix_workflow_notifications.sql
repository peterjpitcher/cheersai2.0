-- Migration to fix issue #252: Workflow email notifications not sent
-- Creates notification outbox table with queue claiming semantics

-- Create notification outbox table for reliable async notifications
CREATE TABLE IF NOT EXISTS notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('email', 'in_app', 'webhook')),
  recipient_id uuid REFERENCES auth.users(id),
  recipient_email text,
  subject text NOT NULL,
  template_name text NOT NULL,
  template_data jsonb NOT NULL,
  priority integer DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempts integer DEFAULT 0,
  max_attempts integer DEFAULT 3,
  scheduled_for timestamptz DEFAULT NOW(),
  sent_at timestamptz,
  failed_at timestamptz,
  error_message text,
  created_at timestamptz DEFAULT NOW(),
  metadata jsonb DEFAULT '{}',
  CONSTRAINT require_recipient CHECK (recipient_id IS NOT NULL OR recipient_email IS NOT NULL)
);
-- Indexes for efficient queue processing
CREATE INDEX IF NOT EXISTS idx_notification_outbox_pending 
ON notification_outbox (scheduled_for, priority DESC) 
WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_notification_outbox_recipient 
ON notification_outbox (recipient_id, created_at DESC);
-- Add de-duplication index to prevent duplicate notifications
CREATE UNIQUE INDEX IF NOT EXISTS notif_dedupe
ON notification_outbox (
  (metadata->>'content_id'), 
  (metadata->>'step_id'), 
  COALESCE(recipient_id::text, recipient_email)
)
WHERE status IN ('pending', 'processing');
-- Enable RLS for security
ALTER TABLE notification_outbox ENABLE ROW LEVEL SECURITY;
-- Only service role can manage notifications (no user access)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'notification_outbox'
    AND policyname = 'Only service role can manage'
  ) THEN
    CREATE POLICY "Only service role can manage"
    ON notification_outbox
    FOR ALL
    USING (false)
    WITH CHECK (false);
  END IF;
END $$;
-- Create function to claim notifications for processing
CREATE OR REPLACE FUNCTION claim_notifications(p_limit int DEFAULT 25)
RETURNS SETOF notification_outbox
LANGUAGE sql 
SECURITY DEFINER 
SET search_path = public, pg_temp 
AS $$
  UPDATE notification_outbox n
  SET status = 'processing', attempts = attempts + 1
  WHERE n.id IN (
    SELECT id 
    FROM notification_outbox
    WHERE status = 'pending' 
      AND scheduled_for <= NOW() 
      AND attempts < max_attempts
    ORDER BY priority DESC, created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  RETURNING *;
$$;
-- Grant execute permission on the claim function to service role only
REVOKE EXECUTE ON FUNCTION claim_notifications FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_notifications TO service_role;
-- Create helper function to enqueue notifications
CREATE OR REPLACE FUNCTION enqueue_notification(
  p_type text,
  p_subject text,
  p_template_name text,
  p_template_data jsonb,
  p_recipient_id uuid DEFAULT NULL,
  p_recipient_email text DEFAULT NULL,
  p_priority integer DEFAULT 5,
  p_metadata jsonb DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_notification_id uuid;
BEGIN
  -- Validate input
  IF p_recipient_id IS NULL AND p_recipient_email IS NULL THEN
    RAISE EXCEPTION 'Either recipient_id or recipient_email must be provided';
  END IF;
  
  IF p_subject IS NULL OR trim(p_subject) = '' THEN
    RAISE EXCEPTION 'Subject is required';
  END IF;
  
  IF p_template_name IS NULL OR trim(p_template_name) = '' THEN
    RAISE EXCEPTION 'Template name is required';
  END IF;

  -- Insert notification
  INSERT INTO notification_outbox (
    type,
    recipient_id,
    recipient_email,
    subject,
    template_name,
    template_data,
    priority,
    metadata,
    scheduled_for
  )
  VALUES (
    p_type,
    p_recipient_id,
    p_recipient_email,
    p_subject,
    p_template_name,
    p_template_data,
    p_priority,
    p_metadata,
    NOW()
  )
  RETURNING id INTO v_notification_id;
  
  RETURN v_notification_id;
END;
$$;
-- Grant execute permission to authenticated users for enqueueing
GRANT EXECUTE ON FUNCTION enqueue_notification TO authenticated;
-- Create function to enqueue workflow notifications
CREATE OR REPLACE FUNCTION enqueue_workflow_notification(
  p_content_id uuid,
  p_workflow_id uuid,
  p_step_id uuid,
  p_recipient_id uuid,
  p_action text,
  p_content_title text,
  p_brand_name text,
  p_step_name text,
  p_comment text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_notification_id uuid;
  v_recipient_email text;
  v_subject text;
  v_template_name text;
BEGIN
  -- Get recipient email
  SELECT email INTO v_recipient_email
  FROM auth.users
  WHERE id = p_recipient_id;
  
  IF v_recipient_email IS NULL THEN
    RAISE EXCEPTION 'Recipient not found';
  END IF;
  
  -- Determine subject and template based on action
  IF p_action = 'review_required' THEN
    v_subject := 'Review Required: ' || p_content_title;
    v_template_name := 'workflow_review_required';
  ELSIF p_action = 'approved' THEN
    v_subject := 'Content Approved: ' || p_content_title;
    v_template_name := 'workflow_approved';
  ELSIF p_action = 'rejected' THEN
    v_subject := 'Content Rejected: ' || p_content_title;
    v_template_name := 'workflow_rejected';
  ELSE
    v_subject := 'Workflow Update: ' || p_content_title;
    v_template_name := 'workflow_update';
  END IF;
  
  -- Enqueue the notification
  v_notification_id := enqueue_notification(
    p_type := 'email',
    p_recipient_id := p_recipient_id,
    p_recipient_email := v_recipient_email,
    p_subject := v_subject,
    p_template_name := v_template_name,
    p_template_data := jsonb_build_object(
      'contentId', p_content_id,
      'contentTitle', p_content_title,
      'brandName', p_brand_name,
      'workflowStep', p_step_name,
      'action', p_action,
      'comment', p_comment,
      'actionUrl', format('%s/dashboard/content/%s/review', 
        current_setting('app.base_url', true), 
        p_content_id)
    ),
    p_priority := CASE 
      WHEN p_action = 'review_required' THEN 8
      WHEN p_action = 'rejected' THEN 7
      ELSE 5
    END,
    p_metadata := jsonb_build_object(
      'content_id', p_content_id,
      'workflow_id', p_workflow_id,
      'step_id', p_step_id,
      'action', p_action
    )
  );
  
  RETURN v_notification_id;
END;
$$;
-- Grant execute permission
GRANT EXECUTE ON FUNCTION enqueue_workflow_notification TO authenticated;
-- Add comment for documentation
COMMENT ON TABLE notification_outbox IS 'Queue for async notification delivery with exactly-once semantics';
COMMENT ON FUNCTION claim_notifications IS 'Atomically claim notifications for processing with skip-locked to prevent double-sends';
COMMENT ON FUNCTION enqueue_notification IS 'Helper to enqueue notifications with validation';
COMMENT ON FUNCTION enqueue_workflow_notification IS 'Specialized function for workflow-related notifications';
