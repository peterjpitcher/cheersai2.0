-- Phase 3 (3d) — Creative fatigue time-series.
-- Additive, non-destructive: a new append-only per-ad daily metrics table plus a
-- CHECK-constraint widening on meta_optimisation_actions.action_type.
-- No data or columns are dropped; safe to roll forward and inert if unused.

-- 1. Time-series store: one row per ad per captured day.
create table if not exists public.ad_metrics_history (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  ad_id uuid not null,
  captured_on date not null,
  impressions bigint,
  clicks bigint,
  ctr numeric,
  frequency numeric,
  spend numeric,
  created_at timestamptz not null default now(),
  constraint ad_metrics_history_ad_id_captured_on_key unique (ad_id, captured_on)
);

comment on table public.ad_metrics_history is
  'Append-only daily snapshot of per-ad delivery metrics; powers week-over-week creative-fatigue detection (Phase 3 3d).';
comment on column public.ad_metrics_history.captured_on is 'Europe/London calendar date the metrics were captured for.';
comment on column public.ad_metrics_history.frequency is 'impressions / reach at capture time; null when reach is unavailable.';

-- Lookup index for the per-ad rolling-window reads done by detectCreativeFatigue.
create index if not exists ad_metrics_history_ad_captured_idx
  on public.ad_metrics_history (ad_id, captured_on desc);

-- Account-scoped RLS, mirroring the ads / booking_conversion_events policies.
alter table public.ad_metrics_history enable row level security;

drop policy if exists "Ad metrics history accessible by account" on public.ad_metrics_history;
create policy "Ad metrics history accessible by account"
  on public.ad_metrics_history
  using (("auth"."role"() = 'service_role'::text) or ("account_id" = "public"."current_account_id"()))
  with check (("auth"."role"() = 'service_role'::text) or ("account_id" = "public"."current_account_id"()));

-- 2. Widen the existing named action_type CHECK to allow the new optimisation
--    action types. Additive only: every previously-allowed value is retained.
alter table public.meta_optimisation_actions
  drop constraint if exists meta_optimisation_actions_action_type_check;

alter table public.meta_optimisation_actions
  add constraint meta_optimisation_actions_action_type_check
  check (action_type = any (array[
    'pause_ad'::text,
    'tracking_issue'::text,
    'copy_rewrite'::text,
    'creative_fatigue'::text,
    'budget_adjust'::text
  ]));
