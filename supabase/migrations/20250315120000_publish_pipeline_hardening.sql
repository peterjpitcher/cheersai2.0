alter table public.content_items
  drop constraint if exists content_items_status_check;

alter table public.content_items
  add constraint content_items_status_check
  check (status in ('draft','scheduled','queued','publishing','posted','failed'));

create table if not exists public.worker_heartbeats (
  name text primary key,
  last_run_at timestamptz not null default now(),
  last_run_source text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.worker_heartbeats enable row level security;
create policy "Worker heartbeats managed by service role" on public.worker_heartbeats
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
