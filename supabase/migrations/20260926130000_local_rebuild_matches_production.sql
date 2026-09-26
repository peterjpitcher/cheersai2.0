-- Make a database rebuilt from this migration chain match production.
--
-- WHY
-- A fresh rebuild (`npm run db:rebuild`, CI's migration-check) did not look like
-- production, so app paths that work live failed locally, and CI checked a schema
-- production does not have. The Stripe end-to-end test found it on 26 September
-- 2026; a read-only diff of a fresh rebuild's catalogue against production
-- (nbkjciurhvkfpcpatbnt) the same day found three kinds of drift:
--
--   1. Grants. Newer local Supabase images no longer give anon, authenticated and
--      service_role DML on new tables, so every service-role query failed with
--      "permission denied". Production grants them. The same gap applies to
--      function EXECUTE grants and to postgres's default privileges in public.
--   2. Table shapes. On production, content_items, publish_jobs,
--      social_connections, oauth_states, notifications, analytics_snapshots,
--      provider_rate_limits, link_in_bio_profiles and link_in_bio_tiles already
--      existed from v1 when the v2 chain ran, so its `create table if not exists`
--      skipped them and production kept the v1 shape: text status columns with
--      CHECK constraints, accounts.email, content_items.placement and platform,
--      social_connections.provider, and different keys. A rebuild got the v2
--      shape instead, so, for example, releaseHeldPublishJobs failed locally with
--      `invalid input value for enum content_status: "held"`, and the publish
--      scheduler took its v2 path because publish_jobs had a platform column.
--   3. One production migration, 20260905053345, was missing from the repo; it is
--      restored alongside this one.
--
-- WHAT
-- Every change below sits behind a catalogue check that is true only for the
-- shape the chain builds and false on production. Production matches every
-- target already, so there nothing runs: no DDL, no locks on app tables, only
-- catalogue reads. On a rebuild the blocks reshape each table to production's
-- definition, including dropping the chain-only columns, keys and one function
-- overload that production does not have (the tables are empty on a rebuild).
-- The grant blocks compare each object's grants with production's and change
-- only the difference, then fail if any difference is left.
--
-- Not covered (environment, not schema): extensions (a rebuild also has pg_net),
-- realtime's own message publication, and the storage bucket list.
--
-- ROLLBACK
-- Nothing to roll back on production (nothing runs there). A local database is
-- rebuilt, not rolled back: `npm run db:rebuild`.

-- 1. publish_jobs: enum status to text, production's keys and indexes, no platform
do $$
begin
  if (select atttypid from pg_attribute
       where attrelid = 'public.publish_jobs'::regclass and attname = 'status' and not attisdropped)
     is distinct from to_regtype('public.content_status') then
    return;
  end if;

  -- The view reads publish_jobs.status, so it has to go while the type changes.
  drop view if exists public.publish_jobs_with_variant;

  alter table public.publish_jobs drop constraint if exists publish_jobs_content_item_id_platform_excl;
  alter table public.publish_jobs drop constraint if exists publish_jobs_idempotency_key_key;
  alter table public.publish_jobs drop constraint if exists publish_jobs_status_check;
  drop index if exists public.idx_publish_jobs_active_failed;
  drop index if exists public.idx_publish_jobs_failed;
  drop index if exists public.idx_publish_jobs_scheduled_queued;
  drop index if exists public.idx_publish_jobs_unresolved_due;

  alter table public.publish_jobs alter column status drop default;
  alter table public.publish_jobs alter column status type text using status::text;
  alter table public.publish_jobs alter column status set default 'queued';
  alter table public.publish_jobs add constraint publish_jobs_status_check
    check (status = any (array['queued', 'in_progress', 'succeeded', 'failed', 'held']));

  -- Production has no platform column; the scheduler keys its legacy path off that.
  alter table public.publish_jobs drop column if exists platform;

  alter table public.publish_jobs alter column account_id drop not null;
  alter table public.publish_jobs alter column attempt set default 0;
  alter table public.publish_jobs alter column attempt set not null;
  alter table public.publish_jobs alter column idempotency_key drop not null;
  alter table public.publish_jobs alter column placement set default 'feed';
  alter table public.publish_jobs alter column placement set not null;
  alter table public.publish_jobs alter column scheduled_at drop not null;
  alter table public.publish_jobs alter column variant_id set not null;
  alter table public.publish_jobs add constraint publish_jobs_placement_check
    check (placement = any (array['feed', 'story']));
  alter table public.publish_jobs add constraint publish_jobs_variant_id_fkey
    foreign key (variant_id) references public.content_variants(id) on delete cascade;

  create index idx_publish_jobs_active_failed on public.publish_jobs (account_id, status, updated_at desc)
    where status = 'failed' and resolved_at is null;
  create index idx_publish_jobs_failed on public.publish_jobs (account_id) where status = 'failed';
  create index idx_publish_jobs_scheduled_queued on public.publish_jobs (scheduled_at) where status = 'queued';
  create index idx_publish_jobs_unresolved_due on public.publish_jobs (next_attempt_at)
    where status = 'queued' and resolved_at is null;
  create index publish_jobs_next_idx on public.publish_jobs (next_attempt_at);
  create index publish_jobs_status_idx on public.publish_jobs (status);
  create unique index publish_jobs_story_unique on public.publish_jobs (content_item_id, placement)
    where placement = 'story' and status = any (array['queued', 'in_progress']);
  create index publish_jobs_variant_id_idx on public.publish_jobs (variant_id);

  create view public.publish_jobs_with_variant with (security_invoker = true) as
    select pj.id, pj.content_item_id, pj.attempt, pj.status, pj.last_error, pj.provider_response,
           pj.next_attempt_at, pj.created_at, pj.updated_at, pj.placement, pj.variant_id, cv.media_ids
      from public.publish_jobs pj
      join public.content_variants cv on cv.id = pj.variant_id;
end $$;

-- 2. content_items: enum status to text, and the v1 columns production still has
do $$
begin
  if (select atttypid from pg_attribute
       where attrelid = 'public.content_items'::regclass and attname = 'status' and not attisdropped)
     is distinct from to_regtype('public.content_status') then
    return;
  end if;

  alter table public.content_items drop constraint if exists content_items_recurring_day_of_week_check;

  alter table public.content_items alter column status drop default;
  alter table public.content_items alter column status type text using status::text;
  alter table public.content_items alter column status set default 'draft';
  alter table public.content_items add constraint content_items_status_check
    check (status = any (array['draft', 'scheduled', 'queued', 'publishing', 'posted', 'failed']));
  alter table public.content_items alter column content_type set default 'instant_post'::public.content_type;

  alter table public.content_items add column if not exists auto_generated boolean not null default true;
  alter table public.content_items add column if not exists campaign_id uuid;
  alter table public.content_items add column if not exists content_pillar text;
  alter table public.content_items add column if not exists deleted_at timestamptz;
  alter table public.content_items add column if not exists hook_strategy text;
  alter table public.content_items add column if not exists placement text not null default 'feed';
  alter table public.content_items add column if not exists platform text;
  alter table public.content_items add column if not exists prompt_context jsonb;
  alter table public.content_items add column if not exists scheduled_for timestamptz;

  alter table public.content_items add constraint content_items_campaign_id_fkey
    foreign key (campaign_id) references public.campaigns(id) on delete set null;
  alter table public.content_items add constraint content_items_content_pillar_check
    check (content_pillar is null or content_pillar = any (array['food_drink', 'events', 'people', 'behind_scenes', 'customer_love', 'seasonal']));
  alter table public.content_items add constraint content_items_hook_strategy_check
    check (hook_strategy is null or hook_strategy = any (array['question', 'bold_statement', 'direct_address', 'curiosity_gap', 'seasonal', 'scarcity', 'behind_scenes', 'social_proof']));
  alter table public.content_items add constraint content_items_placement_check
    check (placement = any (array['feed', 'story']));
  alter table public.content_items add constraint content_items_platform_check
    check (platform = any (array['facebook', 'instagram', 'gbp']));

  create index content_items_account_idx on public.content_items (account_id);
  create index content_items_deleted_idx on public.content_items (deleted_at);
  create index content_items_schedule_idx on public.content_items (scheduled_for);
  create index content_items_status_idx on public.content_items (status);
  create index idx_content_items_account_schedule on public.content_items (account_id, scheduled_for);
end $$;

-- 3. social_connections: enum status to text, provider instead of platform
do $$
begin
  if (select atttypid from pg_attribute
       where attrelid = 'public.social_connections'::regclass and attname = 'status' and not attisdropped)
     is distinct from to_regtype('public.connection_status') then
    return;
  end if;

  alter table public.social_connections alter column status drop default;
  alter table public.social_connections alter column status type text using status::text;
  alter table public.social_connections alter column status set default 'needs_action';
  alter table public.social_connections add constraint social_connections_status_check
    check (status = any (array['active', 'expiring', 'needs_action']));

  -- Takes the chain's unique (account_id, platform, platform_account_id) with it.
  alter table public.social_connections drop column if exists platform;
  alter table public.social_connections add column if not exists provider text not null;
  alter table public.social_connections add column if not exists access_token text;
  alter table public.social_connections add column if not exists refresh_token text;
  alter table public.social_connections add column if not exists expires_at timestamptz;
  alter table public.social_connections alter column metadata drop default;
  alter table public.social_connections alter column platform_account_id drop not null;
  alter table public.social_connections add constraint social_connections_provider_check
    check (provider = any (array['facebook', 'instagram', 'gbp']));

  create index social_connections_account_idx on public.social_connections (account_id);
  create index social_connections_metadata_idx on public.social_connections using gin (metadata);
  create unique index social_connections_unique_provider on public.social_connections (account_id, provider);
end $$;

-- 4. oauth_states: text provider, the v1 columns, and the service-role policy
do $$
begin
  if (select atttypid from pg_attribute
       where attrelid = 'public.oauth_states'::regclass and attname = 'provider' and not attisdropped)
     is distinct from to_regtype('public.platform') then
    return;
  end if;

  alter table public.oauth_states alter column provider type text using provider::text;
  alter table public.oauth_states add constraint oauth_states_provider_check
    check (provider = any (array['facebook', 'instagram', 'gbp']));
  alter table public.oauth_states add column if not exists account_id uuid;
  alter table public.oauth_states add column if not exists auth_code text;
  alter table public.oauth_states add column if not exists code_verifier text;
  alter table public.oauth_states add column if not exists error text;
  alter table public.oauth_states alter column created_by drop default;
  alter table public.oauth_states alter column created_by drop not null;
  alter table public.oauth_states alter column expires_at drop not null;
  alter table public.oauth_states add constraint oauth_states_account_id_accounts_fkey
    foreign key (account_id) references public.accounts(id) on delete cascade;

  create index oauth_states_provider_idx on public.oauth_states (provider);
  create index oauth_states_used_idx on public.oauth_states (used_at);

  create policy "OAuth states managed by service role" on public.oauth_states
    using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
end $$;

-- 5. provider_rate_limits: text provider, and drop the chain-only enum overload
do $$
begin
  if (select atttypid from pg_attribute
       where attrelid = 'public.provider_rate_limits'::regclass and attname = 'provider' and not attisdropped)
     is distinct from to_regtype('public.platform') then
    return;
  end if;

  alter table public.provider_rate_limits alter column provider type text using provider::text;
  drop function if exists public.increment_rate_limit(uuid, public.platform, text, timestamptz, integer);
end $$;

-- 6. analytics_snapshots: text platform
do $$
begin
  if (select atttypid from pg_attribute
       where attrelid = 'public.analytics_snapshots'::regclass and attname = 'platform' and not attisdropped)
     is distinct from to_regtype('public.platform') then
    return;
  end if;

  alter table public.analytics_snapshots alter column platform type text using platform::text;
end $$;

-- 7. notifications: text urgency, message required, title optional
do $$
begin
  if (select atttypid from pg_attribute
       where attrelid = 'public.notifications'::regclass and attname = 'urgency' and not attisdropped)
     is distinct from to_regtype('public.notification_urgency') then
    return;
  end if;

  alter table public.notifications alter column urgency drop default;
  alter table public.notifications alter column urgency drop not null;
  alter table public.notifications alter column urgency type text using urgency::text;
  alter table public.notifications alter column urgency set default 'standard';
  alter table public.notifications alter column message set not null;
  alter table public.notifications alter column title drop not null;
  alter table public.notifications alter column metadata drop default;

  create index notifications_account_idx on public.notifications (account_id);
  create index notifications_account_unread_idx on public.notifications (account_id, created_at desc)
    where read_at is null;
  create index notifications_read_idx on public.notifications (read_at);
end $$;

-- 8. link_in_bio_profiles: keyed by account_id, as production is
do $$
begin
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.link_in_bio_profiles'::regclass and c.contype = 'p'
       and c.conkey = array[(select attnum from pg_attribute
                              where attrelid = 'public.link_in_bio_profiles'::regclass and attname = 'id')]
  ) then
    return;
  end if;

  -- Chain-only foreign keys onto profiles.id; production has none.
  alter table public.link_in_bio_clicks drop constraint if exists link_in_bio_clicks_profile_id_fkey;
  alter table public.link_in_bio_page_views drop constraint if exists link_in_bio_page_views_profile_id_fkey;
  alter table public.link_in_bio_tiles drop constraint if exists link_in_bio_tiles_profile_id_fkey;

  alter table public.link_in_bio_profiles drop constraint link_in_bio_profiles_pkey;
  alter table public.link_in_bio_profiles drop constraint if exists link_in_bio_profiles_account_id_key;
  alter table public.link_in_bio_profiles add constraint link_in_bio_profiles_pkey primary key (account_id);
  alter table public.link_in_bio_profiles alter column id drop not null;

  -- Production has the slug index without a constraint behind it.
  alter table public.link_in_bio_profiles drop constraint if exists link_in_bio_profiles_slug_key;
  create unique index if not exists link_in_bio_profiles_slug_key on public.link_in_bio_profiles (slug);

  alter table public.link_in_bio_profiles add constraint link_in_bio_profiles_hero_media_id_fkey
    foreign key (hero_media_id) references public.media_assets(id) on delete set null;
  create index link_in_bio_profiles_hero_media_idx on public.link_in_bio_profiles (hero_media_id);

  create trigger link_in_bio_profiles_touch_updated_at before update on public.link_in_bio_profiles
    for each row execute function public.touch_link_in_bio_updated_at();
