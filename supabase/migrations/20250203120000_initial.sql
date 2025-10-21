create extension if not exists pgcrypto;

create table if not exists public.accounts (
  id uuid primary key,
  email text not null unique,
  display_name text,
  timezone text not null default 'Europe/London',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.brand_profile (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  tone_formal numeric(3,2) not null default 0.50,
  tone_playful numeric(3,2) not null default 0.50,
  key_phrases text[] default array[]::text[],
  banned_topics text[] default array[]::text[],
  default_hashtags text[] default array[]::text[],
  default_emojis text[] default array[]::text[],
  instagram_signature text,
  facebook_signature text,
  gbp_cta text,
  updated_at timestamptz not null default now()
);

create table if not exists public.posting_defaults (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  facebook_location_id text,
  instagram_location_id text,
  gbp_location_id text,
  notifications jsonb not null default jsonb_build_object(
    'emailFailures', true,
    'emailTokenExpiring', true
  ),
  gbp_cta_standard text not null default 'LEARN_MORE',
  gbp_cta_event text not null default 'LEARN_MORE',
  gbp_cta_offer text not null default 'REDEEM',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.social_connections (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  provider text not null check (provider in ('facebook','instagram','gbp')),
  status text not null check (status in ('active','expiring','needs_action')) default 'needs_action',
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  display_name text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists social_connections_account_idx on public.social_connections (account_id);
create unique index if not exists social_connections_unique_provider on public.social_connections (account_id, provider);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  media_type text not null check (media_type in ('image','video')),
  mime_type text,
  size_bytes bigint,
  tags text[] default array[]::text[],
  uploaded_at timestamptz not null default now()
);
create index if not exists media_assets_account_idx on public.media_assets (account_id);
create index if not exists media_assets_uploaded_idx on public.media_assets (uploaded_at desc);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  name text not null,
  campaign_type text not null check (campaign_type in ('event','promotion','weekly','instant','story_series')),
  start_at timestamptz,
  end_at timestamptz,
  hero_media_id uuid references public.media_assets (id),
  auto_confirm boolean not null default false,
  status text not null check (status in ('draft','scheduled','completed','cancelled')) default 'draft',
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists campaigns_account_idx on public.campaigns (account_id);
create index if not exists campaigns_status_idx on public.campaigns (status);

create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns (id) on delete set null,
  account_id uuid not null references public.accounts (id) on delete cascade,
  platform text not null check (platform in ('facebook','instagram','gbp')),
  scheduled_for timestamptz,
  status text not null check (status in ('draft','scheduled','publishing','posted','failed')) default 'draft',
  prompt_context jsonb,
  auto_generated boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists content_items_account_idx on public.content_items (account_id);
create index if not exists content_items_schedule_idx on public.content_items (scheduled_for);
create index if not exists content_items_status_idx on public.content_items (status);

create table if not exists public.content_variants (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items (id) on delete cascade,
  body text,
  media_ids uuid[] default array[]::uuid[],
  preview_data jsonb,
  validation jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists content_variants_content_idx on public.content_variants (content_item_id);

create table if not exists public.publish_jobs (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items (id) on delete cascade,
  attempt integer not null default 0,
  status text not null check (status in ('queued','in_progress','succeeded','failed')) default 'queued',
  last_error text,
  provider_response jsonb,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists publish_jobs_status_idx on public.publish_jobs (status);
create index if not exists publish_jobs_next_idx on public.publish_jobs (next_attempt_at);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  category text,
  message text not null,
  read_at timestamptz,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists notifications_account_idx on public.notifications (account_id);
create index if not exists notifications_read_idx on public.notifications (read_at);
