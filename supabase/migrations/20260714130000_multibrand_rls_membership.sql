-- Multi-brand tenancy PR2: membership-based RLS rewrite (expand phase).
--
-- Replaces the single-owner tenancy predicates used across the schema with the
-- membership helpers created by PR1 (20260714120000_multibrand_foundation.sql):
--   * public.is_account_member(uuid) -- SECURITY DEFINER, super-admin OR account_members row
--   * public.is_super_admin()        -- SECURITY DEFINER, app_admins row
--
-- Every existing tenancy predicate that keyed off the calling user's single
-- account (either the scalar subquery `(SELECT accounts.id FROM accounts WHERE
-- accounts.auth_user_id = auth.uid())` or `current_account_id()`) is rewritten
-- to `public.is_account_member(<account_id>)`, so any user listed in
-- public.account_members for a brand can act on that brand's rows.
--
-- Ordering (see tasks/PR2-rls-policy-manifest.md):
--   STEP 1  Meta/oauth_states FK reconciliation (account_id -> public.accounts)
--   STEP 2  Rewrite every tenancy policy (buckets A, B, C, D, E)
--   STEP 3  Bucket F -- intentionally left untouched (documented below)
--   STEP 4  Drop the single-owner UNIQUE on accounts.auth_user_id
--   STEP 5  Canonical, NOT NULL, non-blank accounts.business_name
--   STEP 6  current_account_id() left in place (now deprecated/unused by policies)
--
-- This migration MUST run after PR1. It rewrites RLS in place and does not drop
-- accounts.auth_user_id (only its UNIQUE constraint). No app/TS files change.

begin;

-- ============================================================================
-- STEP 1 -- Meta/oauth_states FK reconciliation
-- ----------------------------------------------------------------------------
-- Today account_id on these tables carries a FK to auth.users(id) and stores an
-- auth user id. is_account_member(account_id) resolves against public.accounts,
-- so before the Bucket-B rewrites below can match, account_id must hold the true
-- accounts.id and its FK must reference public.accounts(id).
--
-- Catalog-driven and idempotent: the auth.users FK is discovered by name from
-- pg_constraint (tolerates prod/branch name drift), the backfill is an identity
-- no-op on current data (accounts.id == auth_user_id for the existing tenant)
-- but correct if ids ever diverge, and the new FK is only added when absent.
-- ============================================================================
do $$
declare
  t                text;
  reconcile_tables text[] := array[
    'meta_campaigns',
    'meta_ad_accounts',
    'meta_optimisation_actions',
    'meta_optimisation_runs',
    'ad_metrics_history',
    'booking_conversion_events',
    'oauth_states'
  ];
  v_rel            regclass;
  v_account_attnum smallint;
  v_conname        text;
  v_orphans        bigint;
