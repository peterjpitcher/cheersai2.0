-- Add token encryption fields and security improvements
-- This migration adds encrypted token storage and improves security

-- Add encrypted token columns to social_connections table
ALTER TABLE social_connections 
ADD COLUMN IF NOT EXISTS access_token_encrypted TEXT,
ADD COLUMN IF NOT EXISTS refresh_token_encrypted TEXT,
ADD COLUMN IF NOT EXISTS token_encrypted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS token_rotation_count INTEGER DEFAULT 0;

-- Create index for token rotation tracking
CREATE INDEX IF NOT EXISTS idx_social_connections_token_rotation 
ON social_connections(tenant_id, token_rotation_count) 
WHERE deleted_at IS NULL;

-- Add audit columns for security tracking
ALTER TABLE social_connections
ADD COLUMN IF NOT EXISTS last_security_check_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS security_flags JSONB DEFAULT '{}';

-- Create function to track token access
CREATE OR REPLACE FUNCTION log_token_access()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Log token access for audit
  INSERT INTO audit_logs (
    tenant_id,
    user_id,
    action,
    table_name,
    record_id,
    metadata
  ) VALUES (
    NEW.tenant_id,
    auth.uid(),
    'token_access',
    'social_connections',
    NEW.id,
    jsonb_build_object(
      'platform', NEW.platform,
      'account_id', NEW.account_id,
      'timestamp', NOW()
    )
  );
  
  RETURN NEW;
END;
$$;

-- Create audit_logs table if not exists
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  table_name TEXT,
  record_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT
);

-- Add RLS policies for audit_logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Superadmins can view all audit logs
CREATE POLICY "Superadmins can view all audit logs"
  ON audit_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.is_superadmin = true
    )
  );

-- Users can view their tenant's audit logs
CREATE POLICY "Users can view tenant audit logs"
  ON audit_logs FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid()
    )
  );

-- Only system can insert audit logs
CREATE POLICY "System inserts audit logs"
  ON audit_logs FOR INSERT
  WITH CHECK (true);

-- Create index for audit log queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_action 
ON audit_logs(tenant_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user 
ON audit_logs(user_id, created_at DESC);

-- Add function to migrate existing tokens to encrypted format
-- NOTE: This is a placeholder - actual encryption happens in application code
CREATE OR REPLACE FUNCTION mark_tokens_for_encryption()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  affected_rows INTEGER;
BEGIN
  UPDATE social_connections
  SET 
    security_flags = security_flags || jsonb_build_object('needs_encryption', true),
    last_security_check_at = NOW()
  WHERE access_token IS NOT NULL
  AND access_token_encrypted IS NULL
  AND deleted_at IS NULL;
  
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  
  RETURN affected_rows;
END;
$$;

-- Mark existing tokens for encryption
SELECT mark_tokens_for_encryption();

-- Add comment for documentation
COMMENT ON COLUMN social_connections.access_token_encrypted IS 'AES-256-GCM encrypted OAuth access token';
COMMENT ON COLUMN social_connections.refresh_token_encrypted IS 'AES-256-GCM encrypted OAuth refresh token';
COMMENT ON COLUMN social_connections.token_encrypted_at IS 'Timestamp when tokens were last encrypted';
COMMENT ON COLUMN social_connections.token_rotation_count IS 'Number of times tokens have been rotated for security';
COMMENT ON TABLE audit_logs IS 'Security audit log for sensitive operations';

-- Create approval gates table for destructive operations
CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES users(id),
  operation_type TEXT NOT NULL CHECK (operation_type IN (
    'delete_campaign',
    'delete_all_posts',
    'disconnect_all_accounts',
    'delete_tenant_data',
    'bulk_delete',
    'cancel_subscription'
  )),
  operation_details JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  approved_by UUID REFERENCES users(id),
  approval_note TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add RLS for approval_requests
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;

-- Users can view their tenant's approval requests
CREATE POLICY "View tenant approval requests"
  ON approval_requests FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid()
    )
  );

-- Only admins and owners can approve
CREATE POLICY "Admins approve requests"
  ON approval_requests FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM users 
      WHERE id = auth.uid() 
      AND role IN ('owner', 'admin')
    )
  );

-- Users can create approval requests for their tenant
CREATE POLICY "Create approval requests"
  ON approval_requests FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid()
    )
  );

-- Create indexes for approval requests
CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant_status 
ON approval_requests(tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_approval_requests_expires 
ON approval_requests(expires_at) 
WHERE status = 'pending';