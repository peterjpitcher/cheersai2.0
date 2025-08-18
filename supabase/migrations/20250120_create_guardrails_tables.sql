-- Create guardrails table for storing user feedback on AI-generated content
CREATE TABLE IF NOT EXISTS content_guardrails (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- Context of the guardrail
  context_type VARCHAR(50) NOT NULL CHECK (context_type IN ('campaign', 'quick_post', 'brand_voice', 'general')),
  platform VARCHAR(50), -- Optional: specific platform this applies to
  
  -- The feedback/guardrail itself
  feedback_type VARCHAR(50) NOT NULL CHECK (feedback_type IN ('avoid', 'include', 'tone', 'style', 'format', 'other')),
  feedback_text TEXT NOT NULL,
  
  -- AI content that triggered this feedback (for context)
  original_content TEXT,
  original_prompt TEXT,
  
  -- Usage tracking
  is_active BOOLEAN DEFAULT true,
  times_applied INTEGER DEFAULT 0,
  last_applied_at TIMESTAMP WITH TIME ZONE,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create guardrails history table for tracking changes
CREATE TABLE IF NOT EXISTS content_guardrails_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guardrail_id UUID REFERENCES content_guardrails(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  
  action VARCHAR(50) NOT NULL CHECK (action IN ('created', 'updated', 'disabled', 'enabled', 'applied')),
  previous_value JSONB,
  new_value JSONB,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create AI generation feedback table for immediate user feedback
CREATE TABLE IF NOT EXISTS ai_generation_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- Reference to where this was generated
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  post_id UUID REFERENCES campaign_posts(id) ON DELETE CASCADE,
  
  -- Generation details
  generated_content TEXT NOT NULL,
  prompt_used TEXT,
  platform VARCHAR(50),
  generation_type VARCHAR(50) CHECK (generation_type IN ('campaign', 'quick_post', 'caption', 'hashtags', 'other')),
  
  -- Feedback
  feedback_type VARCHAR(50) CHECK (feedback_type IN ('positive', 'negative', 'needs_improvement')),
  feedback_text TEXT,
  suggested_improvement TEXT,
  
  -- Whether this was converted to a guardrail
  converted_to_guardrail BOOLEAN DEFAULT false,
  guardrail_id UUID REFERENCES content_guardrails(id) ON DELETE SET NULL,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_guardrails_tenant ON content_guardrails(tenant_id);
CREATE INDEX idx_guardrails_active ON content_guardrails(is_active) WHERE is_active = true;
CREATE INDEX idx_guardrails_context ON content_guardrails(context_type);
CREATE INDEX idx_guardrails_platform ON content_guardrails(platform) WHERE platform IS NOT NULL;
CREATE INDEX idx_guardrails_feedback_type ON content_guardrails(feedback_type);

CREATE INDEX idx_guardrails_history_guardrail ON content_guardrails_history(guardrail_id);
CREATE INDEX idx_guardrails_history_tenant ON content_guardrails_history(tenant_id);
CREATE INDEX idx_guardrails_history_created ON content_guardrails_history(created_at DESC);

CREATE INDEX idx_ai_feedback_tenant ON ai_generation_feedback(tenant_id);
CREATE INDEX idx_ai_feedback_campaign ON ai_generation_feedback(campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX idx_ai_feedback_unconverted ON ai_generation_feedback(converted_to_guardrail) WHERE converted_to_guardrail = false;

-- Enable Row Level Security
ALTER TABLE content_guardrails ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_guardrails_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_generation_feedback ENABLE ROW LEVEL SECURITY;

-- RLS Policies for content_guardrails
CREATE POLICY "Users can view their tenant guardrails" ON content_guardrails
  FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  ));

CREATE POLICY "Users can create guardrails for their tenant" ON content_guardrails
  FOR INSERT
  WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    AND (user_id IS NULL OR user_id = auth.uid())
  );

CREATE POLICY "Users can update their tenant guardrails" ON content_guardrails
  FOR UPDATE
  USING (tenant_id IN (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  ))
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  ));

