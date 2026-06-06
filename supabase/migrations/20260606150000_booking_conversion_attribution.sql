alter table public.booking_conversion_events
  add column if not exists gclid text,
  add column if not exists short_code text,
  add column if not exists attribution_captured_at timestamptz,
  add column if not exists attribution_updated_at timestamptz;

create index if not exists booking_conversion_events_short_code_idx
  on public.booking_conversion_events (account_id, short_code, occurred_at desc)
  where short_code is not null;

create index if not exists booking_conversion_events_gclid_idx
  on public.booking_conversion_events (account_id, gclid, occurred_at desc)
  where gclid is not null;
