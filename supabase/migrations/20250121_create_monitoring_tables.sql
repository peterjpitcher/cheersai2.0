-- Create performance monitoring tables
CREATE TABLE IF NOT EXISTS performance_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  metric_type VARCHAR(50) NOT NULL,
  value NUMERIC NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS error_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  error_message TEXT NOT NULL,
  context VARCHAR(255),
  severity VARCHAR(20) CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_metrics_tenant_date ON performance_metrics(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_type ON performance_metrics(metric_type);
CREATE INDEX IF NOT EXISTS idx_errors_tenant_date ON error_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_errors_severity ON error_logs(severity);

-- Enable Row Level Security
ALTER TABLE performance_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for performance_metrics
CREATE POLICY "Users can view their tenant metrics" ON performance_metrics
  FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  ));

CREATE POLICY "Users can insert their tenant metrics" ON performance_metrics
  FOR INSERT
  WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    AND user_id = auth.uid()
  );

CREATE POLICY "Users can update their own metrics" ON performance_metrics
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own metrics" ON performance_metrics
  FOR DELETE
  USING (user_id = auth.uid());

-- Create RLS policies for error_logs
CREATE POLICY "Users can view their tenant errors" ON error_logs
  FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  ));

CREATE POLICY "Users can insert their tenant errors" ON error_logs
  FOR INSERT
  WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    AND user_id = auth.uid()
  );

CREATE POLICY "Users can update their own errors" ON error_logs
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own errors" ON error_logs
  FOR DELETE
  USING (user_id = auth.uid());

-- Add comments for documentation
COMMENT ON TABLE performance_metrics IS 'Stores performance monitoring data for the application';
COMMENT ON TABLE error_logs IS 'Stores error logs and system issues for debugging';
COMMENT ON COLUMN performance_metrics.metric_type IS 'Type of metric: page_load, api_call, database_query, etc';
COMMENT ON COLUMN error_logs.severity IS 'Error severity level: low, medium, high, critical';