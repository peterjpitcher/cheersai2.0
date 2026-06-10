-- Phase 3 (3d) — Creative fatigue time-series.
-- Additive, non-destructive: a new append-only per-ad daily metrics table plus a
-- CHECK-constraint widening on meta_optimisation_actions.action_type.
-- No data or columns are dropped; safe to roll forward and inert if unused.

-- 1. Time-series store: one row per ad per captured day.
--    FKs (SEC-2) follow the meta_optimisation_actions sibling pattern: account_id
--    references auth.users, ad rows are removed with their parent ad.
create table if not exists public.ad_metrics_history (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  ad_id uuid not null references public.ads(id) on delete cascade,
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

-- Account-scoped RLS, mirroring the campaigns policy pattern
-- (service_role OR account_id = current_account_id(), USING + WITH CHECK).
alter table public.ad_metrics_history enable row level security;

drop policy if exists "Ad metrics history accessible by account" on public.ad_metrics_history;
create policy "Ad metrics history accessible by account"
  on public.ad_metrics_history
  using (("auth"."role"() = 'service_role'::text) or ("account_id" = "public"."current_account_id"()))
  with check (("auth"."role"() = 'service_role'::text) or ("account_id" = "public"."current_account_id"()));

-- 2. Widen the action_type CHECK to allow the new optimisation action types.
--    Additive only: every previously-allowed value is retained.
--    WF-4: the existing constraint's name is not guaranteed (it may have been
--    created inline or renamed), so look up every CHECK constraint covering
--    action_type in the catalog and drop it by its real name before adding the
--    widened constraint under our canonical name.
do $$
declare
  existing record;
begin
  for existing in
    select conname
    from pg_constraint
    where conrelid = 'public.meta_optimisation_actions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%action_type%'
  loop
    execute format(
      'alter table public.meta_optimisation_actions drop constraint %I',
      existing.conname
    );
  end loop;
end;
$$;

alter table public.meta_optimisation_actions
  add constraint meta_optimisation_actions_action_type_check
  check (action_type = any (array[
    'pause_ad'::text,
    'tracking_issue'::text,
    'copy_rewrite'::text,
    'creative_fatigue'::text,
    'budget_adjust'::text
  ]));
