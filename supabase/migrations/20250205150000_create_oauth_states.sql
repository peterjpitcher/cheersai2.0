create table if not exists public.oauth_states (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('facebook','instagram','gbp')),
  state text not null unique,
  redirect_to text,
  code_verifier text,
  auth_code text,
  error text,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create index if not exists oauth_states_provider_idx on public.oauth_states (provider);
create index if not exists oauth_states_used_idx on public.oauth_states (used_at);