end $$;

-- 9. link_in_bio_tiles: production's nullability, keys and indexes
do $$
begin
  if (select attnotnull from pg_attribute
       where attrelid = 'public.link_in_bio_tiles'::regclass and attname = 'cta_url' and not attisdropped) then
    return;
  end if;

  alter table public.link_in_bio_tiles drop constraint if exists link_in_bio_tiles_profile_id_fkey;
  alter table public.link_in_bio_tiles drop constraint if exists link_in_bio_tiles_position_check;
  alter table public.link_in_bio_tiles alter column cta_label drop default;
  alter table public.link_in_bio_tiles alter column cta_url set not null;
  alter table public.link_in_bio_tiles alter column profile_id drop not null;
  alter table public.link_in_bio_tiles add constraint link_in_bio_tiles_media_asset_id_fkey
    foreign key (media_asset_id) references public.media_assets(id) on delete set null;

  create index link_in_bio_tiles_account_idx on public.link_in_bio_tiles (account_id, position);
  create index link_in_bio_tiles_media_idx on public.link_in_bio_tiles (media_asset_id);

  create trigger link_in_bio_tiles_touch_updated_at before update on public.link_in_bio_tiles
    for each row execute function public.touch_link_in_bio_updated_at();
end $$;

-- 10. accounts: the contact email and display name, and no foreign key to auth.users
do $$
begin
  if exists (select 1 from pg_attribute
              where attrelid = 'public.accounts'::regclass and attname = 'email' and not attisdropped) then
    return;
  end if;

  -- Blank for any rows a local database already has; production has no default.
  alter table public.accounts add column email text not null default '';
  alter table public.accounts alter column email drop default;
  alter table public.accounts add column if not exists display_name text;
  alter table public.accounts drop constraint if exists accounts_auth_user_id_fkey;
