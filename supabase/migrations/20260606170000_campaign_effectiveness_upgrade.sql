alter table public.ads
  add column if not exists creative_format text,
  add column if not exists creative_variant_key text,
  add column if not exists utm_content_key text;

create index if not exists ads_utm_content_key_idx
  on public.ads (utm_content_key)
  where utm_content_key is not null;

alter table public.meta_campaigns
  add column if not exists quality_score numeric,
  add column if not exists quality_status text,
  add column if not exists quality_issues jsonb not null default '[]'::jsonb,
  add column if not exists audience_strategy jsonb not null default '{}'::jsonb;

alter table public.meta_ad_accounts
  add column if not exists conversions_api_access_token text;

alter table public.booking_conversion_events
  add column if not exists meta_consent_granted boolean not null default false,
  add column if not exists fbp text,
  add column if not exists fbc text,
  add column if not exists client_user_agent text,
  add column if not exists capi_event_id text,
  add column if not exists capi_status text,
  add column if not exists capi_sent_at timestamp with time zone,
  add column if not exists capi_error text;

create index if not exists booking_conversion_events_utm_content_idx
  on public.booking_conversion_events (account_id, utm_content, occurred_at desc)
  where utm_content is not null;
