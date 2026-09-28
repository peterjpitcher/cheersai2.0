-- Behaviour check for public.consume_rate_limit (migration 20260928120000).
-- LOCAL ONLY: run after a local rebuild (`npm run db:rebuild`), never against
-- production. Writes nothing lasting: every probe runs inside a sub-transaction
-- that is always rolled back. A clean run ends with "auth_rate_limit_verify: pass".
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/auth_rate_limit_verify.sql
-- Concurrency is checked separately by supabase/tests/auth_rate_limit_concurrency_verify.sh.

-- 1. As service_role: allow up to the limit, block after it, reset an expired
--    window, keep keys apart, refuse bad arguments, and stay visible to the
--    data-retention job.
do $$
declare
  r record;
  v_retention jsonb;
  i int;
begin
  begin
    set local role service_role;

    for i in 1..3 loop
      select * into r from public.consume_rate_limit('verify:allow', 3, 60);
      if not r.allowed or r.hits <> i then
        raise exception 'call % should be allowed with hits %, got allowed % hits %', i, i, r.allowed, r.hits;
      end if;
    end loop;

    select * into r from public.consume_rate_limit('verify:allow', 3, 60);
    if r.allowed or r.hits <> 4 then
      raise exception 'call 4 should be blocked, got allowed % hits %', r.allowed, r.hits;
    end if;
    if r.resets_at <= now() or r.resets_at > now() + interval '60 seconds' then
      raise exception 'resets_at should be within the 60 second window, got %', r.resets_at;
    end if;

    -- Another key has its own count.
    select * into r from public.consume_rate_limit('verify:other', 3, 60);
    if not r.allowed or r.hits <> 1 then
      raise exception 'a second key should start at 1, got hits %', r.hits;
    end if;

    -- An expired window starts again at 1 with a fresh reset time.
    update public.auth_rate_limits set reset_at = now() - interval '1 second' where key = 'verify:allow';
    select * into r from public.consume_rate_limit('verify:allow', 3, 60);
    if not r.allowed or r.hits <> 1 or r.resets_at <= now() then
      raise exception 'an expired window should reset, got allowed % hits % resets_at %', r.allowed, r.hits, r.resets_at;
    end if;

    -- Bad arguments are refused, not silently allowed.
    begin
      perform public.consume_rate_limit('', 3, 60);
      raise exception 'an empty key was accepted';
    exception when invalid_parameter_value then null;
    end;
    begin
      perform public.consume_rate_limit('verify:bad', 0, 60);
      raise exception 'a limit of 0 was accepted';
    exception when invalid_parameter_value then null;
    end;
    begin
      perform public.consume_rate_limit('verify:bad', 3, 0);
      raise exception 'a window of 0 was accepted';
    exception when invalid_parameter_value then null;
    end;
    begin
      perform public.consume_rate_limit(repeat('k', 201), 3, 60);
      raise exception 'a 201 character key was accepted';
    exception when invalid_parameter_value then null;
    end;

    -- The retention job still sees windows that reset over 24 hours ago (dry run).
    update public.auth_rate_limits set reset_at = now() - interval '25 hours' where key = 'verify:other';
    v_retention := public.run_data_retention(true);
    if coalesce((v_retention -> 'rules' -> 'auth_rate_limits' ->> 'due')::int, 0) < 1 then
      raise exception 'run_data_retention does not see the expired window: %', v_retention -> 'rules' -> 'auth_rate_limits';
    end if;

    raise exception using errcode = 'P0099', message = 'rollback probe';
  exception when sqlstate 'P0099' then null;
  end;

  if exists (select 1 from public.auth_rate_limits where key like 'verify:%') then
    raise exception 'probe rows were not rolled back';
  end if;
end;
$$;

-- 2. anon and authenticated can neither execute the function nor touch the table.
do $$
declare
  v_role text;
  n int;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    begin
      execute format('set local role %I', v_role);
      perform public.consume_rate_limit('verify:' || v_role, 3, 60);
      raise exception '% could execute consume_rate_limit', v_role;
    exception when insufficient_privilege then null;
    end;

    begin
      execute format('set local role %I', v_role);
      execute 'select count(*) from public.auth_rate_limits' into n;
      raise exception '% could read auth_rate_limits', v_role;
    exception when insufficient_privilege then null;
    end;

    begin
      execute format('set local role %I', v_role);
      execute $q$insert into public.auth_rate_limits (key, count, reset_at) values ('verify:write', 0, now())$q$;
      raise exception '% could write auth_rate_limits', v_role;
    exception when insufficient_privilege then null;
    end;

    begin
      execute format('set local role %I', v_role);
      execute 'delete from public.auth_rate_limits';
      raise exception '% could delete from auth_rate_limits', v_role;
    exception when insufficient_privilege then null;
    end;
  end loop;
end;
$$;

select 'auth_rate_limit_verify: pass' as result;
