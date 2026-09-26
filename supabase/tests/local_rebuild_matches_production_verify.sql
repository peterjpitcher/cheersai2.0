-- Verification for 20260926130000_local_rebuild_matches_production.
-- Run AFTER a local rebuild (`npm run db:rebuild`). Each block raises an exception if
-- the expectation is not met; a clean run = pass. Writes nothing lasting: the write
-- probe runs as service_role inside a sub-transaction that is always rolled back.
-- Local only: production is already in this shape and needs no probe rows.
-- Usage: psql "$DATABASE_URL" -f supabase/tests/local_rebuild_matches_production_verify.sql

-- 1. The shapes the Stripe end-to-end test tripped over.
do $$
begin
  if (select format_type(atttypid, atttypmod) from pg_attribute
       where attrelid = 'public.publish_jobs'::regclass and attname = 'status') <> 'text' then
    raise exception 'publish_jobs.status is not text';
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint
       where conrelid = 'public.publish_jobs'::regclass and conname = 'publish_jobs_status_check')
     is distinct from 'CHECK ((status = ANY (ARRAY[''queued''::text, ''in_progress''::text, ''succeeded''::text, ''failed''::text, ''held''::text])))' then
    raise exception 'publish_jobs_status_check differs from production';
  end if;
  if (select format_type(atttypid, atttypmod) from pg_attribute
       where attrelid = 'public.content_items'::regclass and attname = 'status') <> 'text' then
    raise exception 'content_items.status is not text';
  end if;
  if exists (select 1 from pg_attribute
              where attrelid = 'public.publish_jobs'::regclass and attname = 'platform' and not attisdropped) then
    raise exception 'publish_jobs.platform exists; production has none';
  end if;
  if not exists (select 1 from pg_attribute
                  where attrelid = 'public.accounts'::regclass and attname = 'email' and attnotnull and not attisdropped) then
    raise exception 'accounts.email is missing or nullable';
  end if;
end;
$$;

-- 2. service_role can read every table and view in public; anon cannot touch token_vault.
do $$
declare
  r record;
  n int;
begin
  begin
    set local role service_role;
    for r in select relname from pg_class
              where relnamespace = 'public'::regnamespace and relkind in ('r', 'v', 'p') loop
      execute format('select count(*) from public.%I', r.relname) into n;
    end loop;
    raise exception using errcode = 'P0099', message = 'reset role';
  exception when sqlstate 'P0099' then null;
  end;

  begin
    set local role anon;
    execute 'select count(*) from public.token_vault' into n;
    raise exception 'anon can read token_vault';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- 3. A brand, a post and a held publish job insert as service_role, and
--    releaseHeldPublishJobs's update releases the job (it failed on the enum before).
do $$
declare
  v_account uuid;
  v_item uuid;
  v_variant uuid;
  v_released int;
begin
  begin
    set local role service_role;
    insert into public.accounts (business_name, email, auth_user_id)
      values ('Probe brand', 'probe@example.invalid', gen_random_uuid()) returning id into v_account;
    insert into public.content_items (account_id, status, placement, platform)
      values (v_account, 'scheduled', 'feed', 'instagram') returning id into v_item;
    insert into public.content_variants (content_item_id) values (v_item) returning id into v_variant;
    insert into public.publish_jobs (account_id, content_item_id, variant_id, status, hold_reason, next_attempt_at)
      values (v_account, v_item, v_variant, 'held', 'entitlement', now() + interval '1 day');

    update public.publish_jobs
       set status = 'queued', hold_reason = null, last_error = null, updated_at = now()
     where account_id = v_account and status = 'held' and hold_reason = 'entitlement'
       and next_attempt_at > now();
    get diagnostics v_released = row_count;
    if v_released <> 1 then
      raise exception 'expected to release 1 held job, released %', v_released;
    end if;

    -- always undo the probe rows
    raise exception using errcode = 'P0099', message = 'rollback probe';
  exception when sqlstate 'P0099' then null;
  end;

  if exists (select 1 from public.accounts where email = 'probe@example.invalid') then
    raise exception 'probe rows were not rolled back';
  end if;
end;
$$;
