-- Behaviour check for 20260928190000_provision_self_serve_brand (spec §4.4):
-- one sign-up makes one brand with the right defaults, a second call returns
-- the same brand, every refusal writes nothing, bad arguments are refused,
-- and a failure part-way through leaves no account, membership or brand
-- profile behind. Every call runs as service_role, the only role allowed to
-- execute it (grants: self_serve_grants_verify.sql). The row lock against the
-- login clean-up is checked by provision_self_serve_brand_lock_verify.sh.
--
-- Writes nothing lasting: every fixture (and turning the sign-up switch on)
-- lives inside a sub-transaction that is always rolled back. Local only:
-- never run this against production.
-- Needs the auth.users snapshot triggers (production has them; a local
-- rebuild gets them from 20260928180000_auth_users_snapshot_triggers.sql).
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/provision_self_serve_brand_verify.sql

do $$
declare
  v_owner uuid := gen_random_uuid();      -- confirmed, has a sign-up row: gets a brand
  v_no_row uuid := gen_random_uuid();     -- signed in with no brand, never asked (starts from /no-access): gets a brand
  v_no_row_member uuid := gen_random_uuid(); -- no sign-up row and already a member: refused, no row made
  v_gone uuid := gen_random_uuid();       -- no login at all (deleted): refused
  v_member uuid := gen_random_uuid();     -- has a sign-up row but already belongs to a brand
  v_mismatch uuid := gen_random_uuid();   -- sends an email that is not the login's
  v_closed uuid := gen_random_uuid();     -- its venue was made and later deleted
  v_switch uuid := gen_random_uuid();     -- tries while the switch is off
  v_broken uuid := gen_random_uuid();     -- the brand_profile insert fails part-way through
  v_other_account uuid;
  v_account uuid;
  v_result jsonb;
  v_row record;
  v_count integer;
