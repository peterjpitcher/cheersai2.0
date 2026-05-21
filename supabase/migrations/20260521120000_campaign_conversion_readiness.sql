alter table public.meta_ad_accounts
  alter column meta_pixel_id drop default,
  alter column meta_pixel_id drop not null;

update public.meta_ad_accounts
set meta_pixel_id = null
where meta_pixel_id = '757659911002159';
