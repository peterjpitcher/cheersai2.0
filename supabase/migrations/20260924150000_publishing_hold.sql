-- Publishing hold (SPEC-new-customer-readiness §4.2, Stage 2 piece 2.5).
--
-- 1. publish_jobs gets a 'held' status and a hold_reason. The live worker
--    (supabase/functions/publish-queue) moves a due job to held, before any
--    provider call, when the brand may not publish (lapsed, not set up,
--    suspended) and billing enforcement is on. Held jobs keep their schedule
--    and are never picked up (the worker only claims 'queued').
--    On restore, future held jobs go back to queued; overdue ones stay held
--    for the owner to reschedule or discard (nothing stale publishes late).
--
-- 2. app_flags holds the single billing-enforcement switch, read by both the
--    Next.js app and the edge function, so the two can never disagree and the
--    switch flips without a deploy (spec §6 rollback). It starts off.
--
-- Expand only. With the switch off, nothing is held.
--
-- Rollback:
--   update public.publish_jobs set status = 'queued', hold_reason = null where status = 'held';
--   alter table public.publish_jobs drop constraint publish_jobs_status_check;
--   alter table public.publish_jobs add constraint publish_jobs_status_check
--     check (status = any (array['queued','in_progress','succeeded','failed']));
--   alter table public.publish_jobs drop column if exists hold_reason;
--   drop table if exists public.app_flags;

alter table public.publish_jobs drop constraint if exists publish_jobs_status_check;
-- status::text: live production stores status as text, while a database rebuilt
-- from the migration chain (CI) has an enum; the cast works for both.
alter table public.publish_jobs add constraint publish_jobs_status_check
  check (status::text = any (array['queued', 'in_progress', 'succeeded', 'failed', 'held']));

alter table public.publish_jobs
  add column if not exists hold_reason text
  check (hold_reason is null or hold_reason in ('entitlement'));

comment on column public.publish_jobs.hold_reason is
  'Why a job is held: entitlement = the brand may not publish (billing). Cleared when the job is released or rescheduled.';

create table if not exists public.app_flags (
  name        text primary key,
  enabled     boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

comment on table public.app_flags is
  'Operator switches read by the app and the edge functions. Service-role only.';

insert into public.app_flags (name, enabled)
values ('billing_enforcement', false)
on conflict (name) do nothing;

alter table public.app_flags enable row level security;
revoke all on public.app_flags from anon, authenticated;
grant select, insert, update on public.app_flags to service_role;
