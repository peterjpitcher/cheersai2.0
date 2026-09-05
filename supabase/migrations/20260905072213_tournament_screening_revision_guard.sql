-- Serialise rugby confirmations for each account and make freshness revision automatic.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE FUNCTION public.guard_tournament_screening_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  fixture_account uuid;
  fixture_sport text;
BEGIN
  SELECT account_id, sport INTO fixture_account, fixture_sport
  FROM public.tournaments WHERE id = NEW.tournament_id;
  IF fixture_sport IS DISTINCT FROM 'rugby_union' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(fixture_account::text, 731));
  IF TG_OP = 'INSERT' THEN
    NEW.content_revision := 1;
  ELSIF
    (to_jsonb(NEW) - ARRAY['updated_at','content_revision','content_generated']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['updated_at','content_revision','content_generated']) THEN
    NEW.content_revision := OLD.content_revision + 1;
    NEW.content_generated := false;
  ELSE
    NEW.content_revision := OLD.content_revision;
  END IF;
  IF NEW.screening_decision = 'confirmed' AND NEW.match_state IN ('scheduled', 'in_progress') THEN
    IF NEW.broadcast_decision <> 'confirmed' OR NEW.broadcast_checked_at IS NULL
      OR NEW.screening_confirmed_at IS NULL OR nullif(btrim(NEW.linear_channel), '') IS NULL
      OR nullif(btrim(NEW.screen_label), '') IS NULL OR NEW.planned_end_at IS NULL THEN
      RAISE EXCEPTION 'Confirmed screening requires verified channel, screen and planned end';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.tournament_fixtures f JOIN public.tournaments t ON t.id = f.tournament_id
      WHERE t.account_id = fixture_account AND t.sport = 'rugby_union'
        AND f.id <> NEW.id AND f.screening_decision = 'confirmed'
        AND f.match_state IN ('scheduled', 'in_progress')
        AND f.kick_off_at < NEW.planned_end_at AND f.planned_end_at > NEW.kick_off_at
        AND (lower(btrim(f.screen_label)) = lower(btrim(NEW.screen_label))
          OR (f.commentary = 'on' AND NEW.commentary = 'on'))
    ) THEN
      RAISE EXCEPTION 'Overlapping confirmed screening uses this screen or commentary';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_tournament_screening_revision() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER tournament_screening_revision_guard
BEFORE INSERT OR UPDATE ON public.tournament_fixtures
FOR EACH ROW EXECUTE FUNCTION public.guard_tournament_screening_revision();
COMMIT;
