-- F7: serialise concurrent food-window materialisation.
--
-- The weekly materialisation worker used read-before-write idempotency; two concurrent
-- deliveries for the same campaign+week could both pass the read and double-create a window's
-- ad set. This partial unique index makes the window occurrence (campaign, service_key,
-- decision_stage, phase_start = runDate) unique at the database, so the loser of the race gets
-- a 23505 the worker treats as already-materialised.
--
-- Additive + safe on existing data: Phase-1 creation already guarantees uniqueness per
-- (campaign, window, date), and the WHERE clause scopes the index to food rows only
-- (service_key is null on event/evergreen ad sets).
create unique index if not exists ad_sets_food_window_unique
  on public.ad_sets (campaign_id, service_key, decision_stage, phase_start)
  where service_key is not null;