CREATE POLICY "Users can delete their tenant guardrails" ON content_guardrails
  FOR DELETE
  USING (tenant_id IN (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  ));

-- RLS Policies for content_guardrails_history
CREATE POLICY "Users can view their tenant guardrails history" ON content_guardrails_history
  FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  ));

CREATE POLICY "Users can insert guardrails history for their tenant" ON content_guardrails_history
  FOR INSERT
  WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    AND (user_id IS NULL OR user_id = auth.uid())
  );

-- RLS Policies for ai_generation_feedback
CREATE POLICY "Users can view their tenant AI feedback" ON ai_generation_feedback
  FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  ));

CREATE POLICY "Users can create AI feedback for their tenant" ON ai_generation_feedback
  FOR INSERT
  WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    AND (user_id IS NULL OR user_id = auth.uid())
  );

CREATE POLICY "Users can update their AI feedback" ON ai_generation_feedback
  FOR UPDATE
  USING (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    AND (user_id IS NULL OR user_id = auth.uid())
  )
  WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    AND (user_id IS NULL OR user_id = auth.uid())
  );

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_guardrails_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_guardrails_timestamp
  BEFORE UPDATE ON content_guardrails
  FOR EACH ROW
  EXECUTE FUNCTION update_guardrails_updated_at();

-- Create function to log guardrail history
CREATE OR REPLACE FUNCTION log_guardrail_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO content_guardrails_history (
      guardrail_id, tenant_id, user_id, action, new_value
    ) VALUES (
      NEW.id, NEW.tenant_id, NEW.user_id, 'created', row_to_json(NEW)
    );
  ELSIF TG_OP = 'UPDATE' THEN
    -- Detect specific action type
    DECLARE
      action_type VARCHAR(50);
    BEGIN
      IF OLD.is_active = true AND NEW.is_active = false THEN
        action_type := 'disabled';
      ELSIF OLD.is_active = false AND NEW.is_active = true THEN
        action_type := 'enabled';
      ELSE
        action_type := 'updated';
      END IF;
      
      INSERT INTO content_guardrails_history (
        guardrail_id, tenant_id, user_id, action, previous_value, new_value
      ) VALUES (
        NEW.id, NEW.tenant_id, NEW.user_id, action_type, row_to_json(OLD), row_to_json(NEW)
      );
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER log_guardrail_changes
  AFTER INSERT OR UPDATE ON content_guardrails
  FOR EACH ROW
  EXECUTE FUNCTION log_guardrail_change();

-- Add comments for documentation
COMMENT ON TABLE content_guardrails IS 'Stores user-defined guardrails and feedback for AI content generation';
COMMENT ON TABLE content_guardrails_history IS 'Tracks changes to guardrails over time';
COMMENT ON TABLE ai_generation_feedback IS 'Stores immediate feedback on AI-generated content';

COMMENT ON COLUMN content_guardrails.context_type IS 'Where this guardrail applies: campaign, quick_post, brand_voice, or general';
COMMENT ON COLUMN content_guardrails.feedback_type IS 'Type of feedback: avoid, include, tone, style, format, other';
COMMENT ON COLUMN content_guardrails.times_applied IS 'Number of times this guardrail has been used in AI generation';

COMMENT ON COLUMN ai_generation_feedback.feedback_type IS 'User sentiment about generated content: positive, negative, needs_improvement';
COMMENT ON COLUMN ai_generation_feedback.converted_to_guardrail IS 'Whether this feedback has been converted to a reusable guardrail';

-- Sample data for testing (commented out for production)
-- INSERT INTO content_guardrails (tenant_id, user_id, context_type, feedback_type, feedback_text)
-- VALUES 
-- ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'general', 'avoid', 'Avoid using corporate jargon'),
-- ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'general', 'include', 'Always mention our happy hour specials on Fridays'),
-- ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'instagram', 'format', 'Keep Instagram captions under 125 characters');