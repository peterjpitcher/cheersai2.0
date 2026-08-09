-- Widen meta_campaigns.campaign_kind to permit 'food_booking'.
--
-- The v1 baseline (supabase/baseline/v1_baseline.sql) constrained campaign_kind to
-- ('event', 'evergreen'). The food-booking feature shipped later and writes 'food_booking':
--
--   src/app/(app)/campaigns/actions.ts:1249   insert campaign_kind: 'food_booking'
--   src/app/(app)/campaigns/[id]/actions.ts:142  isFoodBookingCampaign publish branch
--   src/app/api/cron/materialise-food-windows/route.ts:70  .eq('campaign_kind', 'food_booking')
--   src/types/campaigns.ts:14  PaidCampaignKind includes 'food_booking'
--
-- No migration ever widened the constraint, so createFoodBookingCampaign (reachable from
-- CampaignBriefForm.tsx:309) failed at insert with a check violation. All 10 production rows
-- are 'event', so the path has never succeeded in production.
--
-- Additive and non-destructive: the new constraint is a strict superset of the old one, no
-- existing row violates it, no view or function references campaign_kind, and the validation
-- scan covers 10 rows in a 296 kB table.
--
-- Rollback:
--   alter table public.meta_campaigns drop constraint if exists meta_campaigns_campaign_kind_check;
--   alter table public.meta_campaigns add constraint meta_campaigns_campaign_kind_check
--     check (campaign_kind = any (array['event'::text, 'evergreen'::text]));
--   (safe only while no row uses 'food_booking')

alter table public.meta_campaigns
  drop constraint if exists meta_campaigns_campaign_kind_check;

alter table public.meta_campaigns
  add constraint meta_campaigns_campaign_kind_check
  check (campaign_kind = any (array['event'::text, 'evergreen'::text, 'food_booking'::text]));