end $$;

-- 11. Table and view grants for anon, authenticated and service_role, exactly as
-- production has them (read 26 September 2026). Letters are Postgres ACL letters:
-- a insert, r select, w update, d delete, D truncate, x references, t trigger,
-- m maintain (Postgres 17 and later only).
do $$
declare
  diff constant text := $q$
    with target(relname, anon, authenticated, service_role) as (values
      ('account_members',            '',         'r',        'arwdDxtm'),
      ('accounts',                   'arwdDxtm', 'arwdDxtm', 'arwdDxtm'),
      ('ad_metrics_history',         'arwdDxtm', 'arwdDxtm', 'arwdDxtm'),
      ('ad_sets',                    'arwdDxtm', 'arwdDxtm', 'arwdDxtm'),
      ('admin_audit',                '',         '',         'arwdDxtm'),
      ('ads',                        'arwdDxtm', 'arwdDxtm', 'arwdDxtm'),
      ('ai_usage_events',            '',         '',         'arwdDxtm'),
      ('analytics_snapshots',        'arwdDxtm', 'arwdDxtm', 'arwdDxtm'),
      ('app_admins',                 '',         '',         'arwdDxtm'),
      ('app_flags',                  '',         '',         'arwdDxtm'),
      ('audit_log',                  '',         'arwdDxtm', 'arwdDxtm'),
      ('auth_rate_limits',           '',         'arwdDxtm', 'arwdDxtm'),
      ('billing_customers',          '',         '',         'arwdDxtm'),
      ('booking_conversion_events',  'arwdDxtm', 'arwdDxtm', 'arwdDxtm'),
      ('brand_profile',              'arwdDxtm', 'arwdDxtm', 'arwdDxtm'),
      ('campaigns',                  'arwdDxtm', 'arwdDxtm', 'arwdDxtm'),
      ('content_item_versions',      'arwdDxtm', 'arwdDxtm', 'arwdDxtm'),
      ('content_items',              'rDxtm',    'rDxtm',    'arwdDxtm'),
      ('content_media_attachments',  'rDxtm',    'rDxtm',    'arwdDxtm'),
      ('content_templates',          'arwdDxtm', 'arwdDxtm', 'arwdDxtm'),
      ('content_variants',           'rDxtm',    'rDxtm',    'arwdDxtm'),
      ('link_in_bio_clicks',         'arwdDxtm', 'arwdDxtm', 'arwdDxtm'),
      ('link_in_bio_page_views',     'arwdDxtm', 'arwdDxtm', 'arwdDxtm'),
      ('link_in_bio_profiles',       'arwdDxtm', 'arwdDxtm', 'arwdDxtm'),
      ('link_in_bio_tiles',          'arwdDxtm', 'arwdDxtm', 'arwdDxtm'),
      ('management_app_connections', '',         'arwdDxtm', 'arwdDxtm'),
      ('media_assets',               'rDxtm',    'rDxtm',    'arwdDxtm'),
      ('media_library',              'rDxtm',    'rDxtm',    'arwdDxtm'),
      ('meta_ad_account_tokens',     '',         '',         'arwdDxtm'),
      ('meta_ad_accounts',           '',         '',         'arwdDxtm'),
      ('meta_campaigns',             'arwdDxtm', 'arwdDxtm', 'arwdDxtm'),
      ('meta_data_requests',         '',         '',         'arwdDxtm'),
      ('meta_optimisation_actions',  'arwdDxtm', 'arwdDxtm', 'arwdDxtm'),
      ('meta_optimisation_runs',     'arwdDxtm', 'arwdDxtm', 'arwdDxtm'),
      ('notifications',              'arwdDxtm', 'arwdDxtm', 'arwdDxtm'),
      ('oauth_states',               '',         'arwdDxtm', 'arwdDxtm'),
      ('posting_defaults',           'arwdDxtm', 'arwdDxtm', 'arwdDxtm'),
      ('profiles',                   'arwdDxtm', 'arwdDxtm', 'arwdDxtm'),
      ('provider_rate_limits',       '',         'arwdDxtm', 'arwdDxtm'),
      ('publish_attempts',           'arwdDxtm', 'arwdDxtm', 'arwdDxtm'),
      ('publish_jobs',               'arwdDxtm', 'arwdDxtm', 'arwdDxtm'),
      ('publish_jobs_with_variant',  'arwdDxtm', 'arwdDxtm', 'arwdDxtm'),
      ('social_connections',         'arwdDxtm', 'arwdDxtm', 'arwdDxtm'),
      ('stripe_events',              '',         '',         'arwdDxtm'),
      ('subscriptions',              '',         '',         'arwdDxtm'),
      ('token_vault',                '',         'arwdDxtm', 'arwdDxtm'),
      ('tournament_fixtures',        'arwdDxtm', 'arwdDxtm', 'arwdDxtm'),
      ('tournaments',                'arwdDxtm', 'arwdDxtm', 'arwdDxtm'),
      ('user_auth_snapshot',         '',         'arwdDxtm', 'arwdDxtm'),
      ('worker_heartbeats',          'arwdDxtm', 'arwdDxtm', 'arwdDxtm')
    ),
    letters(letter, priv) as (values
      ('a', 'INSERT'), ('r', 'SELECT'), ('w', 'UPDATE'), ('d', 'DELETE'),
      ('D', 'TRUNCATE'), ('x', 'REFERENCES'), ('t', 'TRIGGER'), ('m', 'MAINTAIN')
    ),
    wanted as (
      select t.relname, r.rolname, l.priv
        from target t
        cross join lateral (values ('anon', t.anon), ('authenticated', t.authenticated),
                                   ('service_role', t.service_role)) r(rolname, letters)
        join letters l on strpos(r.letters, l.letter) > 0
       where l.priv <> 'MAINTAIN' or current_setting('server_version_num')::int >= 170000
    ),
    held as (
      select c.relname, x.grantee::regrole::text as rolname, x.privilege_type as priv
        from target t
        join pg_class c on c.relname = t.relname and c.relnamespace = 'public'::regnamespace
        cross join lateral aclexplode(coalesce(c.relacl, acldefault('r'::"char", c.relowner))) x
       where x.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)
    )
    select format('grant %s on public.%I to %I', priv, relname, rolname)
      from (select * from wanted except select * from held) missing
    union all
    select format('revoke %s on public.%I from %I', priv, relname, rolname)
      from (select * from held except select * from wanted) extra
  $q$;
  stmt text;
  remaining int;
