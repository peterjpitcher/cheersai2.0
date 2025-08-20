-- Create posting_schedules table for storing recommended posting times
CREATE TABLE posting_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6), -- 0 = Sunday, 6 = Saturday
  time TIME NOT NULL, -- HH:MM format
  platform VARCHAR(50) NOT NULL, -- 'all', 'facebook', 'instagram', 'twitter', 'linkedin'
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for better performance
CREATE INDEX idx_posting_schedules_tenant_id ON posting_schedules(tenant_id);
CREATE INDEX idx_posting_schedules_day_time ON posting_schedules(day_of_week, time);
CREATE INDEX idx_posting_schedules_active ON posting_schedules(active) WHERE active = true;

-- Add updated_at trigger
CREATE TRIGGER update_posting_schedules_updated_at BEFORE UPDATE ON posting_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) policies
ALTER TABLE posting_schedules ENABLE ROW LEVEL SECURITY;

-- Policy for tenant isolation
CREATE POLICY "Users can manage posting schedules for their tenant" 
ON posting_schedules
FOR ALL
USING (
  tenant_id IN (
    SELECT u.tenant_id 
    FROM users u 
    WHERE u.id = auth.uid()
  )
)
WITH CHECK (
  tenant_id IN (
    SELECT u.tenant_id 
    FROM users u 
    WHERE u.id = auth.uid()
  )
);

-- Grant permissions for authenticated users
GRANT ALL ON posting_schedules TO authenticated;
GRANT USAGE ON SEQUENCE posting_schedules_id_seq TO authenticated;