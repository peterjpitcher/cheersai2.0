Progress update (PR 2): Seed catalog + importer added.

- data/inspiration/events.yaml: initial UK-centric seed list (15 items; seasonal/civic/food/drink/sports).
- scripts/inspiration/import.ts: YAML importer with validation, using Supabase service-role (idempotent upsert by slug). Supports --dry-run.
- package.json: added scripts `inspiration:import` and `inspiration:import:dry`.

How to run locally:
- Dry run: `npm run inspiration:import:dry`
- Import: `npm run inspiration:import` (requires env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).

Next up (PR 3): Occurrence expansion (RRULE + calculators for movable feasts), deterministic upserts, and date-range join for API.