begin
  -- A listed table that does not exist yields a grant that fails, which is intended.
  for stmt in execute diff loop
    execute stmt;
  end loop;
  execute 'select count(*) from (' || diff || ') d' into remaining;
  if remaining > 0 then
    raise exception 'table grants still differ from production in % place(s)', remaining;
  end if;
end $$;

-- 12. Function EXECUTE grants, exactly as production has them. PUBLIC is the
-- implicit grant every new function gets unless it is revoked.
do $$
declare
  diff constant text := $q$
    with target(sig, grantees) as (values
      ('public.account_members_keep_an_owner()',                                                  'service_role'),
      ('public.advisory_lock_fixture(bigint)',                                                    'service_role'),
      ('public.current_account_id()',                                                             'PUBLIC,anon,authenticated,service_role'),
      ('public.finalise_imported_media_asset(uuid,uuid,bigint,jsonb,integer,integer,jsonb)',      'service_role'),
      ('public.guard_tournament_screening_revision()',                                            'service_role'),
      ('public.increment_rate_limit(uuid,text,text,timestamp with time zone,integer)',            'authenticated,service_role'),
      ('public.inspect_worker_db_context()',                                                      'service_role'),
      ('public.is_account_member(uuid)',                                                          'anon,authenticated,service_role'),
      ('public.is_super_admin()',                                                                 'anon,authenticated,service_role'),
      ('public.purge_user_auth_snapshot()',                                                       'service_role'),
      ('public.release_imported_media_asset(uuid,uuid)',                                          'service_role'),
      ('public.reserve_imported_media_asset(uuid,text,uuid,text,text,text[],interval)',           'service_role'),
      ('public.set_updated_at()',                                                                 'authenticated,service_role'),
      ('public.sync_user_auth_snapshot()',                                                        'service_role'),
      ('public.touch_link_in_bio_updated_at()',                                                   'authenticated,service_role')
    ),
    wanted as (
      select t.sig, g.grantee
        from target t
        cross join lateral unnest(string_to_array(t.grantees, ',')) g(grantee)
    ),
    held as (
      select t.sig, case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end as grantee
        from target t
        cross join lateral aclexplode(coalesce(
          (select proacl from pg_proc where oid = to_regprocedure(t.sig)),
          acldefault('f'::"char", (select proowner from pg_proc where oid = to_regprocedure(t.sig))))) x
       where x.grantee = 0 or x.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)
    )
    select format('grant execute on function %s to %s', sig, grantee)
      from (select * from wanted except select * from held) missing
    union all
    select format('revoke execute on function %s from %s', sig, grantee)
      from (select * from held except select * from wanted) extra
  $q$;
  stmt text;
  remaining int;
