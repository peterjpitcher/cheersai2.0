-- UK Hospitality Calendar Inspiration: schema for events, occurrences, briefs, selections, and user prefs

-- 1) Events catalog (global)
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  aliases TEXT[] DEFAULT '{}',
  category TEXT NOT NULL, -- seasonal|civic|food|drink|sports
  alcohol_flag BOOLEAN NOT NULL DEFAULT false,
  dedupe_key TEXT NULL,
  date_type TEXT NOT NULL, -- fixed|recurring|multi_day
  rrule TEXT NULL,
  fixed_date DATE NULL,
  source_url TEXT NULL,
  uk_centric BOOLEAN NOT NULL DEFAULT true,
  notes TEXT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON events TO authenticated;
CREATE POLICY "events_read_all_authenticated" ON events FOR SELECT USING (true);
-- Writes performed by service role; optionally allow superadmin
CREATE POLICY "events_superadmin_manage" ON events FOR ALL
  USING (public.is_superadmin()) WITH CHECK (public.is_superadmin());

COMMENT ON TABLE events IS 'Global catalog of UK-centric hospitality-relevant events.';

-- 2) Event occurrences (materialized dates from events)
CREATE TABLE IF NOT EXISTS event_occurrences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  country TEXT NOT NULL DEFAULT 'UK',
  certainty TEXT NOT NULL DEFAULT 'confirmed', -- confirmed|estimated
  metadata JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, start_date)
);

ALTER TABLE event_occurrences ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON event_occurrences TO authenticated;
CREATE POLICY "event_occurrences_read_all_authenticated" ON event_occurrences FOR SELECT USING (true);
CREATE POLICY "event_occurrences_superadmin_manage" ON event_occurrences FOR ALL
  USING (public.is_superadmin()) WITH CHECK (public.is_superadmin());

CREATE INDEX IF NOT EXISTS idx_event_occurrences_start ON event_occurrences(start_date);
CREATE INDEX IF NOT EXISTS idx_event_occurrences_event ON event_occurrences(event_id);

COMMENT ON TABLE event_occurrences IS 'Expanded dated instances of events (next 13 months rolling).';

-- 3) Event briefs (250-word centrally stored text)
CREATE TABLE IF NOT EXISTS event_briefs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  version INT NOT NULL DEFAULT 1,
  text TEXT NOT NULL,
  constraints_applied TEXT[] DEFAULT '{no_emojis,no_links,no_prices}',
  drinkaware_applicable BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, version)
);

ALTER TABLE event_briefs ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON event_briefs TO authenticated;
CREATE POLICY "event_briefs_read_all_authenticated" ON event_briefs FOR SELECT USING (true);
CREATE POLICY "event_briefs_superadmin_manage" ON event_briefs FOR ALL
  USING (public.is_superadmin()) WITH CHECK (public.is_superadmin());

COMMENT ON TABLE event_briefs IS 'Centrally stored ~250-word briefs for each event, versioned.';

-- 4) Idea instances (daily selections with scores)
CREATE TABLE IF NOT EXISTS idea_instances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  occurrence_id UUID NOT NULL REFERENCES event_occurrences(id) ON DELETE CASCADE,
  rank_score INT NOT NULL DEFAULT 0,
  diversity_bucket TEXT NULL, -- civic|sports|food_drink|seasonal
  tags TEXT[] DEFAULT '{}',
  selected BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (occurrence_id)
);

ALTER TABLE idea_instances ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON idea_instances TO authenticated;
CREATE POLICY "idea_instances_read_all_authenticated" ON idea_instances FOR SELECT USING (true);
CREATE POLICY "idea_instances_superadmin_manage" ON idea_instances FOR ALL
  USING (public.is_superadmin()) WITH CHECK (public.is_superadmin());

CREATE INDEX IF NOT EXISTS idx_idea_instances_occurrence ON idea_instances(occurrence_id);

COMMENT ON TABLE idea_instances IS 'Selected top ideas per day based on scoring and diversity rules.';

-- 5) User preferences for inspiration visibility
CREATE TABLE IF NOT EXISTS user_prefs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  show_sports BOOLEAN NOT NULL DEFAULT true,
  show_alcohol BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

ALTER TABLE user_prefs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON user_prefs TO authenticated;
CREATE POLICY "user_prefs_select_own" ON user_prefs FOR SELECT
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "user_prefs_upsert_own" ON user_prefs FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "user_prefs_update_own" ON user_prefs FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

COMMENT ON TABLE user_prefs IS 'Per-user toggles for inspiration (sports/alcohol).';
