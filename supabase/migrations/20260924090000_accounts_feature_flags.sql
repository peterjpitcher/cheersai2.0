-- Per-brand feature switches (SPEC-new-customer-readiness D1b, D1c).
--
-- Paid Meta ads, tournaments and the management-app import are built around
-- The Anchor (Anchor-only ad hosts, Anchor tournament copy and opening hours,
-- The Anchor's management app). New customers do not get them at launch, so
-- each is off by default and switched on per brand by a super-admin.
--
-- Expand-only: three new columns with safe defaults, no data removed. The app
-- reads these columns when resolving a user's brands, so this migration must
-- be applied BEFORE the code that reads them is deployed.
--
-- Rollback: drop the three columns (after reverting the code).

alter table public.accounts
  add column if not exists paid_ads_enabled boolean not null default false,
  add column if not exists tournaments_enabled boolean not null default false,
  add column if not exists management_import_enabled boolean not null default false;

comment on column public.accounts.paid_ads_enabled is
  'Brand can build and manage paid Meta campaigns. Off by default; super-admin switch.';
comment on column public.accounts.tournaments_enabled is
  'Brand can use tournaments. Off by default; super-admin switch.';
comment on column public.accounts.management_import_enabled is
  'Brand can import events, promotions and artwork from its management app. Off by default; super-admin switch.';

-- The Anchor keeps everything it uses today (14 Meta campaigns, 2 tournaments
-- and the only management_app_connections row, checked 2026-09-24).
update public.accounts
set paid_ads_enabled = true,
    tournaments_enabled = true,
    management_import_enabled = true
where id = '91fda684-2801-4abb-980e-f42cec017cef';