begin
  -- A listed function that does not exist yields a grant that fails, which is intended.
  for stmt in execute diff loop
    execute stmt;
  end loop;
  execute 'select count(*) from (' || diff || ') d' into remaining;
  if remaining > 0 then
    raise exception 'function grants still differ from production in % place(s)', remaining;
  end if;
end $$;

-- 13. Default privileges for objects postgres creates in public, as production
-- has them, so a table, sequence or function added by a later migration gets the
-- same grants locally as it does live. Letters: r select, w update, U usage,
-- X execute, and the table letters above.
do $$
declare
  diff constant text := $q$
    with target(objtype, rolname, letters) as (values
      ('r', 'authenticated', 'arwdDxtm'), ('r', 'service_role', 'arwdDxtm'),
      ('S', 'authenticated', 'rwU'),      ('S', 'service_role', 'rwU'),
      ('f', 'authenticated', 'X'),        ('f', 'service_role', 'X')
    ),
    letters(objtype, letter, priv) as (values
      ('r', 'a', 'INSERT'), ('r', 'r', 'SELECT'), ('r', 'w', 'UPDATE'), ('r', 'd', 'DELETE'),
      ('r', 'D', 'TRUNCATE'), ('r', 'x', 'REFERENCES'), ('r', 't', 'TRIGGER'), ('r', 'm', 'MAINTAIN'),
      ('S', 'r', 'SELECT'), ('S', 'w', 'UPDATE'), ('S', 'U', 'USAGE'),
      ('f', 'X', 'EXECUTE')
    ),
    wanted as (
      select t.objtype, t.rolname, l.priv
        from target t
        join letters l on l.objtype = t.objtype and strpos(t.letters, l.letter) > 0
       where l.priv <> 'MAINTAIN' or current_setting('server_version_num')::int >= 170000
    ),
    held as (
      select d.defaclobjtype::text as objtype, x.grantee::regrole::text as rolname, x.privilege_type as priv
        from pg_default_acl d
        cross join lateral aclexplode(d.defaclacl) x
       where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
         and d.defaclobjtype in ('r', 'S', 'f')
         and x.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)
    ),
    kinds(objtype, word) as (values ('r', 'tables'), ('S', 'sequences'), ('f', 'functions'))
    select format('alter default privileges for role postgres in schema public grant %s on %s to %I', m.priv, k.word, m.rolname)
      from (select * from wanted except select * from held) m join kinds k using (objtype)
    union all
    select format('alter default privileges for role postgres in schema public revoke %s on %s from %I', e.priv, k.word, e.rolname)
      from (select * from held except select * from wanted) e join kinds k using (objtype)
  $q$;
  stmt text;
  remaining int;
begin
  for stmt in execute diff loop
    execute stmt;
  end loop;
  execute 'select count(*) from (' || diff || ') d' into remaining;
  if remaining > 0 then
    raise exception 'default privileges still differ from production in % place(s)', remaining;
  end if;
end $$;

-- 14. Stop here if the points that broke the Stripe end-to-end test are still wrong.
do $$
begin
  if (select format_type(atttypid, atttypmod) from pg_attribute
       where attrelid = 'public.publish_jobs'::regclass and attname = 'status') <> 'text'
     or (select format_type(atttypid, atttypmod) from pg_attribute
          where attrelid = 'public.content_items'::regclass and attname = 'status') <> 'text' then
    raise exception 'publish_jobs.status and content_items.status must be text, as on production';
  end if;
  if not exists (select 1 from pg_attribute
                  where attrelid = 'public.accounts'::regclass and attname = 'email' and not attisdropped) then
    raise exception 'accounts.email is missing';
  end if;
end $$;
