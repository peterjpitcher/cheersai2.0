create extension if not exists "pgcrypto";
create table if not exists public.error_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  severity text,
  fingerprint text,
  payload jsonb not null,
  reporter_ip text,
  user_agent text,
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists error_reports_created_at_idx on public.error_reports (created_at desc);
create index if not exists error_reports_user_id_idx on public.error_reports (user_id);
alter table public.error_reports enable row level security;
create policy "service-role-only" on public.error_reports
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
