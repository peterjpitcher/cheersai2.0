-- Check that a signed-in user (the `authenticated` role) cannot write to public.accounts
-- (the accounts_member_writes_revoked migration; tasks/SPEC-accounts-member-writes-revoked.md).
--
--   1. Catalogue: authenticated holds SELECT and nothing else on the table or any of its
--      columns; anon holds no write; service_role keeps SELECT, INSERT, UPDATE and DELETE.
--   2. Ask the role itself: an INSERT, UPDATE and DELETE that touch no rows are each refused
--      with "permission denied", and a SELECT still works.
--
-- Read-only: the probes insert, update and delete no rows, so it is safe to run on a local
-- rebuild AND against production. Run it as postgres, which can switch role. CI runs it on every
-- fresh rebuild (migration-check), so a later migration that hands the access back fails there.
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/accounts_member_writes_revoked_verify.sql

do $$
declare
  v_priv text;
  v_col text;
  v_role text;
  v_probe text;
  v_refused boolean;
begin
  -- 1. Catalogue.
  foreach v_priv in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('authenticated', 'public.accounts', v_priv) then
      raise exception 'authenticated holds % on public.accounts', v_priv;
    end if;
  end loop;
  foreach v_role in array array['authenticated', 'anon'] loop
    for v_col in
      select attname from pg_attribute
       where attrelid = 'public.accounts'::regclass and attnum > 0 and not attisdropped
    loop
      if has_column_privilege(v_role, 'public.accounts', v_col, 'INSERT')
         or has_column_privilege(v_role, 'public.accounts', v_col, 'UPDATE') then
        raise exception '% can write public.accounts.%', v_role, v_col;
      end if;
    end loop;
  end loop;
  if not has_table_privilege('authenticated', 'public.accounts', 'SELECT') then
    raise exception 'authenticated cannot SELECT public.accounts (signed-in reads would break)';
  end if;
  foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if not has_table_privilege('service_role', 'public.accounts', v_priv) then
      raise exception 'service_role lacks % on public.accounts (server code would break)', v_priv;
    end if;
  end loop;

  -- 2. Ask the role. Privileges are checked before any row is looked at, so statements that
  --    match nothing are still refused. Each probe runs in its own block; SET LOCAL ROLE made
  --    inside a block that raises is undone with it.
  foreach v_probe in array array[
    'update public.accounts set billing_override = billing_override where false',
    'update public.accounts set paid_ads_enabled = paid_ads_enabled where false',
    'insert into public.accounts select * from public.accounts where false',
    'delete from public.accounts where false'
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
      raise exception 'authenticated was allowed to run: %', v_probe;
    end if;
  end loop;

  -- A signed-in read still works (row level security decides which rows; here, none).
  set local role authenticated;
  perform count(*) from public.accounts;
  reset role;

  raise notice 'accounts_member_writes_revoked_verify: pass';
end $$;
