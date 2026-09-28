-- Self-serve sign-up requests (tasks/SPEC-self-serve-signup.md §4.2, §4.4
-- table, §4.10, §4.12; §5 PR 5). Approved by Peter on 28 September 2026 (his
-- question 53: build everything now behind app_flags('self_serve_signup'),
-- which stays off until Meta approves and a first venue has published).
--
-- 1. public.self_serve_signups: one row per login that asked to sign up
--    through /signup. It stores no email, name or IP address (review finding
--    10): only the login's id, the venue's id once one exists, and when each
--    step happened. PR 6 (venue creation) fills verified_at, account_id,
--    venue_created_at, business_confirmed_at and legal_version.
-- 2. public.record_self_serve_signup_request(p_user_id): the upsert on
--    user_id that every sign-up request makes, so re-requesting always leaves
--    exactly one row per login (last_requested_at and request_count move on).
-- 3. public.run_data_retention restated IN FULL with the rules from decision
--    P6 (Peter's question 45):
--      - self_serve_signups rows: deleted 24 months after requested_at;
--      - self-serve logins that never became a venue: listed for deletion
--        when never confirmed 7 days after the last request, or confirmed more
--        than 30 days ago (no venue, no membership, not an admin, no open
--        team invitation). The daily cron hands each one, at most 100 a run,
--        to delete_stale_self_serve_login (5), which deletes it only if the
--        rule still holds; the user_auth_snapshot row goes with each (trigger).
--    Rules 1 to 13 are copied unchanged from
--    20260928161500_team_invitations.sql (applied in production as version
--    20260928111735; the live function body was checked byte for byte
--    against that file on 28 September 2026), which itself restated rules 1
--    to 12 from 20260927120000_data_retention.sql.
-- 4. EXECUTE on public.increment_rate_limit revoked from authenticated (spec
--    §4.12, F15). It is SECURITY DEFINER and takes any account id; only the
--    app's service-role client calls it (src/lib/providers/rate-limits.ts) and
--    no RLS policy uses it (both checked 28 September 2026). Live grants read
--    the same day: postgres, authenticated and service_role had EXECUTE; anon
--    and public did not.
-- 5. The stale-login rule lives in one place, public.self_serve_login_is_stale
--    (internal: only the functions below, which run as its owner, call it).
--    run_data_retention uses it to make the list. For each listed login the
--    cron calls public.delete_stale_self_serve_login(user_id), which in ONE
--    transaction locks the login's sign-up row (select ... for update),
--    applies the full rule again and, only if it still holds, deletes the
--    row in auth.users, then releases the lock at commit. Nothing can change
--    between the check and the delete: a sign-up request (the upsert in
--    record_self_serve_signup_request) takes the same row lock, and venue
--    creation in PR 6 (provision_self_serve_brand) must take it too, so each
--    either finishes first (and the login is kept) or waits until the delete
--    is over. A login that asked again, was invited, joined a brand or
--    created a venue since the list was made is kept.
--    The login is deleted in SQL, not through the Auth admin API, so Supabase
--    writes no "user_deleted" entry in auth.audit_log_entries for it; its
--    cascades (identities, sessions, refresh tokens, MFA factors, one-time
--    tokens) and the snapshot purge trigger are the same.
--
-- Access: service role only. RLS is on with no policies, and every privilege
-- is revoked from public, anon and authenticated, because on this project
-- `authenticated` still inherits all privileges on new tables and EXECUTE on
-- new functions from the postgres default ACL (20260905053036 only removed
-- anon). supabase/tests/self_serve_grants_verify.sql checks all of it, read
-- only, and is safe to run against production after this migration.
--
-- Written for production's shape: accounts (id), account_members (user_id),
-- app_admins (user_id), team_invitations (user_id, accepted_at, declined_at,
-- cancelled_at, expires_at), auth.users (email_confirmed_at). Nothing
-- references self_serve_signups by foreign key.
--
-- Deploy order: apply this migration BEFORE the app that calls it deploys.
-- The app fails closed without it (a sign-up request is refused and the
-- operator alerted), and the sign-up switch is off anyway. Applying it first
-- changes nothing for the live app: nothing reads the new table, and the live
-- cron ignores the new "self_serve_logins" key until the new app deploys.
--
-- Rollback (revert the app first; the table holds no personal data):
--   restore run_data_retention from 20260928161500_team_invitations.sql;
--   drop function if exists public.delete_stale_self_serve_login(uuid);
--   drop function if exists public.self_serve_login_is_stale(uuid, timestamptz);
--   drop function if exists public.record_self_serve_signup_request(uuid);
--   drop table if exists public.self_serve_signups;
--   grant execute on function public.increment_rate_limit(uuid, text, text, timestamptz, integer) to authenticated;

create table if not exists public.self_serve_signups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users (id) on delete set null,
  account_id uuid unique references public.accounts (id) on delete set null,
  requested_at timestamptz not null default now(),
  last_requested_at timestamptz not null default now(),
  request_count integer not null default 1 check (request_count >= 1),
  verified_at timestamptz,
  venue_created_at timestamptz,
  business_confirmed_at timestamptz,
  legal_version text check (legal_version is null or length(legal_version) between 1 and 40)
);

