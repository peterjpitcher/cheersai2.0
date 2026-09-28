-- Behaviour check for 20260928170000_self_serve_signups: the sign-up record
-- (one row per login however often it is requested) and the two retention
-- rules from decision P6 (rows kept 24 months; logins that never became a
-- venue listed for deletion after 7 days unconfirmed or 30 days confirmed,
-- unless they are a member, an admin or have an open team invitation).
-- Grants are checked separately by self_serve_grants_verify.sql.
--
-- Writes nothing lasting: every fixture lives inside a sub-transaction that is
-- always rolled back. Local only: never run this against production.
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/self_serve_signups_verify.sql

do $$
declare
  v_new uuid := gen_random_uuid();          -- unconfirmed, asked 1 day ago: kept
  v_stale uuid := gen_random_uuid();        -- unconfirmed, last asked 8 days ago: listed
  v_retried uuid := gen_random_uuid();      -- unconfirmed, first asked 10 days ago, again 2 days ago: kept
  v_confirmed_new uuid := gen_random_uuid();  -- confirmed 29 days ago, no venue: kept
  v_confirmed_old uuid := gen_random_uuid();  -- confirmed 31 days ago, no venue: listed
  v_with_venue uuid := gen_random_uuid();   -- confirmed 60 days ago, has a venue: kept
  v_member uuid := gen_random_uuid();       -- unconfirmed 20 days, but a brand member: kept
  v_admin uuid := gen_random_uuid();        -- unconfirmed 20 days, but an app admin: kept
  v_no_row uuid := gen_random_uuid();       -- old unconfirmed login with no sign-up row: never listed
  v_invited uuid := gen_random_uuid();      -- unconfirmed 9 days, but has an open team invitation: kept
  v_invite_expired uuid := gen_random_uuid(); -- unconfirmed 9 days, its invitation expired: listed
  v_account uuid;
  v_id_first uuid;
  v_id_second uuid;
  v_count integer;
  v_result jsonb;
  v_ids jsonb;
