-- Verification for 20260910103048_meta_campaigns_delivery_schedule.
-- Run AFTER applying the migration (local or a preview branch). Each block raises an
-- exception if the expectation is not met; a clean run = pass. Writes nothing lasting:
-- the constraint is exercised on a temporary copy of the table, never on real rows.
-- Usage: psql "$DATABASE_URL" -f supabase/tests/meta_campaigns_delivery_schedule_verify.sql

do $$
declare
  v_type text;
  v_nullable text;
begin
  -- the column exists, is jsonb and is nullable (null = no schedule)
  select data_type, is_nullable
    into v_type, v_nullable
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'meta_campaigns'
     and column_name = 'delivery_schedule';

  if v_type is null then raise exception 'meta_campaigns.delivery_schedule missing'; end if;
  if v_type <> 'jsonb' then raise exception 'delivery_schedule is %, expected jsonb', v_type; end if;
  if v_nullable <> 'YES' then raise exception 'delivery_schedule must be nullable'; end if;

  -- the object-only check is attached to the real table
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.meta_campaigns'::regclass
       and conname = 'meta_campaigns_delivery_schedule_check'
       and contype = 'c'
  ) then
    raise exception 'meta_campaigns_delivery_schedule_check missing';
  end if;

  -- exercise the constraint on a temporary copy (LIKE copies CHECK constraints, not FKs)
  create temp table delivery_schedule_probe
    (like public.meta_campaigns including defaults including constraints);

  -- null and an object are accepted
  insert into delivery_schedule_probe
    (account_id, name, objective, problem_brief, budget_amount, start_date, delivery_schedule)
  values
    (gen_random_uuid(), 'probe', 'OUTCOME_TRAFFIC', 'probe', 1, current_date, null),
    (gen_random_uuid(), 'probe', 'OUTCOME_TRAFFIC', 'probe', 1, current_date,
     '{"days": ["tuesday", "wednesday", "thursday", "friday"], "startHour": 9, "endHour": 14}'::jsonb);

  -- an array is rejected
  begin
    insert into delivery_schedule_probe
      (account_id, name, objective, problem_brief, budget_amount, start_date, delivery_schedule)
    values (gen_random_uuid(), 'probe', 'OUTCOME_TRAFFIC', 'probe', 1, current_date, '["tuesday"]'::jsonb);
    raise exception 'an array delivery_schedule was accepted';
  exception when check_violation then
    null;
  end;

  -- a bare string is rejected
  begin
    insert into delivery_schedule_probe
      (account_id, name, objective, problem_brief, budget_amount, start_date, delivery_schedule)
    values (gen_random_uuid(), 'probe', 'OUTCOME_TRAFFIC', 'probe', 1, current_date, '"tuesday"'::jsonb);
    raise exception 'a string delivery_schedule was accepted';
  exception when check_violation then
    null;
  end;

  -- a JSON null literal is rejected (only SQL null means "no schedule")
  begin
    insert into delivery_schedule_probe
      (account_id, name, objective, problem_brief, budget_amount, start_date, delivery_schedule)
    values (gen_random_uuid(), 'probe', 'OUTCOME_TRAFFIC', 'probe', 1, current_date, 'null'::jsonb);
    raise exception 'a JSON null delivery_schedule was accepted';
  exception when check_violation then
    null;
  end;

  drop table delivery_schedule_probe;
end $$;
