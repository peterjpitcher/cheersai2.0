-- Additive rugby screening facts. Existing football rows retain their behaviour.
-- Production application requires approval of this exact file and checksum.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.tournaments
  ADD COLUMN sport text NOT NULL DEFAULT 'football' CHECK (sport IN ('football', 'rugby_union'));
ALTER TABLE public.tournament_fixtures
  ADD COLUMN import_key text CHECK (import_key IS NULL OR (length(import_key) BETWEEN 1 AND 100 AND import_key ~ '^[a-zA-Z0-9_-]+$')),
  ADD COLUMN round_number integer CHECK (round_number BETWEEN 1 AND 6),
  ADD COLUMN final_position integer CHECK (final_position BETWEEN 1 AND 6),
  ADD COLUMN planned_end_at timestamptz CHECK (planned_end_at > kick_off_at),
  ADD COLUMN match_state text NOT NULL DEFAULT 'scheduled' CHECK (match_state IN ('scheduled', 'in_progress', 'finished', 'cancelled')),
  ADD COLUMN screening_decision text NOT NULL DEFAULT 'unconfirmed' CHECK (screening_decision IN ('unconfirmed', 'confirmed', 'not_showing')),
  ADD COLUMN broadcast_decision text NOT NULL DEFAULT 'unconfirmed' CHECK (broadcast_decision IN ('unconfirmed', 'confirmed', 'not_linear')),
  ADD COLUMN linear_channel text CHECK (length(linear_channel) BETWEEN 1 AND 100),
  ADD COLUMN screen_label text CHECK (length(screen_label) BETWEEN 1 AND 100),
  ADD COLUMN commentary text NOT NULL DEFAULT 'unconfirmed' CHECK (commentary IN ('unconfirmed', 'on', 'off')),
  ADD COLUMN source_url text CHECK (source_url IS NULL OR source_url LIKE 'https://%'),
  ADD COLUMN source_checked_at timestamptz,
  ADD COLUMN broadcast_checked_at timestamptz,
  ADD COLUMN screening_confirmed_at timestamptz,
  ADD COLUMN content_revision integer NOT NULL DEFAULT 1 CHECK (content_revision > 0);
-- Widen the existing text check without removing any football round.
ALTER TABLE public.tournament_fixtures DROP CONSTRAINT tournament_fixtures_round_check;
ALTER TABLE public.tournament_fixtures ADD CONSTRAINT tournament_fixtures_round_check
  CHECK (round IN ('group_stage', 'round_of_32', 'round_of_16', 'quarter_final', 'semi_final', 'third_place', 'final', 'league_round', 'placement_final'));
CREATE UNIQUE INDEX tournament_fixtures_import_key_unique
  ON public.tournament_fixtures (tournament_id, import_key) WHERE import_key IS NOT NULL;
-- No new exposed relations/routines, grants or RLS changes.
COMMIT;
