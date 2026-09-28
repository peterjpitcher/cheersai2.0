-- Grants check for the database objects added by the self-serve sign-up work
-- (tasks/SPEC-self-serve-signup.md §4.12). Each stage adds its objects here.
--   Stage 1 (migration 20260928120000): public.consume_rate_limit and the table
--   it writes, public.auth_rate_limits.
--   PR 4 (migration 20260928161500): public.team_invitations and the functions
--   record_team_invitation and accept_team_invitation.
--   PR 5 (migration 20260928170000): public.self_serve_signups,
--   public.record_self_serve_signup_request, public.self_serve_login_deletable,
--   the internal public.self_serve_login_is_stale (nobody but its owner may run
--   it), public.run_data_retention (still service role only after its
--   restatement) and public.increment_rate_limit (EXECUTE revoked from
--   authenticated).
--
-- Read-only: it reads the catalogue and nothing else, so it is safe to run on a
-- local rebuild AND against production after each migration. A clean run ends
-- with "self_serve_grants_verify: pass"; any failure raises an exception that
-- names the object and the role.
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/self_serve_grants_verify.sql

do $$
declare
  -- Functions only service_role may execute.
  v_functions constant text[] := array[
    'public.consume_rate_limit(text, integer, integer)',
    'public.record_team_invitation(uuid, uuid, text, uuid, integer, integer, boolean)',
    'public.accept_team_invitation(uuid, uuid)',
    'public.record_self_serve_signup_request(uuid)',
    'public.self_serve_login_deletable(uuid)',
    'public.run_data_retention(boolean)',
    'public.increment_rate_limit(uuid, text, text, timestamp with time zone, integer)'
  ];
  -- SECURITY DEFINER functions this work wrote (they read auth.users): empty search_path.
  v_definer_functions constant text[] := array[
    'public.self_serve_login_deletable(uuid)',
    'public.run_data_retention(boolean)'
  ];
  -- Internal functions: only their owner (and so the definer functions above) may run them.
  v_internal_functions constant text[] := array[
    'public.self_serve_login_is_stale(uuid, timestamp with time zone)'
  ];
  -- Of those, the ones this work wrote: SECURITY INVOKER with an empty search_path.
  v_invoker_functions constant text[] := array[
    'public.consume_rate_limit(text, integer, integer)',
    'public.record_team_invitation(uuid, uuid, text, uuid, integer, integer, boolean)',
    'public.accept_team_invitation(uuid, uuid)',
    'public.record_self_serve_signup_request(uuid)',
    'public.self_serve_login_is_stale(uuid, timestamp with time zone)'
  ];
  -- Tables only service_role may touch, with RLS on.
  v_tables constant text[] := array['public.auth_rate_limits', 'public.team_invitations', 'public.self_serve_signups'];
  -- Of those, the ones read only through the service role: no RLS policy at all.
  v_no_policy_tables constant text[] := array['team_invitations', 'self_serve_signups'];
  v_fn text;
  v_table text;
  v_role text;
  v_priv text;
  v_proc record;
  -- MAINTAIN is a table privilege from Postgres 17 (production and the local stack run 17).
  v_table_privs constant text[] := array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']
    || case when current_setting('server_version_num')::int >= 170000 then array['maintain'] else array[]::text[] end;
begin
  foreach v_fn in array v_functions loop
    if to_regprocedure(v_fn) is null then
      raise exception '% is missing', v_fn;
    end if;
    -- Nobody but service_role can execute it.
    foreach v_role in array array['public', 'anon', 'authenticated'] loop
      if has_function_privilege(v_role, v_fn, 'execute') then
        raise exception '% can execute %', v_role, v_fn;
      end if;
    end loop;
    if not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'service_role cannot execute %', v_fn;
    end if;
  end loop;

  foreach v_fn in array v_internal_functions loop
    if to_regprocedure(v_fn) is null then
      raise exception '% is missing', v_fn;
    end if;
    foreach v_role in array array['public', 'anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(v_role, v_fn, 'execute') then
        raise exception '% can execute the internal function %', v_role, v_fn;
      end if;
    end loop;
  end loop;

  foreach v_fn in array v_definer_functions loop
    select p.prosecdef, p.proconfig into v_proc
      from pg_proc p where p.oid = to_regprocedure(v_fn);
    if not v_proc.prosecdef then
      raise exception '% must be SECURITY DEFINER', v_fn;
    end if;
    if v_proc.proconfig is null or not (v_proc.proconfig @> array['search_path=""']) then
      raise exception '% must pin search_path to empty (found %)', v_fn, v_proc.proconfig;
    end if;
  end loop;

  -- The functions this work wrote run as their caller and pin search_path.
  foreach v_fn in array v_invoker_functions loop
    select p.prosecdef, p.proconfig into v_proc
      from pg_proc p where p.oid = to_regprocedure(v_fn);
    if v_proc.prosecdef then
      raise exception '% must be SECURITY INVOKER', v_fn;
    end if;
    if v_proc.proconfig is null or not (v_proc.proconfig @> array['search_path=""']) then
      raise exception '% must pin search_path to empty (found %)', v_fn, v_proc.proconfig;
    end if;
  end loop;

  foreach v_table in array v_tables loop
    if to_regclass(v_table) is null then
      raise exception '% is missing', v_table;
    end if;
    foreach v_role in array array['public', 'anon', 'authenticated'] loop
      foreach v_priv in array v_table_privs loop
        if has_table_privilege(v_role, v_table, v_priv) then
          raise exception '% has % on %', v_role, v_priv, v_table;
        end if;
      end loop;
    end loop;
    foreach v_priv in array array['select', 'insert', 'update', 'delete'] loop
      if not has_table_privilege('service_role', v_table, v_priv) then
        raise exception 'service_role lacks % on %', v_priv, v_table;
      end if;
    end loop;
    -- RLS stays on as the second layer.
    if not (select c.relrowsecurity from pg_class c where c.oid = v_table::regclass) then
      raise exception 'RLS is off on %', v_table;
    end if;
  end loop;

  foreach v_table in array v_no_policy_tables loop
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = v_table) then
      raise exception 'public.% has a policy; expected none (service role only)', v_table;
    end if;
  end loop;

  -- self_serve_signups stores no email, name or IP address (spec §4.12, review finding 10).
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'self_serve_signups'
       and column_name ~* '(email|name|address|^ip$|^ip_|_ip$)'
  ) then
    raise exception 'public.self_serve_signups has a column that looks like an email, name or IP';
  end if;
end;
$$;

select 'self_serve_grants_verify: pass' as result;
