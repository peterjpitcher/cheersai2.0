-- Create a minimal waitlist table to store emails only
-- No PII other than email; RLS enabled; access via server (service role) only

create table if not exists public.waitlist_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  created_at timestamptz not null default now()
);
-- Enforce case-insensitive uniqueness on email
create unique index if not exists waitlist_subscribers_email_key
  on public.waitlist_subscribers (lower(email));
alter table public.waitlist_subscribers enable row level security;
-- Intentionally no RLS policies for anon users.
-- Inserts/selects are performed via server using service role.;
