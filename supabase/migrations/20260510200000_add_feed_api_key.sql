ALTER TABLE tournaments
  ADD COLUMN feed_api_key text;

CREATE UNIQUE INDEX idx_tournaments_feed_api_key
  ON tournaments (feed_api_key)
  WHERE feed_api_key IS NOT NULL;

COMMENT ON COLUMN tournaments.feed_api_key IS
  'Public access token for the fixture feed API. NULL = feed disabled.';
