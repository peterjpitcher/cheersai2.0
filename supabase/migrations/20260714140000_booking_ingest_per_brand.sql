-- PR4: per-brand booking-conversion ingestion.
-- Adds an optional per-brand ingest secret so multiple brands can receive
-- booking conversions correctly (previously pinned to one brand via the
-- BOOKING_CONVERSION_ACCOUNT_ID env var). The webhook resolves the target brand
-- by matching the supplied secret; a null secret means the brand does not ingest
-- bookings. Unique (where set) so a secret maps to exactly one brand.

begin;

alter table public.accounts
  add column if not exists booking_ingest_secret text;

create unique index if not exists idx_accounts_booking_ingest_secret
  on public.accounts (booking_ingest_secret)
  where booking_ingest_secret is not null;

commit;
