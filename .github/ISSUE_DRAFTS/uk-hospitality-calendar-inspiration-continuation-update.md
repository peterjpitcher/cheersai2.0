Continuation update: data coverage, bank holidays, tenant override, and lock

- Seed expansion: Added more UK-centric events to `data/inspiration/events.yaml` (Mother’s Day UK, Easter Sunday, Bonfire Night, Boxing Day, New Year’s Day, Black Friday, Cyber Monday, World Cocktail Day, Beer Day Britain).
- Bank Holidays importer: `scripts/inspiration/bank-holidays.ts`
  - Fetches GOV.UK bank holidays JSON (England and Wales) and upserts events and occurrences. Scripts: `inspiration:bankholidays(:dry)`.
- Advisory lock: `acquire_inspiration_lock` / `release_inspiration_lock` SQL functions to prevent overlapping cron/backfill runs; orchestrator now uses them.
- Tenant alcohol-free: Added `tenants.alcohol_free` column and the read API now hides alcohol events automatically when set, overriding per-user prefs.
- Multi-day rendering: Read API now expands multi-day occurrences across each date in range; overlay shows them on each day.

Operational notes
- After deploying migrations, you can backfill bank holidays with `npm run inspiration:bankholidays`.
- Then run `npm run seed-inspiration` (import + backfill horizon) or hit the cron endpoint once.
- The cron is idempotent and now guarded by an advisory lock.
