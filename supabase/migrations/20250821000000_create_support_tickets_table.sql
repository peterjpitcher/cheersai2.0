-- Create support_tickets table for tiered support system
CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  support_channel VARCHAR(20) DEFAULT 'email' CHECK (support_channel IN ('email', 'whatsapp', 'phone', 'community')),
  subscription_tier VARCHAR(20) NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  resolved_at TIMESTAMP WITH TIME ZONE NULL
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_id ON support_tickets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_priority ON support_tickets(priority);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at ON support_tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_metadata ON support_tickets USING gin (metadata);

-- Row Level Security policies
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own tenant's tickets
CREATE POLICY "Users can view own tenant tickets" ON support_tickets
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid()
    )
  );

-- Policy: Users can create tickets for their tenant
CREATE POLICY "Users can create tickets" ON support_tickets
  FOR INSERT WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid()
    ) AND user_id = auth.uid()
  );

-- Policy: Users can update their own tickets (limited fields)
CREATE POLICY "Users can update own tickets" ON support_tickets
  FOR UPDATE USING (
    user_id = auth.uid() AND
    tenant_id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid()
    )
  ) WITH CHECK (
    user_id = auth.uid() AND
    tenant_id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid()
    )
  );

-- Policy: Superadmins can see all tickets
CREATE POLICY "Superadmins can view all tickets" ON support_tickets
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND is_superadmin = true
    )
  );

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_support_tickets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_support_tickets_updated_at
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION update_support_tickets_updated_at();

-- Add comments for documentation
COMMENT ON TABLE support_tickets IS 'Support tickets for tiered support system with RLS';
COMMENT ON COLUMN support_tickets.priority IS 'Ticket priority: low, normal, high, urgent';
COMMENT ON COLUMN support_tickets.status IS 'Ticket status: open, in_progress, resolved, closed';
COMMENT ON COLUMN support_tickets.support_channel IS 'Support channel used: email, whatsapp, phone, community';
COMMENT ON COLUMN support_tickets.subscription_tier IS 'User subscription tier when ticket was created';
COMMENT ON COLUMN support_tickets.metadata IS 'Additional ticket data like user agent, device info, etc.';