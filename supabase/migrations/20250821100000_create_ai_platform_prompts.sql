-- Create ai_platform_prompts table for superadmin platform-specific AI prompts
CREATE TABLE IF NOT EXISTS ai_platform_prompts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram', 'twitter', 'linkedin', 'google_my_business', 'general')),
  content_type TEXT NOT NULL CHECK (content_type IN ('post', 'story', 'reel', 'carousel', 'event', 'offer')),
  system_prompt TEXT NOT NULL,
  user_prompt_template TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Create ai_platform_prompt_history table for version history
CREATE TABLE IF NOT EXISTS ai_platform_prompt_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prompt_id UUID NOT NULL REFERENCES ai_platform_prompts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  system_prompt TEXT NOT NULL,
  user_prompt_template TEXT NOT NULL,
  change_description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_ai_platform_prompts_platform ON ai_platform_prompts(platform);
CREATE INDEX IF NOT EXISTS idx_ai_platform_prompts_content_type ON ai_platform_prompts(content_type);
CREATE INDEX IF NOT EXISTS idx_ai_platform_prompts_active ON ai_platform_prompts(is_active);
CREATE INDEX IF NOT EXISTS idx_ai_platform_prompts_default ON ai_platform_prompts(is_default);
CREATE INDEX IF NOT EXISTS idx_ai_platform_prompt_history_prompt_id ON ai_platform_prompt_history(prompt_id);
CREATE INDEX IF NOT EXISTS idx_ai_platform_prompt_history_version ON ai_platform_prompt_history(prompt_id, version);

-- Add unique constraint for default prompts per platform/content_type
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_platform_prompts_unique_default 
ON ai_platform_prompts(platform, content_type) 
WHERE is_default = true;

-- Insert default prompts for each platform
INSERT INTO ai_platform_prompts (name, description, platform, content_type, system_prompt, user_prompt_template, is_default, is_active) VALUES
-- Facebook defaults
('Facebook Post Default', 'Default system prompt for Facebook posts', 'facebook', 'post', 
'You are a social media expert specializing in Facebook content for UK hospitality businesses. Create engaging, conversational posts that encourage community interaction and showcase the warmth of local hospitality. Use a friendly, approachable tone that reflects British pub culture.', 
'Create a {postTiming} Facebook post for {campaignType} called "{campaignName}" for {businessName}. The business type is {businessType} and target audience is {targetAudience}. {eventDate ? `The event is on ${eventDate}.` : ""} Make it engaging and encourage comments or shares.', 
true, true),

('Facebook Event Default', 'Default system prompt for Facebook events', 'facebook', 'event', 
'You are a social media expert creating Facebook event posts for UK hospitality businesses. Focus on creating excitement, providing clear details, and encouraging attendance. Use warm, inviting language that makes people want to attend.', 
'Create a {postTiming} Facebook event post for {campaignType} called "{campaignName}" for {businessName}. {eventDate ? `The event is on ${eventDate}.` : ""} Include compelling reasons to attend and create urgency around booking or arriving early.', 
true, true),

-- Instagram defaults
('Instagram Post Default', 'Default system prompt for Instagram posts', 'instagram', 'post', 
'You are a social media expert specializing in Instagram content for UK hospitality businesses. Create visually-focused, hashtag-rich posts that are Instagram-native. Use emojis strategically and write captions that complement stunning food and venue photography.', 
'Create a {postTiming} Instagram post for {campaignType} called "{campaignName}" for {businessName}. Focus on visual storytelling and include relevant hashtags. The business type is {businessType} and target audience is {targetAudience}. {eventDate ? `The event is on ${eventDate}.` : ""}', 
true, true),

('Instagram Story Default', 'Default system prompt for Instagram stories', 'instagram', 'story', 
'You are a social media expert creating Instagram Stories for UK hospitality businesses. Stories should be casual, behind-the-scenes, and create FOMO. Use interactive elements like polls, questions, or "swipe up" calls-to-action.', 
'Create an Instagram Story caption for {campaignType} called "{campaignName}" for {businessName}. Make it feel spontaneous and engaging. {eventDate ? `The event is on ${eventDate}.` : ""} Keep it casual and encourage interaction.', 
true, true),

