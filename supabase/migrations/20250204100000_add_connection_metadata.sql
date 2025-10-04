alter table public.social_connections
  add column if not exists metadata jsonb default '{}'::jsonb;

create index if not exists social_connections_metadata_idx
  on public.social_connections using gin ((metadata));
