-- A signed-in user can no longer write to any table in public directly.
--
-- Owner approval: 15 November 2026. Asked: "Shall I also stop customers releasing posts held
-- for non-payment and writing other tables directly?" Peter's reply: "Yes, fix it".
-- Spec: tasks/SPEC-revoke-authenticated-table-writes.md.
--
-- `authenticated` is the role behind every signed-in session. A customer can call the Supabase
-- API with their own session, outside the app. The role held full write privileges on 30 tables
-- and one view, and one write-like privilege that ignores row level security on five more
-- tables, all copied from the v1 database. Row level security limits a member to their own
-- brand's rows but not to what the app would let them do with them: a member could move a post
-- held for non-payment back into the queue (publish_jobs), write their own connection token rows
-- (token_vault), or rewrite their audit trail (audit_log).
--
-- Checked on production on 15 November 2026 that nothing relies on it:
--   - every table write in src/ and in the publish-queue edge function uses the service role;
--     requireAuthContext() hands actions the service-role client;
--   - the session and browser clients are used only for sign-in calls, reads, realtime
--     subscriptions (which need SELECT) and storage uploads (the storage schema, not touched);
--   - no function `authenticated` can execute writes to a table.
--
-- What changes, per relation: everything `authenticated` holds is revoked and SELECT is granted
-- back where it held SELECT before, in this one transaction, so signed-in reads never fail.
-- accounts was done the same way on its own (20261115084453). anon and service_role are not
-- changed. Policies stay; without the privilege they give a user session no write.
--
-- Default privileges: postgres (the role that runs migrations) still handed `authenticated`
-- every privilege on each new table. That is narrowed to SELECT, so a table added later starts
-- read-only for user sessions unless its migration says otherwise.
--
-- Rollback: grant the old privileges back on the same relations and restore the default
-- (the SQL is in the spec).

do $$
declare
  v_relations constant text[] := array[
    -- full write access before this migration
    'ad_metrics_history',
    'ad_sets',
    'ads',
    'analytics_snapshots',
    'audit_log',
    'booking_conversion_events',
    'brand_profile',
    'campaigns',
    'content_item_versions',
    'content_templates',
    'link_in_bio_clicks',
    'link_in_bio_page_views',
    'link_in_bio_profiles',
    'link_in_bio_tiles',
    'management_app_connections',
    'meta_campaigns',
    'meta_optimisation_actions',
    'meta_optimisation_runs',
    'notifications',
    'posting_defaults',
    'profiles',
    'provider_rate_limits',
    'publish_attempts',
    'publish_jobs',
    'publish_jobs_with_variant',
    'social_connections',
    'token_vault',
    'tournament_fixtures',
    'tournaments',
    'user_auth_snapshot',
    'worker_heartbeats',
    -- the empty-the-table privilege only before this migration
    'content_items',
    'content_media_attachments',
    'content_variants',
    'media_assets',
    'media_library'
  ];
  v_writes constant text[] := array['insert', 'update', 'delete', 'truncate', 'references', 'trigger'];
  v_name text;
  v_relation regclass;
  v_priv text;
  v_could_read boolean;
  v_left text;
begin
  foreach v_name in array v_relations loop
    v_relation := to_regclass(format('public.%I', v_name));
    if v_relation is null then
      -- Every one exists on production; a local rebuild may lack one.
      raise notice 'revoke_authenticated_table_writes: public.% does not exist here, skipped', v_name;
      continue;
    end if;

    v_could_read := has_table_privilege('authenticated', v_relation, 'select');
    execute format('revoke all on table %s from authenticated', v_relation);
    if v_could_read then
      execute format('grant select on table %s to authenticated', v_relation);
    end if;

    -- Prove it before the migration commits, by table and by column.
    foreach v_priv in array v_writes loop
      if has_table_privilege('authenticated', v_relation, v_priv) then
        raise exception 'revoke_authenticated_table_writes: authenticated still has % on %', v_priv, v_relation;
      end if;
    end loop;
    foreach v_priv in array array['insert', 'update'] loop
      if has_any_column_privilege('authenticated', v_relation, v_priv) then
        raise exception 'revoke_authenticated_table_writes: authenticated still has % on a column of %', v_priv, v_relation;
      end if;
    end loop;
    if v_could_read and not has_table_privilege('authenticated', v_relation, 'select') then
      raise exception 'revoke_authenticated_table_writes: authenticated lost SELECT on %', v_relation;
    end if;
    foreach v_priv in array array['select', 'insert', 'update', 'delete'] loop
      if not has_table_privilege('service_role', v_relation, v_priv) then
        raise exception 'revoke_authenticated_table_writes: service_role lacks % on %', v_priv, v_relation;
      end if;
    end loop;
  end loop;

  -- Nothing in public may be left writable by a user session, listed above or not.
  select string_agg(c.relname, ', ' order by c.relname) into v_left
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and (has_table_privilege('authenticated', c.oid, 'insert')
       or has_table_privilege('authenticated', c.oid, 'update')
       or has_table_privilege('authenticated', c.oid, 'delete')
       or has_table_privilege('authenticated', c.oid, 'truncate')
       or has_any_column_privilege('authenticated', c.oid, 'insert')
       or has_any_column_privilege('authenticated', c.oid, 'update'));
  if v_left is not null then
    raise exception 'revoke_authenticated_table_writes: authenticated can still write to: %', v_left;
  end if;
end;
$$;

-- New tables created by migrations start read-only for user sessions.
alter default privileges for role postgres in schema public revoke all on tables from authenticated;
alter default privileges for role postgres in schema public grant select on tables to authenticated;

do $$
begin
  if exists (
    select 1
      from pg_default_acl d
      cross join lateral aclexplode(d.defaclacl) x
     where d.defaclrole = 'postgres'::regrole
       and d.defaclnamespace = 'public'::regnamespace
       and d.defaclobjtype = 'r'
       and x.grantee = 'authenticated'::regrole
       and x.privilege_type <> 'SELECT'
  ) then
    raise exception 'revoke_authenticated_table_writes: new tables would still give authenticated more than SELECT';
  end if;
end;
$$;
