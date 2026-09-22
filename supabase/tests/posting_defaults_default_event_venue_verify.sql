-- Verification for 20260922140000_posting_defaults_default_event_venue.
-- Run AFTER applying the migration (local or a preview branch). Each block raises an
-- exception if the expectation is not met; a clean run = pass. Writes nothing lasting:
-- the check is exercised on a temporary copy of the table, never on real rows.
-- Usage: psql "$DATABASE_URL" -f supabase/tests/posting_defaults_default_event_venue_verify.sql

do $$
declare
  v_type text;
  v_nullable text;
begin
  -- the column exists, is text and is nullable (null = no default)
  select data_type, is_nullable
    into v_type, v_nullable
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'posting_defaults'
     and column_name = 'default_event_venue';

  if v_type is null then raise exception 'posting_defaults.default_event_venue missing'; end if;
  if v_type <> 'text' then raise exception 'default_event_venue is %, expected text', v_type; end if;
  if v_nullable <> 'YES' then raise exception 'default_event_venue must be nullable'; end if;

  -- the length check is attached to the real table
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.posting_defaults'::regclass
       and conname = 'posting_defaults_default_event_venue_length_check'
       and contype = 'c'
  ) then
    raise exception 'posting_defaults_default_event_venue_length_check missing';
  end if;

  -- every "The Anchor" brand with a posting_defaults row has a default venue
  if exists (
    select 1
      from public.posting_defaults pd
      join public.accounts a on a.id = pd.account_id
     where a.business_name = 'The Anchor'
       and pd.default_event_venue is null
  ) then
    raise exception 'The Anchor default event venue was not backfilled';
  end if;

  -- exercise the check on a temporary copy (LIKE copies CHECK constraints, not FKs)
  create temp table event_venue_probe
    (like public.posting_defaults including defaults including constraints);

  insert into event_venue_probe (account_id, default_event_venue)
  values (gen_random_uuid(), null), (gen_random_uuid(), repeat('v', 200));

  begin
    insert into event_venue_probe (account_id, default_event_venue)
    values (gen_random_uuid(), repeat('v', 201));
    raise exception 'default_event_venue of 201 characters was accepted';
  exception when check_violation then null;
  end;

  drop table event_venue_probe;
end;
$$;