-- Twitter defaults
('Twitter Post Default', 'Default system prompt for Twitter/X posts', 'twitter', 'post', 
'You are a social media expert specializing in Twitter content for UK hospitality businesses. Create concise, witty posts that spark conversation. Use British humor appropriately and keep within character limits while being engaging and shareable.', 
'Create a {postTiming} Twitter post for {campaignType} called "{campaignName}" for {businessName}. Keep it under 280 characters, make it conversational and engaging. The business type is {businessType}. {eventDate ? `The event is on ${eventDate}.` : ""}', 
true, true),

-- LinkedIn defaults
('LinkedIn Post Default', 'Default system prompt for LinkedIn posts', 'linkedin', 'post', 
'You are a social media expert creating LinkedIn content for UK hospitality businesses. Focus on the business side of hospitality - team achievements, community impact, industry insights, and professional networking. Use a more professional tone while maintaining warmth.', 
'Create a {postTiming} LinkedIn post for {campaignType} called "{campaignName}" for {businessName}. Focus on the business/professional angle - team, community impact, or industry insight. {eventDate ? `The event is on ${eventDate}.` : ""} Target audience is {targetAudience}.', 
true, true),

-- Google My Business defaults
('Google My Business Default', 'Default system prompt for Google My Business posts', 'google_my_business', 'post', 
'You are a social media expert creating Google My Business posts for UK hospitality businesses. Focus on local SEO, customer reviews, opening hours, special offers, and location-specific information. Use clear, informative language that helps with local discovery.', 
'Create a {postTiming} Google My Business post for {campaignType} called "{campaignName}" for {businessName}. Focus on local relevance and include location-specific details. {eventDate ? `The event is on ${eventDate}.` : ""} Target local customers in the area.', 
true, true),

-- General default
('General Default', 'Default system prompt for multi-platform content', 'general', 'post', 
'You are a social media expert creating content for UK hospitality businesses. Create versatile content that works well across multiple social media platforms. Focus on the core message while being adaptable to different platform requirements.', 
'Create a {postTiming} social media post for {campaignType} called "{campaignName}" for {businessName}. Make it suitable for multiple platforms. The business type is {businessType} and target audience is {targetAudience}. {eventDate ? `The event is on ${eventDate}.` : ""}', 
true, true);

-- Create trigger to automatically create history entries
CREATE OR REPLACE FUNCTION create_ai_prompt_history()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO ai_platform_prompt_history (
    prompt_id, 
    version, 
    system_prompt, 
    user_prompt_template, 
    change_description,
    created_by
  ) VALUES (
    NEW.id,
    NEW.version,
    NEW.system_prompt,
    NEW.user_prompt_template,
    CASE 
      WHEN TG_OP = 'INSERT' THEN 'Initial version'
      ELSE 'Updated prompt'
    END,
    NEW.created_by
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for new prompts and updates
CREATE TRIGGER trigger_create_ai_prompt_history
  AFTER INSERT OR UPDATE OF system_prompt, user_prompt_template, version
  ON ai_platform_prompts
  FOR EACH ROW
  EXECUTE FUNCTION create_ai_prompt_history();

-- Create function to increment version on update
CREATE OR REPLACE FUNCTION increment_ai_prompt_version()
RETURNS TRIGGER AS $$
BEGIN
  -- Only increment version if system_prompt or user_prompt_template changed
  IF (OLD.system_prompt != NEW.system_prompt OR OLD.user_prompt_template != NEW.user_prompt_template) THEN
    NEW.version = OLD.version + 1;
    NEW.updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-increment version
CREATE TRIGGER trigger_increment_ai_prompt_version
  BEFORE UPDATE ON ai_platform_prompts
  FOR EACH ROW
  EXECUTE FUNCTION increment_ai_prompt_version();

-- No RLS needed as this is superadmin only - access controlled at application level