Progress update: Vercel Cron + seed script

- vercel.json:
  - Added function config for `app/api/cron/inspiration/route.ts` (maxDuration 60s).
  - Added Vercel Cron entry: `path: /api/cron/inspiration`, `schedule: 0 2 1 * *` (UTC). Note: Vercel schedules run in UTC; this fires at 02:00 UTC on the 1st. That equals 02:00 local in winter and 03:00 in summer.
- package.json:
  - Added `seed-inspiration` script that runs the catalog import and then the backfill orchestration (default horizon: current month → +13 months).

How to initialize
- One command (after migrations and env): `npm run seed-inspiration`
- Or test via cron endpoint (dry): `POST /api/cron/inspiration?dry=1` with header `x-cron-secret: $CRON_SECRET`.

Note on timezone
- Vercel Cron uses UTC. If you prefer 02:00 Europe/London strictly, we can keep the job at 02:00 UTC (02:00 GMT / 03:00 BST). Operationally this is fine as long as it runs during off‑hours.
