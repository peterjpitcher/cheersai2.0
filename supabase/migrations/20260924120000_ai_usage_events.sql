-- Per-brand AI usage log (SPEC-new-customer-readiness §4.6, Stage 2).
--
-- One row per OpenAI call, written by src/lib/ai/usage.ts with the service
-- role. Used first to measure real use (two weeks before any plan cap is
-- enforced), then as the source for usage caps.
--
-- Expand-only: a new table, nothing existing changes. Operator-only data, so
-- anon and authenticated get no access at all.
--
-- Rollback: drop table public.ai_usage_events;

create table if not exists public.ai_usage_events (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts(id) on delete cascade,
  feature           text not null check (feature in ('post_copy', 'media_tagging', 'campaign_generation', 'campaign_copy_correction')),
  model             text,
  prompt_tokens     integer,
  completion_tokens integer,
  succeeded         boolean not null,
  created_at        timestamptz not null default now()
);

comment on table public.ai_usage_events is
  'One row per OpenAI call, per brand. Service-role only. Source for AI usage reporting and plan caps.';

create index if not exists ai_usage_events_account_created_idx
  on public.ai_usage_events (account_id, created_at desc);

alter table public.ai_usage_events enable row level security;
revoke all on public.ai_usage_events from anon, authenticated;
grant select, insert on public.ai_usage_events to service_role;
