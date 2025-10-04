alter table public.social_connections
  add column if not exists metadata jsonb;
