-- Fix missing columns in brand_profiles table
ALTER TABLE brand_profiles 
ADD COLUMN IF NOT EXISTS primary_color VARCHAR(7),
ADD COLUMN IF NOT EXISTS business_name TEXT,
ADD COLUMN IF NOT EXISTS brand_identity TEXT;

-- Create brand_voice_profiles table for trained AI models
CREATE TABLE IF NOT EXISTS brand_voice_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID UNIQUE REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  tone_attributes TEXT[],
  vocabulary TEXT[],
  sentence_patterns JSONB DEFAULT '{}',
  avg_sentence_length INTEGER DEFAULT 15,
  emoji_usage BOOLEAN DEFAULT false,
  emoji_frequency VARCHAR(20) DEFAULT 'none',
  hashtag_style VARCHAR(20) DEFAULT 'minimal',
  characteristics TEXT[],
  sample_count INTEGER DEFAULT 0,
  trained_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create brand_voice_samples table for training data
CREATE TABLE IF NOT EXISTS brand_voice_samples (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  type VARCHAR(50) CHECK (type IN ('caption', 'blog', 'email', 'menu', 'custom')),
  platform VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_brand_voice_profiles_tenant ON brand_voice_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_brand_voice_samples_tenant ON brand_voice_samples(tenant_id);
CREATE INDEX IF NOT EXISTS idx_brand_voice_samples_type ON brand_voice_samples(type);

-- Enable RLS on new tables
ALTER TABLE brand_voice_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_voice_samples ENABLE ROW LEVEL SECURITY;

-- RLS Policies for brand_voice_profiles
CREATE POLICY "Users can view their brand voice profile"
  ON brand_voice_profiles FOR SELECT
  TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM users WHERE auth.uid() = id
  ));

CREATE POLICY "Users can insert their brand voice profile"
  ON brand_voice_profiles FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM users WHERE auth.uid() = id
  ));

CREATE POLICY "Users can update their brand voice profile"
  ON brand_voice_profiles FOR UPDATE
  TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM users WHERE auth.uid() = id
  ));

CREATE POLICY "Users can delete their brand voice profile"
  ON brand_voice_profiles FOR DELETE
  TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM users WHERE auth.uid() = id
  ));

-- RLS Policies for brand_voice_samples
CREATE POLICY "Users can view their brand voice samples"
  ON brand_voice_samples FOR SELECT
  TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM users WHERE auth.uid() = id
  ));

CREATE POLICY "Users can insert their brand voice samples"
  ON brand_voice_samples FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM users WHERE auth.uid() = id
  ));

CREATE POLICY "Users can update their brand voice samples"
  ON brand_voice_samples FOR UPDATE
  TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM users WHERE auth.uid() = id
  ));

CREATE POLICY "Users can delete their brand voice samples"
  ON brand_voice_samples FOR DELETE
  TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM users WHERE auth.uid() = id
  ));

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_brand_voice_profiles_updated_at
  BEFORE UPDATE ON brand_voice_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Update any existing brand_profiles with missing data
UPDATE brand_profiles 
SET brand_identity = 'Please describe your pub''s unique identity, history, and values.'
WHERE brand_identity IS NULL;