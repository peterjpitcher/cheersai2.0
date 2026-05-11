-- Fix tournament RLS policies: use current_account_id() instead of auth.uid()
-- Same bug that was fixed for gbp_reviews in 20260308170001.
-- auth.uid() returns the raw Supabase user UUID, but the application stores
-- the resolved account_id (from app_metadata) in tournaments.account_id.
-- When these differ, all writes silently affect zero rows.

-- tournaments table
drop policy if exists "Tournaments accessible by account owner" on public.tournaments;

create policy "Tournaments accessible by account owner"
  on public.tournaments for all
  using (auth.role() = 'service_role' or account_id = public.current_account_id())
  with check (auth.role() = 'service_role' or account_id = public.current_account_id());

-- tournament_fixtures table
drop policy if exists "Fixtures accessible via tournament account" on public.tournament_fixtures;

create policy "Fixtures accessible via tournament account"
  on public.tournament_fixtures for all
  using (
    auth.role() = 'service_role'
    or exists (
      select 1 from public.tournaments t
      where t.id = tournament_fixtures.tournament_id
        and t.account_id = public.current_account_id()
    )
  )
  with check (
    auth.role() = 'service_role'
    or exists (
      select 1 from public.tournaments t
      where t.id = tournament_fixtures.tournament_id
        and t.account_id = public.current_account_id()
    )
  );