begin
  foreach t in array reconcile_tables loop
    v_rel := to_regclass('public.' || t);
    if v_rel is null then
      raise notice 'FK reconciliation: table public.% is absent, skipping', t;
      continue;
    end if;

    -- account_id must exist on this table before we touch its FK.
    select a.attnum
      into v_account_attnum
      from pg_attribute a
     where a.attrelid = v_rel
       and a.attname = 'account_id'
       and a.attnum > 0
       and not a.attisdropped;
    if v_account_attnum is null then
      raise notice 'FK reconciliation: %.account_id is absent, skipping', t;
      continue;
    end if;

    -- (a) Drop whatever FK currently constrains account_id to auth.users.
    for v_conname in
      select c.conname
        from pg_constraint c
       where c.conrelid = v_rel
         and c.contype = 'f'
         and c.confrelid = 'auth.users'::regclass
         and v_account_attnum = any (c.conkey)
    loop
      execute format('alter table public.%I drop constraint %I', t, v_conname);
      raise notice 'FK reconciliation: dropped % (%.account_id -> auth.users)', v_conname, t;
    end loop;

    -- (b) Backfill stored auth-user-id -> accounts.id (identity no-op today).
    execute format(
      'update public.%I x
          set account_id = a.id
         from public.accounts a
        where x.account_id = a.auth_user_id
          and x.account_id <> a.id', t);

    -- Surface orphans (account_id not resolvable to any accounts.id). The
    -- ADD CONSTRAINT below will hard-fail on these, which is the safe outcome.
    execute format(
      'select count(*) from public.%I x
        where x.account_id is not null
          and not exists (select 1 from public.accounts a where a.id = x.account_id)', t)
      into v_orphans;
    if v_orphans > 0 then
      raise warning 'FK reconciliation: %.account_id has % orphan row(s) with no matching accounts.id; new FK will fail', t, v_orphans;
    end if;

    -- (c) Add the named FK to public.accounts if not already present.
    if not exists (
      select 1
        from pg_constraint c
       where c.conrelid = v_rel
         and c.contype = 'f'
         and c.confrelid = 'public.accounts'::regclass
         and v_account_attnum = any (c.conkey)
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (account_id) references public.accounts(id) on delete cascade',
        t, t || '_account_id_accounts_fkey');
      raise notice 'FK reconciliation: added %_account_id_accounts_fkey (%.account_id -> public.accounts)', t, t;
    end if;
  end loop;
end $$;

-- ============================================================================
-- STEP 2 prerequisites -- grants required for the rewritten policies to work
-- under the roles that actually hit RLS.
--   * anon needs EXECUTE on the membership helpers, otherwise anonymous reads
--     of `to public` tables raise "permission denied for function" (a 500)
--     instead of returning an empty set. For anon (auth.uid() is null) both
--     helpers return false, so this grants no access -- only clean fail-closed.
--   * authenticated needs SELECT on account_members because the storage.objects
--     media policies run as the authenticated user and read account_members
--     directly. account_members RLS still restricts rows to the caller's own
--     memberships, so this exposes nothing beyond the user's own access list.
-- ============================================================================
grant execute on function public.is_account_member(uuid) to anon;
grant execute on function public.is_super_admin() to anon;
grant select on public.account_members to authenticated;

-- ============================================================================
-- STEP 2 -- RLS policy rewrites (buckets A, B, C, D, E), grouped by table.
-- Command, roles, and any service_role OR branch are preserved verbatim; only
-- the tenant predicate is replaced. `with_check` is left null where it was null
-- so Postgres keeps applying USING to the write check (unless a bucket refines
-- it -- see accounts UPDATE in Bucket C).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- accounts (Bucket C). The three "... by owner" duplicates reference
-- current_account_id() and are dropped without recreate (folded into the
-- canonical accounts_* set below).
-- ---------------------------------------------------------------------------
drop policy if exists "Accounts readable by owner"   on public.accounts;
drop policy if exists "Accounts insertable by owner" on public.accounts;
drop policy if exists "Accounts updatable by owner"  on public.accounts;

drop policy if exists accounts_select on public.accounts;
create policy accounts_select on public.accounts
  for select to public
  -- Use the SECURITY DEFINER helper (super-admin OR membership). Inlining the
  -- account_members subquery here would evaluate with the CALLER's privileges,
  -- which PR1 revoked from authenticated/anon -> permission-denied for members.
  using (public.is_account_member(accounts.id));

drop policy if exists accounts_insert on public.accounts;
create policy accounts_insert on public.accounts
  for insert to public
  with check (public.is_super_admin());

-- Deliberate refinement of the manifest (which had UPDATE as super-admin only):
-- access-only membership means a member can edit their own brand's settings.
drop policy if exists accounts_update on public.accounts;
create policy accounts_update on public.accounts
  for update to public
  using (public.is_account_member(accounts.id))
  with check (public.is_account_member(accounts.id));

drop policy if exists accounts_delete on public.accounts;
create policy accounts_delete on public.accounts
  for delete to public
  using (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- ad_metrics_history (Bucket B.1)
-- ---------------------------------------------------------------------------
drop policy if exists "Ad metrics history accessible by account" on public.ad_metrics_history;
create policy "Ad metrics history accessible by account" on public.ad_metrics_history
  for all to public
  using ((auth.role() = 'service_role'::text) or public.is_account_member(account_id))
  with check ((auth.role() = 'service_role'::text) or public.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- ad_sets (Bucket B.3 -- scopes via campaigns join; with_check stays null)
-- ---------------------------------------------------------------------------
drop policy if exists "Users can manage their own ad sets" on public.ad_sets;
create policy "Users can manage their own ad sets" on public.ad_sets
  for all to public
  using (exists (
    select 1 from public.campaigns c
     where c.id = ad_sets.campaign_id
       and public.is_account_member(c.account_id)
  ));

-- ---------------------------------------------------------------------------
-- ads (Bucket B.3 -- scopes via ad_sets -> campaigns join; with_check stays null)
-- ---------------------------------------------------------------------------
drop policy if exists "Users can manage their own ads" on public.ads;
create policy "Users can manage their own ads" on public.ads
  for all to public
  using (exists (
    select 1
      from public.ad_sets ads2
      join public.campaigns c on c.id = ads2.campaign_id
     where ads2.id = ads.adset_id
       and public.is_account_member(c.account_id)
  ));

-- ---------------------------------------------------------------------------
-- analytics_snapshots (Bucket A)
-- ---------------------------------------------------------------------------
drop policy if exists analytics_snapshots_select on public.analytics_snapshots;
create policy analytics_snapshots_select on public.analytics_snapshots
  for select to public using (public.is_account_member(account_id));

drop policy if exists analytics_snapshots_insert on public.analytics_snapshots;
create policy analytics_snapshots_insert on public.analytics_snapshots
  for insert to public with check (public.is_account_member(account_id));

drop policy if exists analytics_snapshots_update on public.analytics_snapshots;
create policy analytics_snapshots_update on public.analytics_snapshots
  for update to public using (public.is_account_member(account_id));

drop policy if exists analytics_snapshots_delete on public.analytics_snapshots;
create policy analytics_snapshots_delete on public.analytics_snapshots
  for delete to public using (public.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- audit_log (Bucket A)
-- ---------------------------------------------------------------------------
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to public using (public.is_account_member(account_id));

drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log
  for insert to public with check (public.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- booking_conversion_events (Bucket B.2)
-- ---------------------------------------------------------------------------
drop policy if exists "Users can view their own booking conversions" on public.booking_conversion_events;
create policy "Users can view their own booking conversions" on public.booking_conversion_events
  for select to public using (public.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- brand_profile (Bucket B.1)
-- ---------------------------------------------------------------------------
drop policy if exists "Brand profile accessible by account" on public.brand_profile;
create policy "Brand profile accessible by account" on public.brand_profile
  for all to public
  using ((auth.role() = 'service_role'::text) or public.is_account_member(account_id))
  with check ((auth.role() = 'service_role'::text) or public.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- campaigns (Bucket B.1 + B.2 duplicate ALL policies; both retained)
-- ---------------------------------------------------------------------------
drop policy if exists "Campaigns accessible by account" on public.campaigns;
create policy "Campaigns accessible by account" on public.campaigns
  for all to public
  using ((auth.role() = 'service_role'::text) or public.is_account_member(account_id))
  with check ((auth.role() = 'service_role'::text) or public.is_account_member(account_id));

drop policy if exists "Users can manage their own campaigns" on public.campaigns;
create policy "Users can manage their own campaigns" on public.campaigns
  for all to public
  using (public.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- content_item_versions (Bucket A)
-- ---------------------------------------------------------------------------
drop policy if exists content_item_versions_select on public.content_item_versions;
create policy content_item_versions_select on public.content_item_versions
  for select to public using (public.is_account_member(account_id));

drop policy if exists content_item_versions_insert on public.content_item_versions;
create policy content_item_versions_insert on public.content_item_versions
  for insert to public with check (public.is_account_member(account_id));

drop policy if exists content_item_versions_update on public.content_item_versions;
create policy content_item_versions_update on public.content_item_versions
  for update to public using (public.is_account_member(account_id));

drop policy if exists content_item_versions_delete on public.content_item_versions;
create policy content_item_versions_delete on public.content_item_versions
  for delete to public using (public.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- content_items (Bucket B.1 + Bucket A; overlapping policies retained)
-- ---------------------------------------------------------------------------
drop policy if exists "Content items accessible by account" on public.content_items;
create policy "Content items accessible by account" on public.content_items
  for all to public
  using ((auth.role() = 'service_role'::text) or public.is_account_member(account_id))
  with check ((auth.role() = 'service_role'::text) or public.is_account_member(account_id));

drop policy if exists content_items_select on public.content_items;
create policy content_items_select on public.content_items
  for select to public using (public.is_account_member(account_id));

drop policy if exists content_items_insert on public.content_items;
create policy content_items_insert on public.content_items
  for insert to public with check (public.is_account_member(account_id));

drop policy if exists content_items_update on public.content_items;
create policy content_items_update on public.content_items
  for update to public using (public.is_account_member(account_id));

drop policy if exists content_items_delete on public.content_items;
create policy content_items_delete on public.content_items
  for delete to public using (public.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- content_media_attachments (Bucket D -- child of content_items)
-- ---------------------------------------------------------------------------
drop policy if exists content_media_attachments_select on public.content_media_attachments;
create policy content_media_attachments_select on public.content_media_attachments
  for select to public
  using (content_item_id in (
    select content_items.id from public.content_items
     where public.is_account_member(content_items.account_id)
  ));

drop policy if exists content_media_attachments_insert on public.content_media_attachments;
create policy content_media_attachments_insert on public.content_media_attachments
  for insert to public
  with check (content_item_id in (
    select content_items.id from public.content_items
     where public.is_account_member(content_items.account_id)
  ));

drop policy if exists content_media_attachments_update on public.content_media_attachments;
create policy content_media_attachments_update on public.content_media_attachments
  for update to public
  using (content_item_id in (
    select content_items.id from public.content_items
     where public.is_account_member(content_items.account_id)
  ));

drop policy if exists content_media_attachments_delete on public.content_media_attachments;
create policy content_media_attachments_delete on public.content_media_attachments
  for delete to public
  using (content_item_id in (
    select content_items.id from public.content_items
     where public.is_account_member(content_items.account_id)
  ));

-- ---------------------------------------------------------------------------
-- content_templates (Bucket B.1)
-- ---------------------------------------------------------------------------
drop policy if exists "Content templates accessible by account" on public.content_templates;
create policy "Content templates accessible by account" on public.content_templates
  for all to public
  using ((auth.role() = 'service_role'::text) or public.is_account_member(account_id))
  with check ((auth.role() = 'service_role'::text) or public.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- content_variants (Bucket B.3 -- child of content_items)
-- ---------------------------------------------------------------------------
drop policy if exists "Content variants accessible via parent" on public.content_variants;
create policy "Content variants accessible via parent" on public.content_variants
  for all to public
  using ((auth.role() = 'service_role'::text) or exists (
    select 1 from public.content_items ci
     where ci.id = content_variants.content_item_id
       and public.is_account_member(ci.account_id)
  ))
  with check ((auth.role() = 'service_role'::text) or exists (
    select 1 from public.content_items ci
     where ci.id = content_variants.content_item_id
       and public.is_account_member(ci.account_id)
  ));

-- ---------------------------------------------------------------------------
-- link_in_bio_clicks (Bucket D owner_select; _service_insert left untouched)
-- ---------------------------------------------------------------------------
drop policy if exists link_in_bio_clicks_owner_select on public.link_in_bio_clicks;
create policy link_in_bio_clicks_owner_select on public.link_in_bio_clicks
  for select to public
  using (profile_id in (
    select link_in_bio_profiles.id from public.link_in_bio_profiles
     where public.is_account_member(link_in_bio_profiles.account_id)
  ));

-- ---------------------------------------------------------------------------
-- link_in_bio_page_views (Bucket D owner_select; _service_insert left untouched)
-- ---------------------------------------------------------------------------
drop policy if exists link_in_bio_page_views_owner_select on public.link_in_bio_page_views;
create policy link_in_bio_page_views_owner_select on public.link_in_bio_page_views
  for select to public
  using (profile_id in (
    select link_in_bio_profiles.id from public.link_in_bio_profiles
     where public.is_account_member(link_in_bio_profiles.account_id)
  ));

-- ---------------------------------------------------------------------------
-- link_in_bio_profiles (Bucket B.1 + Bucket A; overlapping policies retained)
-- ---------------------------------------------------------------------------
drop policy if exists "Link-in-bio profiles accessible by account" on public.link_in_bio_profiles;
create policy "Link-in-bio profiles accessible by account" on public.link_in_bio_profiles
  for all to public
  using ((auth.role() = 'service_role'::text) or public.is_account_member(account_id))
  with check ((auth.role() = 'service_role'::text) or public.is_account_member(account_id));

drop policy if exists link_in_bio_profiles_select on public.link_in_bio_profiles;
create policy link_in_bio_profiles_select on public.link_in_bio_profiles
  for select to public using (public.is_account_member(account_id));

drop policy if exists link_in_bio_profiles_insert on public.link_in_bio_profiles;
create policy link_in_bio_profiles_insert on public.link_in_bio_profiles
  for insert to public with check (public.is_account_member(account_id));

drop policy if exists link_in_bio_profiles_update on public.link_in_bio_profiles;
create policy link_in_bio_profiles_update on public.link_in_bio_profiles
  for update to public using (public.is_account_member(account_id));

drop policy if exists link_in_bio_profiles_delete on public.link_in_bio_profiles;
create policy link_in_bio_profiles_delete on public.link_in_bio_profiles
  for delete to public using (public.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- link_in_bio_tiles (Bucket B.1 + Bucket A; overlapping policies retained)
-- ---------------------------------------------------------------------------
drop policy if exists "Link-in-bio tiles accessible by account" on public.link_in_bio_tiles;
create policy "Link-in-bio tiles accessible by account" on public.link_in_bio_tiles
  for all to public
  using ((auth.role() = 'service_role'::text) or public.is_account_member(account_id))
  with check ((auth.role() = 'service_role'::text) or public.is_account_member(account_id));

drop policy if exists link_in_bio_tiles_select on public.link_in_bio_tiles;
create policy link_in_bio_tiles_select on public.link_in_bio_tiles
  for select to public using (public.is_account_member(account_id));

drop policy if exists link_in_bio_tiles_insert on public.link_in_bio_tiles;
create policy link_in_bio_tiles_insert on public.link_in_bio_tiles
  for insert to public with check (public.is_account_member(account_id));

drop policy if exists link_in_bio_tiles_update on public.link_in_bio_tiles;
create policy link_in_bio_tiles_update on public.link_in_bio_tiles
  for update to public using (public.is_account_member(account_id));

drop policy if exists link_in_bio_tiles_delete on public.link_in_bio_tiles;
create policy link_in_bio_tiles_delete on public.link_in_bio_tiles
  for delete to public using (public.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- media_assets (Bucket B.1)
-- ---------------------------------------------------------------------------
drop policy if exists "Media assets accessible by account" on public.media_assets;
create policy "Media assets accessible by account" on public.media_assets
  for all to public
  using ((auth.role() = 'service_role'::text) or public.is_account_member(account_id))
  with check ((auth.role() = 'service_role'::text) or public.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- media_library (Bucket A)
-- ---------------------------------------------------------------------------
drop policy if exists media_library_select on public.media_library;
create policy media_library_select on public.media_library
  for select to public using (public.is_account_member(account_id));

drop policy if exists media_library_insert on public.media_library;
create policy media_library_insert on public.media_library
  for insert to public with check (public.is_account_member(account_id));

drop policy if exists media_library_update on public.media_library;
create policy media_library_update on public.media_library
  for update to public using (public.is_account_member(account_id));

drop policy if exists media_library_delete on public.media_library;
create policy media_library_delete on public.media_library
  for delete to public using (public.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- meta_ad_accounts (Bucket B.2 -- with_check stays null)
-- ---------------------------------------------------------------------------
drop policy if exists "Users can manage their own ad account" on public.meta_ad_accounts;
create policy "Users can manage their own ad account" on public.meta_ad_accounts
  for all to public
  using (public.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- meta_campaigns (Bucket B.2)
-- ---------------------------------------------------------------------------
drop policy if exists "Users can manage their own meta campaigns" on public.meta_campaigns;
create policy "Users can manage their own meta campaigns" on public.meta_campaigns
  for all to public
  using (public.is_account_member(account_id))
  with check (public.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- meta_optimisation_actions (Bucket B.2)
-- ---------------------------------------------------------------------------
drop policy if exists "Users can view their own optimisation actions" on public.meta_optimisation_actions;
create policy "Users can view their own optimisation actions" on public.meta_optimisation_actions
  for all to public
  using (public.is_account_member(account_id))
  with check (public.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- meta_optimisation_runs (Bucket B.2)
-- ---------------------------------------------------------------------------
drop policy if exists "Users can view their own optimisation runs" on public.meta_optimisation_runs;
create policy "Users can view their own optimisation runs" on public.meta_optimisation_runs
  for all to public
  using (public.is_account_member(account_id))
  with check (public.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- notifications (Bucket B.1 + Bucket A; overlapping policies retained)
-- ---------------------------------------------------------------------------
drop policy if exists "Notifications accessible by account" on public.notifications;
create policy "Notifications accessible by account" on public.notifications
  for all to public
  using ((auth.role() = 'service_role'::text) or public.is_account_member(account_id))
  with check ((auth.role() = 'service_role'::text) or public.is_account_member(account_id));

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to public using (public.is_account_member(account_id));

drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications
  for insert to public with check (public.is_account_member(account_id));

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to public using (public.is_account_member(account_id));

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete to public using (public.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- posting_defaults (Bucket B.1)
-- ---------------------------------------------------------------------------
drop policy if exists "Posting defaults accessible by account" on public.posting_defaults;
create policy "Posting defaults accessible by account" on public.posting_defaults
  for all to public
  using ((auth.role() = 'service_role'::text) or public.is_account_member(account_id))
  with check ((auth.role() = 'service_role'::text) or public.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- profiles (Bucket A)
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to public using (public.is_account_member(account_id));

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to public with check (public.is_account_member(account_id));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to public using (public.is_account_member(account_id));

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete to public using (public.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- provider_rate_limits (Bucket A -- no DELETE policy exists)
-- ---------------------------------------------------------------------------
drop policy if exists rate_limits_select on public.provider_rate_limits;
create policy rate_limits_select on public.provider_rate_limits
  for select to public using (public.is_account_member(account_id));

drop policy if exists rate_limits_insert on public.provider_rate_limits;
create policy rate_limits_insert on public.provider_rate_limits
  for insert to public with check (public.is_account_member(account_id));

drop policy if exists rate_limits_update on public.provider_rate_limits;
create policy rate_limits_update on public.provider_rate_limits
  for update to public using (public.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- publish_attempts (Bucket A)
-- ---------------------------------------------------------------------------
drop policy if exists publish_attempts_select on public.publish_attempts;
create policy publish_attempts_select on public.publish_attempts
  for select to public using (public.is_account_member(account_id));

drop policy if exists publish_attempts_insert on public.publish_attempts;
create policy publish_attempts_insert on public.publish_attempts
  for insert to public with check (public.is_account_member(account_id));

drop policy if exists publish_attempts_update on public.publish_attempts;
create policy publish_attempts_update on public.publish_attempts
  for update to public using (public.is_account_member(account_id));

drop policy if exists publish_attempts_delete on public.publish_attempts;
create policy publish_attempts_delete on public.publish_attempts
  for delete to public using (public.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- publish_jobs (Bucket B.3 via content + Bucket A on account_id; both retained)
-- ---------------------------------------------------------------------------
drop policy if exists "Publish jobs accessible via content" on public.publish_jobs;
create policy "Publish jobs accessible via content" on public.publish_jobs
  for all to public
  using ((auth.role() = 'service_role'::text) or exists (
    select 1 from public.content_items ci
     where ci.id = publish_jobs.content_item_id
       and public.is_account_member(ci.account_id)
  ))
  with check ((auth.role() = 'service_role'::text) or exists (
    select 1 from public.content_items ci
     where ci.id = publish_jobs.content_item_id
       and public.is_account_member(ci.account_id)
  ));

drop policy if exists publish_jobs_select on public.publish_jobs;
create policy publish_jobs_select on public.publish_jobs
  for select to public using (public.is_account_member(account_id));

drop policy if exists publish_jobs_insert on public.publish_jobs;
create policy publish_jobs_insert on public.publish_jobs
  for insert to public with check (public.is_account_member(account_id));

drop policy if exists publish_jobs_update on public.publish_jobs;
create policy publish_jobs_update on public.publish_jobs
  for update to public using (public.is_account_member(account_id));

drop policy if exists publish_jobs_delete on public.publish_jobs;
create policy publish_jobs_delete on public.publish_jobs
  for delete to public using (public.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- social_connections (Bucket B.1 + Bucket A; overlapping policies retained)
-- ---------------------------------------------------------------------------
drop policy if exists "Social connections accessible by account" on public.social_connections;
create policy "Social connections accessible by account" on public.social_connections
  for all to public
  using ((auth.role() = 'service_role'::text) or public.is_account_member(account_id))
  with check ((auth.role() = 'service_role'::text) or public.is_account_member(account_id));

drop policy if exists social_connections_select on public.social_connections;
create policy social_connections_select on public.social_connections
  for select to public using (public.is_account_member(account_id));

drop policy if exists social_connections_insert on public.social_connections;
create policy social_connections_insert on public.social_connections
  for insert to public with check (public.is_account_member(account_id));

drop policy if exists social_connections_update on public.social_connections;
create policy social_connections_update on public.social_connections
  for update to public using (public.is_account_member(account_id));

drop policy if exists social_connections_delete on public.social_connections;
create policy social_connections_delete on public.social_connections
  for delete to public using (public.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- token_vault (Bucket D -- child of social_connections)
-- ---------------------------------------------------------------------------
drop policy if exists token_vault_select on public.token_vault;
create policy token_vault_select on public.token_vault
  for select to public
  using (social_connection_id in (
    select social_connections.id from public.social_connections
     where public.is_account_member(social_connections.account_id)
  ));

drop policy if exists token_vault_insert on public.token_vault;
create policy token_vault_insert on public.token_vault
  for insert to public
  with check (social_connection_id in (
    select social_connections.id from public.social_connections
     where public.is_account_member(social_connections.account_id)
  ));

drop policy if exists token_vault_update on public.token_vault;
create policy token_vault_update on public.token_vault
  for update to public
  using (social_connection_id in (
    select social_connections.id from public.social_connections
     where public.is_account_member(social_connections.account_id)
  ));

drop policy if exists token_vault_delete on public.token_vault;
create policy token_vault_delete on public.token_vault
  for delete to public
  using (social_connection_id in (
    select social_connections.id from public.social_connections
     where public.is_account_member(social_connections.account_id)
  ));

-- ---------------------------------------------------------------------------
-- tournament_fixtures (Bucket B.3 -- child of tournaments)
-- ---------------------------------------------------------------------------
drop policy if exists "Fixtures accessible via tournament account" on public.tournament_fixtures;
create policy "Fixtures accessible via tournament account" on public.tournament_fixtures
  for all to public
  using ((auth.role() = 'service_role'::text) or exists (
    select 1 from public.tournaments t
     where t.id = tournament_fixtures.tournament_id
       and public.is_account_member(t.account_id)
  ))
  with check ((auth.role() = 'service_role'::text) or exists (
    select 1 from public.tournaments t
     where t.id = tournament_fixtures.tournament_id
       and public.is_account_member(t.account_id)
  ));

-- ---------------------------------------------------------------------------
-- tournaments (Bucket B.1)
-- ---------------------------------------------------------------------------
drop policy if exists "Tournaments accessible by account owner" on public.tournaments;
create policy "Tournaments accessible by account owner" on public.tournaments
  for all to public
  using ((auth.role() = 'service_role'::text) or public.is_account_member(account_id))
  with check ((auth.role() = 'service_role'::text) or public.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- storage.objects media bucket (Bucket E). media_read_by_account is a
-- redundant, multi-account-broken JWT duplicate of the media SELECT path and is
-- dropped (folded into media_select). Folder segment 1 is compared as TEXT to
-- the caller's memberships (no uuid cast).
--
-- storage.objects is owned by supabase_storage_admin. Where the migration role
-- cannot alter it (e.g. the local CI stack), this block skips with a warning
-- instead of failing the whole migration: storage RLS is defence-in-depth (the
-- app serves media via service-role signed URLs). In that case apply these
-- policies manually as supabase_storage_admin.
-- ---------------------------------------------------------------------------
do $$
begin
  drop policy if exists media_read_by_account on storage.objects;

  drop policy if exists media_select on storage.objects;
create policy media_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'media'::text
    and (
      (storage.foldername(name))[1] in (
        select account_members.account_id::text
          from public.account_members
         where account_members.user_id = auth.uid()
      )
      or public.is_super_admin()
    )
  );

drop policy if exists media_insert on storage.objects;
create policy media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'::text
    and (
      (storage.foldername(name))[1] in (
        select account_members.account_id::text
          from public.account_members
         where account_members.user_id = auth.uid()
      )
      or public.is_super_admin()
    )
  );

drop policy if exists media_update on storage.objects;
create policy media_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'media'::text
    and (
      (storage.foldername(name))[1] in (
        select account_members.account_id::text
          from public.account_members
         where account_members.user_id = auth.uid()
      )
      or public.is_super_admin()
    )
  );

  drop policy if exists media_delete on storage.objects;
  create policy media_delete on storage.objects
    for delete to authenticated
    using (
      bucket_id = 'media'::text
      and (
        (storage.foldername(name))[1] in (
          select account_members.account_id::text
            from public.account_members
           where account_members.user_id = auth.uid()
        )
        or public.is_super_admin()
      )
    );
exception
  when insufficient_privilege then
    raise warning 'multibrand PR2: skipped storage.objects media policy rewrite (insufficient privilege on storage.objects). Apply as supabase_storage_admin. Detail: %', sqlerrm;
end $$;

-- ============================================================================
-- STEP 3 -- Bucket F: intentionally NOT touched.
-- These carry no account-tenancy predicate that the membership model changes
-- (service-role-only system tables, user-scoped created_by, public analytics
-- inserts, and one intentionally-global authenticated read). Left verbatim:
--   public.auth_rate_limits             -> "Auth rate limits service only"
--   public.management_app_connections   -> "Management app connections service only"
--   public.worker_heartbeats            -> "Worker heartbeats managed by service role"
--   public.oauth_states                 -> "OAuth states managed by service role"
--   public.oauth_states                 -> oauth_states_select   (created_by = auth.uid())
--   public.oauth_states                 -> oauth_states_insert   (created_by = auth.uid())
--   public.oauth_states                 -> oauth_states_update   (created_by = auth.uid())
--   public.link_in_bio_clicks           -> link_in_bio_clicks_service_insert   (with check true)
--   public.link_in_bio_page_views       -> link_in_bio_page_views_service_insert (with check true)
--   public.user_auth_snapshot           -> "User auth snapshot readable by authenticated" (true)
-- Note: oauth_states.account_id FK is re-pointed to public.accounts in STEP 1,
-- but its RLS keys off created_by, so no oauth_states policy is rewritten here.
-- ============================================================================

-- ============================================================================
-- STEP 4 -- Drop the single-owner UNIQUE so a user can be linked to many
-- accounts (and an account, in principle, retains one auth_user_id column but
-- is no longer globally unique on it). The column and its FK to auth.users stay.
-- ============================================================================
alter table public.accounts drop constraint if exists accounts_auth_user_id_key;

-- ============================================================================
-- STEP 5 -- Canonical, non-blank business_name for brand display.
-- ============================================================================
update public.accounts
   set business_name = coalesce(
     nullif(btrim(business_name), ''),
     nullif(btrim(display_name), ''),
     nullif(btrim(email), ''),
     'Brand'
   )
 where business_name is null or btrim(business_name) = '';

alter table public.accounts alter column business_name set not null;

-- Guarded add (Postgres has no ADD CONSTRAINT IF NOT EXISTS) so a re-run after a
-- partial failure does not abort on "constraint already exists".
alter table public.accounts drop constraint if exists accounts_business_name_not_blank;
alter table public.accounts
  add constraint accounts_business_name_not_blank check (btrim(business_name) <> '');

-- ============================================================================
-- STEP 6 -- public.current_account_id() is left in place. It is now DEPRECATED
-- and no longer referenced by any RLS policy (all tenancy predicates use
-- public.is_account_member(...)). It is NOT dropped here because other database
-- functions may still reference it; removing it is out of scope for PR2.
-- ============================================================================

commit;
