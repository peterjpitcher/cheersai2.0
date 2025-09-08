-- Per-user snoozes for inspiration items (hide an event on a specific date)

CREATE TABLE IF NOT EXISTS inspiration_snoozes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, event_id, date)
);

ALTER TABLE inspiration_snoozes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON inspiration_snoozes TO authenticated;

CREATE POLICY "inspo_snoozes_select_own" ON inspiration_snoozes FOR SELECT
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "inspo_snoozes_insert_own" ON inspiration_snoozes FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "inspo_snoozes_delete_own" ON inspiration_snoozes FOR DELETE
  USING (user_id = (SELECT auth.uid()));

CREATE INDEX IF NOT EXISTS idx_inspo_snoozes_user_date ON inspiration_snoozes(user_id, date);

