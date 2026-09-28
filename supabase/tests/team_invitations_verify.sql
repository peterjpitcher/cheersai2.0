-- Verification for 20260928161500_team_invitations (public.team_invitations,
-- record_team_invitation, accept_team_invitation).
-- Run AFTER a local rebuild (`npm run db:rebuild`) with the migration applied.
-- Each block raises an exception if an expectation is not met; a clean run =
-- pass, and the last notice prints 'team invitations verification PASSED'.
-- Writes nothing lasting: the fixture rows live inside a sub-transaction that
-- is always rolled back. Local only: never run this against production (the
-- read-only grant checks in block 1 are also safe to run there on their own).
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/team_invitations_verify.sql

-- 1. Grants: anon and authenticated can neither touch the table nor run the
--    functions; service_role can. RLS is on with no policies.
do $$
declare
  v_role text;
  v_priv text;
  v_fn text;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.team_invitations'::regclass) then
    raise exception 'team_invitations: RLS is off';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'team_invitations') then
    raise exception 'team_invitations: has a policy, expected none (service role only)';
  end if;

  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_priv in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
      if has_table_privilege(v_role, 'public.team_invitations', v_priv) then
        raise exception 'team_invitations: % has %', v_role, v_priv;
      end if;
    end loop;
    foreach v_fn in array array[
      'public.record_team_invitation(uuid, uuid, text, uuid, integer, integer, boolean)',
      'public.accept_team_invitation(uuid, uuid)',
      'public.run_data_retention(boolean)'
    ] loop
      if has_function_privilege(v_role, v_fn, 'execute') then
        raise exception '% can execute %', v_role, v_fn;
      end if;
    end loop;
  end loop;

  foreach v_priv in array array['select', 'insert', 'update', 'delete'] loop
    if not has_table_privilege('service_role', 'public.team_invitations', v_priv) then
      raise exception 'team_invitations: service_role lacks %', v_priv;
    end if;
  end loop;
  foreach v_fn in array array[
    'public.record_team_invitation(uuid, uuid, text, uuid, integer, integer, boolean)',
    'public.accept_team_invitation(uuid, uuid)'
  ] loop
    if not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'service_role cannot execute %', v_fn;
    end if;
    -- Security invoker with an empty search_path: they act only with the
    -- caller's own rights.
    if (select prosecdef from pg_proc where oid = v_fn::regprocedure) then
      raise exception '% is security definer, expected invoker', v_fn;
    end if;
    if (select proconfig from pg_proc where oid = v_fn::regprocedure) is distinct from array['search_path=""'] then
      raise exception '% search_path is not empty', v_fn;
    end if;
  end loop;

  -- Prove it as the roles themselves: every attempt must be refused.
  foreach v_role in array array['anon', 'authenticated'] loop
    begin
      execute format('set local role %I', v_role);
      perform count(*) from public.team_invitations;
      raise exception '% read team_invitations', v_role;
    exception when insufficient_privilege then null;
    end;
    begin
      execute format('set local role %I', v_role);
      insert into public.team_invitations (account_id, user_id) values (gen_random_uuid(), gen_random_uuid());
      raise exception '% wrote team_invitations', v_role;
    exception when insufficient_privilege then null;
    end;
    begin
      execute format('set local role %I', v_role);
      perform public.record_team_invitation(gen_random_uuid(), gen_random_uuid(), 'member', null, null, 5, false);
      raise exception '% ran record_team_invitation', v_role;
    exception when insufficient_privilege then null;
    end;
    begin
      execute format('set local role %I', v_role);
      perform public.accept_team_invitation(gen_random_uuid(), gen_random_uuid());
      raise exception '% ran accept_team_invitation', v_role;
    exception when insufficient_privilege then null;
    end;
  end loop;
end;
$$;

-- 2. Behaviour, as service_role: existing users get a pending invitation, not
--    a membership, until they accept; the rolling cap refuses the sixth invite
--    in 24 hours; seats count open invitations; expired, closed and other
--    people's invitations are refused.
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_users uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                          gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                          gen_random_uuid(), gen_random_uuid()];
  v_account uuid;
  v_other_account uuid;
  v_i integer;
  v_result text;
  v_invitation uuid;
  v_n bigint;
