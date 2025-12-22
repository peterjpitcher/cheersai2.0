alter table public.media_assets
  add column if not exists hidden_at timestamptz;

create index if not exists media_assets_hidden_idx on public.media_assets (account_id, hidden_at);
