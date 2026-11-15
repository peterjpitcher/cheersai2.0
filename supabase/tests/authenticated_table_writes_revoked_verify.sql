-- Check that a signed-in user (the `authenticated` role) cannot write to any relation in public
-- (the revoke_authenticated_table_writes migration, 15 November 2026;
-- spec tasks/SPEC-revoke-authenticated-table-writes.md).
--
--   1. authenticated holds no INSERT, UPDATE, DELETE or TRUNCATE on any table, view, materialized
--      view or foreign table in public, nor INSERT or UPDATE on any of their columns.
--   2. Every relation the migration changed still lets authenticated SELECT, and service_role
--      keeps SELECT, INSERT, UPDATE and DELETE.
--   3. Ask authenticated itself: an INSERT, UPDATE and DELETE that touch no rows are each refused
--      with "permission denied" on every changed table. TRUNCATE is checked in the catalogue only,
--      never attempted.
--   4. Default privileges: a table postgres creates in public gives authenticated SELECT only.
--
-- Read-only: the probes select, insert, update and delete no rows, so it is safe to run on a local
-- rebuild AND against production. Run it as postgres, which can switch role. CI runs it on every
-- fresh rebuild (migration-check), so a later migration that grants authenticated a write, or
-- creates a table without stating its grants, fails there. A new table that user sessions really
-- must write to needs its own reviewed change to this script.
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/authenticated_table_writes_revoked_verify.sql

do $$
declare
  v_changed constant text[] := array[
    'ad_metrics_history', 'ad_sets', 'ads', 'analytics_snapshots', 'audit_log', 'booking_conversion_events',
    'brand_profile', 'campaigns', 'content_item_versions', 'content_templates', 'link_in_bio_clicks',
    'link_in_bio_page_views', 'link_in_bio_profiles', 'link_in_bio_tiles', 'management_app_connections',
    'meta_campaigns', 'meta_optimisation_actions', 'meta_optimisation_runs', 'notifications',
    'posting_defaults', 'profiles', 'provider_rate_limits', 'publish_attempts', 'publish_jobs',
    'publish_jobs_with_variant', 'social_connections', 'token_vault', 'tournament_fixtures', 'tournaments',
    'user_auth_snapshot', 'worker_heartbeats', 'content_items', 'content_media_attachments',
    'content_variants', 'media_assets', 'media_library', 'accounts'
  ];
  v_rel record;
  v_name text;
  v_relation regclass;
  v_priv text;
  v_probe text;
  v_column text;
  v_refused boolean;
begin
  -- 1. No write privilege for authenticated anywhere in public, by relation or by column.
  for v_rel in
    select c.oid::regclass as relation
      from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
  loop
    foreach v_priv in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
      if has_table_privilege('authenticated', v_rel.relation, v_priv) then
        raise exception 'authenticated holds % on %', v_priv, v_rel.relation;
      end if;
    end loop;
    foreach v_priv in array array['INSERT', 'UPDATE'] loop
      if has_any_column_privilege('authenticated', v_rel.relation, v_priv) then
        raise exception 'authenticated holds % on a column of %', v_priv, v_rel.relation;
      end if;
    end loop;
  end loop;

  foreach v_name in array v_changed loop
    v_relation := to_regclass(format('public.%I', v_name));
    if v_relation is null then
      raise notice 'authenticated_table_writes_revoked_verify: public.% does not exist here, skipped', v_name;
      continue;
    end if;

    -- 2. Reads and server writes are intact.
    if not has_table_privilege('authenticated', v_relation, 'SELECT') then
      raise exception 'authenticated cannot SELECT % (signed-in reads would break)', v_relation;
    end if;
    foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if not has_table_privilege('service_role', v_relation, v_priv) then
        raise exception 'service_role lacks % on % (server code would break)', v_priv, v_relation;
      end if;
    end loop;

    -- 3. Ask the role. Privileges are checked before any row is looked at, so statements that
    --    match nothing are still refused. The view is skipped: it cannot be written through.
    if (select relkind from pg_class where oid = v_relation) = 'v' then
      continue;
    end if;
    select attname into v_column from pg_attribute
     where attrelid = v_relation and attnum > 0 and not attisdropped
       and attgenerated = '' and attidentity = ''
     order by attnum limit 1;
    foreach v_probe in array array[
      format('update %s set %I = %I where false', v_relation, v_column, v_column),
      format('insert into %s (%I) select %I from %s where false', v_relation, v_column, v_column, v_relation),
      format('delete from %s where false', v_relation)
    ] loop
      v_refused := false;
      begin
        set local role authenticated;
        execute v_probe;
        reset role;
      exception when insufficient_privilege then
        v_refused := true;
      end;
      reset role;
      if not v_refused then
        raise exception 'authenticated was not refused: %', v_probe;
      end if;
    end loop;
  end loop;

  -- 4. Default privileges for tables postgres creates in public.
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
    raise exception 'a new table in public would give authenticated more than SELECT';
  end if;

  raise notice 'authenticated_table_writes_revoked_verify: pass';
end $$;
