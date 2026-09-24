-- Stop signed-in users reading every login's email (found 2026-09-24).
--
-- public.user_auth_snapshot mirrors auth.users (email, status, sign-in times).
-- Its only SELECT policy was "User auth snapshot readable by authenticated"
-- with USING (true), so any signed-in user of any brand could list every
-- login's email and last sign-in through the Supabase API. With more than one
-- customer that exposes customers to each other.
--
-- The app reads this table only through the service role (admin overview and
-- team lists), which bypasses RLS, so narrowing the policy to the caller's own
-- row changes nothing in the app.
--
-- Rollback:
--   drop policy if exists user_auth_snapshot_select_own on public.user_auth_snapshot;
--   create policy "User auth snapshot readable by authenticated" on public.user_auth_snapshot
--     for select to authenticated using (true);

drop policy if exists "User auth snapshot readable by authenticated" on public.user_auth_snapshot;
drop policy if exists user_auth_snapshot_select_own on public.user_auth_snapshot;

create policy user_auth_snapshot_select_own on public.user_auth_snapshot
  for select to authenticated
  using (user_id = auth.uid());
