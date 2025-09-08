Progress update (PR 6 + PR 7): Cron orchestration and API

- app/api/cron/inspiration/route.ts: Monthly cron endpoint (Node runtime) secured by `CRON_SECRET`. Orchestrates import → expand → select → briefs. Supports `?dry=1&from=YYYY-MM-DD&to=YYYY-MM-DD&forceBriefs=1`.
- lib/inspiration/orchestrator.ts: Shared orchestration used by cron and CLI backfill.
- lib/inspiration/calculators.ts: UK movable feast calculators (Easter Sunday, Shrove Tuesday, Mother’s Day) with UTC-safe math.
- scripts/inspiration/run.ts: Backfill CLI wrapper for orchestration (with `--from`, `--to`, `--dry-run`, `--force-briefs`).
- package.json: Added `backfill:inspiration(:dry)` scripts.
- app/api/inspiration/route.ts: Read API returns top items by date range, honoring user prefs (sports/alcohol). Max 2/day.

Notes:
- Alcohol-free tenant flag is not present in the current schema; API filters on per-user prefs only (sports/alcohol). We can extend when a tenant-level field exists.
- Movable/announced-late sports still rely on manual dates; calculators cover Pancake Day and Mother’s Day; more can be added iteratively.

Next up (PR 8): Calendar overlay UI, popovers, weekly panel, and Add‑Draft flow.
