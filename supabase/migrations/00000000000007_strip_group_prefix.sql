-- Backfill: strip leading "Group " from tournament_fixtures.group_name
-- to prevent the double-prefix bug ("GROUP GROUP B") in formatRoundLabel().
UPDATE tournament_fixtures
SET group_name = TRIM(REGEXP_REPLACE(group_name, '^\s*group\s+', '', 'i'))
WHERE group_name ~* '^\s*group\s+';
