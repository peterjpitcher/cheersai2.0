UK Hospitality Inspiration — Runbook

What it does
- Curated UK events (seasonal/civic/food/drink/sports) with 250‑word briefs.
- Always 12 months ahead via a monthly cron.
- Calendar overlay shows at most two items per day; weekly top picks.
- Per-user prefs for sports/alcohol; tenant-level alcohol_free hides alcohol globally.
- Snooze/Unsnooze to hide or restore ideas per user/date.

Key endpoints & scripts
- Read: GET /api/inspiration?from=YYYY-MM-DD&to=YYYY-MM-DD
- Cron: GET|POST /api/cron/inspiration (accepts x-vercel-cron=1 or ?secret=)
- Prefs: GET|POST /api/inspiration/prefs
- Snoozes: POST /api/inspiration/snoozes (body: { event_id, date }), DELETE /api/inspiration/snoozes?event_id=&date=
- Snooze list: GET /api/inspiration/snoozes/list?from=&to=
- Scripts: 
  - npm run seed-inspiration (import + backfill)
  - npm run inspiration:bankholidays (import GOV.UK bank holidays)
  - npm run backfill:inspiration -- --from=YYYY-MM-DD --to=YYYY-MM-DD (or :dry)

Cron schedule
- vercel.json defines a Vercel Cron for /api/cron/inspiration at 02:00 UTC on the 1st monthly.
- The cron is idempotent and guarded by a PostgreSQL advisory lock.

Data sources
- data/inspiration/events.yaml (curated)
- GOV.UK bank holidays JSON (England & Wales) — integrated in orchestration
- Calculators: Easter Sunday, Shrove Tuesday (Pancake Day), Mother’s Day (UK)

Extending
- Add/adjust events in data/inspiration/events.yaml and run seed-inspiration.
- Add calculators or RRULEs for more movable events.
- Expand seed to ~100+ events for fuller coverage.

Troubleshooting
- No overlay items: ensure migrations applied; check logs of /api/cron/inspiration; confirm env vars.
- Snoozed items missing: use “Manage snoozes” in weekly panel to unsnooze.
- Alcohol items showing for alcohol-free tenants: set tenants.alcohol_free = true.

