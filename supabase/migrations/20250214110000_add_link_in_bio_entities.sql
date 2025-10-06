-- Add link-in-bio URL column to campaigns for public deep-links
alter table public.campaigns
  add column if not exists link_in_bio_url text;

create index if not exists campaigns_link_in_bio_url_idx
  on public.campaigns (account_id, link_in_bio_url);

update public.campaigns
set link_in_bio_url = metadata ->> 'linkInBioUrl'
where link_in_bio_url is null
  and metadata ? 'linkInBioUrl'
  and coalesce(metadata ->> 'linkInBioUrl', '') <> '';

-- Profile table governing the public link-in-bio experience per account
create table if not exists public.link_in_bio_profiles (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  slug text not null,
  display_name text,
  bio text,
  hero_media_id uuid references public.media_assets (id) on delete set null,
  theme jsonb not null default '{}'::jsonb,
  phone_number text,
  whatsapp_number text,
  booking_url text,
  menu_url text,
  parking_url text,
  facebook_url text,
  instagram_url text,
  website_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists link_in_bio_profiles_slug_key on public.link_in_bio_profiles (slug);
create index if not exists link_in_bio_profiles_hero_media_idx on public.link_in_bio_profiles (hero_media_id);

-- Always-on tile configuration for link-in-bio pages
create table if not exists public.link_in_bio_tiles (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  title text not null,
  subtitle text,
  cta_label text not null,
  cta_url text not null,
  media_asset_id uuid references public.media_assets (id) on delete set null,
  position integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists link_in_bio_tiles_account_idx on public.link_in_bio_tiles (account_id, position);
create index if not exists link_in_bio_tiles_media_idx on public.link_in_bio_tiles (media_asset_id);

-- Row level security policies mirroring other account-scoped tables
alter table public.link_in_bio_profiles enable row level security;
alter table public.link_in_bio_tiles enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'link_in_bio_profiles'
      and policyname = 'Link-in-bio profiles accessible by account'
  ) then
    create policy "Link-in-bio profiles accessible by account" on public.link_in_bio_profiles
    for all using (
      auth.role() = 'service_role' or account_id = public.current_account_id()
    ) with check (
      auth.role() = 'service_role' or account_id = public.current_account_id()
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'link_in_bio_tiles'
      and policyname = 'Link-in-bio tiles accessible by account'
  ) then
    create policy "Link-in-bio tiles accessible by account" on public.link_in_bio_tiles
    for all using (
      auth.role() = 'service_role' or account_id = public.current_account_id()
    ) with check (
      auth.role() = 'service_role' or account_id = public.current_account_id()
    );
  end if;
end $$;

comment on table public.link_in_bio_profiles is 'Account-level configuration for link-in-bio page branding and CTAs.';
comment on table public.link_in_bio_tiles is 'Evergreen tiles displayed on the public link-in-bio page.';

-- Ensure updated_at stays in sync
create or replace function public.touch_link_in_bio_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger link_in_bio_profiles_touch_updated_at
  before update on public.link_in_bio_profiles
  for each row execute function public.touch_link_in_bio_updated_at();

create trigger link_in_bio_tiles_touch_updated_at
  before update on public.link_in_bio_tiles
  for each row execute function public.touch_link_in_bio_updated_at();