comment on table public.self_serve_signups is
  'One row per login that asked to sign up at /signup (spec §4.4). No email, name or IP. Kept 24 months; the login goes after 7 days unconfirmed or 30 days confirmed without a venue. Service role only.';

-- Retention (24 months) and the funnel query both filter on requested_at.
create index if not exists self_serve_signups_requested_at on public.self_serve_signups (requested_at);

alter table public.self_serve_signups enable row level security;
revoke all on table public.self_serve_signups from public, anon, authenticated;
grant all on table public.self_serve_signups to service_role;

create or replace function public.record_self_serve_signup_request(p_user_id uuid)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_user_id is null then
    raise exception 'record_self_serve_signup_request: user id is required' using errcode = '22023';
  end if;

  insert into public.self_serve_signups as s (user_id)
  values (p_user_id)
  on conflict (user_id) do update
     set last_requested_at = pg_catalog.now(),
         request_count = least(s.request_count, 2147483646) + 1
  returning s.id into v_id;

  return v_id;
end;
$$;

comment on function public.record_self_serve_signup_request(uuid) is
  'Records one sign-up request: inserts the login''s self_serve_signups row or moves its last_requested_at and request_count on. One row per login. Service role only.';

revoke all on function public.record_self_serve_signup_request(uuid) from public, anon, authenticated;
grant execute on function public.record_self_serve_signup_request(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The stale self-serve login rule (P6), in one place.
-- ---------------------------------------------------------------------------
create or replace function public.self_serve_login_is_stale(p_user_id uuid, p_now timestamptz)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
      from public.self_serve_signups s
      join auth.users u on u.id = s.user_id
     where s.user_id = p_user_id
       and s.account_id is null
       and s.venue_created_at is null
       and not exists (select 1 from public.account_members m where m.user_id = s.user_id)
       and not exists (select 1 from public.app_admins a where a.user_id = s.user_id)
       -- An open invitation to a brand: deleting the login would delete it too.
       and not exists (
         select 1 from public.team_invitations t
          where t.user_id = s.user_id
            and t.accepted_at is null and t.declined_at is null and t.cancelled_at is null
            and t.expires_at > p_now)
       and ((u.email_confirmed_at is null and s.last_requested_at < p_now - interval '7 days')
            or u.email_confirmed_at < p_now - interval '30 days')
  );
$$;

comment on function public.self_serve_login_is_stale(uuid, timestamptz) is
  'The P6 rule for deleting a self-serve login that never became a venue: a sign-up row with no venue, no membership, not an admin, no open team invitation, and unconfirmed 7 days after the last request or confirmed more than 30 days ago. Internal: called only by run_data_retention and delete_stale_self_serve_login (both run as the owner). Nobody else may execute it.';

-- Internal: it reads auth.users, which service_role cannot read, so only the
-- two SECURITY DEFINER functions below (same owner) call it.
revoke all on function public.self_serve_login_is_stale(uuid, timestamptz) from public, anon, authenticated, service_role;

