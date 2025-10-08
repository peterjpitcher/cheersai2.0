-- Ensure RLS is active on the user_auth_snapshot cache table for existing environments.

alter table if exists public.user_auth_snapshot enable row level security;
alter table if exists public.user_auth_snapshot force row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_auth_snapshot'
      and policyname = 'User auth snapshot readable by authenticated'
  ) then
    create policy "User auth snapshot readable by authenticated" on public.user_auth_snapshot
      for select
      to authenticated, service_role
      using (true);
  end if;
end
$$;
