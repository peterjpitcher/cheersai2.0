alter table public.content_items
  add column if not exists deleted_at timestamptz;

create index if not exists content_items_deleted_idx on public.content_items (deleted_at);
