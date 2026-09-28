-- Team invitations guarded before strangers can create venues
-- (tasks/SPEC-self-serve-signup.md §4.6, decisions P4 and P6, approved by
-- Peter on 28 September 2026).
--
-- 1. public.team_invitations: one row per team invite an owner sends.
--    - Inviting someone who already has a Cheers login creates a pending row;
--      they get access only when they accept it (accept_team_invitation).
--      Pending rows expire 7 days after they are sent.
--    - Inviting a new address keeps today's flow: the login and the
--      membership are created together, so the row is written already
--      accepted. Every invite therefore leaves a row, which is what the
--      rolling 24-hour cap counts.
-- 2. public.record_team_invitation: records one invite atomically. Under a
--    per-brand lock it refuses a person who is already a member or already
--    has an open invitation, refuses once 5 invites were sent in the last 24
--    hours (rolling), and refuses when members plus open invitations fill the
--    plan's seats. Returns an outcome code; it never raises for those cases.
-- 3. public.accept_team_invitation: the invited person accepts; refuses an
--    invitation that is someone else's, closed or expired, or whose brand is
--    closed. Inserts the membership and marks the row accepted in one step.
--    Whether the brand's plan still lets it add people (not lapsed, suspended
--    or unstarted) is checked by its only caller, the accept action
--    (src/app/invitations/actions.ts), with the same entitlement helper as
--    sending an invite, so the grace-period rules live in one place.
-- 4. public.run_data_retention restated IN FULL with one new rule: a team
--    invitation is deleted a day after it was accepted, declined, cancelled or
--    expired, whichever came first (P6: "deleted a day after they expire or
--    are accepted"). Every earlier rule is copied unchanged from
--    20260927120000_data_retention.sql (applied in production as version
--    20260927123048).
--
-- Access: service role only. Every read and write goes through server code
-- with the service-role client, scoped by the signed-in user's id (the
-- invited person) or the active brand's id (the owner), so no RLS policy is
-- needed and none is added. RLS is on with no policies, and every privilege
-- is revoked from public, anon and authenticated, because on this project
-- `authenticated` still inherits all privileges on new tables and EXECUTE on
-- new functions from the postgres default ACL (migration 20260905053036 only
-- removed anon). supabase/tests/team_invitations_verify.sql checks all of it.
--
-- Written for production's shape: account_members (account_id, user_id,
-- created_at, created_by, role) with role 'owner' or 'member'. The rolling
-- window never loses a row it still needs: every row's accepted, declined,
-- cancelled and expiry times are after its created_at, so retention (a day
-- after the earliest of them) never deletes a row sent in the last 24 hours.
--
-- Rollback (nothing else depends on these objects; the app must be reverted
-- first, or inviting fails closed):
--   restore run_data_retention from 20260927120000_data_retention.sql;
--   drop function if exists public.accept_team_invitation(uuid, uuid);
--   drop function if exists public.record_team_invitation(uuid, uuid, text, uuid, integer, integer, boolean);
--   drop table if exists public.team_invitations;

create table if not exists public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  declined_at timestamptz,
  cancelled_at timestamptz,
  constraint team_invitations_role_check check (role in ('owner', 'member')),
  constraint team_invitations_expiry_after_created check (expires_at > created_at),
  constraint team_invitations_one_outcome check (num_nonnulls(accepted_at, declined_at, cancelled_at) <= 1)
);

comment on table public.team_invitations is
  'One row per team invite (SPEC-self-serve-signup §4.6). Existing logins must accept a pending row; new logins are recorded already accepted. Deleted by run_data_retention a day after accepted, declined, cancelled or expired. Service role only.';

-- At most one open invitation per person per brand. An expired open row is
-- cleared by record_team_invitation before a new one is written.
create unique index if not exists team_invitations_one_open
  on public.team_invitations (account_id, user_id)
  where accepted_at is null and declined_at is null and cancelled_at is null;

