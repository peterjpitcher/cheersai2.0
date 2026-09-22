-- Verification for 20260922120000_brand_profile_business_type.
-- Run AFTER applying the migration (local or a preview branch). Each block raises an
-- exception if the expectation is not met; a clean run = pass. Writes nothing lasting:
-- the checks are exercised on a temporary copy of the table, never on real rows.
-- Usage: psql "$DATABASE_URL" -f supabase/tests/brand_profile_business_type_verify.sql

do $$
declare
  v_col record;
begin
  -- both columns exist, are text and are nullable (null = not set)
  for v_col in
    select c.column_name, c.data_type, c.is_nullable
      from (values ('business_type'), ('business_description')) as expected(name)
      left join information_schema.columns c
        on c.table_schema = 'public'
       and c.table_name = 'brand_profile'
       and c.column_name = expected.name
  loop
    if v_col.column_name is null then raise exception 'brand_profile column missing'; end if;
    if v_col.data_type <> 'text' then
      raise exception 'brand_profile.% is %, expected text', v_col.column_name, v_col.data_type;
    end if;
    if v_col.is_nullable <> 'YES' then
      raise exception 'brand_profile.% must be nullable', v_col.column_name;
    end if;
  end loop;

  -- both length checks are attached to the real table
  if (
    select count(*) from pg_constraint
     where conrelid = 'public.brand_profile'::regclass
       and contype = 'c'
       and conname in (
         'brand_profile_business_type_length_check',
         'brand_profile_business_description_length_check'
       )
  ) <> 2 then
    raise exception 'brand_profile business length checks missing';
  end if;

  -- exercise the checks on a temporary copy (LIKE copies CHECK constraints, not FKs)
  create temp table business_type_probe
    (like public.brand_profile including defaults including constraints);

  -- null and values at the limit are accepted
  insert into business_type_probe (account_id, business_type, business_description)
  values
    (gen_random_uuid(), null, null),
    (gen_random_uuid(), repeat('a', 60), repeat('b', 400));

  -- one character over either limit is rejected
  begin
    insert into business_type_probe (account_id, business_type)
    values (gen_random_uuid(), repeat('a', 61));
    raise exception 'business_type of 61 characters was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into business_type_probe (account_id, business_description)
    values (gen_random_uuid(), repeat('b', 401));
    raise exception 'business_description of 401 characters was accepted';
  exception when check_violation then null;
  end;

  drop table business_type_probe;
end;
$$;
