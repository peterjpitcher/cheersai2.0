alter table public.media_assets
  add column if not exists processed_status text not null default 'pending' check (processed_status in ('pending','processing','ready','failed')),
  add column if not exists processed_at timestamptz,
  add column if not exists derived_variants jsonb default '{}'::jsonb;

create index if not exists media_assets_processed_status_idx on public.media_assets (processed_status);