-- The invited person's pending list.
create index if not exists team_invitations_user_open
  on public.team_invitations (user_id)
  where accepted_at is null and declined_at is null and cancelled_at is null;

-- The rolling 24-hour cap per brand.
create index if not exists team_invitations_account_created
  on public.team_invitations (account_id, created_at);

alter table public.team_invitations enable row level security;

revoke all on table public.team_invitations from public, anon, authenticated;
grant all on table public.team_invitations to service_role;

-- ---------------------------------------------------------------------------
-- record_team_invitation
-- ---------------------------------------------------------------------------
create or replace function public.record_team_invitation(
  p_account_id uuid,
  p_user_id uuid,
  p_role text,
  p_invited_by uuid,
  p_seat_limit integer,
  p_daily_limit integer,
  p_grant_access boolean
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_sent bigint;
  v_used bigint;
begin
  if p_account_id is null or p_user_id is null or p_daily_limit is null or p_grant_access is null then
    raise exception 'record_team_invitation: missing argument' using errcode = '22004';
  end if;
  if p_role not in ('owner', 'member') then
    raise exception 'record_team_invitation: invalid role %', p_role using errcode = '22023';
  end if;

  -- Serialise invites per brand, so two at once cannot both take the last
  -- seat or the fifth daily slot. Released when the transaction ends.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public.team_invitations:' || p_account_id::text, 0));

  if exists (
    select 1 from public.account_members
     where account_id = p_account_id and user_id = p_user_id
  ) then
    return 'already_member';
  end if;

  if exists (
    select 1 from public.team_invitations
     where account_id = p_account_id and user_id = p_user_id
       and accepted_at is null and declined_at is null and cancelled_at is null
       and expires_at > v_now
  ) then
    return 'already_invited';
  end if;

  -- Rolling cap: every invite sent in the last 24 hours, whatever became of it.
  select count(*) into v_sent
    from public.team_invitations
   where account_id = p_account_id and created_at > v_now - interval '24 hours';
  if v_sent >= p_daily_limit then
    return 'daily_limit';
  end if;

  -- Seats: members plus open, unexpired invitations. Null means unlimited.
  if p_seat_limit is not null then
    select
      (select count(*) from public.account_members where account_id = p_account_id)
      + (select count(*) from public.team_invitations
          where account_id = p_account_id
            and accepted_at is null and declined_at is null and cancelled_at is null
            and expires_at > v_now)
      into v_used;
    if v_used >= p_seat_limit then
      return 'seat_limit';
    end if;
  end if;

  -- An expired open invitation for the same person no longer counts for
  -- anything (it is at least 7 days old, so outside the 24-hour window);
  -- clear it so the one-open-invitation index allows the new one.
  delete from public.team_invitations
   where account_id = p_account_id and user_id = p_user_id
     and accepted_at is null and declined_at is null and cancelled_at is null
     and expires_at <= v_now;

  if p_grant_access then
    -- A login created for this invite: access now, as before (the person
    -- accepts by setting a password).
    insert into public.account_members (account_id, user_id, role, created_by)
      values (p_account_id, p_user_id, p_role, p_invited_by);
    insert into public.team_invitations (account_id, user_id, role, invited_by, created_at, expires_at, accepted_at)
      values (p_account_id, p_user_id, p_role, p_invited_by, v_now, v_now + interval '7 days', v_now);
    return 'granted';
  end if;

  insert into public.team_invitations (account_id, user_id, role, invited_by, created_at, expires_at)
    values (p_account_id, p_user_id, p_role, p_invited_by, v_now, v_now + interval '7 days');
  return 'invited';
end;
$$;

comment on function public.record_team_invitation(uuid, uuid, text, uuid, integer, integer, boolean) is
  'Records one team invite under a per-brand lock: refuses already_member, already_invited, daily_limit (rolling 24 hours) and seat_limit (members plus open invitations; null = unlimited). p_grant_access writes the membership too (a login created for this invite). Returns granted or invited. Service role only.';

revoke all on function public.record_team_invitation(uuid, uuid, text, uuid, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.record_team_invitation(uuid, uuid, text, uuid, integer, integer, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- accept_team_invitation
-- ---------------------------------------------------------------------------
create or replace function public.accept_team_invitation(
  p_invitation_id uuid,
  p_user_id uuid
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_invitation public.team_invitations%rowtype;
begin
  if p_invitation_id is null or p_user_id is null then
    raise exception 'accept_team_invitation: missing argument' using errcode = '22004';
  end if;

  -- The user id comes from the verified session; someone else's invitation
  -- looks exactly like a missing one.
  select * into v_invitation
    from public.team_invitations
   where id = p_invitation_id and user_id = p_user_id
   for update;
  if not found then
    return 'not_found';
  end if;
  if v_invitation.accepted_at is not null then
    return 'already_accepted';
  end if;
  if v_invitation.declined_at is not null or v_invitation.cancelled_at is not null then
    return 'closed';
  end if;
  if v_invitation.expires_at <= v_now then
    return 'expired';
  end if;
  if not exists (
    select 1 from public.accounts
     where id = v_invitation.account_id and archived_at is null
  ) then
    return 'closed';
  end if;

  -- Already a member (an operator may have added them meanwhile): keep that
  -- membership and its role, and close the invitation.
  insert into public.account_members (account_id, user_id, role, created_by)
    values (v_invitation.account_id, p_user_id, v_invitation.role, v_invitation.invited_by)
    on conflict (account_id, user_id) do nothing;

  update public.team_invitations
     set accepted_at = v_now
   where id = v_invitation.id;

  return 'accepted';
end;
$$;

comment on function public.accept_team_invitation(uuid, uuid) is
  'The invited person accepts a team invitation: refuses not_found (including someone else''s), already_accepted, closed (declined, cancelled or brand closed) and expired; otherwise inserts the membership and marks the row accepted. Returns accepted. Service role only.';

revoke all on function public.accept_team_invitation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.accept_team_invitation(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- run_data_retention, restated in full. Rules 1 to 12 are unchanged from
-- 20260927120000_data_retention.sql; rule 13 (team_invitations) is new.
--
-- Periods, each measured back from now():
--   notifications                          created_at   older than 12 months: delete
--   publish_attempts                       started_at   older than 24 months: delete
--   audit_log                              created_at   older than 24 months: delete
--   auth.audit_log_entries (sign-ins)      created_at   older than 24 months: delete
--   link_in_bio_page_views, _clicks        created_at   older than 24 months: delete
--   booking_conversion_events              occurred_at  older than 24 months: delete
--   booking_conversion_events identifiers  occurred_at  older than 7 days: set to null
--     (client_ip_address, client_user_agent, email_sha256, phone_sha256, fbp,
--     fbc, fbclid, gclid, and any fbclid or gclid query parameter inside
--     source_url or landing_path). The row itself stays for reporting.
--   meta_data_requests, admin_audit        created_at   older than 6 years: delete
--   auth_rate_limits                       reset_at     more than 24 hours ago: delete
--   oauth_states                           expires_at   more than 24 hours ago: delete
--     (a row with no expires_at is treated as expiring when it was created)
--   team_invitations                       the earliest of accepted_at,
--     declined_at, cancelled_at and expires_at more than 24 hours ago: delete
--
-- Each rule handles at most 10,000 rows per run; safe to run twice. Nothing
-- references team_invitations by foreign key.
-- ---------------------------------------------------------------------------
create or replace function public.run_data_retention(p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_max_rows constant integer := 10000;
  -- A click id inside a stored URL, e.g. ?fbclid=... or &gclid=...
  v_click_param constant text := '[?&](fbclid|gclid)=';
  v_rules jsonb := '{}'::jsonb;
  v_cutoff timestamptz;
  v_due bigint;
  v_done bigint;
begin
  -- One real run at a time, so two overlapping runs cannot double-count.
  if not p_dry_run then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('public.run_data_retention'));
  end if;

  -- notifications: 12 months.
  v_cutoff := v_now - interval '12 months';
  select count(*) into v_due from public.notifications where created_at < v_cutoff;
  v_done := 0;
  if not p_dry_run and v_due > 0 then
    delete from public.notifications
     where id in (
       select id from public.notifications
        where created_at < v_cutoff
        order by created_at
        limit v_max_rows
     );
    get diagnostics v_done = row_count;
  end if;
  v_rules := v_rules || jsonb_build_object('notifications',
    jsonb_build_object('action', 'delete', 'cutoff', v_cutoff, 'due', v_due, 'done', v_done));

  -- publish_attempts: 24 months (publish history; the jobs themselves stay).
  v_cutoff := v_now - interval '24 months';
  select count(*) into v_due from public.publish_attempts where started_at < v_cutoff;
  v_done := 0;
  if not p_dry_run and v_due > 0 then
    delete from public.publish_attempts
     where id in (
       select id from public.publish_attempts
        where started_at < v_cutoff
        order by started_at
        limit v_max_rows
     );
    get diagnostics v_done = row_count;
  end if;
  v_rules := v_rules || jsonb_build_object('publish_attempts',
    jsonb_build_object('action', 'delete', 'cutoff', v_cutoff, 'due', v_due, 'done', v_done));

  -- audit_log: 24 months.
  v_cutoff := v_now - interval '24 months';
  select count(*) into v_due from public.audit_log where created_at < v_cutoff;
  v_done := 0;
  if not p_dry_run and v_due > 0 then
    delete from public.audit_log
     where id in (
       select id from public.audit_log
        where created_at < v_cutoff
        order by created_at
        limit v_max_rows
     );
    get diagnostics v_done = row_count;
  end if;
  v_rules := v_rules || jsonb_build_object('audit_log',
    jsonb_build_object('action', 'delete', 'cutoff', v_cutoff, 'due', v_due, 'done', v_done));

  -- auth.audit_log_entries (Supabase sign-in history): 24 months.
  v_cutoff := v_now - interval '24 months';
  select count(*) into v_due from auth.audit_log_entries where created_at < v_cutoff;
  v_done := 0;
  if not p_dry_run and v_due > 0 then
    delete from auth.audit_log_entries
     where id in (
       select id from auth.audit_log_entries
        where created_at < v_cutoff
        order by created_at
        limit v_max_rows
     );
    get diagnostics v_done = row_count;
  end if;
  v_rules := v_rules || jsonb_build_object('auth_audit_log_entries',
    jsonb_build_object('action', 'delete', 'cutoff', v_cutoff, 'due', v_due, 'done', v_done));

  -- link_in_bio_page_views: 24 months.
  v_cutoff := v_now - interval '24 months';
  select count(*) into v_due from public.link_in_bio_page_views where created_at < v_cutoff;
  v_done := 0;
  if not p_dry_run and v_due > 0 then
    delete from public.link_in_bio_page_views
     where id in (
       select id from public.link_in_bio_page_views
        where created_at < v_cutoff
        order by created_at
        limit v_max_rows
     );
    get diagnostics v_done = row_count;
  end if;
  v_rules := v_rules || jsonb_build_object('link_in_bio_page_views',
    jsonb_build_object('action', 'delete', 'cutoff', v_cutoff, 'due', v_due, 'done', v_done));

  -- link_in_bio_clicks: 24 months.
  v_cutoff := v_now - interval '24 months';
  select count(*) into v_due from public.link_in_bio_clicks where created_at < v_cutoff;
  v_done := 0;
  if not p_dry_run and v_due > 0 then
    delete from public.link_in_bio_clicks
     where id in (
       select id from public.link_in_bio_clicks
        where created_at < v_cutoff
        order by created_at
        limit v_max_rows
     );
    get diagnostics v_done = row_count;
  end if;
  v_rules := v_rules || jsonb_build_object('link_in_bio_clicks',
    jsonb_build_object('action', 'delete', 'cutoff', v_cutoff, 'due', v_due, 'done', v_done));

  -- booking_conversion_events: whole row after 24 months. Runs before the
  -- identifier rule so rows about to go are not updated first.
  v_cutoff := v_now - interval '24 months';
  select count(*) into v_due from public.booking_conversion_events where occurred_at < v_cutoff;
  v_done := 0;
  if not p_dry_run and v_due > 0 then
    delete from public.booking_conversion_events
     where id in (
       select id from public.booking_conversion_events
        where occurred_at < v_cutoff
        order by occurred_at
        limit v_max_rows
     );
    get diagnostics v_done = row_count;
  end if;
  v_rules := v_rules || jsonb_build_object('booking_conversion_events',
    jsonb_build_object('action', 'delete', 'cutoff', v_cutoff, 'due', v_due, 'done', v_done));

  -- booking_conversion_events: personal identifiers set to null 7 days after
  -- the booking. Only rows that still hold one are counted or touched, so a
  -- second run changes nothing. Rows old enough for the delete above are left
  -- out, so a dry run's counts match what a real run does.
  v_cutoff := v_now - interval '7 days';
  select count(*) into v_due
    from public.booking_conversion_events
   where occurred_at < v_cutoff
     and occurred_at >= v_now - interval '24 months'
     and (client_ip_address is not null
          or client_user_agent is not null
          or email_sha256 is not null
          or phone_sha256 is not null
          or fbp is not null
          or fbc is not null
          or fbclid is not null
          or gclid is not null
          or source_url ~* v_click_param
          or landing_path ~* v_click_param);
  v_done := 0;
  if not p_dry_run and v_due > 0 then
    update public.booking_conversion_events
       set client_ip_address = null,
           client_user_agent = null,
           email_sha256 = null,
           phone_sha256 = null,
           fbp = null,
           fbc = null,
           fbclid = null,
           gclid = null,
           -- Drop the click id parameter, then any "?" or "&" it leaves dangling.
           source_url = case
             when source_url ~* v_click_param then
               pg_catalog.regexp_replace(
                 pg_catalog.regexp_replace(source_url, '(?<=[?&])(fbclid|gclid)=[^&#]*&?', '', 'gi'),
                 '[?&]+(#|$)', '\1')
             else source_url
           end,
           landing_path = case
             when landing_path ~* v_click_param then
               pg_catalog.regexp_replace(
                 pg_catalog.regexp_replace(landing_path, '(?<=[?&])(fbclid|gclid)=[^&#]*&?', '', 'gi'),
                 '[?&]+(#|$)', '\1')
             else landing_path
           end
     where id in (
       select id from public.booking_conversion_events
        where occurred_at < v_cutoff
          and occurred_at >= v_now - interval '24 months'
          and (client_ip_address is not null
               or client_user_agent is not null
               or email_sha256 is not null
               or phone_sha256 is not null
               or fbp is not null
               or fbc is not null
               or fbclid is not null
               or gclid is not null
               or source_url ~* v_click_param
               or landing_path ~* v_click_param)
        order by occurred_at
        limit v_max_rows
     );
    get diagnostics v_done = row_count;
  end if;
  v_rules := v_rules || jsonb_build_object('booking_conversion_identifiers',
    jsonb_build_object('action', 'clear', 'cutoff', v_cutoff, 'due', v_due, 'done', v_done));

  -- meta_data_requests: 6 years.
  v_cutoff := v_now - interval '6 years';
  select count(*) into v_due from public.meta_data_requests where created_at < v_cutoff;
  v_done := 0;
  if not p_dry_run and v_due > 0 then
    delete from public.meta_data_requests
     where id in (
       select id from public.meta_data_requests
        where created_at < v_cutoff
        order by created_at
        limit v_max_rows
     );
    get diagnostics v_done = row_count;
  end if;
  v_rules := v_rules || jsonb_build_object('meta_data_requests',
    jsonb_build_object('action', 'delete', 'cutoff', v_cutoff, 'due', v_due, 'done', v_done));

  -- admin_audit: 6 years.
  v_cutoff := v_now - interval '6 years';
  select count(*) into v_due from public.admin_audit where created_at < v_cutoff;
  v_done := 0;
  if not p_dry_run and v_due > 0 then
    delete from public.admin_audit
     where id in (
       select id from public.admin_audit
        where created_at < v_cutoff
        order by created_at
        limit v_max_rows
     );
    get diagnostics v_done = row_count;
  end if;
  v_rules := v_rules || jsonb_build_object('admin_audit',
    jsonb_build_object('action', 'delete', 'cutoff', v_cutoff, 'due', v_due, 'done', v_done));

  -- auth_rate_limits: windows that reset more than 24 hours ago.
  v_cutoff := v_now - interval '24 hours';
  select count(*) into v_due from public.auth_rate_limits where reset_at < v_cutoff;
  v_done := 0;
  if not p_dry_run and v_due > 0 then
    delete from public.auth_rate_limits
     where key in (
       select key from public.auth_rate_limits
        where reset_at < v_cutoff
        order by reset_at
        limit v_max_rows
     );
    get diagnostics v_done = row_count;
  end if;
  v_rules := v_rules || jsonb_build_object('auth_rate_limits',
    jsonb_build_object('action', 'delete', 'cutoff', v_cutoff, 'due', v_due, 'done', v_done));

  -- oauth_states: expired more than 24 hours ago.
  v_cutoff := v_now - interval '24 hours';
  select count(*) into v_due from public.oauth_states where coalesce(expires_at, created_at) < v_cutoff;
  v_done := 0;
  if not p_dry_run and v_due > 0 then
    delete from public.oauth_states
     where id in (
       select id from public.oauth_states
        where coalesce(expires_at, created_at) < v_cutoff
        order by coalesce(expires_at, created_at)
        limit v_max_rows
     );
    get diagnostics v_done = row_count;
  end if;
  v_rules := v_rules || jsonb_build_object('oauth_states',
    jsonb_build_object('action', 'delete', 'cutoff', v_cutoff, 'due', v_due, 'done', v_done));

  -- team_invitations: a day after the invitation was accepted, declined,
  -- cancelled or expired, whichever came first (P6, 28 September 2026).
  -- greatest/least ignore nulls, so least() is the first of those that happened.
  v_cutoff := v_now - interval '24 hours';
  select count(*) into v_due
    from public.team_invitations
   where least(expires_at, accepted_at, declined_at, cancelled_at) < v_cutoff;
  v_done := 0;
  if not p_dry_run and v_due > 0 then
    delete from public.team_invitations
     where id in (
       select id from public.team_invitations
        where least(expires_at, accepted_at, declined_at, cancelled_at) < v_cutoff
        order by least(expires_at, accepted_at, declined_at, cancelled_at)
        limit v_max_rows
     );
    get diagnostics v_done = row_count;
  end if;
  v_rules := v_rules || jsonb_build_object('team_invitations',
    jsonb_build_object('action', 'delete', 'cutoff', v_cutoff, 'due', v_due, 'done', v_done));

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'ran_at', v_now,
    'max_rows_per_rule', v_max_rows,
    'rules', v_rules
  );
end;
$$;

comment on function public.run_data_retention(boolean) is
  'Enforces the approved data retention periods (27 September 2026; team invitations added 28 September 2026). Dry run by default; the daily /api/cron/data-retention cron passes false. Returns per-rule due and done counts. Service role only.';

revoke all on function public.run_data_retention(boolean) from public, anon, authenticated;
grant execute on function public.run_data_retention(boolean) to service_role;
