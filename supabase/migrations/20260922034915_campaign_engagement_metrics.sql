alter table public.meta_campaigns
  add column if not exists metrics_reactions integer not null default 0,
  add column if not exists metrics_comments integer not null default 0,
  add column if not exists metrics_shares integer not null default 0;

alter table public.ad_sets
  add column if not exists metrics_reactions integer not null default 0,
  add column if not exists metrics_comments integer not null default 0,
  add column if not exists metrics_shares integer not null default 0;

alter table public.ads
  add column if not exists metrics_reactions integer not null default 0,
  add column if not exists metrics_comments integer not null default 0,
  add column if not exists metrics_shares integer not null default 0;
