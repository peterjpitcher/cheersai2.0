-- Brand offboarding (SPEC-new-customer-readiness §4.7, decision D5, piece 2.9).
--
-- Offboarding is operator-run: the brand is archived straight away (hidden
-- from its users, posts stopped, tokens deleted) and its data is deleted 30
-- days later. These two columns record when it was offboarded and when the
-- purge becomes allowed. They are separate from archived_at, which is also
-- used for other archives that must never be purged automatically.
--
-- Expand only.
--
-- Rollback:
--   alter table public.accounts drop column if exists purge_after;
--   alter table public.accounts drop column if exists offboarded_at;

alter table public.accounts
  add column if not exists offboarded_at timestamptz,
  add column if not exists purge_after timestamptz;

comment on column public.accounts.offboarded_at is
  'When the operator offboarded this brand (archived, posts stopped, tokens deleted). Null for live brands.';
comment on column public.accounts.purge_after is
  'Earliest time the operator may permanently delete this brand''s data (offboarded_at + 30 days, decision D5).';