begin
  begin
    update public.app_flags set enabled = true where name = 'self_serve_signup';
    if not found then raise exception 'app_flags has no self_serve_signup row'; end if;

    insert into auth.users (id, email, created_at, email_confirmed_at) values
      (v_owner, 'pssb-owner@example.invalid', now() - interval '1 hour', now() - interval '1 hour'),
      (v_no_row, 'pssb-norow@example.invalid', now() - interval '90 days', now() - interval '90 days'),
      (v_no_row_member, 'pssb-norow-member@example.invalid', now() - interval '90 days', now() - interval '90 days'),
      (v_member, 'pssb-member@example.invalid', now() - interval '1 hour', now() - interval '1 hour'),
      (v_mismatch, 'pssb-mismatch@example.invalid', now() - interval '1 hour', now() - interval '1 hour'),
      (v_closed, 'pssb-closed@example.invalid', now() - interval '1 hour', now() - interval '1 hour'),
      (v_switch, 'pssb-switch@example.invalid', now() - interval '1 hour', now() - interval '1 hour'),
      (v_broken, 'pssb-broken@example.invalid', now() - interval '1 hour', now() - interval '1 hour');
    insert into public.self_serve_signups (user_id) values
      (v_owner), (v_member), (v_mismatch), (v_switch), (v_broken);
    insert into public.self_serve_signups (user_id, venue_created_at) values (v_closed, now() - interval '40 days');
    insert into public.accounts (business_name, email, auth_user_id)
      values ('Provision verify other venue', 'pssb-other@example.invalid', v_member) returning id into v_other_account;
    insert into public.account_members (account_id, user_id, role) values
      (v_other_account, v_member, 'member'), (v_other_account, v_no_row_member, 'member');

    -- 1. The happy path.
    set local role service_role;
    v_result := public.provision_self_serve_brand(v_owner, '  The Crown & Anchor  ', 'pub', ' PSSB-Owner@Example.invalid ', '2026-09-28.3');
    if v_result ->> 'status' <> 'created' then raise exception 'owner: expected created, got %', v_result; end if;
    v_account := (v_result ->> 'account_id')::uuid;
    set local role postgres;

    select * into v_row from public.accounts where id = v_account;
    if v_row.business_name <> 'The Crown & Anchor' or v_row.display_name <> 'The Crown & Anchor' then
      raise exception 'owner: venue name stored as % / %', v_row.business_name, v_row.display_name;
    end if;
    if v_row.email <> 'pssb-owner@example.invalid' then raise exception 'owner: email stored as %', v_row.email; end if;
    if v_row.timezone <> 'Europe/London' then raise exception 'owner: timezone %', v_row.timezone; end if;
    if v_row.created_by_user_id <> v_owner or v_row.auth_user_id <> v_owner then
      raise exception 'owner: created_by_user_id or auth_user_id is not the login';
    end if;
    if v_row.paid_ads_enabled or v_row.tournaments_enabled or v_row.management_import_enabled then
      raise exception 'owner: a per-brand feature switch is on';
    end if;
    if v_row.billing_override is not null or v_row.archived_at is not null or v_row.offboarded_at is not null then
      raise exception 'owner: billing_override, archived_at or offboarded_at is set';
    end if;

    select count(*) into v_count from public.account_members
     where account_id = v_account and user_id = v_owner and role = 'owner' and created_by = v_owner;
    if v_count <> 1 then raise exception 'owner: expected one owner membership, found %', v_count; end if;
    select count(*) into v_count from public.account_members where account_id = v_account;
    if v_count <> 1 then raise exception 'owner: the new brand has % members, expected 1', v_count; end if;

    select count(*) into v_count from public.brand_profile where account_id = v_account and business_type = 'pub';
    if v_count <> 1 then raise exception 'owner: brand_profile.business_type was not saved'; end if;

    select * into v_row from public.self_serve_signups where user_id = v_owner;
    if v_row.account_id is distinct from v_account then raise exception 'owner: sign-up row account_id not set'; end if;
    if v_row.verified_at is null or v_row.venue_created_at is null or v_row.business_confirmed_at is null then
      raise exception 'owner: verified_at, venue_created_at or business_confirmed_at not set';
    end if;
    if v_row.legal_version is distinct from '2026-09-28.3' then raise exception 'owner: legal_version %', v_row.legal_version; end if;

    -- 2. A double submit, refresh or second tab gets the same brand, and nothing new.
    set local role service_role;
    v_result := public.provision_self_serve_brand(v_owner, 'A different name', 'bar', 'pssb-owner@example.invalid', '2026-09-28.3');
    if v_result ->> 'status' <> 'existing' or (v_result ->> 'account_id')::uuid <> v_account then
      raise exception 'owner again: expected existing %, got %', v_account, v_result;
    end if;
    set local role postgres;
    select count(*) into v_count from public.accounts where auth_user_id = v_owner;
    if v_count <> 1 then raise exception 'owner again: % brands for one sign-up', v_count; end if;
    if (select business_name from public.accounts where id = v_account) <> 'The Crown & Anchor' then
      raise exception 'owner again: the second call changed the brand';
    end if;

    -- 3. A login with no brand and no sign-up row (the /no-access entry): the
    --    row is made with the venue, in the same call.
    set local role service_role;
    v_result := public.provision_self_serve_brand(v_no_row, 'No Row Inn', 'cafe', 'pssb-norow@example.invalid', '2026-09-28.3');
    if v_result ->> 'status' <> 'created' then raise exception 'no row: expected created, got %', v_result; end if;
    set local role postgres;
    select * into v_row from public.self_serve_signups where user_id = v_no_row;
    if v_row.account_id is distinct from (v_result ->> 'account_id')::uuid or v_row.verified_at is null
       or v_row.venue_created_at is null or v_row.requested_at is null or v_row.request_count <> 1 then
      raise exception 'no row: the sign-up row was not made and filled';
    end if;
    select count(*) into v_count from public.account_members
     where user_id = v_no_row and role = 'owner' and account_id = (v_result ->> 'account_id')::uuid;
    if v_count <> 1 then raise exception 'no row: no owner membership'; end if;

    -- 4. Refusals write nothing (and never leave a sign-up row behind).
    set local role service_role;
    v_result := public.provision_self_serve_brand(v_no_row_member, 'Member Again', 'pub', 'pssb-norow-member@example.invalid', '2026-09-28.3');
    if v_result ->> 'status' <> 'member' then raise exception 'no row member: got %', v_result; end if;
    v_result := public.provision_self_serve_brand(v_gone, 'Ghost Inn', 'pub', 'pssb-gone@example.invalid', '2026-09-28.3');
    if v_result ->> 'status' <> 'no_login' then raise exception 'gone: got %', v_result; end if;
    v_result := public.provision_self_serve_brand(v_member, 'Member Arms', 'pub', 'pssb-member@example.invalid', '2026-09-28.3');
    if v_result ->> 'status' <> 'member' then raise exception 'member: got %', v_result; end if;
    v_result := public.provision_self_serve_brand(v_mismatch, 'Mismatch Tavern', 'pub', 'someone-else@example.invalid', '2026-09-28.3');
    if v_result ->> 'status' <> 'email_mismatch' then raise exception 'mismatch: got %', v_result; end if;
    v_result := public.provision_self_serve_brand(v_closed, 'Closed Bar', 'bar', 'pssb-closed@example.invalid', '2026-09-28.3');
    if v_result ->> 'status' <> 'venue_closed' then raise exception 'closed: got %', v_result; end if;
    set local role postgres;
    update public.app_flags set enabled = false where name = 'self_serve_signup';
    set local role service_role;
    v_result := public.provision_self_serve_brand(v_switch, 'Switch Off Inn', 'pub', 'pssb-switch@example.invalid', '2026-09-28.3');
    if v_result ->> 'status' <> 'closed' then raise exception 'switch off: got %', v_result; end if;
    set local role postgres;
    update public.app_flags set enabled = true where name = 'self_serve_signup';

    select count(*) into v_count from public.accounts
     where auth_user_id in (v_gone, v_mismatch, v_closed, v_switch)
        or (auth_user_id in (v_member, v_no_row_member) and id <> v_other_account);
    if v_count <> 0 then raise exception 'a refused call created % brands', v_count; end if;
    select count(*) into v_count from public.account_members where user_id in (v_gone, v_mismatch, v_closed, v_switch);
    if v_count <> 0 then raise exception 'a refused call created % memberships', v_count; end if;
    select count(*) into v_count from public.self_serve_signups where user_id in (v_no_row_member, v_gone);
    if v_count <> 0 then raise exception 'a refused call left a sign-up row behind'; end if;
    select count(*) into v_count from public.self_serve_signups
     where user_id in (v_mismatch, v_switch) and (account_id is not null or venue_created_at is not null or legal_version is not null);
    if v_count <> 0 then raise exception 'a refused call filled its sign-up row'; end if;

    -- 5. Bad arguments are refused (the app validates first).
    set local role service_role;
    begin
      perform public.provision_self_serve_brand(v_switch, 'Visit www.example.com', 'pub', 'pssb-switch@example.invalid', '2026-09-28.3');
      raise exception 'a venue name with a link was accepted';
    exception when invalid_parameter_value then null;
    end;
    begin
      perform public.provision_self_serve_brand(v_switch, 'Mail me@example.invalid', 'pub', 'pssb-switch@example.invalid', '2026-09-28.3');
      raise exception 'a venue name with an email address was accepted';
    exception when invalid_parameter_value then null;
    end;
    begin
      perform public.provision_self_serve_brand(v_switch, e'Line\nBreak Bar', 'pub', 'pssb-switch@example.invalid', '2026-09-28.3');
      raise exception 'a venue name with a line break was accepted';
    exception when invalid_parameter_value then null;
    end;
    begin
      perform public.provision_self_serve_brand(v_switch, '   ', 'pub', 'pssb-switch@example.invalid', '2026-09-28.3');
      raise exception 'a blank venue name was accepted';
    exception when invalid_parameter_value then null;
    end;
    begin
      perform public.provision_self_serve_brand(v_switch, repeat('x', 121), 'pub', 'pssb-switch@example.invalid', '2026-09-28.3');
      raise exception 'a 121-character venue name was accepted';
    exception when invalid_parameter_value then null;
    end;
    begin
      perform public.provision_self_serve_brand(v_switch, 'Switch Off Inn', 'nightclub', 'pssb-switch@example.invalid', '2026-09-28.3');
      raise exception 'an unknown business type was accepted';
    exception when invalid_parameter_value then null;
    end;
    begin
      perform public.provision_self_serve_brand(null, 'Switch Off Inn', 'pub', 'pssb-switch@example.invalid', '2026-09-28.3');
      raise exception 'a null user id was accepted';
    exception when invalid_parameter_value then null;
    end;
    set local role postgres;

    -- 6. A failure part-way through (the brand_profile insert, after the
    --    account and the membership were inserted) undoes everything.
    create function pg_temp.pssb_fail() returns trigger language plpgsql as $f$
    begin
      raise exception 'pssb injected failure' using errcode = 'XX000';
    end;
    $f$;
    create trigger pssb_fail before insert on public.brand_profile for each row execute function pg_temp.pssb_fail();
    set local role service_role;
    begin
      perform public.provision_self_serve_brand(v_broken, 'Broken Bar', 'bar', 'pssb-broken@example.invalid', '2026-09-28.3');
      raise exception 'the injected failure did not stop provisioning';
    exception when internal_error then null;
    end;
    set local role postgres;
    drop trigger pssb_fail on public.brand_profile;
    select count(*) into v_count from public.accounts where auth_user_id = v_broken or business_name = 'Broken Bar';
    if v_count <> 0 then raise exception 'failure part-way: % accounts left behind', v_count; end if;
    select count(*) into v_count from public.account_members where user_id = v_broken;
    if v_count <> 0 then raise exception 'failure part-way: % memberships left behind', v_count; end if;
    select * into v_row from public.self_serve_signups where user_id = v_broken;
    if v_row.account_id is not null or v_row.venue_created_at is not null then
      raise exception 'failure part-way: the sign-up row was filled';
    end if;
    -- It works once the failure is gone.
    set local role service_role;
    v_result := public.provision_self_serve_brand(v_broken, 'Broken Bar', 'bar', 'pssb-broken@example.invalid', '2026-09-28.3');
    if v_result ->> 'status' <> 'created' then raise exception 'after the failure: got %', v_result; end if;
    set local role postgres;

    raise exception 'rollback' using errcode = 'P0001', hint = 'provision_self_serve_brand_verify_ok';
  exception
    when raise_exception then
      if sqlerrm <> 'rollback' then raise; end if;
  end;
end;
$$;

select 'provision_self_serve_brand_verify: pass' as result;
