# Supabase Migrations Workflow

Remote is the source of truth. This repo now uses a single squashed baseline migration that mirrors the remote schema. If local gets out of sync, realign from remote and add new changes as fresh migrations.

## Common Commands

- Realign local to remote (backs up local, fetches remote, verifies):
  - `npm run db:realign`
- Push new migrations:
  - `npm run db:push`
- Dry-run push (CI-safe alignment check):
  - `npm run db:push:dry`
- Reset local database to current migrations:
  - `npm run db:reset`

## Creating Changes

1) Create a new migration:
   - `supabase migration new <name>`
   - or generate from a local DB diff: `supabase db diff -f <name>`
2) Review SQL and run: `npm run db:push`

## If Things Drift

- You see errors like “relation already exists” or “Remote migration versions not found in local migrations directory”. Do:
  - `npm run db:realign`
  - Re-apply your intended changes as new migrations on top.

## CI Check

- `npm run check:migrations` fails CI if local migrations are not aligned with remote.
- A GitHub Actions workflow is available to run the same check against your linked project when secrets are set: `.github/workflows/supabase-remote-alignment.yml` (requires `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF`).

## Notes

- History has been squashed remotely; local `supabase/migrations` should contain the single `*_baseline.sql` plus any new migrations you create.
- Avoid `.REVIEW` suffixes and non-idempotent DDL in migrations. Keep history clean; add fixes in new migrations.
- Do not recreate new baselines repeatedly; only when intentionally re-squashing.

## Optional: Pre-push hook

- Enable the repo’s pre-push hook to enforce alignment locally:
  - `npm run hooks:install` (sets `core.hooksPath` to `.githooks`)
  - On push, it runs `npm run check:migrations` and blocks if out of sync.
