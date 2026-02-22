create table if not exists public.management_app_connections (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  base_url text not null,
  api_key text not null,
  enabled boolean not null default true,
  last_tested_at timestamptz,
  last_test_status text,
  last_test_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint management_app_connections_last_test_status_check
    check (last_test_status in ('ok', 'error') or last_test_status is null)
);

alter table public.management_app_connections enable row level security;

create policy "Management app connections service only" on public.management_app_connections
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
