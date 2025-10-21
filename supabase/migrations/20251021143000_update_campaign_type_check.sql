alter table public.campaigns
  drop constraint if exists campaigns_campaign_type_check;

alter table public.campaigns
  add constraint campaigns_campaign_type_check
    check (campaign_type in ('event','promotion','weekly','instant','story_series'));
