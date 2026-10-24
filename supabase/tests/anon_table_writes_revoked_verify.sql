-- Check that the anon role (the public anon key) cannot write to any relation in public
-- (the revoke_anon_table_writes migration, 24 October 2026; spec tasks/SPEC-revoke-anon-table-writes.md).
--
--   1. Neither anon nor PUBLIC holds INSERT, UPDATE, DELETE or TRUNCATE on any table, view,
--      materialized view or foreign table in public, nor INSERT or UPDATE on any of their columns.
--   2. The 32 relations the migration changed keep what it left alone: anon and authenticated
--      can still SELECT them, and service_role keeps SELECT, INSERT, UPDATE and DELETE.
--   3. Ask anon itself: an INSERT, UPDATE and DELETE that touch no rows are each refused with
--      "permission denied" on every changed table. TRUNCATE is checked in the catalogue only,
--      never attempted.
--
-- Read-only: the probes select, insert, update and delete no rows, so it is safe to run on a local
-- rebuild AND against production. Run it as postgres, which can switch to anon. CI runs it on every
-- fresh rebuild (migration-check), so a later migration that grants anon a write fails there.
-- A clean run ends with "anon_table_writes_revoked_verify: pass"; any failure raises an exception
-- that names the role, privilege and relation.
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/anon_table_writes_revoked_verify.sql

do $$
declare
  v_changed constant text[] := array[
    'accounts', 'ad_metrics_history', 'ad_sets', 'ads', 'analytics_snapshots', 'booking_conversion_events',
    'brand_profile', 'campaigns', 'content_item_versions', 'content_templates', 'link_in_bio_clicks',
    'link_in_bio_page_views', 'link_in_bio_profiles', 'link_in_bio_tiles', 'meta_campaigns',
    'meta_optimisation_actions', 'meta_optimisation_runs', 'notifications', 'posting_defaults', 'profiles',
    'publish_attempts', 'publish_jobs', 'publish_jobs_with_variant', 'social_connections', 'tournament_fixtures',
    'tournaments', 'worker_heartbeats', 'content_items', 'content_media_attachments', 'content_variants',
    'media_assets', 'media_library'
  ];
  v_rel record;
  v_name text;
  v_relation regclass;
  v_qualified text;
  v_role text;
  v_priv text;
  v_column text;
  v_probe text;
  v_switched boolean;
begin
  -- 1. No write privilege for anon or PUBLIC anywhere in public, by relation or by column.
  for v_rel in
    select c.oid::regclass as relation
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
     order by c.relname
  loop
    foreach v_role in array array['anon', 'public'] loop
      foreach v_priv in array array['insert', 'update', 'delete', 'truncate'] loop
        if has_table_privilege(v_role, v_rel.relation, v_priv) then
          raise exception '% has % on %', v_role, v_priv, v_rel.relation;
        end if;
      end loop;
      foreach v_priv in array array['insert', 'update'] loop
        if has_any_column_privilege(v_role, v_rel.relation, v_priv) then
          raise exception '% has % on a column of %', v_role, v_priv, v_rel.relation;
        end if;
      end loop;
    end loop;
  end loop;

  foreach v_name in array v_changed loop
    v_relation := to_regclass(format('public.%I', v_name));
    if v_relation is null then
      raise notice 'public.% does not exist here, skipped', v_name;
      continue;
    end if;

    -- 2. What the migration left alone.
    foreach v_role in array array['anon', 'authenticated'] loop
      if not has_table_privilege(v_role, v_relation, 'select') then
        raise exception '% lost select on %', v_role, v_relation;
      end if;
    end loop;
    foreach v_priv in array array['select', 'insert', 'update', 'delete'] loop
      if not has_table_privilege('service_role', v_relation, v_priv) then
        raise exception 'service_role lacks % on %', v_priv, v_relation;
      end if;
    end loop;

    -- 3. Ask anon. Views are skipped: a view that cannot be written through refuses with a
    --    different error before privileges are checked.
    if (select c.relkind from pg_class c where c.oid = v_relation) not in ('r', 'p') then
      continue;
    end if;
    -- A plain column: identity (always) and generated columns refuse explicit values before any
    -- privilege is checked, which would hide the answer.
    select quote_ident(a.attname) into v_column
      from pg_attribute a
     where a.attrelid = v_relation and a.attnum > 0 and not a.attisdropped
       and a.attidentity <> 'a' and a.attgenerated = ''
     order by a.attnum limit 1;
    v_qualified := format('public.%I', v_name);

    foreach v_probe in array array[
      format('insert into %s (%s) select %s from %s where false', v_qualified, v_column, v_column, v_qualified),
      format('update %s set %s = %s where false', v_qualified, v_column, v_column),
      format('delete from %s where false', v_qualified)
    ] loop
      -- The refused statement rolls the block back, and the role switch with it. v_switched is a
      -- variable, so it survives that rollback and tells a refused write (the pass) apart from a
      -- refused role switch (the check could not run).
      v_switched := false;
      begin
        set local role anon;
        v_switched := true;
        execute v_probe;
        raise exception 'anon was allowed to run: %', v_probe;
      exception when insufficient_privilege then
        if not v_switched then
          raise exception 'could not switch to role anon (%); run this check as postgres', sqlerrm;
        end if;
      end;
    end loop;
  end loop;
end;
$$;

select 'anon_table_writes_revoked_verify: pass' as result;
