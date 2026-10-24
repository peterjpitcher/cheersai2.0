# Spec: the public app key can no longer write to any table

Owner approval: 24 October 2026, relayed by the chief of staff session. Asked: "Tighten CheersAI's database permissions? 27 tables still let the public app key write to them. Today a second safeguard blocks this, but removing that access closes the gap for good." Peter's reply: "yes tighten the permissions".

## Problem
- `anon` is the role behind the public (anon) key, which every browser holds. Requests made without a signed-in session run as `anon`.
- On 24 October 2026, `anon` held write privileges it never needs on public relations. These grants were copied from the v1 database:
  - INSERT, UPDATE, DELETE and TRUNCATE on 26 tables and one view;
  - TRUNCATE on 5 more tables.
- Row level security is the only thing stopping those writes. TRUNCATE ignores row level security entirely; it is only out of reach today because the API does not offer it.

## Checked live on 24 October 2026 (project nbkjciurhvkfpcpatbnt)
- **The 32 relations.**
  - Full writes: accounts, ad_metrics_history, ad_sets, ads, analytics_snapshots, booking_conversion_events, brand_profile, campaigns, content_item_versions, content_templates, link_in_bio_clicks, link_in_bio_page_views, link_in_bio_profiles, link_in_bio_tiles, meta_campaigns, meta_optimisation_actions, meta_optimisation_runs, notifications, posting_defaults, profiles, publish_attempts, publish_jobs, social_connections, tournament_fixtures, tournaments, worker_heartbeats, and the view publish_jobs_with_variant.
  - TRUNCATE only: content_items, content_media_attachments, content_variants, media_assets, media_library.
  - These are every public relation where `anon` holds any write privilege.
  - None of the grants go through PUBLIC, and none are column grants.
- **Row level security** is on for all 31 tables. Every write policy that applies to `anon` needs one of:
  - brand membership (`is_account_member`);
  - a super admin (`is_super_admin`);
  - the service role (`auth.role() = 'service_role'`).

  booking_conversion_events, link_in_bio_clicks and link_in_bio_page_views have no write policy at all.
- **The view** runs with the caller's rights (`security_invoker=true`) and cannot be written through, so it leaks nothing.
- **Functions.** Five functions write to these tables. `provision_self_serve_brand` is closed to `anon`. `finalise_imported_media_asset`, `release_imported_media_asset`, `reserve_imported_media_asset` and `run_data_retention` run as their owner and are also closed to `anon`. No function `anon` can call writes to them.
- **App paths.** Everything that writes while signed out uses the service role:
  - link-in-bio page views and clicks (`src/lib/link-in-bio/click-tracking.ts`);
  - the booking-conversion ingest;
  - sign-up (`src/lib/signup/venue.ts`), invitations and the auth rate limit;
  - every cron and webhook route;
  - the publish-queue edge function.

  No browser-client code writes to any table, and the session clients on public pages are used only for sign-in calls and reads.
- **Default privileges.** Migration `20260905053036` already revoked `anon`'s default privileges in public for `postgres`, the role that runs migrations, so new tables give `anon` nothing. The one remaining default entry belongs to `supabase_admin`. The migration role cannot alter it, and it creates no app tables.
- **Other roles.** `authenticated` holds the same privileges `anon` does today, and `service_role` holds everything. Neither changes.

## Decisions
- One migration revokes INSERT, UPDATE, DELETE and TRUNCATE from `anon` on the 32 relations, named one by one. It then checks that `anon` can no longer write to any of them, by table or by column, and aborts if it can.
- No table is excluded, because nothing relies on `anon` writing.
- SELECT, REFERENCES, TRIGGER and MAINTAIN for `anon` stay as they are, and so does every other role.
- Default privileges are left alone: they are already closed for `postgres` (see above). A second revoke would do nothing on production.
- `supabase/tests/anon_table_writes_revoked_verify.sql` proves the result:
  - by the catalogue, for every relation in public;
  - by asking `anon` itself, with statements that touch no rows.

  It runs in CI's `migration-check` job on every fresh rebuild, so a later migration that grants `anon` a write fails CI. It is also run against production after applying.
- Applied through the Supabase MCP `apply_migration`, never a blanket `db push`. The file is then renamed to the version production records, before merging.

## Rollback
Run as postgres:
```sql
grant insert, update, delete, truncate on public.accounts, public.ad_metrics_history, public.ad_sets, public.ads,
  public.analytics_snapshots, public.booking_conversion_events, public.brand_profile, public.campaigns,
  public.content_item_versions, public.content_templates, public.link_in_bio_clicks, public.link_in_bio_page_views,
  public.link_in_bio_profiles, public.link_in_bio_tiles, public.meta_campaigns, public.meta_optimisation_actions,
  public.meta_optimisation_runs, public.notifications, public.posting_defaults, public.profiles, public.publish_attempts,
  public.publish_jobs, public.social_connections, public.tournament_fixtures, public.tournaments, public.worker_heartbeats,
  public.publish_jobs_with_variant to anon;
grant truncate on public.content_items, public.content_media_attachments, public.content_variants, public.media_assets,
  public.media_library to anon;
```
That restores exactly the earlier privileges. No data changes in either direction.

## Tests
- On a local rebuild:
  - the migration applies cleanly;
  - the verify script passes;
  - the verify script fails when a single write grant is put back.
- CI's `migration-check` runs the verify script on a fresh rebuild.
- After applying to production:
  - the verify script passes there;
  - the public role cannot insert, update or delete on any changed relation (`has_table_privilege` is false for each);
  - the next scheduled publish run still succeeds;
  - the link-in-bio page and its click logging still work.