begin
  begin
    insert into auth.users (id, email, created_at)
      values (v_owner, 'invite-verify-owner@example.invalid', now());
    for v_i in 1 .. array_length(v_users, 1) loop
      insert into auth.users (id, email, created_at)
        values (v_users[v_i], format('invite-verify-%s@example.invalid', v_i), now());
    end loop;
    insert into public.accounts (business_name, email, auth_user_id)
      values ('Invite probe', 'invite-probe@example.invalid', v_owner) returning id into v_account;
    insert into public.accounts (business_name, email, auth_user_id)
      values ('Invite probe two', 'invite-probe@example.invalid', v_owner) returning id into v_other_account;
    insert into public.account_members (account_id, user_id, role) values (v_account, v_owner, 'owner');

    set local role service_role;

    -- a. Existing user: pending invitation, no membership yet.
    v_result := public.record_team_invitation(v_account, v_users[1], 'member', v_owner, null, 5, false);
    if v_result <> 'invited' then raise exception 'a: expected invited, got %', v_result; end if;
    if exists (select 1 from public.account_members where account_id = v_account and user_id = v_users[1]) then
      raise exception 'a: an existing user got a membership before accepting';
    end if;
    select id into v_invitation from public.team_invitations
     where account_id = v_account and user_id = v_users[1] and accepted_at is null;
    if v_invitation is null then raise exception 'a: no pending invitation written'; end if;
    if (select expires_at - created_at from public.team_invitations where id = v_invitation) <> interval '7 days' then
      raise exception 'a: invitation does not expire after 7 days';
    end if;

    -- b. The same person again while it is open: refused, nothing written.
    v_result := public.record_team_invitation(v_account, v_users[1], 'member', v_owner, null, 5, false);
    if v_result <> 'already_invited' then raise exception 'b: expected already_invited, got %', v_result; end if;

    -- c. Someone else cannot accept it.
    v_result := public.accept_team_invitation(v_invitation, v_users[2]);
    if v_result <> 'not_found' then raise exception 'c: another user accepted, got %', v_result; end if;

    -- d. The invited person accepts: membership with the invited role.
    v_result := public.accept_team_invitation(v_invitation, v_users[1]);
    if v_result <> 'accepted' then raise exception 'd: expected accepted, got %', v_result; end if;
    if not exists (select 1 from public.account_members
                    where account_id = v_account and user_id = v_users[1] and role = 'member' and created_by = v_owner) then
      raise exception 'd: membership not written on accept';
    end if;
    v_result := public.accept_team_invitation(v_invitation, v_users[1]);
    if v_result <> 'already_accepted' then raise exception 'd: second accept gave %', v_result; end if;
    v_result := public.record_team_invitation(v_account, v_users[1], 'member', v_owner, null, 5, false);
    if v_result <> 'already_member' then raise exception 'd: expected already_member, got %', v_result; end if;

    -- e. A new login: membership and an accepted row in one step.
    v_result := public.record_team_invitation(v_account, v_users[2], 'owner', v_owner, null, 5, true);
    if v_result <> 'granted' then raise exception 'e: expected granted, got %', v_result; end if;
    if not exists (select 1 from public.account_members
                    where account_id = v_account and user_id = v_users[2] and role = 'owner') then
      raise exception 'e: new login has no membership';
    end if;
    if not exists (select 1 from public.team_invitations
                    where account_id = v_account and user_id = v_users[2] and accepted_at is not null) then
      raise exception 'e: new login invite not recorded';
    end if;

    -- f. Rolling cap: 2 sent so far; 3 more reach 5, the sixth is refused.
    for v_i in 3 .. 5 loop
      v_result := public.record_team_invitation(v_account, v_users[v_i], 'member', v_owner, null, 5, false);
      if v_result <> 'invited' then raise exception 'f: invite % gave %', v_i, v_result; end if;
    end loop;
    v_result := public.record_team_invitation(v_account, v_users[6], 'member', v_owner, null, 5, false);
    if v_result <> 'daily_limit' then raise exception 'f: sixth invite gave %', v_result; end if;
    v_result := public.record_team_invitation(v_account, v_users[6], 'member', v_owner, null, 5, true);
    if v_result <> 'daily_limit' then raise exception 'f: sixth invite (new login) gave %', v_result; end if;
    if exists (select 1 from public.team_invitations where account_id = v_account and user_id = v_users[6])
       or exists (select 1 from public.account_members where account_id = v_account and user_id = v_users[6]) then
      raise exception 'f: the refused sixth invite wrote something';
    end if;
    -- Declined or cancelled invites still count towards the cap.
    update public.team_invitations set declined_at = now()
     where account_id = v_account and user_id = v_users[3];
    v_result := public.record_team_invitation(v_account, v_users[6], 'member', v_owner, null, 5, false);
    if v_result <> 'daily_limit' then raise exception 'f: a decline freed a daily slot (%)', v_result; end if;
    -- An invite sent more than 24 hours ago no longer counts (rolling window).
    update public.team_invitations set created_at = now() - interval '25 hours'
     where account_id = v_account and user_id = v_users[3];
    v_result := public.record_team_invitation(v_account, v_users[6], 'member', v_owner, null, 5, false);
    if v_result <> 'invited' then raise exception 'f: rolling window did not free a slot (%)', v_result; end if;
    -- The cap is per brand: the other brand is unaffected.
    v_result := public.record_team_invitation(v_other_account, v_users[7], 'member', v_owner, null, 5, false);
    if v_result <> 'invited' then raise exception 'f: cap leaked across brands (%)', v_result; end if;

    -- g. Seats: members (owner, users 1 and 2 = 3) plus open invitations
    --    (users 4, 5 and 6 = 3) = 6. A limit of 6 refuses the next one.
    update public.team_invitations set created_at = now() - interval '2 days'
     where account_id = v_account;
    v_result := public.record_team_invitation(v_account, v_users[8], 'member', v_owner, 6, 5, false);
    if v_result <> 'seat_limit' then raise exception 'g: open invitations did not count towards seats (%)', v_result; end if;
    -- A cancelled invitation frees its seat.
    update public.team_invitations set cancelled_at = now()
     where account_id = v_account and user_id = v_users[4] and accepted_at is null;
    v_result := public.record_team_invitation(v_account, v_users[8], 'member', v_owner, 6, 5, false);
    if v_result <> 'invited' then raise exception 'g: cancelled invitation still held a seat (%)', v_result; end if;

    -- h. Expired: refused on accept; the person can be invited again.
    select id into v_invitation from public.team_invitations
     where account_id = v_account and user_id = v_users[5] and accepted_at is null and cancelled_at is null;
    update public.team_invitations set created_at = now() - interval '8 days', expires_at = now() - interval '1 second'
     where id = v_invitation;
    v_result := public.accept_team_invitation(v_invitation, v_users[5]);
    if v_result <> 'expired' then raise exception 'h: expired invitation gave %', v_result; end if;
    if exists (select 1 from public.account_members where account_id = v_account and user_id = v_users[5]) then
      raise exception 'h: expired invitation granted access';
    end if;
    v_result := public.record_team_invitation(v_account, v_users[5], 'member', v_owner, null, 5, false);
    if v_result <> 'invited' then raise exception 'h: re-invite after expiry gave %', v_result; end if;
    if exists (select 1 from public.team_invitations where id = v_invitation) then
      raise exception 'h: the expired invitation was not cleared';
    end if;

    -- i. Declined, cancelled and closed-brand invitations are refused.
    select id into v_invitation from public.team_invitations
     where account_id = v_account and user_id = v_users[3];
    v_result := public.accept_team_invitation(v_invitation, v_users[3]);
    if v_result <> 'closed' then raise exception 'i: declined invitation gave %', v_result; end if;
    select id into v_invitation from public.team_invitations
     where account_id = v_account and user_id = v_users[4] and cancelled_at is not null;
    v_result := public.accept_team_invitation(v_invitation, v_users[4]);
    if v_result <> 'closed' then raise exception 'i: cancelled invitation gave %', v_result; end if;
    set local role postgres;
    update public.accounts set archived_at = now() where id = v_other_account;
    set local role service_role;
    select id into v_invitation from public.team_invitations
     where account_id = v_other_account and user_id = v_users[7];
    v_result := public.accept_team_invitation(v_invitation, v_users[7]);
    if v_result <> 'closed' then raise exception 'i: archived brand invitation gave %', v_result; end if;

    -- j. Constraints: one outcome per row; bad role refused.
    begin
      update public.team_invitations set declined_at = now(), cancelled_at = now()
       where account_id = v_account and user_id = v_users[6];
      raise exception 'j: a row took two outcomes';
    exception when check_violation then null;
    end;
    begin
      perform public.record_team_invitation(v_account, v_users[8], 'admin', v_owner, null, 5, false);
      raise exception 'j: bad role accepted';
    exception when invalid_parameter_value then null;
    end;

    -- k. Deleting a brand or a login removes its invitations.
    set local role postgres;
    select count(*) into v_n from public.team_invitations where account_id = v_account;
    if v_n = 0 then raise exception 'k: no rows to cascade'; end if;
    delete from auth.users where id = v_users[6];
    if exists (select 1 from public.team_invitations where user_id = v_users[6]) then
      raise exception 'k: deleting a login left its invitations';
    end if;
    delete from public.accounts where id = v_account;
    if exists (select 1 from public.team_invitations where account_id = v_account) then
      raise exception 'k: deleting a brand left its invitations';
    end if;

    raise exception using errcode = 'P0099', message = 'rollback fixtures';
  exception when sqlstate 'P0099' then null;
  end;

  if exists (select 1 from public.accounts where email = 'invite-probe@example.invalid') then
    raise exception 'fixture rows were not rolled back';
  end if;
  raise notice 'team invitations verification PASSED';
end;
$$;
