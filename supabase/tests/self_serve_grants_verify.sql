-- Grants check for the database objects added by the self-serve sign-up work
-- (tasks/SPEC-self-serve-signup.md §4.12). Each stage adds its objects here.
--   Stage 1 (migration 20260928120000): public.consume_rate_limit and the table
--   it writes, public.auth_rate_limits.
--
-- Read-only: it reads the catalogue and nothing else, so it is safe to run on a
-- local rebuild AND against production after each migration. A clean run ends
-- with "self_serve_grants_verify: pass"; any failure raises an exception that
-- names the object and the role.
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/self_serve_grants_verify.sql

do $$
declare
  v_fn constant text := 'public.consume_rate_limit(text, integer, integer)';
  v_role text;
  v_priv text;
  v_proc record;
begin
  -- The function exists, runs as its caller and pins search_path.
  select p.prosecdef, p.proconfig into v_proc
    from pg_proc p where p.oid = to_regprocedure(v_fn);
  if not found then
    raise exception '% is missing', v_fn;
  end if;
  if v_proc.prosecdef then
    raise exception '% must be SECURITY INVOKER', v_fn;
  end if;
  if v_proc.proconfig is null or not (v_proc.proconfig @> array['search_path=""']) then
    raise exception '% must pin search_path to empty (found %)', v_fn, v_proc.proconfig;
  end if;

  -- Nobody but service_role can execute it or touch the table it writes.
  foreach v_role in array array['public', 'anon', 'authenticated'] loop
    if has_function_privilege(v_role, v_fn, 'execute') then
      raise exception '% can execute %', v_role, v_fn;
    end if;
    foreach v_priv in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
      if has_table_privilege(v_role, 'public.auth_rate_limits', v_priv) then
        raise exception '% has % on public.auth_rate_limits', v_role, v_priv;
      end if;
    end loop;
  end loop;

  if not has_function_privilege('service_role', v_fn, 'execute') then
    raise exception 'service_role cannot execute %', v_fn;
  end if;
  foreach v_priv in array array['select', 'insert', 'update', 'delete'] loop
    if not has_table_privilege('service_role', 'public.auth_rate_limits', v_priv) then
      raise exception 'service_role lacks % on public.auth_rate_limits', v_priv;
    end if;
  end loop;

  -- RLS stays on as the second layer.
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.auth_rate_limits'::regclass) then
    raise exception 'RLS is off on public.auth_rate_limits';
  end if;
end;
$$;

select 'self_serve_grants_verify: pass' as result;
