# SPEC: a rebuilt local database matches production

## Problem

The Stripe end-to-end test (26 September 2026) failed on a local database rebuilt from the chain
(`npm run db:rebuild`) in ways production does not:

- every service-role query failed with "permission denied" (newer local Supabase images no longer
  grant anon, authenticated and service_role DML on new tables by default; production has them);
- `accounts.email` did not exist;
- `releaseHeldPublishJobs` failed with `invalid input value for enum content_status: "held"`.

CI's migration-check builds the same database, so it has been checking a schema production does
not have.

## Findings (read-only diff, 26 September 2026)

A fresh rebuild's catalogue was fingerprinted per table and object and compared with production
(`nbkjciurhvkfpcpatbnt`) using SELECT-only queries.

- **Same tables, same types, same RLS flags, same view text, same schema grants.**
- **Grants:** 45 of 50 tables and views had different grants (local held only TRUNCATE, REFERENCES,
  TRIGGER, MAINTAIN; anon also kept those on the seven secret-bearing tables). 10 of 15 functions
  had different EXECUTE grants. postgres's default privileges in `public` gave authenticated and
  service_role no DML, sequence or EXECUTE rights for new objects.
- **Missing migration:** production history has `20260905053345 revoke_anon_grants_on_secret_bearing_tables`,
  which the repo never had.
- **Table shapes:** production's content_items, publish_jobs, social_connections, oauth_states,
  notifications, analytics_snapshots, provider_rate_limits, link_in_bio_profiles and
  link_in_bio_tiles predate the v2 chain (its `create table if not exists` skipped them), so they
  keep the v1 shape. A rebuild got the v2 shape. Differences: enum columns that are text with CHECK
  constraints on production (7 columns), 19 columns only production has (for example
  `accounts.email`, `content_items.placement` and `platform`, `social_connections.provider`), two
  columns only the rebuild had (`publish_jobs.platform`, `social_connections.platform`), different
  nullability and defaults, the link-in-bio profile keyed by `account_id` on production, 20 indexes,
  14 constraints, 2 triggers and 1 policy only production has, 4 partial indexes and 2 constraints
  defined differently, and 11 constraints and 1 function overload only the rebuild had.
- **Environment only (left alone):** the local image adds the `pg_net` extension, realtime's own
  message publication exists only where realtime runs, and the local stack has no `media` storage
  bucket.

## Change

1. Restore `20260905053345_revoke_anon_grants_on_secret_bearing_tables.sql` byte for byte from
   production's `supabase_migrations.schema_migrations`. Already in production's history under the
   same version; never apply it again.
2. New migration `20260926130000_local_rebuild_matches_production.sql`, last in the chain:
   - blocks 1 to 10 reshape each table to production's definition. Each block is behind one
     catalogue check that is true only for the shape the chain builds (for example "publish_jobs.status
     is the content_status enum") and false on production;
   - blocks 11 to 13 compare table, function and default grants with production's (a literal
     table in the file) and issue only the difference, then fail if any difference is left;
   - block 14 fails the migration if the three reported points are still wrong.
3. `supabase/tests/local_rebuild_matches_production_verify.sql`: catalogue checks, a read of every
   table as service_role, anon refused on `token_vault`, and a rolled-back probe that inserts a
   brand, a post and a held job as service_role and releases it with the same update as
   `releaseHeldPublishJobs`.
4. `CLAUDE.md` gotcha: later migrations must target production's shape and state their own grants.

A correction to the staged v1 baseline was considered and rejected: the baseline is generated
from the v1 dump and is staged after the v2 chain's first migrations, so it cannot make the v2
`create table if not exists` statements skip the way they did on production. Only a migration at
the end of the chain can reach production's shape.

## Behaviour on production

Nothing runs there. A read-only dry run (the migration's own guard expressions and grant-diff
queries, extracted from the file) on production on 26 September 2026 returned: all ten reshaping
blocks would skip, and blocks 11 to 13 would issue 0 statements. Block 14's checks already hold on
production. No DDL, no locks on app tables.

Assumption: production's grants do not change between the dry run and the apply. If they do,
blocks 11 to 13 would move production back to the 26 September grants, so the dry run must be
re-run immediately before the apply and must still read all false and 0.

## Validation

- Fresh rebuild (CLI 2.108.0, Postgres 17.6, baseline staged as `db:rebuild` does): the migration
  applies; the catalogue fingerprint then equals production's in every schema category (tables,
  columns, constraints, indexes, policies, triggers, functions, views, types, table grants,
  function grants, default privileges); only the environment items above differ.
- Verify script passes on the rebuild; on a rebuild without the new migration it fails with the
  reported errors.
- The app's own `releaseHeldPublishJobs`, run through supabase-js and the local API with the
  service-role key, released a held job (`{"released":1,"stillHeld":0}`); probe rows cleaned up.
- `tests/anon-access.test.ts` against the rebuild reports only the two items the allowlist already
  records as open on production (`is_account_member`, `is_super_admin`).
- CI migration-check (CLI 2.67.1) on the PR.

## Rollback

Production: nothing to roll back. Local: `npm run db:rebuild`. Reverting the PR restores the old
rebuild behaviour.
