# Spec: a signed-in user can no longer write to any table directly

Owner approval: 15 November 2026. Asked: "Shall I also stop customers releasing posts held for non-payment and writing other tables directly?" Peter's reply: "Yes, fix it".

Follows `tasks/SPEC-accounts-member-writes-revoked.md` (the `accounts` table, same day) and `tasks/SPEC-revoke-anon-table-writes.md` (the public key, 24 October 2026).

## Problem

- `authenticated` is the role behind every signed-in session. A customer can call the Supabase API with their own session, outside the app.
- On 15 November 2026 it held INSERT, UPDATE, DELETE and TRUNCATE on 30 tables and one view, and TRUNCATE on five more tables. These grants were copied from the v1 database.
- Row level security limits a member to their own brand's rows. It does not limit what they do with them. Through the API a member could:
  - move a post held for non-payment back into the queue (`publish_jobs.status` from `held` to `queued`);
  - write their own rows in `token_vault` and `social_connections`;
  - rewrite or remove their brand's `audit_log`, `notifications` and `publish_attempts`;
  - change paid campaign records (`meta_campaigns`, `campaigns`, `ad_sets`, `ads`) without the app's checks.
- TRUNCATE ignores row level security altogether; it is only out of reach because the API does not offer it.
- New tables: `postgres`, the role that runs migrations, still handed `authenticated` every privilege on each table it created.

## Checked live on 15 November 2026 (project nbkjciurhvkfpcpatbnt)

- **The 36 relations.**
  - Full writes: ad_metrics_history, ad_sets, ads, analytics_snapshots, audit_log, booking_conversion_events, brand_profile, campaigns, content_item_versions, content_templates, link_in_bio_clicks, link_in_bio_page_views, link_in_bio_profiles, link_in_bio_tiles, management_app_connections, meta_campaigns, meta_optimisation_actions, meta_optimisation_runs, notifications, posting_defaults, profiles, provider_rate_limits, publish_attempts, publish_jobs, social_connections, token_vault, tournament_fixtures, tournaments, user_auth_snapshot, worker_heartbeats, and the view publish_jobs_with_variant.
  - TRUNCATE only: content_items, content_media_attachments, content_variants, media_assets, media_library.
  - These are every public relation where `authenticated` holds a write. None go through PUBLIC and none are column grants. `accounts` was closed earlier the same day.
- **App paths.** No table write in `src/` uses a user session:
  - `requireAuthContext()` returns the service-role client (`src/lib/auth/server.ts:102`), and every action writes through it;
  - the session client (`createServerSupabaseClient`) is used for sign-in calls and for reads in `src/lib/content/queries.ts` and `src/lib/media/resolve-thumbnails.ts`;
  - the browser client is used for realtime subscriptions (`notification-badge.tsx`, `use-realtime-feed.ts`), which need SELECT, and for storage uploads (`src/lib/media/upload.ts`), which use the storage schema and are not touched;
  - crons, webhooks, sign-up, invitations and the publish-queue edge function use the service role.
- **Functions.** The only public functions `authenticated` can execute are `is_account_member`, `is_super_admin`, `current_account_id`, two trigger functions and the btree_gist extension's. None writes to a table.
- **Proved, then undone.** Inside a rolled-back transaction with a real non-admin member's session claims: every read the app relies on still worked; releasing held posts, and writes to token_vault, social_connections, audit_log, notifications and meta_campaigns were each refused; the service role could still write. Nothing was changed.

## Decisions

- One migration. For each of the 36 relations it revokes everything `authenticated` holds and grants SELECT back where it held SELECT, in one transaction. It then checks that no relation in public is left writable by `authenticated`, and aborts if one is.
- REFERENCES and TRIGGER go too: a user session never needs them.
- Default privileges for `postgres` in `public` are narrowed to SELECT for `authenticated`, so a new table starts read-only for user sessions.
- `anon` and `service_role` are not changed. Policies stay; without the privilege they give a user session no write.
- Sequences and functions are not changed.
- `supabase/tests/authenticated_table_writes_revoked_verify.sql` checks the catalogue for every relation in public and asks the role itself; CI runs it on every from-scratch rebuild.

## What would break, and how it would show

An action that writes with a user session instead of the service role would get "permission denied" (Postgres 42501). None exists today. If one is added later it fails at once in development, not silently.

## Rollback

For each relation in the migration's list: `grant insert, update, delete, truncate, references, trigger on table public.<name> to authenticated;` (TRUNCATE only for the last five). For the default: `alter default privileges for role postgres in schema public grant all on tables to authenticated;`. No app deploy is tied to this migration in either direction.

## Tests

- The migration's own checks.
- The verify script on CI's fresh rebuild, and its checks on production after applying.
- The rolled-back member trial described above.
- CI's e2e smoke suite (real sign-in) on the PR, and a signed-in check of Planner, Create, Settings and Admin on production after the merge.
