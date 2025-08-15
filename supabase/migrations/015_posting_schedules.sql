-- Create posting schedules table for recommended posting times
CREATE TABLE IF NOT EXISTS posting_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6), -- 0 = Sunday, 6 = Saturday
    time TIME NOT NULL,
    platform VARCHAR(50) NOT NULL DEFAULT 'all',
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique constraint to prevent duplicate time slots
    UNIQUE(tenant_id, day_of_week, time, platform)
);

-- Create index for faster queries
CREATE INDEX idx_posting_schedules_tenant ON posting_schedules(tenant_id);
CREATE INDEX idx_posting_schedules_day_time ON posting_schedules(day_of_week, time);

-- Enable RLS
ALTER TABLE posting_schedules ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their tenant's posting schedule"
    ON posting_schedules FOR SELECT
    USING (
        tenant_id IN (
            SELECT tenant_id FROM users WHERE id = auth.uid()
        )
    );

CREATE POLICY "Users can insert posting schedule for their tenant"
    ON posting_schedules FOR INSERT
    WITH CHECK (
        tenant_id IN (
            SELECT tenant_id FROM users WHERE id = auth.uid()
        )
    );

CREATE POLICY "Users can update their tenant's posting schedule"
    ON posting_schedules FOR UPDATE
    USING (
        tenant_id IN (
            SELECT tenant_id FROM users WHERE id = auth.uid()
        )
    );

CREATE POLICY "Users can delete their tenant's posting schedule"
    ON posting_schedules FOR DELETE
    USING (
        tenant_id IN (
            SELECT tenant_id FROM users WHERE id = auth.uid()
        )
    );

-- Add trigger for updated_at
CREATE TRIGGER update_posting_schedules_updated_at
    BEFORE UPDATE ON posting_schedules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();