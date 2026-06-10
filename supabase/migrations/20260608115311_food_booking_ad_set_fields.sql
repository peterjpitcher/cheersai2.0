-- Food booking: intra-day start + service metadata on ad sets. Additive, nullable, reversible.
alter table public.ad_sets
  add column if not exists ads_start_time text,
  add column if not exists service_key text,
  add column if not exists decision_stage text,
  add column if not exists budget_weight numeric;

comment on column public.ad_sets.ads_start_time is 'HH:MM London-local intra-day start (mirrors ads_stop_time); food_booking only';
comment on column public.ad_sets.service_key is 'FoodServiceKey for food_booking ad sets';
comment on column public.ad_sets.decision_stage is 'FoodDecisionStage for food_booking ad sets';
comment on column public.ad_sets.budget_weight is 'Guidance/preview weight (0..100); not sent to Meta in Phase 1';
