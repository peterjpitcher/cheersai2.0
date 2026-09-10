-- Optional delivery schedule for evergreen Meta campaigns.
--
-- Meta can hold an ad set to chosen days and hours ("day parting"). The Anchor's weekday
-- food ads need it: they must never deliver on a Monday. Nothing in the app stores such a
-- schedule today, so every evergreen campaign delivers at any hour on every day.
--
-- Shape written by the app (validated in src/lib/campaigns/delivery-schedule.ts):
--   {"days": ["tuesday", "wednesday", "thursday", "friday"], "startHour": 9, "endHour": 14}
-- Whole hours in the ad account's time zone (Europe/London); endHour is exclusive and may be 24.
--
-- Null means "no schedule", which is the behaviour every existing campaign already has, so
-- no row changes meaning. The check only guarantees a JSON object; the app enforces the
-- shape, because the same rules also have to run in the browser and before any Meta call.
--
-- Its own column rather than a key in source_snapshot: source_snapshot is rebuilt when copy
-- is generated and rewritten at publish, so a schedule stored there could be lost silently.
--
-- Additive and non-destructive: nullable with no default, so Postgres does not rewrite the
-- table, and every existing row starts null, so the check cannot fail (10 rows on the live
-- project). No view or function references meta_campaigns (checked on the live project,
-- 10 September 2026). RLS is unchanged: the table's existing policy covers the new column,
-- and no grant changes are needed.
--
-- Deploy order: apply this before the backend change that reads and writes the column
-- (PR 2 of 4, tasks/SPEC-evergreen-delivery-schedule.md). That code selects the column at
-- publish, so publishing fails if it ships first.
--
-- Rollback (only once no code reads the column, and only with the owner's approval,
-- because it discards any stored schedules):
--   alter table public.meta_campaigns drop column if exists delivery_schedule;

alter table public.meta_campaigns
  add column if not exists delivery_schedule jsonb
  constraint meta_campaigns_delivery_schedule_check
  check (delivery_schedule is null or jsonb_typeof(delivery_schedule) = 'object');

comment on column public.meta_campaigns.delivery_schedule is
  'Optional ad set delivery schedule for evergreen campaigns: {"days": [RunDay, ...], "startHour": 0-23, "endHour": 1-24}, whole hours in the ad account time zone (Europe/London), endHour exclusive. Null means no schedule: the ad set delivers at any time, as it did before this column existed.';
