-- Drop story_series campaign type. The type is functionally identical to
-- 'event' (the proximity-label code already falls through to event logic),
-- and stories are a placement, not a campaign type. Existing story_series
-- campaigns become 'event' campaigns; their content_items keep placement='story'.
--
-- See docs/superpowers/specs/2026-05-07-drop-story-series-design.md

-- Data step first so the constraint recreate doesn't fail.
UPDATE public.campaigns
   SET campaign_type = 'event'
 WHERE campaign_type = 'story_series';

-- Replace the CHECK constraint to remove story_series.
ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_campaign_type_check;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_campaign_type_check
    CHECK (campaign_type IN ('event','promotion','weekly','instant'));
