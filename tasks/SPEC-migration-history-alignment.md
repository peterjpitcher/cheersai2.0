# SPEC: align production migration history with the repo

Status: proposal. Nothing has been written to production. The change below needs Peter's explicit
yes before it runs.

## Problem

Migrations reach production (`nbkjciurhvkfpcpatbnt`) through the Supabase MCP `apply_migration`
tool. That tool records each one in `supabase_migrations.schema_migrations` under a version it
assigns (the apply time, in UTC), not the timestamp in the file name. For example,
`20260928170000_self_serve_signups.sql` is recorded as `20260928124011`.

The Supabase CLI matches repo and production by version only, so the two histories no longer
line up: `npx supabase migration list` would show 32 matched rows, 33 local-only versions and 33
remote-only versions (derived from the data below; not run, as it needs the database password).
Every new MCP migration adds another pair.

What `npx supabase db push` does today (read from the CLI source,
`apps/cli-go/pkg/migration/apply.go`, `FindPendingMigrations`; not run, because it needs the
database password):

- It stops before running anything, with "Remote migration versions not found in local migrations
  directory", and suggests `supabase migration repair --status reverted` for the 33 remote-only
  versions.
- Following only that hint and then running `db push --include-all` would run all 33 files again
  against live data. Several update live rows (`clear_meta_ad_plaintext_tokens`,
  `accounts_feature_flags`) or change grants (`data_retention`, `team_invitations`), and none was
  written or reviewed to run twice. That suggested fix is the real hazard.

## Findings (read only, 28 September 2026)

Method: `list_migrations`, then SELECT-only queries on `supabase_migrations.schema_migrations`.
Each repo file was matched to its live row by name. Content was confirmed by sha256: the stored
statement against the file minus its final newline, and against the whole file (MCP stored the
final newline on 21 of them). Where that failed (CLI pushes store the file split into statements),
both sides were normalised the same way (comments, whitespace and semicolons removed, a wrapping
`BEGIN`/`COMMIT` dropped) and compared again.

