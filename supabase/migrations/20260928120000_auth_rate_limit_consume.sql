-- Auth rate limits kept in our own database.
-- Stage 1 of tasks/SPEC-self-serve-signup.md (§4.11, decision P8: not Upstash).
--
-- What this adds
--   public.consume_rate_limit(p_key, p_limit, p_window_seconds): one atomic
--   upsert on the existing public.auth_rate_limits table. It counts the call in
--   a fixed window, starts a fresh window when the old one has expired, and
--   returns whether the call is allowed, the count so far and when the window
--   resets. Concurrent calls on one key queue on the row lock, so exactly
--   p_limit calls get through per window.
--
-- Who calls it
--   Only the app's service-role client (src/lib/auth/rate-limit.ts), for
--   password sign-in, magic-link requests and password-reset requests. Keys are
--   '<purpose>:<scope>:<hmac>' where the HMAC-SHA256 is keyed inside the app, so
--   the table never holds an email address or an IP address.
--
-- Why reuse auth_rate_limits
--   It already exists in production with the right shape (key text primary key,
--   count, reset_at, updated_at), RLS on, one "service only" policy and 0 rows
--   (read 28 September 2026); nothing in src/ wrote to it. Its shape does not
--   change, so the data-retention job (public.run_data_retention, migration
--   20260927120000) keeps deleting rows whose reset_at is over 24 hours old,
--   and the privacy notice already covers "sign-in rate limits".
--
-- Grants (targets production's shape and states its own grants)
--   Since 20260905053036, authenticated still gets EXECUTE on every new function
--   and every privilege on every new table by default. The function revokes all
--   from public, anon and authenticated and grants EXECUTE to service_role only.
--   The table also loses authenticated's grants (anon had none): RLS already
--   refused them, but the counters now guard sign-in, so a signed-in user must
--   not be able to read or reset them even if a policy changes later.
--   The function is SECURITY INVOKER: even a wrong grant would still hit the
--   table's grants and RLS.
--
-- Deploy order
--   Apply this migration BEFORE the app that calls it deploys. The app fails
--   closed: without the function, sign-in, magic links and password resets are
--   refused with a visible error. The migration is additive, so applying it
--   first changes nothing for the app that is live now (it never reads
--   auth_rate_limits and never calls this function).
--
-- Rollback (revert the app first)
--   drop function if exists public.consume_rate_limit(text, integer, integer);
--   Leave authenticated's grants on auth_rate_limits revoked: nothing needs them.
--
-- Verify
--   supabase/tests/self_serve_grants_verify.sql  read-only, safe on production
--   supabase/tests/auth_rate_limit_verify.sql     local only, behaviour checks

create or replace function public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, hits integer, resets_at timestamptz)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_hits integer;
  v_resets_at timestamptz;
begin
  if p_key is null or length(p_key) not between 1 and 200 then
    raise exception 'consume_rate_limit: key must be 1 to 200 characters' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 then
    raise exception 'consume_rate_limit: limit must be at least 1' using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception 'consume_rate_limit: window must be 1 to 86400 seconds' using errcode = '22023';
  end if;

  insert into public.auth_rate_limits as r (key, count, reset_at, updated_at)
  values (p_key, 1, now() + make_interval(secs => p_window_seconds), now())
  on conflict (key) do update
     set count = case
                   when r.reset_at <= now() then 1
                   else least(r.count, 2147483646) + 1
                 end,
         reset_at = case
                      when r.reset_at <= now() then now() + make_interval(secs => p_window_seconds)
                      else r.reset_at
                    end,
         updated_at = now()
  returning r.count, r.reset_at into v_hits, v_resets_at;

  return query select v_hits <= p_limit, v_hits, v_resets_at;
end;
$$;

comment on function public.consume_rate_limit(text, integer, integer) is
  'Counts one call against a rate-limit key in a fixed window and says whether it is allowed. Service role only. Keys are HMACs made by the app; no email or IP is stored. See migration 20260928120000.';

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

revoke all on table public.auth_rate_limits from public, anon, authenticated;
grant all on table public.auth_rate_limits to service_role;

notify pgrst, 'reload schema';