begin
  begin
    insert into auth.users (id, email, created_at, email_confirmed_at) values
      (v_new, 'ssu-new@example.invalid', now() - interval '1 day', null),
      (v_stale, 'ssu-stale@example.invalid', now() - interval '8 days', null),
      (v_retried, 'ssu-retried@example.invalid', now() - interval '10 days', null),
      (v_confirmed_new, 'ssu-confirmed-new@example.invalid', now() - interval '29 days', now() - interval '29 days'),
      (v_confirmed_old, 'ssu-confirmed-old@example.invalid', now() - interval '31 days', now() - interval '31 days'),
      (v_with_venue, 'ssu-venue@example.invalid', now() - interval '60 days', now() - interval '60 days'),
      (v_member, 'ssu-member@example.invalid', now() - interval '20 days', null),
      (v_admin, 'ssu-admin@example.invalid', now() - interval '20 days', null),
      (v_no_row, 'ssu-norow@example.invalid', now() - interval '20 days', null),
      (v_invited, 'ssu-invited@example.invalid', now() - interval '9 days', null),
      (v_invite_expired, 'ssu-invite-expired@example.invalid', now() - interval '9 days', null);

    insert into public.accounts (business_name, email, auth_user_id)
      values ('Sign-up verify venue', 'ssu-venue@example.invalid', v_with_venue) returning id into v_account;
    insert into public.account_members (account_id, user_id, role) values (v_account, v_member, 'member');
    insert into public.app_admins (user_id) values (v_admin);
    insert into public.team_invitations (account_id, user_id, role, created_at, expires_at) values
      (v_account, v_invited, 'member', now() - interval '1 day', now() + interval '6 days'),
      (v_account, v_invite_expired, 'member', now() - interval '9 days', now() - interval '2 days');

    -- 1. The record: one row per login, however often it is requested.
    set local role service_role;
    v_id_first := public.record_self_serve_signup_request(v_new);
    v_id_second := public.record_self_serve_signup_request(v_new);
    if v_id_first is distinct from v_id_second then
      raise exception 'a second request made a second row (% then %)', v_id_first, v_id_second;
    end if;
    select count(*) into v_count from public.self_serve_signups where user_id = v_new;
    if v_count <> 1 then raise exception 'expected 1 row for the login, found %', v_count; end if;
    select request_count into v_count from public.self_serve_signups where user_id = v_new;
    if v_count <> 2 then raise exception 'request_count is %, expected 2', v_count; end if;
    begin
      perform public.record_self_serve_signup_request(null);
      raise exception 'a null user id was accepted';
    exception when invalid_parameter_value then null;
    end;
    set local role postgres;

    -- Fixture rows for the retention rules.
    insert into public.self_serve_signups (user_id, requested_at, last_requested_at) values
      (v_stale, now() - interval '8 days', now() - interval '8 days'),
      (v_retried, now() - interval '10 days', now() - interval '2 days'),
      (v_confirmed_new, now() - interval '29 days', now() - interval '29 days'),
      (v_confirmed_old, now() - interval '31 days', now() - interval '31 days'),
      (v_member, now() - interval '20 days', now() - interval '20 days'),
      (v_admin, now() - interval '20 days', now() - interval '20 days'),
      (v_invited, now() - interval '9 days', now() - interval '9 days'),
      (v_invite_expired, now() - interval '9 days 1 hour', now() - interval '9 days 1 hour');
    insert into public.self_serve_signups (user_id, account_id, requested_at, last_requested_at, venue_created_at) values
      (v_with_venue, v_account, now() - interval '60 days', now() - interval '60 days', now() - interval '59 days');
    -- Rows either side of 24 months; user_id already null, as after a login was deleted.
    insert into public.self_serve_signups (user_id, requested_at, last_requested_at) values
      (null, now() - interval '24 months 1 day', now() - interval '24 months 1 day'),
      (null, now() - interval '23 months', now() - interval '23 months');

    -- 2. The login list: exactly the old confirmed login, the one whose invitation
    --    expired and the stale unconfirmed login, oldest request first.
    set local role service_role;
    v_result := public.run_data_retention(true);
    v_ids := v_result -> 'self_serve_logins' -> 'user_ids';
    raise notice 'self_serve_logins: %', v_result -> 'self_serve_logins';
    if v_ids is distinct from jsonb_build_array(v_confirmed_old, v_invite_expired, v_stale) then
      raise exception 'logins listed %, expected [%, %, %]', v_ids, v_confirmed_old, v_invite_expired, v_stale;
    end if;
    if (v_result -> 'self_serve_logins' ->> 'due')::int <> 3 then
      raise exception 'self_serve_logins due is %, expected 3', v_result -> 'self_serve_logins' ->> 'due';
    end if;
    if (v_result -> 'self_serve_logins' ->> 'max_per_run')::int <> 100 then
      raise exception 'self_serve_logins max_per_run is not 100';
    end if;

    -- 3. The 24-month rule: a dry run counts the old row, a real run deletes only it.
    if (v_result -> 'rules' -> 'self_serve_signups' ->> 'due')::int <> 1
       or (v_result -> 'rules' -> 'self_serve_signups' ->> 'done')::int <> 0 then
      raise exception 'dry run self_serve_signups rule: %', v_result -> 'rules' -> 'self_serve_signups';
    end if;
    v_result := public.run_data_retention(false);
    if (v_result -> 'rules' -> 'self_serve_signups' ->> 'done')::int <> 1 then
      raise exception 'real run self_serve_signups rule: %', v_result -> 'rules' -> 'self_serve_signups';
    end if;
    set local role postgres;
    select count(*) into v_count from public.self_serve_signups where user_id is null;
    if v_count <> 1 then raise exception 'expected the 23-month row to stay, found % null-user rows', v_count; end if;
    -- The SQL never deletes a login itself: the cron does, through the Auth admin API.
    select count(*) into v_count from auth.users where id in (v_stale, v_confirmed_old);
    if v_count <> 2 then raise exception 'run_data_retention deleted a login itself'; end if;

    -- 4. The check the cron makes just before each delete: the full rule, as it
    --    stands at that moment, under a lock on the sign-up row.
    set local role service_role;
    if not public.self_serve_login_deletable(v_confirmed_old) then
      raise exception 'deletable: a listed login (confirmed 31 days ago) was refused';
    end if;
    if public.self_serve_login_deletable(v_new) or public.self_serve_login_deletable(v_confirmed_new)
       or public.self_serve_login_deletable(v_with_venue) or public.self_serve_login_deletable(v_member)
       or public.self_serve_login_deletable(v_admin) or public.self_serve_login_deletable(v_invited)
       or public.self_serve_login_deletable(v_no_row) then
      raise exception 'deletable: a login outside the rule was allowed';
    end if;
    if public.self_serve_login_deletable(gen_random_uuid()) or public.self_serve_login_deletable(null) then
      raise exception 'deletable: an unknown or null login was allowed';
    end if;
    -- Listed, then asked to sign up again before the delete: must NOT be deleted.
    if not public.self_serve_login_deletable(v_stale) then
      raise exception 'deletable: the stale login was refused before it asked again';
    end if;
    perform public.record_self_serve_signup_request(v_stale);
    if public.self_serve_login_deletable(v_stale) then
      raise exception 'deletable: a login with a fresh last_requested_at was allowed';
    end if;
    -- Listed, then invited to a brand before the delete (pending invitation): must NOT be deleted.
    set local role postgres;
    insert into public.team_invitations (account_id, user_id, role, created_at, expires_at)
      values (v_account, v_invite_expired, 'member', now(), now() + interval '7 days');
    set local role service_role;
    if public.self_serve_login_deletable(v_invite_expired) then
      raise exception 'deletable: a login with a pending team invitation was allowed';
    end if;
    set local role postgres;

    -- 5. Deleting a login keeps its sign-up row for the funnel, with user_id cleared.
    delete from auth.users where id = v_stale;
    select count(*) into v_count from public.self_serve_signups
     where user_id is null and requested_at::date = (now() - interval '8 days')::date;
    if v_count <> 1 then raise exception 'the sign-up row did not survive its login being deleted'; end if;

    raise exception 'rollback' using errcode = 'P0001', hint = 'self_serve_signups_verify_ok';
  exception
    when raise_exception then
      if sqlerrm <> 'rollback' then raise; end if;
  end;
end;
$$;

select 'self_serve_signups_verify: pass' as result;
