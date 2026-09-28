-- Verification for 20260927120000_data_retention (public.run_data_retention),
-- as restated by 20260928161500_team_invitations (rule 13, team_invitations)
-- and 20260928170000_self_serve_signups (rule 14, self_serve_signups; its
-- login list is checked by self_serve_signups_verify.sql).
-- Run AFTER a local rebuild (`npm run db:rebuild`) with the migrations applied.
-- Each block raises an exception if an expectation is not met; a clean run =
-- pass, and the last notice prints 'data retention verification PASSED'.
-- Writes nothing lasting: the fixture rows live inside a sub-transaction that
-- is always rolled back. Local only: never run this against production.
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/data_retention_verify.sql

-- 1. Security: definer, empty search_path, executable by service_role only.
do $$
declare
  v_secdef boolean;
  v_config text[];
begin
  select prosecdef, proconfig into v_secdef, v_config
    from pg_proc where oid = 'public.run_data_retention(boolean)'::regprocedure;
  if not v_secdef then
    raise exception 'run_data_retention is not security definer';
  end if;
  if v_config is distinct from array['search_path=""'] then
    raise exception 'run_data_retention search_path is %, expected empty', v_config;
  end if;
  if has_function_privilege('anon', 'public.run_data_retention(boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.run_data_retention(boolean)', 'execute') then
    raise exception 'anon or authenticated can execute run_data_retention';
  end if;
  if not has_function_privilege('service_role', 'public.run_data_retention(boolean)', 'execute') then
    raise exception 'service_role cannot execute run_data_retention';
  end if;

  begin
    set local role authenticated;
    perform public.run_data_retention(true);
    raise exception 'authenticated ran run_data_retention';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- 2. Fixtures either side of every cutoff: a dry run changes nothing, a real
--    run removes exactly the old rows, and a second run finds nothing to do.
do $$
declare
  v_account uuid;
  v_item uuid;
  v_variant uuid;
  v_job uuid;
  v_before jsonb;
  v_dry jsonb;
  v_real jsonb;
  v_again jsonb;
  v_rule text;
  v_expected jsonb := jsonb_build_object(
    'notifications', 1,
    'publish_attempts', 1,
    'audit_log', 1,
    'auth_audit_log_entries', 1,
    'link_in_bio_page_views', 1,
    'link_in_bio_clicks', 1,
    'booking_conversion_events', 1,
    'booking_conversion_identifiers', 3,
    'meta_data_requests', 1,
    'admin_audit', 1,
    'auth_rate_limits', 1,
    'oauth_states', 2,
    'team_invitations', 3,
    'self_serve_signups', 1
  );
  v_profile uuid := gen_random_uuid();
  v_old_auth uuid := gen_random_uuid();
  v_new_auth uuid := gen_random_uuid();
  v_invitee_a uuid := gen_random_uuid();
  v_invitee_b uuid := gen_random_uuid();
  v_invitee_c uuid := gen_random_uuid();
  -- team_invitations fixtures: old ones are deleted, new ones kept.
  v_inv_accepted_old uuid := gen_random_uuid();
  v_inv_accepted_new uuid := gen_random_uuid();
  v_inv_declined_old uuid := gen_random_uuid();
  v_inv_cancelled_new uuid := gen_random_uuid();
  v_inv_expired_old uuid := gen_random_uuid();
  v_inv_expired_new uuid := gen_random_uuid();
  v_inv_open uuid := gen_random_uuid();
  v_row record;
  v_n bigint;
