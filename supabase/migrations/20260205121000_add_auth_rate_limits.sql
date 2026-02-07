create table if not exists public.auth_rate_limits (
  key text primary key,
  count integer not null default 0,
  reset_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists auth_rate_limits_reset_at_idx on public.auth_rate_limits (reset_at);

alter table public.auth_rate_limits enable row level security;

create policy "Auth rate limits service only" on public.auth_rate_limits
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
