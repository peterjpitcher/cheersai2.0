-- Data retention (approved by Peter on 27 September 2026 for the privacy
-- notice and DPA). One function enforces every period; the daily Vercel cron
-- /api/cron/data-retention calls it with p_dry_run => false.
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
--
-- publish_jobs and content rows are deliberately NOT touched: they belong to
-- the content, which is kept for the life of the subscription.
--
-- The CAPI retry cron only re-sends rows whose occurred_at is within the last
-- 6.5 days, so it never picks up a row whose identifiers this has cleared.
--
-- Each rule handles at most 10,000 rows per run so one run stays a short
-- transaction; anything left over is picked up by the next daily run (the
-- result shows due > done when that happens). Safe to run twice: a second run
-- finds nothing left to do. Nothing references any of these tables by foreign
-- key (checked against production on 27 September 2026).
--
-- Written for production's shape (the local rebuild is reshaped to match it by
-- 20260926130000_local_rebuild_matches_production.sql). Adds one function and
-- nothing else. Service role only.
--
-- Dry run (counts only, changes nothing):
--   select public.run_data_retention(true);
--
-- Rollback:
--   drop function if exists public.run_data_retention(boolean);

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

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'ran_at', v_now,
    'max_rows_per_rule', v_max_rows,
    'rules', v_rules
  );
end;
$$;

comment on function public.run_data_retention(boolean) is
  'Enforces the approved data retention periods (27 September 2026). Dry run by default; the daily /api/cron/data-retention cron passes false. Returns per-rule due and done counts. Service role only.';

revoke all on function public.run_data_retention(boolean) from public, anon, authenticated;
grant execute on function public.run_data_retention(boolean) to service_role;
