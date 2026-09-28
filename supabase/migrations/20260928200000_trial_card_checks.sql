-- Repeat free trials, checked by card (tasks/SPEC-self-serve-signup.md §4.7,
-- decisions L6, P5 and P6; §5 PR 7). Approved by Peter on 28 September 2026
-- (his question 53: build every stage now; app_flags('self_serve_signup') and
-- app_flags('billing_enforcement') stay off).
--
-- 1. public.trial_card_checks: one row per trialing CheersAI subscription the
--    billing reconcile has checked (src/lib/billing/trial-card-check.ts).
--      stripe_subscription_id  the Stripe subscription (primary key: one
--                              decision per subscription, however many
--                              reconciles run at once)
--      account_id              the brand; deleting the brand deletes its rows
--      card_hash               HMAC-SHA256 (TRIAL_CARD_HASH_KEY) of the card's
--                              Stripe fingerprint, 64 hex characters; the
--                              literal 'none' when the subscription had no card
--      outcome                 first_trial | repeat_refused | no_card
--      cancelled_at            set once a refused trial has been cancelled in
--                              Stripe, stored and reported to the operator
--      created_at              when the check was first recorded (the trial
--                              start, give or take a webhook delivery)
--    The partial unique index on card_hash where outcome = 'first_trial' is the
--    whole cross-brand check: a second brand's insert of 'first_trial' for the
--    same card fails, so the app records 'repeat_refused' instead. The app never
--    reads another brand's rows. No card number, fingerprint, expiry or name is
--    stored, only the keyed code (privacy notice: "Free trial card codes").
--    Beyond the spec's column list: account_id, outcome and created_at are
--    NOT NULL, card_hash must be 64 lower-case hex characters (or 'none' for
--    no_card), so a raw fingerprint can never be stored by mistake, and
--    account_id has an index for the cascade and the app's brand-scoped reads.
-- 2. public.run_data_retention restated IN FULL with one new rule, decision P6
--    (Peter's question 45): trial_card_checks rows deleted 24 months after
--    created_at. Rules 1 to 14 and the self-serve login list are copied
--    unchanged from 20260928170000_self_serve_signups.sql (applied in
--    production as version 20260928124011). The live function body was
--    checked on 28 September 2026 (read only: md5 of pg_proc.prosrc,
--    9f93097f16db41ac28f90c4d2be8332e, 14,168 characters) and matches that
--    file byte for byte; this restatement differs from it only by the added
--    rule block. The return shape is unchanged apart from the new
--    'trial_card_checks' key under "rules", which the cron reads generically.
--
-- Access: service role only. RLS is on with no policies, and every privilege
-- is revoked from public, anon and authenticated, because on this project
-- `authenticated` still inherits all privileges on new tables from the
-- postgres default ACL (20260905053036 only removed anon).
-- supabase/tests/self_serve_grants_verify.sql checks it, read only, and is
-- safe to run against production after this migration.
--
-- Written for production's shape: accounts (id uuid primary key). Nothing
-- references trial_card_checks by foreign key.
--
-- Deploy order: apply this migration BEFORE the app that writes the table
-- deploys, then add TRIAL_CARD_HASH_KEY to Vercel Production and give the
-- restricted Stripe key PaymentMethods read and Subscriptions write, then
-- deploy. Applying it first changes nothing for the live app: nothing reads the
-- new table, and the live cron logs the new rule like any other.
--
-- Rollback (revert the app first; the table holds keyed codes, no card data):
--   restore run_data_retention from 20260928170000_self_serve_signups.sql;
--   drop table if exists public.trial_card_checks;

create table if not exists public.trial_card_checks (
  stripe_subscription_id text primary key,
  account_id uuid not null references public.accounts (id) on delete cascade,
  card_hash text not null,
  outcome text not null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint trial_card_checks_outcome_check
    check (outcome in ('first_trial', 'repeat_refused', 'no_card')),
  constraint trial_card_checks_card_hash_format
    check (card_hash ~ '^[0-9a-f]{64}$' or (outcome = 'no_card' and card_hash = 'none'))
);

comment on table public.trial_card_checks is
  'Repeat free-trial check by card (SPEC-self-serve-signup §4.7, L6, P5): one row per checked trialing CheersAI subscription; card_hash is an HMAC of the card''s Stripe fingerprint, never card data. The partial unique index allows one first_trial per card. Kept 24 months (P6). Service role only.';

-- One free trial per card: only first_trial rows take part.
create unique index if not exists trial_card_checks_first_trial_card
  on public.trial_card_checks (card_hash)
  where outcome = 'first_trial';

-- The brand foreign key (on delete cascade) and the app's brand-scoped reads.
create index if not exists trial_card_checks_account_id on public.trial_card_checks (account_id);

alter table public.trial_card_checks enable row level security;
revoke all on table public.trial_card_checks from public, anon, authenticated;
grant all on table public.trial_card_checks to service_role;

-- ---------------------------------------------------------------------------
-- run_data_retention, restated in full. Everything except the new
-- "trial_card_checks" rule is unchanged from
-- 20260928170000_self_serve_signups.sql (rules 1 to 14 and the self-serve
-- login list).
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
--   trial_card_checks                      created_at   older than 24 months: delete
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

  -- trial_card_checks: 24 months from the trial start (P6). created_at is
  -- when the reconcile first recorded the check, at the start of the trial.
  -- Deleting a first_trial row frees that card for another trial.
  v_cutoff := v_now - interval '24 months';
  select count(*) into v_due from public.trial_card_checks where created_at < v_cutoff;
  v_done := 0;
  if not p_dry_run and v_due > 0 then
    delete from public.trial_card_checks
     where stripe_subscription_id in (
       select stripe_subscription_id from public.trial_card_checks
        where created_at < v_cutoff
        order by created_at
        limit v_max_rows
     );
    get diagnostics v_done = row_count;
  end if;
  v_rules := v_rules || jsonb_build_object('trial_card_checks',
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
  'Enforces the approved data retention periods (27 September 2026; team invitations, self-serve sign-ups and free-trial card checks added 28 September 2026). Dry run by default; the daily /api/cron/data-retention cron passes false. Returns per-rule due and done counts, and the self-serve logins for the cron to delete. Service role only.';

revoke all on function public.run_data_retention(boolean) from public, anon, authenticated;
grant execute on function public.run_data_retention(boolean) to service_role;

notify pgrst, 'reload schema';
