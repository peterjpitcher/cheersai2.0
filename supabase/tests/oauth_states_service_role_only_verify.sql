-- Check that public.oauth_states is reachable by the service role only
-- (migration 20260929113055_oauth_states_service_role_only).
--
-- The table holds OAuth handshakes in flight and, with the Facebook Page chooser,
-- an encrypted Meta user token. Every app path uses the service-role client, so:
--   1. PUBLIC, anon and authenticated hold no privilege on the table or on any of
--      its columns.
--   2. No policy on it applies to public, anon or authenticated except
--      "OAuth states managed by service role", whose USING and WITH CHECK match
--      only a service-role JWT.
--   3. A SELECT as anon and as authenticated is refused with "permission
--      denied", which proves the grants by asking the roles themselves.
--   4. Row level security stays on, and service_role keeps select, insert,
--      update and delete, which the app needs.
--
-- Read-only: it reads the catalogue and runs one SELECT each as anon and as
-- authenticated (both refused), nothing else, so it is safe to run on a local
-- rebuild AND against production. Run it as postgres, which can switch to anon
-- and authenticated. A clean run ends with "oauth_states_service_role_only_verify:
-- pass"; any failure raises an exception that names the role, privilege or
-- policy. Before the migration, production fails it with
-- "authenticated has select on public.oauth_states".
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/oauth_states_service_role_only_verify.sql

do $$
declare
  v_table constant text := 'public.oauth_states';
  v_service_role_only constant text := '(auth.role() = ''service_role''::text)';
  -- MAINTAIN is a table privilege from Postgres 17 (production and the local stack run 17).
  v_table_privs constant text[] := array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']
    || case when current_setting('server_version_num')::int >= 170000 then array['maintain'] else array[]::text[] end;
  v_role text;
  v_priv text;
  v_open text;
  v_switched boolean;
  v_rows bigint;
begin
  if to_regclass(v_table) is null then
    raise exception '% is missing', v_table;
  end if;

  -- 1. No table or column privilege for PUBLIC, anon or authenticated.
  foreach v_role in array array['public', 'anon', 'authenticated'] loop
    foreach v_priv in array v_table_privs loop
      if has_table_privilege(v_role, v_table, v_priv) then
        raise exception '% has % on %', v_role, v_priv, v_table;
      end if;
    end loop;
    foreach v_priv in array array['select', 'insert', 'update', 'references'] loop
      if has_any_column_privilege(v_role, v_table, v_priv) then
        raise exception '% has % on a column of %', v_role, v_priv, v_table;
      end if;
    end loop;
  end loop;

  -- 2. No policy that could let public, anon or authenticated in.
  select string_agg(format('%s (%s)', p.policyname, p.cmd), ', ' order by p.policyname) into v_open
    from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'oauth_states'
     and p.roles && array['public', 'anon', 'authenticated']::name[]
     and not (coalesce(p.qual, '') = v_service_role_only
              and coalesce(p.with_check, '') = v_service_role_only);
  if v_open is not null then
    raise exception '% has policies that could let anon or authenticated in: %', v_table, v_open;
  end if;

  -- 3. Ask the roles themselves. The refused SELECT rolls the block back, and the
  --    role switch with it. v_switched is a variable, so it survives that rollback
  --    and tells a refused SELECT (the pass) apart from a refused role switch (the
  --    check could not run).
  foreach v_role in array array['anon', 'authenticated'] loop
    v_switched := false;
    begin
      execute format('set local role %I', v_role);
      v_switched := true;
      execute format('select count(*) from %s', v_table) into v_rows;
      raise exception '% can select from % (% rows visible)', v_role, v_table, v_rows;
    exception when insufficient_privilege then
      if not v_switched then
        raise exception 'could not switch to role % (%); run this check as postgres', v_role, sqlerrm;
      end if;
    end;
  end loop;

  -- 4. Row level security on, and service_role keeps what the app needs.
  if not (select c.relrowsecurity from pg_class c where c.oid = v_table::regclass) then
    raise exception 'RLS is off on %', v_table;
  end if;
  foreach v_priv in array array['select', 'insert', 'update', 'delete'] loop
    if not has_table_privilege('service_role', v_table, v_priv) then
      raise exception 'service_role lacks % on %', v_priv, v_table;
    end if;
  end loop;
end;
$$;

select 'oauth_states_service_role_only_verify: pass' as result;
