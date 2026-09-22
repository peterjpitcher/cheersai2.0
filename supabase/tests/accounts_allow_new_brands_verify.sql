-- Verification for 20260922150000_accounts_allow_new_brands.
-- Run AFTER applying the migration (local or production). Each block raises an exception if
-- the expectation is not met; a clean run = pass. Writes nothing lasting: the insert probe
-- runs inside a sub-transaction that is always rolled back.
-- Usage: psql "$DATABASE_URL" -f supabase/tests/accounts_allow_new_brands_verify.sql

do $$
declare
  v_default text;
  v_user uuid;
  v_email text := 'brand-probe@example.invalid';
  v_first uuid;
  v_second uuid;
begin
  -- id generates itself
  select column_default into v_default
    from information_schema.columns
   where table_schema = 'public' and table_name = 'accounts' and column_name = 'id';
  if v_default is null or v_default not ilike '%gen_random_uuid%' then
    raise exception 'accounts.id has no gen_random_uuid() default (found %)', coalesce(v_default, 'none');
  end if;

  -- the contact email is no longer unique
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.accounts'::regclass and conname = 'accounts_email_key'
  ) then
    raise exception 'accounts_email_key still exists';
  end if;

  -- The Admin page's insert works twice with the same email. Needs the email column
  -- (production only) and a real auth user; skipped where either is missing.
  select user_id into v_user from public.app_admins limit 1;
  if v_user is not null and exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'accounts' and column_name = 'email'
  ) then
    begin
      execute 'insert into public.accounts (business_name, email, timezone, created_by_user_id, auth_user_id)
               values ($1, $2, $3, $4, $4) returning id'
        into v_first using 'Probe brand A', v_email, 'Europe/London', v_user;
      execute 'insert into public.accounts (business_name, email, timezone, created_by_user_id, auth_user_id)
               values ($1, $2, $3, $4, $4) returning id'
        into v_second using 'Probe brand B', v_email, 'Europe/London', v_user;
      if v_first is null or v_second is null or v_first = v_second then
        raise exception 'probe inserts did not return two distinct ids';
      end if;
      -- always undo the probe rows
      raise exception using errcode = 'P0099', message = 'rollback probe';
    exception when sqlstate 'P0099' then null;
    end;

    if exists (select 1 from public.accounts where email = v_email) then
      raise exception 'probe rows were not rolled back';
    end if;
  else
    raise notice 'insert probe skipped: no admin user or no accounts.email column';
  end if;
end;
$$;