create or replace function public.delete_stale_self_serve_login(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    return jsonb_build_object('status', 'kept');
  end if;

  -- Lock the sign-up row for the rest of this transaction. A sign-up request
  -- (its upsert) or venue creation (PR 6) that takes the same lock waits until
  -- this function has finished, and this function waits for one already under
  -- way, then sees what it wrote.
  perform 1 from public.self_serve_signups where user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('status', 'kept');
  end if;

  -- The whole rule again, as it stands now, under the lock.
  if not public.self_serve_login_is_stale(p_user_id, pg_catalog.now()) then
    return jsonb_build_object('status', 'kept');
  end if;

  -- Delete the login in the same transaction, still under the lock. Its
  -- identities, sessions, refresh tokens, MFA factors and one-time tokens go
  -- by cascade, the user_auth_snapshot row by trigger, and the sign-up row
  -- keeps its dates with user_id set to null. A blocked delete (for example
  -- rows in audit_log, whose foreign key has no delete action) is undone by
  -- this block alone and reported as failed.
  begin
    delete from auth.users where id = p_user_id;
  exception when others then
    return jsonb_build_object('status', 'failed', 'error', sqlstate || ' ' || sqlerrm);
  end;
  return jsonb_build_object('status', 'deleted');
end;
$$;

comment on function public.delete_stale_self_serve_login(uuid) is
  'Called by the data-retention cron for each login run_data_retention lists: locks the login''s sign-up row, applies the P6 rule (self_serve_login_is_stale) again and, if it still holds, deletes the auth user in the same transaction. Returns {"status": "deleted" | "kept" | "failed", "error"?}. SECURITY DEFINER because it reads and deletes auth.users. Service role only.';

revoke all on function public.delete_stale_self_serve_login(uuid) from public, anon, authenticated;
grant execute on function public.delete_stale_self_serve_login(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- run_data_retention, restated in full. Rules 1 to 13 (everything before
-- "self_serve_signups") are unchanged from 20260928161500_team_invitations.sql.
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
--   self_serve_signups                     requested_at older than 24 months: delete
--   self-serve logins without a venue      listed under "self_serve_logins" for
--     the cron to delete: unconfirmed 7 days after last_requested_at, or
--     confirmed (auth.users.email_confirmed_at) more than 30 days ago
--
-- Each rule handles at most 10,000 rows per run; the login list at most 100.
-- Safe to run twice.
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
  v_max_logins constant integer := 100;
  v_unconfirmed_cutoff timestamptz;
  v_confirmed_cutoff timestamptz;
  v_login_ids jsonb;
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

  -- self_serve_signups: 24 months after the first request (P6). The row holds
  -- no email, name or IP; the login it points at goes much sooner (below), and
  -- its foreign key then sets user_id to null.
  v_cutoff := v_now - interval '24 months';
  select count(*) into v_due from public.self_serve_signups where requested_at < v_cutoff;
  v_done := 0;
  if not p_dry_run and v_due > 0 then
    delete from public.self_serve_signups
     where id in (
       select id from public.self_serve_signups
        where requested_at < v_cutoff
        order by requested_at
        limit v_max_rows
     );
    get diagnostics v_done = row_count;
  end if;
  v_rules := v_rules || jsonb_build_object('self_serve_signups',
    jsonb_build_object('action', 'delete', 'cutoff', v_cutoff, 'due', v_due, 'done', v_done));

  -- Self-serve logins that never became a venue (P6): the rule is
  -- self_serve_login_is_stale (unconfirmed 7 days after the last request, or
  -- confirmed more than 30 days ago; no venue, membership, admin role or open
  -- team invitation). Listed, never deleted here: the cron deletes each one
  -- with delete_stale_self_serve_login (at most 100 a run), which re-applies
  -- the rule under a lock on the sign-up row and deletes the auth user in the
  -- same transaction; that also removes its
  -- user_auth_snapshot row (trigger trg_purge_user_auth_snapshot) and sets the
  -- sign-up row's user_id to null. Kept out of "rules" because this function
  -- does not act on it. The two cutoffs below are only reported; the rule
  -- itself holds the same intervals.
  v_unconfirmed_cutoff := v_now - interval '7 days';
  v_confirmed_cutoff := v_now - interval '30 days';
  with due as (
    select s.user_id, s.last_requested_at
      from public.self_serve_signups s
     where s.user_id is not null
       and public.self_serve_login_is_stale(s.user_id, v_now)
  )
  select (select count(*) from due),
         coalesce((select jsonb_agg(d.user_id order by d.last_requested_at)
                     from (select user_id, last_requested_at from due order by last_requested_at limit v_max_logins) d),
                  '[]'::jsonb)
    into v_due, v_login_ids;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'ran_at', v_now,
    'max_rows_per_rule', v_max_rows,
    'rules', v_rules,
    'self_serve_logins', jsonb_build_object(
      'action', 'delete_login',
      'unconfirmed_cutoff', v_unconfirmed_cutoff,
      'confirmed_cutoff', v_confirmed_cutoff,
      'due', v_due,
      'max_per_run', v_max_logins,
      'user_ids', v_login_ids)
  );
end;
$$;

comment on function public.run_data_retention(boolean) is
  'Enforces the approved data retention periods (27 September 2026; team invitations and self-serve sign-ups added 28 September 2026). Dry run by default; the daily /api/cron/data-retention cron passes false. Returns per-rule due and done counts, and the self-serve logins for the cron to delete. Service role only.';

revoke all on function public.run_data_retention(boolean) from public, anon, authenticated;
grant execute on function public.run_data_retention(boolean) to service_role;

-- ---------------------------------------------------------------------------
-- increment_rate_limit: service role only (spec §4.12).
-- ---------------------------------------------------------------------------
revoke all on function public.increment_rate_limit(uuid, text, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.increment_rate_limit(uuid, text, text, timestamptz, integer) to service_role;

notify pgrst, 'reload schema';