- 65 files in `supabase/migrations` on `main` (after #146), 65 live rows. Every file has a live
  row and every live row has a file. No file is missing live, including the local-rebuild no-ops:
  `20260926130000_local_rebuild_matches_production.sql` and
  `20260928180000_auth_users_snapshot_triggers.sql` are both recorded.
- 32 files have the same version live: 24 CLI pushes, 2 rows recorded without SQL, and 6 MCP
  applies whose files were already named with the assigned version.
- **33 files have a different version live.** All 33 were applied through MCP. 29 are exact
  matches by sha256; 4 differ only in comments (the files' comments were rewritten after apply).
- 39 of the 65 live rows came through MCP (`created_by` is set); 24 came from `db push`
  (`created_by` is null); 2 hold no statements.
- The staged v1 baseline (`20260519230001_v1_baseline.sql`) is never committed and has no live
  row, as intended.

### Full mapping

"same" means the live version equals the file version. A bold version is the apply-time version
production recorded instead; it is the only place that apply time survives once the fix runs.

| # | File | Live version | Recorded by | Content check |
|---|---|---|---|---|
| 1 | `00000000000000_baseline.sql` | same | CLI push | same SQL, comments or whitespace differ |
| 2 | `00000000000001_content.sql` | same | CLI push | same SQL, comments or whitespace differ |
| 3 | `00000000000002_publishing.sql` | same | CLI push | same SQL, comments or whitespace differ |
| 4 | `00000000000003_notifications.sql` | same | CLI push | same SQL, comments or whitespace differ |
| 5 | `00000000000004_analytics.sql` | same | CLI push | same SQL, comments or whitespace differ |
| 6 | `00000000000005_link_in_bio.sql` | same | CLI push | same SQL, comments or whitespace differ |
| 7 | `00000000000006_storage_rls.sql` | same | CLI push | same SQL, comments or whitespace differ |
| 8 | `00000000000007_provider_integration.sql` | same | CLI push | same SQL, comments or whitespace differ |
| 9 | `00000000000008_realtime_and_notification_fix.sql` | same | CLI push | same SQL, comments or whitespace differ |
| 10 | `00000000000009_link_in_bio_reconcile.sql` | same | CLI push | same SQL, comments or whitespace differ |
| 11 | `20260519230000_v1_to_v2_bridge.sql` | same | CLI push | SQL differs: file edited 23 May for fresh builds; live matches `c2a75d74` (note 1) |
| 12 | `20260520180000_bridge_media_to_v2.sql` | same | CLI push | same SQL, comments or whitespace differ |
| 13 | `20260520190000_add_content_type_column.sql` | same | CLI push | same SQL, comments or whitespace differ |
| 14 | `20260520193000_nullable_platform_column.sql` | same | CLI push | SQL differs: file edited 23 May; live matches `aa637862` (note 1) |
| 15 | `20260521120000_campaign_conversion_readiness.sql` | same | CLI push | SQL differs: file edited 23 May; live matches `397b1409` (note 1) |
| 16 | `20260527063216_security_hardening_2026_05_27.sql` | same | MCP | same SQL, comments or whitespace differ |
| 17 | `20260527080658_lockdown_admin_functions_2026_05_27.sql` | same | MCP | same SQL, comments or whitespace differ |
| 18 | `20260606150000_booking_conversion_attribution.sql` | same | CLI push | same SQL, comments or whitespace differ |
| 19 | `20260606170000_campaign_effectiveness_upgrade.sql` | same | CLI push | same SQL, comments or whitespace differ |
| 20 | `20260608115311_food_booking_ad_set_fields.sql` | same | CLI push | same SQL, comments or whitespace differ |
| 21 | `20260609092541_ad_metrics_history.sql` | same | CLI push | same SQL, comments or whitespace differ |
| 22 | `20260610052138_ad_sets_food_window_unique.sql` | same | CLI push | same SQL, comments or whitespace differ |
| 23 | `20260629140000_remove_gbp_objects.sql` | same | no SQL stored (note 2) | nothing to compare; effects verified live (note 2) |
| 24 | `20260705120000_publish_job_resolution.sql` | same | no SQL stored (note 2) | nothing to compare; effects verified live (note 2) |
| 25 | `20260707120000_booking_conversion_match_keys.sql` | same | CLI push | same SQL, comments or whitespace differ |
| 26 | `20260714120000_multibrand_foundation.sql` | same | CLI push | same SQL, comments or whitespace differ |
| 27 | `20260714130000_multibrand_rls_membership.sql` | same | CLI push | same SQL, comments or whitespace differ |
| 28 | `20260714140000_booking_ingest_per_brand.sql` | same | CLI push | same SQL, comments or whitespace differ |
| 29 | `20260809120000_campaign_kind_food_booking.sql` | **20260809074632** | MCP | same SQL, comments or whitespace differ |
| 30 | `20260825090338_media_asset_provenance.sql` | same | MCP | exact |
| 31 | `20260905052738_revoke_anon_execute_on_tenant_functions.sql` | same | MCP | same SQL, comments or whitespace differ |
| 32 | `20260905053036_default_privileges_stop_anon_inheriting.sql` | same | MCP | same SQL, comments or whitespace differ |
| 33 | `20260905053345_revoke_anon_grants_on_secret_bearing_tables.sql` | same | MCP | exact |
| 34 | `20260905055500_restore_anon_execute_on_tenant_predicates.sql` | **20260905053659** | MCP | same SQL, comments or whitespace differ |
| 35 | `20260905063918_link_in_bio_analytics_service_role_insert.sql` | **20260905054514** | MCP | same SQL, comments or whitespace differ |
| 36 | `20260905071016_nations_championship_screenings.sql` | **20260905075919** | MCP | exact |
| 37 | `20260905071500_revoke_anon_execute_on_trigger_functions.sql` | **20260905054726** | MCP | same SQL, comments or whitespace differ |
| 38 | `20260905072213_tournament_screening_revision_guard.sql` | **20260905075927** | MCP | exact |
| 39 | `20260910103048_meta_campaigns_delivery_schedule.sql` | **20260910113202** | MCP | exact |
| 40 | `20260922034915_campaign_engagement_metrics.sql` | **20260922040934** | MCP | exact |
| 41 | `20260922120000_brand_profile_business_type.sql` | **20260922124618** | MCP | exact |
| 42 | `20260922140000_posting_defaults_default_event_venue.sql` | **20260922130310** | MCP | exact |
| 43 | `20260922150000_accounts_allow_new_brands.sql` | **20260922140726** | MCP | exact |
| 44 | `20260922160000_meta_campaigns_controlled_test.sql` | **20260922150937** | MCP | exact |
| 45 | `20260924090000_accounts_feature_flags.sql` | **20260924073244** | MCP | exact |
| 46 | `20260924100000_revoke_direct_content_media_writes.sql` | **20260924081719** | MCP | exact |
| 47 | `20260924120000_ai_usage_events.sql` | **20260924085419** | MCP | exact |
| 48 | `20260924130000_billing_schema.sql` | **20260924101504** | MCP | exact |
| 49 | `20260924140000_account_member_roles.sql` | **20260924101514** | MCP | exact |
| 50 | `20260924141000_user_auth_snapshot_own_row.sql` | **20260924101519** | MCP | exact |
| 51 | `20260924150000_publishing_hold.sql` | **20260924110731** | MCP | exact |
| 52 | `20260925090000_meta_data_requests.sql` | **20260925165504** | MCP | exact |
| 53 | `20260925100000_brand_offboarding.sql` | **20260925165509** | MCP | exact |
| 54 | `20260925180000_meta_ad_account_tokens.sql` | **20260925172639** | MCP | exact |
| 55 | `20260925181000_meta_ad_accounts_service_role_only.sql` | **20260925172645** | MCP | exact |
| 56 | `20260926070000_clear_meta_ad_plaintext_tokens.sql` | **20260926070109** | MCP | exact |
| 57 | `20260926120000_subscriptions_period_start.sql` | **20260926121228** | MCP | exact |
| 58 | `20260926130000_local_rebuild_matches_production.sql` | **20260926131137** | MCP | exact |
| 59 | `20260927120000_data_retention.sql` | **20260927123048** | MCP | exact |
| 60 | `20260928120000_auth_rate_limit_consume.sql` | **20260928104602** | MCP | exact |
| 61 | `20260928153000_self_serve_signup_flag.sql` | **20260928110409** | MCP | exact |
| 62 | `20260928161500_team_invitations.sql` | **20260928111735** | MCP | exact |
| 63 | `20260928170000_self_serve_signups.sql` | **20260928124011** | MCP | exact |
| 64 | `20260928180000_auth_users_snapshot_triggers.sql` | **20260928120538** | MCP | exact |
| 65 | `20260928190000_provision_self_serve_brand.sql` | **20260928142314** | MCP | exact |

Notes:

1. Three early CLI pushes were edited on 23 May (commits `572377da`, `9a5169f2`, `dc9125ea`) to
   guard legacy-only columns so the chain builds from scratch. Production ran the original
   versions: the live statements match `c2a75d74`, `aa637862` and `397b1409` exactly after
   normalising. Expected; no action.
2. `remove_gbp_objects` and `publish_job_resolution` were recorded without SQL (likely by hand or
   by an older CLI `migration repair`; today's CLI stores the file's statements). Their effects are
   live: no
   `gbp_*` tables or columns remain, and `publish_jobs` has `resolved_at`, `resolution_kind`,
   `resolution_note`, `publish_jobs_resolution_kind_check` and both resolution indexes. No action.
3. `20260905063918_link_in_bio_analytics_service_role_insert.sql` still says "NOT YET APPLIED" in
   its header; production applied it at `20260905054514`. A stale comment only, left for a
   separate change.

## Options considered

| | A. CLI `migration repair` | B. Rewrite the version in place (recommended) | C. Rename the 33 files | D. Leave it, document the rule |
|---|---|---|---|---|
| Production write | 33 inserts, 33 deletes | 33 single-column updates | none | none |
| Runs any migration SQL | no | no | no | no |
| All or nothing | no: two commands, each its own transaction | yes: one statement with guards | n/a | n/a |
| Keeps the SQL production actually ran, and `created_by` | no: replaced by the file text, `created_by` lost | yes | yes | yes |
| Needs the database password | yes (Peter types it) | no (MCP, as today) | no | no |
| Repo change | none | none | 33 renames; 46 other files mention the old names, mostly in comments (14 `supabase/tests` checks, 13 source and test files, 18 docs) | none |
| Effect on CI migration-check and `db:rebuild` | none | none | changes the apply order in two places (below); needs a full rebuild and parity proof | none |
| `db push` usable afterwards | yes | yes | yes | no |

Option C would run `revoke_anon_execute_on_trigger_functions` before
`nations_championship_screenings`, and `auth_users_snapshot_triggers` before `self_serve_signups`,
on every local rebuild and in CI, and would make each developer's local database see 33 "new"
migrations. Option D leaves `db push` unusable and the drift growing, which hides real drift.

## Proposal: option B, plus a rule that stops it recurring

### 1. Pre-flight (read only)

Run immediately before the change. Expected: `at_apply_time_versions = 33`,
`file_versions_taken = 0`, `total_rows = 65`. It returned exactly that on 28 September 2026. If
another migration has been applied since, `total_rows` will be higher; that is fine as long as the
first two numbers hold. If a newer MCP migration's file version differs from its live version, add
it to the map (and set `expected` to match) before running the change.

```sql
with migration_version_map(live_version, file_version, name) as (values
    ('20260809074632', '20260809120000', 'campaign_kind_food_booking'),
    ('20260905053659', '20260905055500', 'restore_anon_execute_on_tenant_predicates'),
    ('20260905054514', '20260905063918', 'link_in_bio_analytics_service_role_insert'),
    ('20260905075919', '20260905071016', 'nations_championship_screenings'),
    ('20260905054726', '20260905071500', 'revoke_anon_execute_on_trigger_functions'),
    ('20260905075927', '20260905072213', 'tournament_screening_revision_guard'),
    ('20260910113202', '20260910103048', 'meta_campaigns_delivery_schedule'),
    ('20260922040934', '20260922034915', 'campaign_engagement_metrics'),
    ('20260922124618', '20260922120000', 'brand_profile_business_type'),
    ('20260922130310', '20260922140000', 'posting_defaults_default_event_venue'),
    ('20260922140726', '20260922150000', 'accounts_allow_new_brands'),
    ('20260922150937', '20260922160000', 'meta_campaigns_controlled_test'),
    ('20260924073244', '20260924090000', 'accounts_feature_flags'),
    ('20260924081719', '20260924100000', 'revoke_direct_content_media_writes'),
    ('20260924085419', '20260924120000', 'ai_usage_events'),
    ('20260924101504', '20260924130000', 'billing_schema'),
    ('20260924101514', '20260924140000', 'account_member_roles'),
    ('20260924101519', '20260924141000', 'user_auth_snapshot_own_row'),
    ('20260924110731', '20260924150000', 'publishing_hold'),
    ('20260925165504', '20260925090000', 'meta_data_requests'),
    ('20260925165509', '20260925100000', 'brand_offboarding'),
    ('20260925172639', '20260925180000', 'meta_ad_account_tokens'),
    ('20260925172645', '20260925181000', 'meta_ad_accounts_service_role_only'),
    ('20260926070109', '20260926070000', 'clear_meta_ad_plaintext_tokens'),
    ('20260926121228', '20260926120000', 'subscriptions_period_start'),
    ('20260926131137', '20260926130000', 'local_rebuild_matches_production'),
    ('20260927123048', '20260927120000', 'data_retention'),
    ('20260928104602', '20260928120000', 'auth_rate_limit_consume'),
    ('20260928110409', '20260928153000', 'self_serve_signup_flag'),
    ('20260928111735', '20260928161500', 'team_invitations'),
    ('20260928124011', '20260928170000', 'self_serve_signups'),
    ('20260928120538', '20260928180000', 'auth_users_snapshot_triggers'),
    ('20260928142314', '20260928190000', 'provision_self_serve_brand')
)
select
  (select count(*) from supabase_migrations.schema_migrations s
     join migration_version_map m on m.live_version = s.version and m.name = s.name) as at_apply_time_versions,
  (select count(*) from supabase_migrations.schema_migrations s
     join migration_version_map m on m.file_version = s.version) as file_versions_taken,
  (select count(*) from supabase_migrations.schema_migrations) as total_rows;
```

### 2. The change (one statement, needs Peter's yes)

Run once through MCP `execute_sql` (or the SQL editor). It changes only the `version` column of
the 33 rows. If any guard fails it raises, and the whole statement rolls back with nothing changed.
Running it a second time fails guard 1 and changes nothing.

```sql
DO $$
DECLARE
  expected constant integer := 33;
  found_rows integer;
  collisions integer;
  moved integer;
BEGIN
  CREATE TEMP TABLE migration_version_map (
    live_version text PRIMARY KEY,
    file_version text NOT NULL UNIQUE,
    name text NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO migration_version_map (live_version, file_version, name) VALUES
    ('20260809074632', '20260809120000', 'campaign_kind_food_booking'),
    ('20260905053659', '20260905055500', 'restore_anon_execute_on_tenant_predicates'),
    ('20260905054514', '20260905063918', 'link_in_bio_analytics_service_role_insert'),
    ('20260905075919', '20260905071016', 'nations_championship_screenings'),
    ('20260905054726', '20260905071500', 'revoke_anon_execute_on_trigger_functions'),
    ('20260905075927', '20260905072213', 'tournament_screening_revision_guard'),
    ('20260910113202', '20260910103048', 'meta_campaigns_delivery_schedule'),
    ('20260922040934', '20260922034915', 'campaign_engagement_metrics'),
    ('20260922124618', '20260922120000', 'brand_profile_business_type'),
    ('20260922130310', '20260922140000', 'posting_defaults_default_event_venue'),
    ('20260922140726', '20260922150000', 'accounts_allow_new_brands'),
    ('20260922150937', '20260922160000', 'meta_campaigns_controlled_test'),
    ('20260924073244', '20260924090000', 'accounts_feature_flags'),
    ('20260924081719', '20260924100000', 'revoke_direct_content_media_writes'),
    ('20260924085419', '20260924120000', 'ai_usage_events'),
    ('20260924101504', '20260924130000', 'billing_schema'),
    ('20260924101514', '20260924140000', 'account_member_roles'),
    ('20260924101519', '20260924141000', 'user_auth_snapshot_own_row'),
    ('20260924110731', '20260924150000', 'publishing_hold'),
    ('20260925165504', '20260925090000', 'meta_data_requests'),
    ('20260925165509', '20260925100000', 'brand_offboarding'),
    ('20260925172639', '20260925180000', 'meta_ad_account_tokens'),
    ('20260925172645', '20260925181000', 'meta_ad_accounts_service_role_only'),
    ('20260926070109', '20260926070000', 'clear_meta_ad_plaintext_tokens'),
    ('20260926121228', '20260926120000', 'subscriptions_period_start'),
    ('20260926131137', '20260926130000', 'local_rebuild_matches_production'),
    ('20260927123048', '20260927120000', 'data_retention'),
    ('20260928104602', '20260928120000', 'auth_rate_limit_consume'),
    ('20260928110409', '20260928153000', 'self_serve_signup_flag'),
    ('20260928111735', '20260928161500', 'team_invitations'),
    ('20260928124011', '20260928170000', 'self_serve_signups'),
    ('20260928120538', '20260928180000', 'auth_users_snapshot_triggers'),
    ('20260928142314', '20260928190000', 'provision_self_serve_brand');

  -- Guard 1: all 33 rows sit at their apply-time versions under the expected names.
  SELECT count(*) INTO found_rows
    FROM supabase_migrations.schema_migrations s
    JOIN migration_version_map m ON m.live_version = s.version AND m.name = s.name;
  IF found_rows <> expected THEN
    RAISE EXCEPTION 'Expected % rows at their apply-time versions, found %. Nothing changed.', expected, found_rows;
  END IF;

  -- Guard 2: none of the file versions is already taken.
  SELECT count(*) INTO collisions
    FROM supabase_migrations.schema_migrations s
    JOIN migration_version_map m ON m.file_version = s.version;
  IF collisions <> 0 THEN
    RAISE EXCEPTION '% file versions already exist. Nothing changed.', collisions;
  END IF;

  UPDATE supabase_migrations.schema_migrations s
     SET version = m.file_version
    FROM migration_version_map m
   WHERE s.version = m.live_version AND s.name = m.name;
  GET DIAGNOSTICS moved = ROW_COUNT;
  IF moved <> expected THEN
    RAISE EXCEPTION 'Moved % rows, expected %. Nothing changed.', moved, expected;
  END IF;
END $$;
```

Tested on the local database inside a transaction that was rolled back (history rebuilt as
production's 65 rows): the change moved all 33 rows, left statements and `created_by` intact and
the row count at 65; a second run failed guard 1; a stray row at a file version failed guard 2;
a missing live row failed guard 1; the rollback below restored the apply-time versions. The local
history was unchanged afterwards.

### Exact effect on `supabase_migrations.schema_migrations`

- 33 rows change their `version` value from the apply-time version to the file version.
- `name`, `statements`, `created_by`, `idempotency_key` and `rollback` are untouched on every row.
- The row count stays the same; no row is inserted or deleted.
- No DDL and no migration SQL runs. No other table is touched. The update holds row locks on the
  33 rows for milliseconds, so there is no downtime.
- The history's order becomes the file order, which differs from apply order in the two places
  listed under option C. Nothing in the app or scripts reads this table (no reference to
  `schema_migrations` in `src`, `tests`, `scripts` or `supabase/functions`).

### Effect on CI migration-check and `npm run db:rebuild`

None. Both build a fresh local database from the files in `supabase/migrations`, in file-name
order, with the v1 baseline staged at `20260519230001`. They never read production's history, and
option B changes no file. The staged baseline stays local-only: if it were ever present during a
push, the CLI refuses it as an out-of-order migration unless `--include-all` is passed.

### 3. Validation (read only, after the change)

- Re-run the pre-flight: expect `at_apply_time_versions = 0` and `file_versions_taken = 33`.
- `list_migrations`: every version equals a file version in `supabase/migrations` on `main`, with
  the same name, and there are no extra rows.
- Optional, Peter only (needs the database password), from the main checkout, which is already
  linked to `nbkjciurhvkfpcpatbnt`:
  - `npx supabase migration list --linked`: 65 rows, local and remote identical.
  - `npx supabase db push --dry-run --linked`: reports nothing to push.

### Rollback

The same statement in reverse, with the same guards. It returns the 33 rows to their apply-time
versions, which this spec's table records.

```sql
DO $$
DECLARE
  expected constant integer := 33;
  found_rows integer;
  collisions integer;
  moved integer;
BEGIN
  CREATE TEMP TABLE migration_version_map (
    live_version text PRIMARY KEY,
    file_version text NOT NULL UNIQUE,
    name text NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO migration_version_map (live_version, file_version, name) VALUES
    ('20260809074632', '20260809120000', 'campaign_kind_food_booking'),
    ('20260905053659', '20260905055500', 'restore_anon_execute_on_tenant_predicates'),
    ('20260905054514', '20260905063918', 'link_in_bio_analytics_service_role_insert'),
    ('20260905075919', '20260905071016', 'nations_championship_screenings'),
    ('20260905054726', '20260905071500', 'revoke_anon_execute_on_trigger_functions'),
    ('20260905075927', '20260905072213', 'tournament_screening_revision_guard'),
    ('20260910113202', '20260910103048', 'meta_campaigns_delivery_schedule'),
    ('20260922040934', '20260922034915', 'campaign_engagement_metrics'),
    ('20260922124618', '20260922120000', 'brand_profile_business_type'),
    ('20260922130310', '20260922140000', 'posting_defaults_default_event_venue'),
    ('20260922140726', '20260922150000', 'accounts_allow_new_brands'),
    ('20260922150937', '20260922160000', 'meta_campaigns_controlled_test'),
    ('20260924073244', '20260924090000', 'accounts_feature_flags'),
    ('20260924081719', '20260924100000', 'revoke_direct_content_media_writes'),
    ('20260924085419', '20260924120000', 'ai_usage_events'),
    ('20260924101504', '20260924130000', 'billing_schema'),
    ('20260924101514', '20260924140000', 'account_member_roles'),
    ('20260924101519', '20260924141000', 'user_auth_snapshot_own_row'),
    ('20260924110731', '20260924150000', 'publishing_hold'),
    ('20260925165504', '20260925090000', 'meta_data_requests'),
    ('20260925165509', '20260925100000', 'brand_offboarding'),
    ('20260925172639', '20260925180000', 'meta_ad_account_tokens'),
    ('20260925172645', '20260925181000', 'meta_ad_accounts_service_role_only'),
    ('20260926070109', '20260926070000', 'clear_meta_ad_plaintext_tokens'),
    ('20260926121228', '20260926120000', 'subscriptions_period_start'),
    ('20260926131137', '20260926130000', 'local_rebuild_matches_production'),
    ('20260927123048', '20260927120000', 'data_retention'),
    ('20260928104602', '20260928120000', 'auth_rate_limit_consume'),
    ('20260928110409', '20260928153000', 'self_serve_signup_flag'),
    ('20260928111735', '20260928161500', 'team_invitations'),
    ('20260928124011', '20260928170000', 'self_serve_signups'),
    ('20260928120538', '20260928180000', 'auth_users_snapshot_triggers'),
    ('20260928142314', '20260928190000', 'provision_self_serve_brand');

  -- Guard 1: all 33 rows sit at their file versions under the expected names.
  SELECT count(*) INTO found_rows
    FROM supabase_migrations.schema_migrations s
    JOIN migration_version_map m ON m.file_version = s.version AND m.name = s.name;
  IF found_rows <> expected THEN
    RAISE EXCEPTION 'Expected % rows at their file versions, found %. Nothing changed.', expected, found_rows;
  END IF;

  -- Guard 2: none of the apply-time versions is already taken.
  SELECT count(*) INTO collisions
    FROM supabase_migrations.schema_migrations s
    JOIN migration_version_map m ON m.live_version = s.version;
  IF collisions <> 0 THEN
    RAISE EXCEPTION '% apply-time versions already exist. Nothing changed.', collisions;
  END IF;

  UPDATE supabase_migrations.schema_migrations s
     SET version = m.live_version
    FROM migration_version_map m
   WHERE s.version = m.file_version AND s.name = m.name;
  GET DIAGNOSTICS moved = ROW_COUNT;
  IF moved <> expected THEN
    RAISE EXCEPTION 'Moved % rows, expected %. Nothing changed.', moved, expected;
  END IF;
END $$;
```

### Alternative: option A with the CLI

Only if the CLI route is preferred. Peter runs these from a clean checkout of `main` (all 65
files present, no staged `20260519230001_v1_baseline.sql`), typing the database password when
asked. Run `applied` first so that no migration ever looks unapplied between the two commands.

```bash
npx supabase migration repair --linked --status applied 20260809120000 20260905055500 20260905063918 20260905071016 20260905071500 20260905072213 20260910103048 20260922034915 20260922120000 20260922140000 20260922150000 20260922160000 20260924090000 20260924100000 20260924120000 20260924130000 20260924140000 20260924141000 20260924150000 20260925090000 20260925100000 20260925180000 20260925181000 20260926070000 20260926120000 20260926130000 20260927120000 20260928120000 20260928153000 20260928161500 20260928170000 20260928180000 20260928190000
```

```bash
npx supabase migration repair --linked --status reverted 20260809074632 20260905053659 20260905054514 20260905075919 20260905054726 20260905075927 20260910113202 20260922040934 20260922124618 20260922130310 20260922140726 20260922150937 20260924073244 20260924081719 20260924085419 20260924101504 20260924101514 20260924101519 20260924110731 20260925165504 20260925165509 20260925172639 20260925172645 20260926070109 20260926121228 20260926131137 20260927123048 20260928104602 20260928110409 20260928111735 20260928124011 20260928120538 20260928142314
```

From the CLI source (`apps/cli-go/internal/migration/repair/repair.go`): `applied` reads each file
and upserts `(version, name, statements)` with the file's parsed statements; `reverted` deletes
the listed versions. Neither executes migration SQL. The cost against option B: the SQL that MCP
recorded as actually run, and `created_by`, are deleted with the old rows, and the two commands
are separate transactions.

## Forward rule (a follow-up PR adds it to `CLAUDE.md`, Supabase specifics)

When a migration is applied with MCP `apply_migration`:

1. Pass the file's name part (after the timestamp) as `name`, and the file's content unchanged as
   `query`.
2. Read the version MCP assigned from `list_migrations`.
3. In the same PR, before merge, `git mv` the file to `<assigned version>_<name>.sql` and update
   any references to the old file name.
4. Confirm the file version, name and content match the live row before merging.

This is the pattern the six files that already match followed (for example
`20260905052738_revoke_anon_execute_on_tenant_functions.sql`). It keeps production writes to
migrations only; the rename happens while the PR is still open, so nothing else refers to the old
name yet. Editing an applied file's comments later is harmless but means the history holds the
text that ran, not the file's text.

## Deployment order

1. Merge this spec (documentation only; nothing deploys).
2. With Peter's yes: pre-flight, the change, validation, all through MCP.
3. Follow-up PR: the forward rule in `CLAUDE.md`.

No app code depends on any of this, so no deploy has to happen before or after the change.

## Assumptions

- The CLI compares migrations by version alone (`FindPendingMigrations`); names and statements
  play no part in `migration list` or `db push`. Read from source, not from a run against
  production.
- Nothing else writes to `supabase_migrations.schema_migrations` on this project except MCP
  `apply_migration` and the CLI. The project has a Supabase branching record for `main` (created
  14 July 2026, never updated); whether the GitHub integration deploys migrations on merge was not
  checked.
- Other sessions are applying migrations today (`provision_self_serve_brand` was applied at 14:23
  UTC and merged in #146 during this investigation). The guards make a stale map fail safely
  rather than apply half a change.
