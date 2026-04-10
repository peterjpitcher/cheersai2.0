-- Composite index for efficient scheduling queries
CREATE INDEX IF NOT EXISTS idx_content_items_account_schedule
ON content_items(account_id, scheduled_for);

-- New columns for copy engagement tracking (used by Plan B and C)
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS hook_strategy text
  CHECK (hook_strategy IS NULL OR hook_strategy IN (
    'question', 'bold_statement', 'direct_address', 'curiosity_gap',
    'seasonal', 'scarcity', 'behind_scenes', 'social_proof'
  ));

ALTER TABLE content_items ADD COLUMN IF NOT EXISTS content_pillar text
  CHECK (content_pillar IS NULL OR content_pillar IN (
    'food_drink', 'events', 'people', 'behind_scenes', 'customer_love', 'seasonal'
  ));