begin
  begin
    v_before := public.run_data_retention(true);

    insert into public.accounts (business_name, email, auth_user_id)
      values ('Retention probe', 'retention-probe@example.invalid', gen_random_uuid()) returning id into v_account;

    -- notifications: 12 months.
    insert into public.notifications (account_id, message, created_at) values
      (v_account, 'retention-old', now() - interval '13 months'),
      (v_account, 'retention-new', now() - interval '11 months');

    -- publish_attempts: 24 months. The job and post must stay.
    insert into public.content_items (account_id, status, placement, platform)
      values (v_account, 'scheduled', 'feed', 'instagram') returning id into v_item;
    insert into public.content_variants (content_item_id) values (v_item) returning id into v_variant;
    insert into public.publish_jobs (account_id, content_item_id, variant_id, status)
      values (v_account, v_item, v_variant, 'succeeded') returning id into v_job;
    insert into public.publish_attempts (publish_job_id, account_id, attempt_number, status, started_at) values
      (v_job, v_account, 1, 'failed', now() - interval '25 months'),
      (v_job, v_account, 2, 'succeeded', now() - interval '23 months');

    -- audit_log: 24 months.
    insert into public.audit_log (account_id, operation_type, resource_type, created_at) values
      (v_account, 'retention-old', 'probe', now() - interval '25 months'),
      (v_account, 'retention-new', 'probe', now() - interval '23 months');

    -- auth.audit_log_entries: 24 months.
    insert into auth.audit_log_entries (id, payload, created_at) values
      (v_old_auth, '{"action":"login"}', now() - interval '25 months'),
      (v_new_auth, '{"action":"login"}', now() - interval '23 months');

    -- link-in-bio views and clicks: 24 months (profile_id has no foreign key).
    insert into public.link_in_bio_page_views (profile_id, referrer, created_at) values
      (v_profile, 'retention-old', now() - interval '25 months'),
      (v_profile, 'retention-new', now() - interval '23 months');
    insert into public.link_in_bio_clicks (profile_id, referrer, created_at) values
      (v_profile, 'retention-old', now() - interval '25 months'),
      (v_profile, 'retention-new', now() - interval '23 months');

    -- booking_conversion_events.
    --   old-25m: deleted whole (not also counted as an identifier clear).
    --   ids-23m, ids-8d: identifiers cleared, rows kept, click ids stripped from URLs.
    --   url-9d: only a click id in the URL; URL cleaned.
    --   plain-10d: nothing personal; not counted, untouched.
    --   ids-6d: inside 7 days; untouched.
    insert into public.booking_conversion_events
      (account_id, booking_id, occurred_at, client_ip_address, client_user_agent, email_sha256, phone_sha256,
       fbp, fbc, fbclid, gclid, source_url, landing_path, utm_source, meta_consent_granted, capi_status) values
      (v_account, 'old-25m', now() - interval '25 months', '203.0.113.1', 'UA', 'e1', 'p1', 'fb.1', 'fb.1.x', 'FBC', null,
       'https://the-anchor.pub/events/a?fbclid=FBC', null, 'facebook', true, 'sent'),
      (v_account, 'ids-23m', now() - interval '23 months', '203.0.113.2', 'UA', 'e2', 'p2', 'fb.2', 'fb.2.x', null, 'GCL',
       'https://the-anchor.pub/events/b?gclid=GCL&utm_source=google', null, 'google', true, 'sent'),
      (v_account, 'ids-8d', now() - interval '8 days', '203.0.113.3', 'UA', 'e3', 'p3', 'fb.3', 'fb.3.x', 'FBC3', null,
       'https://the-anchor.pub/events/c?utm_source=facebook&fbclid=FBC3&utm_medium=paid',
       '/events/c?utm_source=facebook&FBCLID=FBC3', 'facebook', true, 'sent'),
      (v_account, 'url-9d', now() - interval '9 days', null, null, null, null, null, null, null, null,
       'https://the-anchor.pub/?fbclid=ONLY#book', null, null, false, 'skipped'),
      (v_account, 'plain-10d', now() - interval '10 days', null, null, null, null, null, null, null, null,
       'https://the-anchor.pub/events/d?utm_source=facebook&', null, 'facebook', false, 'skipped'),
      (v_account, 'ids-6d', now() - interval '6 days', '203.0.113.6', 'UA', 'e6', 'p6', 'fb.6', 'fb.6.x', 'FBC6', null,
       'https://the-anchor.pub/events/e?fbclid=FBC6', null, 'facebook', true, null);

    -- meta_data_requests and admin_audit: 6 years.
    insert into public.meta_data_requests (kind, confirmation_code, status, created_at) values
      ('deletion', 'retention-old', 'completed', now() - interval '6 years 1 month'),
      ('deletion', 'retention-new', 'completed', now() - interval '5 years 11 months');
    insert into public.admin_audit (action, created_at) values
      ('retention-old', now() - interval '6 years 1 month'),
      ('retention-new', now() - interval '5 years 11 months');

    -- auth_rate_limits: reset more than 24 hours ago.
    insert into public.auth_rate_limits (key, count, reset_at) values
      ('retention-old', 3, now() - interval '25 hours'),
      ('retention-new', 3, now() - interval '23 hours'),
      ('retention-live', 3, now() + interval '1 hour');

    -- oauth_states: expired more than 24 hours ago; no expiry = created_at.
    insert into public.oauth_states (provider, state, expires_at, created_at) values
      ('facebook', 'retention-old', now() - interval '25 hours', now() - interval '25 hours 10 minutes'),
      ('facebook', 'retention-new', now() - interval '23 hours', now() - interval '23 hours 10 minutes'),
      ('facebook', 'retention-noexpiry-old', null, now() - interval '2 days'),
      ('facebook', 'retention-noexpiry-new', null, now() - interval '1 hour');

    -- team_invitations: a day after accepted, declined, cancelled or expired,
    -- whichever came first. Open rows need a person each (one open row per
    -- person per brand).
    insert into auth.users (id, email, created_at) values
      (v_invitee_a, 'retention-invitee-a@example.invalid', now()),
      (v_invitee_b, 'retention-invitee-b@example.invalid', now()),
      (v_invitee_c, 'retention-invitee-c@example.invalid', now());
    insert into public.team_invitations
      (id, account_id, user_id, role, created_at, expires_at, accepted_at, declined_at, cancelled_at) values
      -- deleted: accepted 25 hours ago
      (v_inv_accepted_old, v_account, v_invitee_a, 'member', now() - interval '26 hours', now() + interval '6 days', now() - interval '25 hours', null, null),
      -- kept: accepted 23 hours ago
      (v_inv_accepted_new, v_account, v_invitee_a, 'member', now() - interval '23 hours 30 minutes', now() + interval '6 days', now() - interval '23 hours', null, null),
      -- deleted: declined 25 hours ago
      (v_inv_declined_old, v_account, v_invitee_b, 'member', now() - interval '2 days', now() + interval '5 days', null, now() - interval '25 hours', null),
      -- kept: cancelled 23 hours ago
      (v_inv_cancelled_new, v_account, v_invitee_b, 'owner', now() - interval '2 days', now() + interval '5 days', null, null, now() - interval '23 hours'),
      -- deleted: never answered, expired 25 hours ago
      (v_inv_expired_old, v_account, v_invitee_a, 'member', now() - interval '8 days 1 hour', now() - interval '25 hours', null, null, null),
      -- kept: never answered, expired 23 hours ago
      (v_inv_expired_new, v_account, v_invitee_b, 'member', now() - interval '7 days 23 hours', now() - interval '23 hours', null, null, null),
      -- kept: open and in date
      (v_inv_open, v_account, v_invitee_c, 'member', now() - interval '1 day', now() + interval '6 days', null, null, null);

    -- self_serve_signups: 24 months from requested_at (legal_version marks the fixtures).
    insert into public.self_serve_signups (user_id, requested_at, last_requested_at, legal_version) values
      (null, now() - interval '24 months 1 day', now() - interval '24 months 1 day', 'retention-old'),
      (null, now() - interval '23 months', now() - interval '23 months', 'retention-new');

    set local role service_role;

    -- Dry run: counts the old fixtures, changes nothing.
    v_dry := public.run_data_retention(true);
    raise notice 'dry run: %', v_dry;
    if (v_dry ->> 'dry_run')::boolean is distinct from true then
      raise exception 'dry run did not report dry_run true';
    end if;
    for v_rule in select jsonb_object_keys(v_expected) loop
      if (v_dry -> 'rules' -> v_rule ->> 'due')::bigint
         <> (v_before -> 'rules' -> v_rule ->> 'due')::bigint + (v_expected ->> v_rule)::bigint then
        raise exception 'dry run: rule % due %, expected % more than before (%)', v_rule,
          v_dry -> 'rules' -> v_rule ->> 'due', v_expected ->> v_rule, v_before -> 'rules' -> v_rule ->> 'due';
      end if;
      if (v_dry -> 'rules' -> v_rule ->> 'done')::bigint <> 0 then
        raise exception 'dry run: rule % reports done %', v_rule, v_dry -> 'rules' -> v_rule ->> 'done';
      end if;
    end loop;
    if (select count(*) from jsonb_object_keys(v_dry -> 'rules')) <> (select count(*) from jsonb_object_keys(v_expected)) then
      raise exception 'dry run returned % rules, expected %', (select count(*) from jsonb_object_keys(v_dry -> 'rules')),
        (select count(*) from jsonb_object_keys(v_expected));
    end if;

    set local role postgres;
    select count(*) into v_n from public.notifications where account_id = v_account;
    if v_n <> 2 then raise exception 'dry run deleted notifications'; end if;
    select count(*) into v_n from auth.audit_log_entries where id in (v_old_auth, v_new_auth);
    if v_n <> 2 then raise exception 'dry run deleted sign-in history'; end if;
    select count(*) into v_n from public.booking_conversion_events
     where account_id = v_account and client_ip_address is not null;
    if v_n <> 4 then raise exception 'dry run cleared booking identifiers (% rows still have an IP)', v_n; end if;
    select count(*) into v_n from public.oauth_states where state like 'retention-%';
    if v_n <> 4 then raise exception 'dry run deleted oauth_states'; end if;
    select count(*) into v_n from public.team_invitations where account_id = v_account;
    if v_n <> 7 then raise exception 'dry run deleted team_invitations'; end if;
    select count(*) into v_n from public.self_serve_signups where legal_version like 'retention-%';
    if v_n <> 2 then raise exception 'dry run deleted self_serve_signups'; end if;

    -- Real run.
    set local role service_role;
    v_real := public.run_data_retention(false);
    raise notice 'real run: %', v_real;
    for v_rule in select jsonb_object_keys(v_expected) loop
      if (v_real -> 'rules' -> v_rule ->> 'done')::bigint <> (v_real -> 'rules' -> v_rule ->> 'due')::bigint
         or (v_real -> 'rules' -> v_rule ->> 'due')::bigint <> (v_dry -> 'rules' -> v_rule ->> 'due')::bigint then
        raise exception 'real run: rule % due % done %, dry run said due %', v_rule,
          v_real -> 'rules' -> v_rule ->> 'due', v_real -> 'rules' -> v_rule ->> 'done', v_dry -> 'rules' -> v_rule ->> 'due';
      end if;
    end loop;

    set local role postgres;
    -- Old rows gone, new rows kept.
    if exists (select 1 from public.notifications where account_id = v_account and message = 'retention-old')
       or not exists (select 1 from public.notifications where account_id = v_account and message = 'retention-new') then
      raise exception 'notifications: wrong rows deleted';
    end if;
    if exists (select 1 from public.publish_attempts where publish_job_id = v_job and attempt_number = 1)
       or not exists (select 1 from public.publish_attempts where publish_job_id = v_job and attempt_number = 2) then
      raise exception 'publish_attempts: wrong rows deleted';
    end if;
    if not exists (select 1 from public.publish_jobs where id = v_job)
       or not exists (select 1 from public.content_items where id = v_item) then
      raise exception 'publish_jobs or content_items were touched';
    end if;
    if exists (select 1 from public.audit_log where account_id = v_account and operation_type = 'retention-old')
       or not exists (select 1 from public.audit_log where account_id = v_account and operation_type = 'retention-new') then
      raise exception 'audit_log: wrong rows deleted';
    end if;
    if exists (select 1 from auth.audit_log_entries where id = v_old_auth)
       or not exists (select 1 from auth.audit_log_entries where id = v_new_auth) then
      raise exception 'auth.audit_log_entries: wrong rows deleted';
    end if;
    if exists (select 1 from public.link_in_bio_page_views where profile_id = v_profile and referrer = 'retention-old')
       or not exists (select 1 from public.link_in_bio_page_views where profile_id = v_profile and referrer = 'retention-new') then
      raise exception 'link_in_bio_page_views: wrong rows deleted';
    end if;
    if exists (select 1 from public.link_in_bio_clicks where profile_id = v_profile and referrer = 'retention-old')
       or not exists (select 1 from public.link_in_bio_clicks where profile_id = v_profile and referrer = 'retention-new') then
      raise exception 'link_in_bio_clicks: wrong rows deleted';
    end if;
    if exists (select 1 from public.meta_data_requests where confirmation_code = 'retention-old')
       or not exists (select 1 from public.meta_data_requests where confirmation_code = 'retention-new') then
      raise exception 'meta_data_requests: wrong rows deleted';
    end if;
    if exists (select 1 from public.admin_audit where action = 'retention-old')
       or not exists (select 1 from public.admin_audit where action = 'retention-new') then
      raise exception 'admin_audit: wrong rows deleted';
    end if;
    if exists (select 1 from public.auth_rate_limits where key = 'retention-old')
       or (select count(*) from public.auth_rate_limits where key in ('retention-new', 'retention-live')) <> 2 then
      raise exception 'auth_rate_limits: wrong rows deleted';
    end if;
    if exists (select 1 from public.oauth_states where state in ('retention-old', 'retention-noexpiry-old'))
       or (select count(*) from public.oauth_states where state in ('retention-new', 'retention-noexpiry-new')) <> 2 then
      raise exception 'oauth_states: wrong rows deleted';
    end if;
    if exists (select 1 from public.team_invitations
                where id in (v_inv_accepted_old, v_inv_declined_old, v_inv_expired_old))
       or (select count(*) from public.team_invitations
            where id in (v_inv_accepted_new, v_inv_cancelled_new, v_inv_expired_new, v_inv_open)) <> 4 then
      raise exception 'team_invitations: wrong rows deleted';
    end if;
    if exists (select 1 from public.self_serve_signups where legal_version = 'retention-old')
       or not exists (select 1 from public.self_serve_signups where legal_version = 'retention-new') then
      raise exception 'self_serve_signups: wrong rows deleted';
    end if;

    -- Booking rows: exactly the right ones deleted, cleared or left alone.
    if exists (select 1 from public.booking_conversion_events where account_id = v_account and booking_id = 'old-25m') then
      raise exception 'booking_conversion_events: 25-month row not deleted';
    end if;
    for v_row in
      select * from public.booking_conversion_events
       where account_id = v_account and booking_id in ('ids-23m', 'ids-8d', 'url-9d')
    loop
      if v_row.client_ip_address is not null or v_row.client_user_agent is not null
         or v_row.email_sha256 is not null or v_row.phone_sha256 is not null
         or v_row.fbp is not null or v_row.fbc is not null
         or v_row.fbclid is not null or v_row.gclid is not null then
        raise exception 'booking %: identifiers not cleared', v_row.booking_id;
      end if;
      -- Everything else on the row is kept.
      if v_row.booking_id <> 'url-9d' and (v_row.utm_source is null or v_row.capi_status <> 'sent' or not v_row.meta_consent_granted) then
        raise exception 'booking %: non-identifier columns changed', v_row.booking_id;
      end if;
    end loop;
    if (select count(*) from public.booking_conversion_events
         where account_id = v_account and booking_id in ('ids-23m', 'ids-8d', 'url-9d')) <> 3 then
      raise exception 'booking_conversion_events: a cleared row was deleted';
    end if;
    select * into v_row from public.booking_conversion_events where account_id = v_account and booking_id = 'ids-23m';
    if v_row.source_url <> 'https://the-anchor.pub/events/b?utm_source=google' then
      raise exception 'ids-23m source_url is %', v_row.source_url;
    end if;
    select * into v_row from public.booking_conversion_events where account_id = v_account and booking_id = 'ids-8d';
    if v_row.source_url <> 'https://the-anchor.pub/events/c?utm_source=facebook&utm_medium=paid' then
      raise exception 'ids-8d source_url is %', v_row.source_url;
    end if;
    if v_row.landing_path <> '/events/c?utm_source=facebook' then
      raise exception 'ids-8d landing_path is %', v_row.landing_path;
    end if;
    select * into v_row from public.booking_conversion_events where account_id = v_account and booking_id = 'url-9d';
    if v_row.source_url <> 'https://the-anchor.pub/#book' then
      raise exception 'url-9d source_url is %', v_row.source_url;
    end if;
    select * into v_row from public.booking_conversion_events where account_id = v_account and booking_id = 'plain-10d';
    if v_row.source_url <> 'https://the-anchor.pub/events/d?utm_source=facebook&' then
      raise exception 'plain-10d was changed: %', v_row.source_url;
    end if;
    select * into v_row from public.booking_conversion_events where account_id = v_account and booking_id = 'ids-6d';
    if v_row.client_ip_address is distinct from '203.0.113.6' or v_row.email_sha256 is distinct from 'e6'
       or v_row.fbclid is distinct from 'FBC6' or v_row.source_url <> 'https://the-anchor.pub/events/e?fbclid=FBC6' then
      raise exception 'ids-6d (inside 7 days) was changed';
    end if;

    -- Second run: nothing left to do.
    set local role service_role;
    v_again := public.run_data_retention(false);
    raise notice 'second run: %', v_again;
    for v_rule in select jsonb_object_keys(v_expected) loop
      if (v_again -> 'rules' -> v_rule ->> 'done')::bigint <> 0 then
        raise exception 'second run: rule % did % more', v_rule, v_again -> 'rules' -> v_rule ->> 'done';
      end if;
    end loop;

    -- always undo the fixture rows
    raise exception using errcode = 'P0099', message = 'rollback fixtures';
  exception when sqlstate 'P0099' then null;
  end;

  if exists (select 1 from public.accounts where email = 'retention-probe@example.invalid') then
    raise exception 'fixture rows were not rolled back';
  end if;
  raise notice 'data retention verification PASSED';
end;
$$;
