-- Default event venue per brand, so new event posts stop pre-filling The Anchor for every brand.
--
-- The create wizard hardcodes "The Anchor, Stanwell Moor Village" as a new event's venue, and
-- that text reaches the AI brief as "Venue:". With more than one brand, each needs its own
-- default. Null means no default: the wizard leaves the venue blank.
--
-- Backfill: The Anchor gets today's hardcoded value, so its events pre-fill exactly as before.
-- It matches by business name rather than a hardcoded id, and only where the value is still
-- null, so re-running is safe and a fresh database (no rows) is a no-op. On the live project
-- this touches one row (22 September 2026).
--
-- Additive: nullable with no default, so Postgres does not rewrite the table (1 row on the live
-- project). The check caps the length at 200, the event brief's venue limit. No view, trigger
-- or function references posting_defaults (checked on the live project, 22 September 2026).
-- RLS is unchanged: the table's existing policy covers the new column, and no grants change.
--
-- Deploy order: apply this before the app change that reads and writes the column
-- (tasks/SPEC-event-venue-default.md). That code selects it when loading Settings.
--
-- Rollback (only once no code reads the column, and only with the owner's approval,
-- because it discards entered text):
--   alter table public.posting_defaults drop column if exists default_event_venue;

alter table public.posting_defaults
  add column if not exists default_event_venue text
  constraint posting_defaults_default_event_venue_length_check
  check (default_event_venue is null or char_length(default_event_venue) <= 200);

comment on column public.posting_defaults.default_event_venue is
  'Venue pre-filled on new event posts in the create wizard. Null means no default: the venue starts blank.';

update public.posting_defaults pd
   set default_event_venue = 'The Anchor, Stanwell Moor Village'
  from public.accounts a
 where a.id = pd.account_id
   and a.business_name = 'The Anchor'
   and pd.default_event_venue is null;
