# Database Schema Blueprint

This blueprint translates the conceptual data model into draft SQL suitable for Supabase migrations. Review and adjust before generating actual migration files.

## 1. Extension Requirements
```sql
create extension if not exists pgcrypto;
```

## 2. Tables
### 2.1 Accounts
```sql
create table public.accounts (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text,
  timezone text not null default 'Europe/London',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### 2.2 Brand Profile
```sql
create table public.brand_profile (
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
```

### 2.3 Social Connections
```sql
create table public.social_connections (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  provider text not null check (provider in ('facebook','instagram','gbp')),
  status text not null check (status in ('active','expiring','needs_action','disconnected')) default 'active',
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  external_page_id text,
  external_location_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.social_connections (account_id);
create unique index social_connections_unique_provider on public.social_connections (account_id, provider);
```

### 2.4 Media Assets
```sql
create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  storage_path text not null,
  media_type text not null check (media_type in ('image','video')),
  mime_type text,
  width integer,
  height integer,
  duration_seconds numeric,
  tags text[] default array[]::text[],
  uploaded_at timestamptz not null default now()
);
create index on public.media_assets (account_id);
```

### 2.5 Campaigns
```sql
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  name text not null,
  campaign_type text not null check (campaign_type in ('event','promotion','weekly','instant')),
  start_at timestamptz,
  end_at timestamptz,
  hero_media_id uuid references public.media_assets (id),
  auto_confirm boolean not null default false,
  status text not null check (status in ('draft','scheduled','completed','cancelled')) default 'draft',
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.campaigns (account_id);
create index on public.campaigns (campaign_type);
```

### 2.6 Content Items
```sql
create table public.content_items (
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
create index on public.content_items (account_id);
create index on public.content_items (scheduled_for);
create index on public.content_items (status);
```

### 2.7 Content Variants
```sql
create table public.content_variants (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items (id) on delete cascade,
  body text,
  media_ids uuid[] default array[]::uuid[],
  preview_data jsonb,
  validation jsonb,
  updated_at timestamptz not null default now()
);
create index on public.content_variants (content_item_id);
```

### 2.8 Publish Jobs
```sql
create table public.publish_jobs (
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
create index on public.publish_jobs (status);
create index on public.publish_jobs (next_attempt_at);
```

### 2.9 Notifications
```sql
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  category text,
  message text not null,
  read_at timestamptz,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index on public.notifications (account_id);
create index on public.notifications (read_at);
```

## 3. Row Level Security Policies
```sql
alter table public.accounts enable row level security;
alter table public.brand_profile enable row level security;
alter table public.social_connections enable row level security;
alter table public.media_assets enable row level security;
alter table public.campaigns enable row level security;
alter table public.content_items enable row level security;
alter table public.content_variants enable row level security;
alter table public.publish_jobs enable row level security;
alter table public.notifications enable row level security;

create policy "Owner can select own data" on public.accounts
  for select using (auth.uid() = id);

create policy "Owner manage account" on public.accounts
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "Owner access" on public.brand_profile
  for all using (auth.uid() = account_id) with check (auth.uid() = account_id);

create policy "Owner access" on public.social_connections
  for all using (auth.uid() = account_id) with check (auth.uid() = account_id);

create policy "Owner access" on public.media_assets
  for all using (auth.uid() = account_id) with check (auth.uid() = account_id);

create policy "Owner access" on public.campaigns
  for all using (auth.uid() = account_id) with check (auth.uid() = account_id);

create policy "Owner access" on public.content_items
  for all using (auth.uid() = account_id) with check (auth.uid() = account_id);

create policy "Owner access" on public.content_variants
  for all using (
    auth.uid() = (
      select account_id from public.content_items where id = content_item_id
    )
  ) with check (
    auth.uid() = (
      select account_id from public.content_items where id = content_item_id
    )
  );

create policy "Owner access" on public.publish_jobs
  for all using (
    auth.uid() = (
      select account_id from public.content_items where id = content_item_id
    )
  );

create policy "Owner access" on public.notifications
  for all using (auth.uid() = account_id) with check (auth.uid() = account_id);
```

> Note: Service role (background worker) bypasses RLS; ensure worker injects `account_id` filters in queries.

## 4. Triggers & Functions
- `updated_at` maintenance via trigger function `set_current_timestamp()` for relevant tables.
- Consider trigger to auto-create `brand_profile` row when new account inserted.
- Optional trigger to clean up orphaned media references when campaign deleted.

## 5. Future Considerations
- Audit logging tables (if needed later) for publish attempts and setting changes.
- Soft delete columns if archival becomes necessary.
- Materialized view for Planner summarising upcoming posts (for performance).
