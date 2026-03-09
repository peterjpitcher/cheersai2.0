# 03 — Backend and Data Architecture

Produced from a full audit of the migration history (26 SQL files spanning 2025-02-03 to 2026-02-28), all source lib files, the publish cron route, and the three design documents (schema-blueprint.md, technical-design.md, api-contracts.md).

---

## 1. Current Data Model Audit

### 1.1 Schema Evolution and Drift

The schema has grown organically through 26 migrations with no consolidated baseline. Each problem was patched in a new migration file rather than correcting an earlier one. This creates significant upgrade-path complexity and means the effective schema is only knowable by replaying every migration in sequence.

**Specific drift points discovered:**

- `content_items.status` check was wrong at birth (`draft | scheduled | publishing | posted | failed`) and had to be retrofitted in `20250315120000_publish_pipeline_hardening.sql` to add `queued`. The `planner/utils.ts` `formatStatusLabel` function handles all six states including `queued`, confirming the original constraint was always wrong.
- `social_connections` was created without the `metadata` column; it was added in `20250204100000_add_connection_metadata.sql`. The GIN index created on `(metadata)` is malformed — it should be `using gin (metadata)` not `using gin ((metadata))` (double parens applies a functional index expression, which works on jsonb but is unnecessarily obscure and can confuse query planners).
- `media_assets` launched without processing state columns. `processed_status`, `processed_at`, `derived_variants` were added in `20250204103000`. The `processed_status` check constraint allowed `pending | processing | ready | failed` and was then overwritten in `20250210123000` to add `skipped`. Two separate migrations for what should have been a single definition.
- `media_assets.hidden_at` (added `20250314`) and `content_items.deleted_at` (added `20250302`) implement separate soft-delete patterns on different tables with different column names. No other tables have soft delete at all — campaigns, variants, publish jobs, notifications all perform hard deletes.
- `publish_jobs` had no `variant_id` at launch. It was added as nullable in `20250218100000`, backfilled with a `distinct on` query (which races if concurrent inserts happen during the migration), then immediately set `NOT NULL`. This is a fragile migration pattern.
- `placement` was added to `content_items` and `publish_jobs` simultaneously in `20250218090000` with `default 'feed'`. No placement concept exists in `content_variants`, which means variant data cannot distinguish between a feed body and a story body for the same content item — the placement is only stored on the item, not on the copy itself.
- The `publish_jobs_with_variant` view created in `20250218100000` exposes `media_ids` (the anti-pattern array column) directly, cementing it as a first-class query surface.
- `worker_heartbeats` was added in `20250315120000` but has no corresponding application code in the lib files reviewed — it is written to by the Supabase Edge Function directly (not visible in this codebase), creating an undocumented dependency.
- `management_app_connections` stores a plaintext `api_key` column. No encryption or reference to a secrets vault is present.
- `oauth_states` table is referenced in the RLS migration (`20250212150000`) but there is no migration creating it in the set reviewed — it appears to have been created by another migration or manually.

### 1.2 Relationship Model Problems

The intended hierarchy is:

```
campaigns (1) → content_items (N) → content_variants (1 per item) → publish_jobs (1+)
```

**Problems with this hierarchy as implemented:**

**campaign_id is nullable with ON DELETE SET NULL.** A content item can lose its campaign reference silently when a campaign is deleted. The planner code in `planner/data.ts` handles this with `row.campaigns?.name ?? "Untitled campaign"` — a code smell confirming the broken FK is routine. Orphaned items with `campaign_id = null` have no parent and cannot be traced back to their origin. A soft-delete on campaigns with a cascade to content_items would preserve referential integrity.

**content_variants has no NOT NULL constraint on content_item_id at the model layer.** The initial migration uses `not null references`, which is correct, but the blueprint doc only states `references content_items(id) on delete cascade` — without `not null` — creating a discrepancy between the spec and the implementation.

**Multiple variants per content_item are permitted by the schema but the application always selects "most recently updated".** The `enqueuePublishJob` function in `queue.ts` resolves the variant by: `.order("updated_at", { ascending: false }).limit(1)`. The `loadVariantData` in `preflight.ts` does the same. This creates a TOCTOU race: the variant selected during preflight may differ from the variant enqueued if the user edits between those two calls. A unique constraint exists (`20250213120000_add_content_variant_unique.sql`) but its definition was not reviewed — if it enforces uniqueness by content_item_id, it effectively locks the schema to one variant per item and the "multiple variants" abstraction is unused overhead.

**publish_jobs has no unique constraint preventing duplicate active jobs for the same content_item.** The unique index added is only: `publish_jobs_story_unique` on `(content_item_id, placement) where placement = 'story' and status in ('queued','in_progress')`. There is no equivalent guard for feed posts. Two concurrent cron invocations can both pick up the same feed job and insert duplicate publish_jobs rows.

**content_items.account_id is denormalised redundantly.** Because campaigns already have account_id and content_items join to campaigns, the account_id on content_items is technically redundant. However, the nullable campaign_id makes direct account_id necessary for RLS. This is acceptable but must be documented as a deliberate denormalisation.

### 1.3 The media_ids uuid[] Anti-Pattern

`content_variants.media_ids uuid[]` is the most structurally damaging decision in the current schema.

**Problems:**

1. **No ordering guarantee.** PostgreSQL arrays have positional ordering, but no mechanism enforces that the order matches the intended presentation order on a given platform. The application code in `planner/data.ts` simply uses `flatMap` and takes the first element — meaning display order is an implicit contract with no enforcement.

2. **No per-attachment metadata.** Each media asset may have platform-specific roles (e.g., cover image vs. carousel slide), alt text, or caption overrides. None of this can be stored in a uuid array. Currently `derived_variants jsonb` on `media_assets` attempts to fill this gap, but it is asset-level metadata, not attachment-level metadata.

3. **No referential integrity.** An array of UUIDs has no foreign key enforcement in Postgres. A media asset can be deleted while its UUID persists in the array — the `preflight.ts` code explicitly checks for this: `if (mediaAssets.length !== mediaIds.length)` and raises `media_missing_assets`. This is a runtime check compensating for a schema design gap.

4. **N+1 query pattern baked in.** Every query that needs media information must first fetch the variant to get the array, then issue a separate IN() query to `media_assets`. A junction table would allow a single joined query.

5. **GIN indexes on uuid[] are less efficient than FK index lookups.** The current schema has no GIN index on `media_ids`, making `WHERE 'some-uuid' = ANY(media_ids)` a full table scan.

6. **The `publish_jobs_with_variant` view exposes `media_ids` directly,** making it part of the worker contract. Any migration away from the array will require migrating this view simultaneously.

**Evidence from source:** `preflight.ts` lines 115-139 implement four separate guards for what should be a single `JOIN` with appropriate constraints.

### 1.4 Publishing Queue: Idempotency Gaps

The `enqueuePublishJob` function in `queue.ts` performs a plain `insert` with no idempotency check. If called twice for the same content item (e.g., the user clicks "Schedule" twice, or a server action retries), two `publish_jobs` rows are inserted.

The cron route in `api/cron/publish/route.ts` simply calls the Supabase Edge Function with `{ source: "cron" }`. There is no locking mechanism. If Vercel fires the cron twice in the same minute (which can happen under degraded conditions), the Edge Function runs twice concurrently.

The Edge Function itself (not in this codebase) presumably does the `status='queued' AND next_attempt_at <= now()` poll. Without `SELECT ... FOR UPDATE SKIP LOCKED`, two concurrent invocations of the Edge Function will pick up the same rows and double-publish.

There is no `idempotency_key` column on `publish_jobs`. The only uniqueness constraint that exists is `publish_jobs_story_unique` for story placements only.

**Evidence:** `queue.ts` line 57-66 — bare `.insert({...})` with no conflict clause or idempotency guard.

### 1.5 Missing Tables

The following tables are absent from the schema but required for production-grade operation:

| Missing Table | Why Needed |
|---|---|
| `media_attachments` | Replace `media_ids uuid[]` with a proper junction table |
| `media_renditions` | Store platform-specific renditions (story crop, thumbnail, etc.) separately from `derived_variants jsonb` |
| `audit_log` | Immutable record of state transitions for content items and publish jobs |
| `content_item_versions` | Snapshot of variant body + media at publish time, so post-publish edits do not corrupt history |
| `idempotency_keys` | Deduplicate server action calls and publish job insertions |

### 1.6 Constraint Gaps

| Table | Missing Constraint |
|---|---|
| `campaigns` | No check that `end_at >= start_at` |
| `content_items` | No check that `scheduled_for` is in the future at insert time (enforced only in application layer) |
| `brand_profile` | `tone_formal` and `tone_playful` have no range check (should be `>= 0 AND <= 1`) |
| `social_connections` | `expires_at` can be set to the past without any warning |
| `media_assets` | No check that `size_bytes > 0`, no minimum dimension checks |
| `publish_jobs` | `attempt` can go negative; no `max_attempts` ceiling |
| `notifications` | `message` has `NOT NULL` but no `length > 0` check |

### 1.7 Indexing Gaps

| Gap | Impact |
|---|---|
| No composite index on `content_items(account_id, scheduled_for, status)` | Planner queries filter by all three; three separate single-column indexes are used instead, forcing a bitmap AND merge |
| No index on `content_items(campaign_id)` | Campaign detail page loads all child items with a full table scan filtered by account_id |
| No index on `publish_jobs(content_item_id, status)` | Status polling for a specific item requires a full `publish_jobs` scan |
| No index on `notifications(account_id, read_at, created_at)` | Unread notification query does three-column filtering with single indexes |
| No index on `media_assets(account_id, uploaded_at, hidden_at)` | Library queries filter hidden and sort by upload date |
| `publish_jobs(next_attempt_at)` index does not include `status` | Worker poll fetches all next_attempt_at <= now() rows including succeeded/failed, then filters in memory |

### 1.8 RLS Policy Weaknesses

The current RLS strategy uses `public.current_account_id()` which reads from JWT `app_metadata.account_id` (falling back to `user_metadata.account_id`). This is correct but has edge cases:

- `content_variants` and `publish_jobs` use `EXISTS (SELECT 1 FROM content_items WHERE ...)` subqueries in RLS. These subqueries are not indexed by content_item_id for the RLS check path — they are covered by `content_items_account_idx` but the RLS planner may not choose this path for all query shapes.
- `management_app_connections` is restricted to `service_role` only, meaning the UI cannot read connection health status without an API endpoint. This is intentional but must be documented as a design constraint.
- No RLS on `worker_heartbeats` data accessible to authenticated users — the policy is service_role only, which is correct but means no in-app worker health display without a service-role API endpoint.
- The `publish_jobs_with_variant` view has no RLS of its own. It inherits nothing from the base tables. Any authenticated user who can access the view bypasses the join-based RLS on `publish_jobs`. In Supabase, views do not automatically inherit RLS from their base tables unless `security_invoker = true` is set.

---

## 2. Target Schema Design

The following DDL represents the complete target schema for the rebuild. Every design decision is noted inline.

```sql
-- ============================================================
-- EXTENSIONS
-- ============================================================
create extension if not exists pgcrypto;
create extension if not exists pg_stat_statements; -- query performance observability

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Resolves account identity from JWT. Prefer app_metadata (server-managed),
-- fall back to user_metadata (legacy). Returns auth.uid() as final fallback
-- so the schema never returns null for an authenticated user.
create or replace function public.current_account_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  claim text;
  account uuid;
begin
  claim := auth.jwt()->'app_metadata'->>'account_id';
  if claim is null or length(trim(claim)) = 0 then
    claim := auth.jwt()->'user_metadata'->>'account_id';
  end if;
  if claim is not null and length(trim(claim)) > 0 then
    begin
      account := claim::uuid;
      return account;
    exception when others then
      null;
    end;
  end if;
  return auth.uid();
end;
$$;

comment on function public.current_account_id() is
  'Resolves the application account id from JWT app_metadata (preferred), user_metadata (legacy), or auth.uid() as final fallback.';

grant execute on function public.current_account_id() to authenticated, anon, service_role;

-- Standard updated_at trigger function, shared across all tables.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger function that sets updated_at to now() on every row update.';

-- ============================================================
-- TABLE: accounts
-- ============================================================
create table public.accounts (
  id            uuid        primary key references auth.users (id) on delete cascade,
  email         text        not null unique check (length(trim(email)) > 0),
  display_name  text        check (display_name is null or length(trim(display_name)) > 0),
  timezone      text        not null default 'Europe/London'
                            check (length(trim(timezone)) > 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger trg_accounts_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();

comment on table public.accounts is
  'Application-level account record. One-to-one with auth.users. Single-tenant: only one row expected.';

-- ============================================================
-- TABLE: brand_profile
-- ============================================================
-- Singleton per account. tone values are [0.0, 1.0] sliders.
-- banned_phrases replaces banned_topics (broader intent).
create table public.brand_profile (
  account_id              uuid        primary key references public.accounts (id) on delete cascade,
  tone_formal             numeric(3,2) not null default 0.50
                          check (tone_formal between 0.00 and 1.00),
  tone_playful            numeric(3,2) not null default 0.50
                          check (tone_playful between 0.00 and 1.00),
  key_phrases             text[]      not null default '{}',
  banned_topics           text[]      not null default '{}',
  banned_phrases          text[]      not null default '{}',
  default_hashtags        text[]      not null default '{}',
  default_emojis          text[]      not null default '{}',
  instagram_signature     text,
  facebook_signature      text,
  gbp_cta                 text,
  updated_at              timestamptz not null default now()
);

create trigger trg_brand_profile_updated_at
  before update on public.brand_profile
  for each row execute function public.set_updated_at();

comment on table public.brand_profile is
  'Brand voice and default content settings. Singleton per account.';
comment on column public.brand_profile.tone_formal is
  'Formal tone slider value from 0.0 (very informal) to 1.0 (very formal).';
comment on column public.brand_profile.banned_phrases is
  'Exact phrases that must not appear in generated copy.';

-- Auto-create brand_profile when account is created.
create or replace function public.create_brand_profile_for_account()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.brand_profile (account_id)
  values (new.id)
  on conflict (account_id) do nothing;
  return new;
end;
$$;

create trigger trg_accounts_create_brand_profile
  after insert on public.accounts
  for each row execute function public.create_brand_profile_for_account();

-- ============================================================
-- TABLE: posting_defaults
-- ============================================================
create table public.posting_defaults (
  account_id              uuid        primary key references public.accounts (id) on delete cascade,
  facebook_location_id    text,
  instagram_location_id   text,
  gbp_location_id         text,
  notifications           jsonb       not null default jsonb_build_object(
                            'emailFailures', true,
                            'emailTokenExpiring', true
                          ),
  gbp_cta_standard        text        not null default 'LEARN_MORE',
  gbp_cta_event           text        not null default 'LEARN_MORE',
  gbp_cta_offer           text        not null default 'REDEEM',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create trigger trg_posting_defaults_updated_at
  before update on public.posting_defaults
  for each row execute function public.set_updated_at();

-- ============================================================
-- TABLE: social_connections
-- ============================================================
-- tokens are stored as plaintext; in production these should be encrypted
-- at the application layer before storage. The column name 'access_token_enc'
-- signals intent in the target schema even if encryption is added later.
create table public.social_connections (
  id                    uuid        primary key default gen_random_uuid(),
  account_id            uuid        not null references public.accounts (id) on delete cascade,
  provider              text        not null
                        check (provider in ('facebook', 'instagram', 'gbp')),
  status                text        not null
                        check (status in ('active', 'expiring', 'needs_action'))
                        default 'needs_action',
  access_token          text,
  refresh_token         text,
  expires_at            timestamptz,
  display_name          text,
  last_synced_at        timestamptz,
  metadata              jsonb       not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- One connection record per provider per account.
  constraint social_connections_account_provider_unique unique (account_id, provider)
);

create index social_connections_account_idx
  on public.social_connections (account_id);

-- Partial index: fast lookup of connections that need attention.
create index social_connections_expiring_idx
  on public.social_connections (expires_at)
  where status in ('active', 'expiring');

create index social_connections_metadata_gin_idx
  on public.social_connections using gin (metadata);

create trigger trg_social_connections_updated_at
  before update on public.social_connections
  for each row execute function public.set_updated_at();

comment on column public.social_connections.metadata is
  'Provider-specific identifiers: page_id, business_account_id, location_id, etc.';

-- ============================================================
-- TABLE: media_assets
-- ============================================================
create table public.media_assets (
  id                uuid        primary key default gen_random_uuid(),
  account_id        uuid        not null references public.accounts (id) on delete cascade,
  storage_path      text        not null check (length(trim(storage_path)) > 0),
  file_name         text        not null check (length(trim(file_name)) > 0),
  media_type        text        not null check (media_type in ('image', 'video')),
  mime_type         text,
  size_bytes        bigint      check (size_bytes is null or size_bytes > 0),
  width             integer     check (width is null or width > 0),
  height            integer     check (height is null or height > 0),
  duration_seconds  numeric     check (duration_seconds is null or duration_seconds >= 0),
  aspect_class      text        not null default 'square'
                    check (aspect_class in ('square', 'story', 'landscape')),
  tags              text[]      not null default '{}',
  processed_status  text        not null default 'pending'
                    check (processed_status in ('pending', 'processing', 'ready', 'failed', 'skipped')),
  processed_at      timestamptz,
  -- derived_variants is deprecated in favour of media_renditions table.
  -- Retained for backwards compatibility during migration window only.
  derived_variants  jsonb       not null default '{}',
  hidden_at         timestamptz,
  deleted_at        timestamptz,
  uploaded_at       timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Composite: all library queries filter account + hidden + sort by upload date.
create index media_assets_library_idx
  on public.media_assets (account_id, uploaded_at desc)
  where hidden_at is null and deleted_at is null;

create index media_assets_processed_status_idx
  on public.media_assets (account_id, processed_status)
  where processed_status in ('pending', 'processing');

create index media_assets_deleted_idx
  on public.media_assets (deleted_at)
  where deleted_at is not null;

create trigger trg_media_assets_updated_at
  before update on public.media_assets
  for each row execute function public.set_updated_at();

comment on column public.media_assets.derived_variants is
  'DEPRECATED. Use media_renditions table. Retained during migration window.';

-- ============================================================
-- TABLE: media_renditions
-- ============================================================
-- Replaces the derived_variants jsonb blob with a normalised table.
-- Each row represents one platform-specific rendition of a source asset.
create table public.media_renditions (
  id                uuid        primary key default gen_random_uuid(),
  asset_id          uuid        not null references public.media_assets (id) on delete cascade,
  rendition_type    text        not null
                    check (rendition_type in ('thumb', 'story', 'feed_square', 'feed_landscape', 'og')),
  storage_path      text        not null check (length(trim(storage_path)) > 0),
  width             integer     check (width is null or width > 0),
  height            integer     check (height is null or height > 0),
  size_bytes        bigint      check (size_bytes is null or size_bytes > 0),
  created_at        timestamptz not null default now(),

  -- Only one rendition of each type per source asset.
  constraint media_renditions_asset_type_unique unique (asset_id, rendition_type)
);

create index media_renditions_asset_idx
  on public.media_renditions (asset_id);

comment on table public.media_renditions is
  'Platform-specific renditions derived from a source media_asset. Replaces derived_variants jsonb column.';

-- ============================================================
-- TABLE: campaigns
-- ============================================================
create table public.campaigns (
  id              uuid        primary key default gen_random_uuid(),
  account_id      uuid        not null references public.accounts (id) on delete cascade,
  name            text        not null check (length(trim(name)) > 0),
  campaign_type   text        not null
                  check (campaign_type in ('event', 'promotion', 'weekly', 'instant', 'story_series')),
  start_at        timestamptz,
  end_at          timestamptz,
  -- Constraint: if both dates present, end must be after start.
  constraint campaigns_date_order check (
    start_at is null or end_at is null or end_at >= start_at
  ),
  hero_media_id   uuid        references public.media_assets (id) on delete set null,
  auto_confirm    boolean     not null default false,
  status          text        not null
                  check (status in ('draft', 'scheduled', 'completed', 'cancelled'))
                  default 'draft',
  metadata        jsonb       not null default '{}',
  -- Soft delete: campaigns are never hard deleted, only soft-deleted.
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Composite: planner fetches active campaigns for an account within a date range.
create index campaigns_account_active_idx
  on public.campaigns (account_id, start_at, end_at)
  where deleted_at is null;

create index campaigns_account_type_idx
  on public.campaigns (account_id, campaign_type)
  where deleted_at is null;

-- Partial index: recurring campaign materialiser only queries weekly + scheduled.
create index campaigns_recurring_idx
  on public.campaigns (account_id, campaign_type, status)
  where campaign_type = 'weekly' and status = 'scheduled' and deleted_at is null;

create trigger trg_campaigns_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();

comment on column public.campaigns.metadata is
  'Campaign-type-specific data. For weekly: {cadence: [{platform, weekday, hour, minute}]}. For event: {location, eventName}. For promotion: {discountCode, promoUrl}.';

-- ============================================================
-- TABLE: content_items
-- ============================================================
-- Represents one scheduled post slot for one platform.
-- One content_item has exactly one active content_variant.
create table public.content_items (
  id              uuid        primary key default gen_random_uuid(),
  -- campaign_id: soft FK. Campaign rows are never hard-deleted so this
  -- never goes NULL silently. ON DELETE RESTRICT prevents orphaning.
  campaign_id     uuid        references public.campaigns (id) on delete restrict,
  account_id      uuid        not null references public.accounts (id) on delete cascade,
  platform        text        not null
                  check (platform in ('facebook', 'instagram', 'gbp')),
  placement       text        not null default 'feed'
                  check (placement in ('feed', 'story')),
  scheduled_for   timestamptz,
  status          text        not null
                  check (status in ('draft', 'scheduled', 'queued', 'publishing', 'posted', 'failed'))
                  default 'draft',
  prompt_context  jsonb       not null default '{}',
  auto_generated  boolean     not null default true,
  -- Soft delete: trashed items are hidden from planner but retained for 7 days.
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Primary planner query: account + date range + not deleted.
create index content_items_planner_idx
  on public.content_items (account_id, scheduled_for, status)
  where deleted_at is null;

-- Campaign children: loading all posts for a campaign detail page.
create index content_items_campaign_idx
  on public.content_items (campaign_id)
  where deleted_at is null;

-- Worker queue poll: items due for publishing.
create index content_items_due_idx
  on public.content_items (account_id, scheduled_for, status)
  where status in ('scheduled', 'queued') and deleted_at is null;

-- Trash view: soft-deleted items for trash panel.
create index content_items_trash_idx
  on public.content_items (account_id, deleted_at desc)
  where deleted_at is not null;

create trigger trg_content_items_updated_at
  before update on public.content_items
  for each row execute function public.set_updated_at();

comment on column public.content_items.placement is
  'Feed or story. GBP does not support story; enforced at application layer and in preflight checks.';
comment on column public.content_items.prompt_context is
  'AI generation inputs: source campaign fields, user overrides, scheduling context. Retained for regeneration.';

-- ============================================================
-- TABLE: content_variants
-- ============================================================
-- Exactly one active variant per content_item. Superseded variants are
-- archived in content_item_versions (append-only). media_ids is removed
-- in favour of the content_media_attachments junction table.
create table public.content_variants (
  id                uuid        primary key default gen_random_uuid(),
  content_item_id   uuid        not null references public.content_items (id) on delete cascade,
  body              text        not null default '',
  -- media_ids retained as empty array for compatibility during migration window.
  -- Use content_media_attachments for all new writes.
  media_ids         uuid[]      not null default '{}',
  preview_data      jsonb       not null default '{}',
  validation        jsonb       not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Enforce one active variant per content item at the schema level.
  constraint content_variants_item_unique unique (content_item_id)
);

create index content_variants_item_idx
  on public.content_variants (content_item_id);

create trigger trg_content_variants_updated_at
  before update on public.content_variants
  for each row execute function public.set_updated_at();

comment on column public.content_variants.media_ids is
  'DEPRECATED. Use content_media_attachments. Retained during migration window only.';
comment on column public.content_variants.validation is
  'Result of most recent lint check: {ok, warnings[], errors[]}. Not authoritative — re-run preflight before publishing.';

-- ============================================================
-- TABLE: content_media_attachments (replaces media_ids uuid[])
-- ============================================================
-- Junction table replacing the uuid[] anti-pattern. Stores ordered,
-- per-attachment metadata.
create table public.content_media_attachments (
  id              uuid        primary key default gen_random_uuid(),
  variant_id      uuid        not null references public.content_variants (id) on delete cascade,
  asset_id        uuid        not null references public.media_assets (id) on delete restrict,
  -- 0-based display order within this variant.
  position        smallint    not null default 0 check (position >= 0),
  -- Optional per-attachment overrides.
  alt_text        text,
  caption         text,
  created_at      timestamptz not null default now(),

  -- Each asset appears at most once per variant.
  constraint content_media_attachments_variant_asset_unique unique (variant_id, asset_id),
  -- Each position is unique within a variant.
  constraint content_media_attachments_variant_position_unique unique (variant_id, position)
);

create index content_media_attachments_variant_idx
  on public.content_media_attachments (variant_id, position);

create index content_media_attachments_asset_idx
  on public.content_media_attachments (asset_id);

comment on table public.content_media_attachments is
  'Ordered, metadata-rich junction between content_variants and media_assets. Replaces content_variants.media_ids uuid[].';
comment on column public.content_media_attachments.position is
  '0-based position in the attachment list. Order is stable and meaningful (carousel slide order, story image, etc.).';

-- ============================================================
-- TABLE: content_item_versions (append-only audit of variant body)
-- ============================================================
-- Snapshot of variant body + attachment list at the moment a publish job
-- is created. Provides an immutable record of what was actually sent.
create table public.content_item_versions (
  id                uuid        primary key default gen_random_uuid(),
  content_item_id   uuid        not null references public.content_items (id) on delete cascade,
  variant_id        uuid        not null references public.content_variants (id) on delete cascade,
  body_snapshot     text        not null,
  -- Ordered array of asset_ids at publish time.
  media_snapshot    uuid[]      not null default '{}',
  -- JSON snapshot of variant.validation at this point.
  validation_snapshot jsonb     not null default '{}',
  created_at        timestamptz not null default now()
  -- No updated_at: this table is append-only. Rows are never modified.
);

create index content_item_versions_item_idx
  on public.content_item_versions (content_item_id, created_at desc);

comment on table public.content_item_versions is
  'Append-only snapshot of variant content at publish-job creation time. Never updated or deleted during normal operation.';

-- ============================================================
-- TABLE: publish_jobs
-- ============================================================
create table public.publish_jobs (
  id                  uuid        primary key default gen_random_uuid(),
  content_item_id     uuid        not null references public.content_items (id) on delete cascade,
  variant_id          uuid        not null references public.content_variants (id) on delete cascade,
  -- version_id links to the immutable snapshot of what was attempted.
  version_id          uuid        references public.content_item_versions (id) on delete set null,
  -- idempotency_key prevents duplicate jobs. Generated by the caller as:
  -- sha256(content_item_id || '::' || placement || '::' || scheduled_for_epoch)
  idempotency_key     text        not null,
  placement           text        not null default 'feed'
                      check (placement in ('feed', 'story')),
  status              text        not null
                      check (status in ('queued', 'in_progress', 'succeeded', 'failed', 'cancelled'))
                      default 'queued',
  attempt             smallint    not null default 0
                      check (attempt >= 0 and attempt <= 10),
  max_attempts        smallint    not null default 3
                      check (max_attempts between 1 and 10),
  last_error          text,
  provider_response   jsonb       not null default '{}',
  -- External ID returned by the social provider on success.
  external_post_id    text,
  next_attempt_at     timestamptz,
  started_at          timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- One active job per (content_item, placement) at any time.
  -- A new job can only be created when no queued/in_progress job exists.
  constraint publish_jobs_idempotency_unique unique (idempotency_key),

  -- Prevent concurrent active jobs for the same content_item+placement.
  constraint publish_jobs_active_unique
    exclude using btree (content_item_id with =, placement with =)
    where (status in ('queued', 'in_progress'))
);

-- Worker poll: due jobs not yet in terminal state.
create index publish_jobs_worker_poll_idx
  on public.publish_jobs (next_attempt_at, status)
  where status in ('queued', 'in_progress');

-- Status lookup for a specific content item.
create index publish_jobs_item_idx
  on public.publish_jobs (content_item_id, status, created_at desc);

-- Variant lookup (for cascade on variant update).
create index publish_jobs_variant_idx
  on public.publish_jobs (variant_id);

create trigger trg_publish_jobs_updated_at
  before update on public.publish_jobs
  for each row execute function public.set_updated_at();

comment on column public.publish_jobs.idempotency_key is
  'sha256(content_item_id || ''::'' || placement || ''::'' || scheduled_for_epoch_seconds). Prevents duplicate publish attempts from concurrent cron or user retriggers.';
comment on column public.publish_jobs.external_post_id is
  'ID returned by Facebook/Instagram/Google on successful post. Enables post linking and deletion.';
comment on column public.publish_jobs.version_id is
  'References the content_item_versions snapshot created at job-creation time. NULL only if snapshot creation failed.';

-- ============================================================
-- TABLE: notifications
-- ============================================================
create table public.notifications (
  id          uuid        primary key default gen_random_uuid(),
  account_id  uuid        not null references public.accounts (id) on delete cascade,
  category    text        not null
              check (category in (
                'publish_success', 'publish_failed', 'publish_retry',
                'story_publish_success', 'story_publish_failed', 'story_publish_retry',
                'connection_needs_action', 'connection_reconnected',
                'connection_metadata_updated', 'token_expiring',
                'system'
              )),
  message     text        not null check (length(trim(message)) > 0),
  -- Reference to the content_item this notification relates to, if any.
  content_item_id uuid    references public.content_items (id) on delete set null,
  read_at     timestamptz,
  metadata    jsonb       not null default '{}',
  created_at  timestamptz not null default now()
  -- No updated_at: notifications are immutable once created. read_at is the
  -- only mutable field; it has its own index.
);

-- Unread feed query: fast, covers the most common access pattern.
create index notifications_unread_idx
  on public.notifications (account_id, created_at desc)
  where read_at is null;

-- Read feed query (notification history).
create index notifications_history_idx
  on public.notifications (account_id, created_at desc);

comment on column public.notifications.category is
  'Strongly-typed category drives icon/colour in the UI and maps to PlannerActivity.level in application code.';
comment on column public.notifications.content_item_id is
  'Optional link to the content item that triggered this notification. Set to NULL on cascade if item is hard-deleted.';

-- ============================================================
-- TABLE: audit_log (append-only)
-- ============================================================
-- Immutable record of significant state changes. Written exclusively by
-- the service role (background worker and server actions). Never updated.
create table public.audit_log (
  id            uuid        primary key default gen_random_uuid(),
  account_id    uuid        not null,  -- denormalised: retained even if account deleted
  entity_type   text        not null
                check (entity_type in (
                  'content_item', 'publish_job', 'campaign',
                  'social_connection', 'media_asset'
                )),
  entity_id     uuid        not null,
  action        text        not null
                check (action in (
                  'created', 'updated', 'deleted', 'status_changed',
                  'published', 'publish_failed', 'publish_retried',
                  'token_refreshed', 'token_expired', 'scheduled', 'cancelled'
                )),
  old_state     jsonb,
  new_state     jsonb,
  actor         text        not null default 'system'
                check (actor in ('owner', 'system', 'cron', 'worker')),
  created_at    timestamptz not null default now()
);

-- Lookup by entity (e.g., "show all history for this content_item").
create index audit_log_entity_idx
  on public.audit_log (entity_type, entity_id, created_at desc);

-- Account-level activity log (service-role query for support/debug).
create index audit_log_account_idx
  on public.audit_log (account_id, created_at desc);

comment on table public.audit_log is
  'Append-only audit trail. No UPDATE or DELETE permitted via application code. Retention: 90 days minimum.';

-- ============================================================
-- TABLE: worker_heartbeats
-- ============================================================
create table public.worker_heartbeats (
  name            text        primary key,
  last_run_at     timestamptz not null default now(),
  last_run_source text,
  last_run_status text
                  check (last_run_status is null or last_run_status in ('ok', 'error', 'partial')),
  metadata        jsonb       not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_worker_heartbeats_updated_at
  before update on public.worker_heartbeats
  for each row execute function public.set_updated_at();

-- ============================================================
-- TABLE: oauth_states
-- ============================================================
create table public.oauth_states (
  state       text        primary key,
  provider    text        not null check (provider in ('facebook', 'instagram', 'gbp')),
  account_id  uuid        not null references public.accounts (id) on delete cascade,
  redirect_to text,
  expires_at  timestamptz not null default (now() + interval '10 minutes'),
  created_at  timestamptz not null default now()
);

create index oauth_states_expires_idx
  on public.oauth_states (expires_at);

-- Auto-purge expired states via nightly cron (or Postgres pg_cron extension).
comment on table public.oauth_states is
  'Short-lived CSRF state tokens for OAuth flows. Rows expire after 10 minutes.';

-- ============================================================
-- TABLE: management_app_connections
-- ============================================================
create table public.management_app_connections (
  account_id          uuid        primary key references public.accounts (id) on delete cascade,
  base_url            text        not null check (base_url like 'https://%'),
  -- api_key should be encrypted at application layer before storage.
  -- Column suffix '_enc' signals that the stored value is encrypted.
  api_key_enc         text        not null,
  enabled             boolean     not null default true,
  last_tested_at      timestamptz,
  last_test_status    text
                      check (last_test_status is null or last_test_status in ('ok', 'error')),
  last_test_message   text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger trg_management_app_connections_updated_at
  before update on public.management_app_connections
  for each row execute function public.set_updated_at();

comment on column public.management_app_connections.api_key_enc is
  'API key encrypted with AES-256-GCM at application layer before storage. Never store plaintext.';
```

---

## 3. RLS Policy Design

The single-owner model means every row belongs to the one account. All policies use `public.current_account_id()` for consistency. The service role always bypasses RLS, so background workers operating under the service key need not be listed in policies — but they must still include `account_id` filters in their queries as a defence-in-depth measure.

```sql
-- ============================================================
-- ENABLE RLS ON ALL TABLES
-- ============================================================
alter table public.accounts                   enable row level security;
alter table public.brand_profile              enable row level security;
alter table public.posting_defaults           enable row level security;
alter table public.social_connections         enable row level security;
alter table public.media_assets               enable row level security;
alter table public.media_renditions           enable row level security;
alter table public.campaigns                  enable row level security;
alter table public.content_items              enable row level security;
alter table public.content_variants           enable row level security;
alter table public.content_media_attachments  enable row level security;
alter table public.content_item_versions      enable row level security;
alter table public.publish_jobs               enable row level security;
alter table public.notifications              enable row level security;
alter table public.audit_log                  enable row level security;
alter table public.worker_heartbeats          enable row level security;
alter table public.oauth_states               enable row level security;
alter table public.management_app_connections enable row level security;

-- Force RLS even for table owners.
alter table public.accounts                   force row level security;
alter table public.brand_profile              force row level security;
alter table public.posting_defaults           force row level security;
alter table public.social_connections         force row level security;
alter table public.media_assets               force row level security;
alter table public.media_renditions           force row level security;
alter table public.campaigns                  force row level security;
alter table public.content_items              force row level security;
alter table public.content_variants           force row level security;
alter table public.content_media_attachments  force row level security;
alter table public.content_item_versions      force row level security;
alter table public.publish_jobs               force row level security;
alter table public.notifications              force row level security;
alter table public.audit_log                  force row level security;
alter table public.worker_heartbeats          force row level security;
alter table public.oauth_states               force row level security;
alter table public.management_app_connections force row level security;

-- ============================================================
-- ACCOUNTS
-- ============================================================
-- SELECT: owner reads own row. No other rows exist in single-tenant.
create policy "accounts_select_owner"
  on public.accounts for select
  using (auth.role() = 'service_role' or id = public.current_account_id());

-- UPDATE: owner updates own row only.
create policy "accounts_update_owner"
  on public.accounts for update
  using (auth.role() = 'service_role' or id = public.current_account_id())
  with check (auth.role() = 'service_role' or id = public.current_account_id());

-- INSERT: only service role may insert (account provisioned server-side).
create policy "accounts_insert_service"
  on public.accounts for insert
  with check (auth.role() = 'service_role');

-- No DELETE policy: accounts are never deleted via application code.

-- ============================================================
-- BRAND PROFILE, POSTING DEFAULTS
-- ============================================================
create policy "brand_profile_owner"
  on public.brand_profile for all
  using (auth.role() = 'service_role' or account_id = public.current_account_id())
  with check (auth.role() = 'service_role' or account_id = public.current_account_id());

create policy "posting_defaults_owner"
  on public.posting_defaults for all
  using (auth.role() = 'service_role' or account_id = public.current_account_id())
  with check (auth.role() = 'service_role' or account_id = public.current_account_id());

-- ============================================================
-- SOCIAL CONNECTIONS
-- ============================================================
create policy "social_connections_owner"
  on public.social_connections for all
  using (auth.role() = 'service_role' or account_id = public.current_account_id())
  with check (auth.role() = 'service_role' or account_id = public.current_account_id());

-- ============================================================
-- MEDIA ASSETS
-- ============================================================
create policy "media_assets_owner"
  on public.media_assets for all
  using (auth.role() = 'service_role' or account_id = public.current_account_id())
  with check (auth.role() = 'service_role' or account_id = public.current_account_id());

-- ============================================================
-- MEDIA RENDITIONS
-- ============================================================
-- No direct account_id column. Bridge via media_assets.
-- Uses EXISTS with indexed lookup: media_assets has (account_id) index.
create policy "media_renditions_owner"
  on public.media_renditions for all
  using (
    auth.role() = 'service_role' or exists (
      select 1 from public.media_assets ma
      where ma.id = media_renditions.asset_id
        and ma.account_id = public.current_account_id()
    )
  )
  with check (
    auth.role() = 'service_role' or exists (
      select 1 from public.media_assets ma
      where ma.id = media_renditions.asset_id
        and ma.account_id = public.current_account_id()
    )
  );

-- ============================================================
-- CAMPAIGNS
-- ============================================================
create policy "campaigns_owner"
  on public.campaigns for all
  using (auth.role() = 'service_role' or account_id = public.current_account_id())
  with check (auth.role() = 'service_role' or account_id = public.current_account_id());

-- ============================================================
-- CONTENT ITEMS
-- ============================================================
create policy "content_items_owner"
  on public.content_items for all
  using (auth.role() = 'service_role' or account_id = public.current_account_id())
  with check (auth.role() = 'service_role' or account_id = public.current_account_id());

-- ============================================================
-- CONTENT VARIANTS
-- ============================================================
-- Bridge via content_items. The subquery targets content_items_account_idx
-- (account_id column) which is efficiently indexed. The join is on the primary
-- key (content_variants.content_item_id = content_items.id), which uses the PK.
create policy "content_variants_owner"
  on public.content_variants for all
  using (
    auth.role() = 'service_role' or exists (
      select 1 from public.content_items ci
      where ci.id = content_variants.content_item_id
        and ci.account_id = public.current_account_id()
    )
  )
  with check (
    auth.role() = 'service_role' or exists (
      select 1 from public.content_items ci
      where ci.id = content_variants.content_item_id
        and ci.account_id = public.current_account_id()
    )
  );

-- ============================================================
-- CONTENT MEDIA ATTACHMENTS
-- ============================================================
-- Bridge via content_variants → content_items. Two-hop EXISTS.
-- In a single-tenant schema this is acceptable; the subquery depth is bounded.
-- Alternative: add a denormalised account_id column to content_media_attachments.
-- Decision: avoid denormalisation; the two-hop path is covered by indexes.
create policy "content_media_attachments_owner"
  on public.content_media_attachments for all
  using (
    auth.role() = 'service_role' or exists (
      select 1
      from public.content_variants cv
      join public.content_items ci on ci.id = cv.content_item_id
      where cv.id = content_media_attachments.variant_id
        and ci.account_id = public.current_account_id()
    )
  )
  with check (
    auth.role() = 'service_role' or exists (
      select 1
      from public.content_variants cv
      join public.content_items ci on ci.id = cv.content_item_id
      where cv.id = content_media_attachments.variant_id
        and ci.account_id = public.current_account_id()
    )
  );

-- ============================================================
-- CONTENT ITEM VERSIONS
-- ============================================================
create policy "content_item_versions_owner"
  on public.content_item_versions for select
  using (
    auth.role() = 'service_role' or exists (
      select 1 from public.content_items ci
      where ci.id = content_item_versions.content_item_id
        and ci.account_id = public.current_account_id()
    )
  );

-- No INSERT/UPDATE/DELETE for authenticated users: versions are append-only,
-- written only by service role (server actions via service client).
create policy "content_item_versions_insert_service"
  on public.content_item_versions for insert
  with check (auth.role() = 'service_role');

-- ============================================================
-- PUBLISH JOBS
-- ============================================================
create policy "publish_jobs_select_owner"
  on public.publish_jobs for select
  using (
    auth.role() = 'service_role' or exists (
      select 1 from public.content_items ci
      where ci.id = publish_jobs.content_item_id
        and ci.account_id = public.current_account_id()
    )
  );

-- Authenticated users can only insert (schedule) and update (cancel/retry).
-- They cannot delete publish_jobs directly.
create policy "publish_jobs_insert_owner"
  on public.publish_jobs for insert
  with check (
    auth.role() = 'service_role' or exists (
      select 1 from public.content_items ci
      where ci.id = content_item_id
        and ci.account_id = public.current_account_id()
    )
  );

create policy "publish_jobs_update_owner"
  on public.publish_jobs for update
  using (
    auth.role() = 'service_role' or exists (
      select 1 from public.content_items ci
      where ci.id = publish_jobs.content_item_id
        and ci.account_id = public.current_account_id()
    )
  )
  -- Owners can only move jobs to 'cancelled'. Status transitions to
  -- in_progress/succeeded/failed are the worker's job.
  with check (
    auth.role() = 'service_role' or (
      publish_jobs.status = 'cancelled' and exists (
        select 1 from public.content_items ci
        where ci.id = publish_jobs.content_item_id
          and ci.account_id = public.current_account_id()
      )
    )
  );

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
create policy "notifications_owner"
  on public.notifications for all
  using (auth.role() = 'service_role' or account_id = public.current_account_id())
  with check (auth.role() = 'service_role' or account_id = public.current_account_id());

-- ============================================================
-- AUDIT LOG
-- ============================================================
-- Owner can read their own audit log. No write access for authenticated users.
create policy "audit_log_select_owner"
  on public.audit_log for select
  using (auth.role() = 'service_role' or account_id = public.current_account_id());

create policy "audit_log_insert_service"
  on public.audit_log for insert
  with check (auth.role() = 'service_role');

-- ============================================================
-- WORKER HEARTBEATS, OAUTH STATES, MANAGEMENT APP CONNECTIONS
-- ============================================================
-- These three tables are service-role only. No authenticated user access.
create policy "worker_heartbeats_service_only"
  on public.worker_heartbeats for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "oauth_states_service_only"
  on public.oauth_states for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "management_app_connections_service_only"
  on public.management_app_connections for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
```

**View security note:** Any view created in the rebuild must be defined with `security_invoker = true` to inherit RLS from base tables. Alternatively, grant `select` only to `service_role` and expose data through typed server actions. The current `publish_jobs_with_variant` view must be dropped and not recreated; its use case is replaced by a typed server action that joins the tables directly.

---

## 4. Publishing Queue Architecture

### 4.1 Decision: Vercel Cron vs QStash vs Inngest vs Supabase Edge Functions

**Current architecture:** Vercel Cron (60-second minimum interval) triggers `GET /api/cron/publish`, which makes an HTTP call to a Supabase Edge Function (`publish-queue`). The Edge Function polls `publish_jobs` and executes provider API calls.

**Trade-off analysis:**

| Dimension | Vercel Cron + Edge Function | QStash | Inngest |
|---|---|---|---|
| Delivery guarantee | At-least-once (Vercel can fire twice) | At-least-once with signature verification | At-least-once with deduplication key |
| Idempotency built-in | No | No (caller must handle) | Yes (event ID) |
| Retry logic | Manual (must re-poll) | Built-in (configurable backoff) | Built-in (step-level retries) |
| Observability | None without custom logging | Dashboard + webhook logs | Full step execution traces |
| Dead-letter handling | None | Dead-letter queue | Failed event replay |
| Cost at scale | Vercel Pro plan fixed | Pay per message | Pay per step execution |
| Minimum scheduling granularity | 60 seconds | 1 second | Event-driven (instant) |
| Cold start latency | Edge Function: ~50ms | QStash HTTP: ~100ms | Inngest bridge: ~200ms |
| Complexity | Low | Medium | Medium-High |

**Recommendation: QStash** for the near term.

Rationale:
- The current Edge Function architecture is already correct in design (stateless HTTP worker). QStash replaces the Vercel Cron HTTP call with a guaranteed-delivery, signed message delivery.
- QStash provides an `Upstash-Message-Id` header on every delivery that can be stored as the `idempotency_key` on `publish_jobs`, giving true at-most-once job creation at the queue layer.
- QStash supports scheduled messages (enqueue at a specific future UTC time), eliminating the need to poll `next_attempt_at <= now()` — jobs are only delivered when due.
- Retry backoff is configurable in the QStash message headers (`Upstash-Retries`, `Upstash-Retry-Callback`).
- Migration is minimal: replace the Vercel Cron route with a QStash publisher, add signature verification to the Edge Function.

**Inngest** is the better long-term choice if the workflow complexity grows (multi-step campaigns, conditional branching, fan-out to multiple providers). Defer this decision until the publish pipeline stabilises.

### 4.2 Idempotency Strategy

Every publish job must carry an `idempotency_key` that makes the job unique regardless of how many times it is enqueued.

**Key generation:**
```
idempotency_key = sha256(
  content_item_id + '::' + placement + '::' + floor(scheduled_for / 300) * 300
)
```

The `scheduled_for` is quantised to 5-minute buckets. This means that if a user reschedules a post within the same 5-minute window, the same key is generated and the `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` swallows the duplicate silently.

If a post is rescheduled to a different 5-minute bucket, a new key is generated. The old job must be explicitly cancelled before the new one is created — enforced by the `publish_jobs_active_unique` exclusion constraint.

**Queue-layer idempotency:** When using QStash, store the `Upstash-Message-Id` in the `publish_jobs.idempotency_key` column. The Edge Function verifies the QStash signature and checks: `INSERT INTO publish_jobs ... ON CONFLICT (idempotency_key) DO NOTHING`. If the row already exists and is `succeeded`, return 200 immediately. This handles the case where QStash redelieries after a timeout.

### 4.3 Retry and Backoff Design

```
Attempt 0 (initial): next_attempt_at = scheduled_for
Attempt 1 (first retry): next_attempt_at = now() + 5 minutes
Attempt 2 (second retry): next_attempt_at = now() + 15 minutes
Attempt 3 (final retry): next_attempt_at = now() + 30 minutes
Attempt 4+: status = 'failed', notification created, fallback package generated
```

Backoff formula: `delay_minutes = 5 * pow(3, attempt - 1)` capped at 60 minutes.

Retry logic lives in the Edge Function worker, not in application code. The worker updates `attempt`, `next_attempt_at`, `last_error`, and `status` atomically in a single UPDATE. It does not insert a new row — the same `publish_jobs` row is reused across all attempts.

**Provider-specific retry rules:**
- HTTP 429 (rate limit): honour the `Retry-After` header; set `next_attempt_at` accordingly, regardless of the backoff schedule.
- HTTP 401/403 (auth failure): do not retry. Set `status = 'failed'`, update `social_connections.status = 'needs_action'`, create a `connection_needs_action` notification.
- HTTP 5xx (provider error): apply standard backoff.
- Network timeout: treat as transient, apply standard backoff.

### 4.4 Dead-Letter Handling

A publish job is "dead" when `attempt >= max_attempts` (default 3). On reaching this state:

1. Set `publish_jobs.status = 'failed'`.
2. Set `content_items.status = 'failed'`.
3. Insert `audit_log` row with `action = 'publish_failed'`.
4. Insert `notifications` row with `category = 'publish_failed'`, linking `content_item_id`.
5. If `posting_defaults.notifications.emailFailures = true`, enqueue an email via Resend with a link to the fallback package download.
6. Generate a fallback package (zip of media assets + copy text) and store in Supabase Storage; store the signed URL in `publish_jobs.provider_response.fallback_package_url`.

Dead jobs are retained in the `publish_jobs` table permanently (not purged). The purge-trash cron only purges soft-deleted `content_items`, not job records.

---

## 5. Async Job Inventory

### 5.1 Publish Executor

| Attribute | Value |
|---|---|
| Trigger | QStash message (replacing Vercel Cron); also triggered on-demand by `publishNow` server action |
| Runtime | Supabase Edge Function (`publish-queue`) |
| Frequency | Continuous (QStash delivers when `next_attempt_at` is reached) |
| SLA | Post must be attempted within 60 seconds of `scheduled_for` |
| Max duration | 25 seconds per invocation (Supabase Edge Function limit) |
| Concurrency | 1 concurrent invocation per content_item (enforced by `publish_jobs_active_unique` exclusion constraint + `SELECT FOR UPDATE SKIP LOCKED`) |
| Failure handling | Exponential backoff up to `max_attempts`; then dead-letter flow above |
| Idempotency | `idempotency_key` unique constraint; `SELECT FOR UPDATE SKIP LOCKED` prevents concurrent pickup |
| Observability | `worker_heartbeats` updated after each run; `audit_log` written on status changes; structured JSON logs to Logflare |

**Critical implementation note:** The worker must use `SELECT FOR UPDATE SKIP LOCKED` when claiming a job:
```sql
SELECT id, content_item_id, variant_id, idempotency_key, placement
FROM publish_jobs
WHERE status = 'queued'
  AND next_attempt_at <= now()
ORDER BY next_attempt_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED;
```
Then immediately `UPDATE publish_jobs SET status = 'in_progress', started_at = now()` within the same transaction. This is the only safe pattern against concurrent worker invocations.

### 5.2 Token Health Check

| Attribute | Value |
|---|---|
| Trigger | Vercel Cron, nightly at 02:00 UTC |
| Runtime | Vercel Serverless Function (not Edge) — needs full Node.js for crypto operations |
| Frequency | Once per day |
| SLA | All expiring tokens notified within 24 hours of hitting the 5-day warning threshold |
| Failure handling | Log error; retry on next nightly run |
| Action on expiry | `social_connections.status = 'expiring'`; create `token_expiring` notification; send email if enabled |
| Action on expired | `social_connections.status = 'needs_action'`; create `connection_needs_action` notification |

### 5.3 Weekly Recurring Materialiser

| Attribute | Value |
|---|---|
| Trigger | Vercel Cron, daily at 01:00 UTC |
| Runtime | Vercel Serverless Function |
| Frequency | Daily (idempotent — skips existing slots) |
| Window | Creates content_items for the next 7 days |
| Failure handling | Schema-missing error is swallowed gracefully (as in current code). Other errors propagate; nightly retry implicit via daily schedule. |
| Idempotency | Checks `existing` scheduled_for values before inserting; no-ops on already-materialised slots |
| Gap: | Currently creates `content_items` with `status = 'scheduled'` and no variant body. AI content generation is deferred. A `prompt_context.source = 'recurring'` flag signals the worker to generate copy on the next planner open, not at materialisation time. This should be a separate async step. |

**Improvement needed:** After materialisation, enqueue AI generation jobs for each new `content_item`. Do not block the materialiser on AI API calls. Add a `content_items.copy_status` column (`pending | generating | ready | failed`) to track this separately from `status` (which tracks publication state).

### 5.4 Trash Purge

| Attribute | Value |
|---|---|
| Trigger | Vercel Cron, daily at 03:00 UTC |
| Runtime | Vercel Serverless Function |
| Frequency | Daily |
| Window | Purges `content_items` where `deleted_at < now() - 7 days` |
| Failure handling | Returns 500 with error body; Vercel logs the failure; no retry mechanism |
| Missing: | Does not purge associated `content_variants`, `content_media_attachments`, `publish_jobs`, or `content_item_versions`. Cascade deletes handle this if FK `ON DELETE CASCADE` is set — which it is for variants and jobs, but must be verified for new tables. |
| Missing: | Does not notify user of permanent deletion. Should create a `system` notification if any items are purged. |
| Missing: | Does not purge expired `oauth_states` rows. Add this to the same cron handler. |

### 5.5 Media Transcoding / Derivative Generation

| Attribute | Value |
|---|---|
| Trigger | Supabase Storage webhook on `media_assets` INSERT (or client-triggered after upload) |
| Runtime | Supabase Edge Function (`media-derivatives`) |
| Frequency | Per upload event |
| SLA | Derivatives ready within 30 seconds of upload for images; 120 seconds for video |
| Actions | Generate story crop, feed square, thumbnail; write rows to `media_renditions`; set `processed_status = 'ready'`; set `aspect_class` based on original dimensions |
| Failure handling | Set `processed_status = 'failed'`; retry up to 3 times; create `system` notification if all retries fail |
| Current gap | `derived_variants jsonb` on `media_assets` is the current output store. Target: write to `media_renditions` table; set `derived_variants` as empty (deprecated) |

---

## 6. Server Actions Design Patterns

### 6.1 Standard Pattern

All server actions follow this invariant chain:

```typescript
"use server";

import { z } from "zod";
import { requireAuthContext } from "@/lib/auth/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

// 1. Input schema — always Zod, always at the top of the file.
const UpdateVariantBodySchema = z.object({
  variantId: z.string().uuid(),
  body: z.string().max(2200),
  // mediaAttachments replaces the mediaIds uuid[] pattern.
  mediaAttachments: z.array(z.object({
    assetId: z.string().uuid(),
    position: z.number().int().min(0),
    altText: z.string().max(500).optional(),
  })).max(10),
});

type UpdateVariantBodyInput = z.infer<typeof UpdateVariantBodySchema>;

// 2. Return type — always explicit. Never return raw DB rows.
type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };

export async function updateVariantBody(
  rawInput: UpdateVariantBodyInput
): Promise<ActionResult> {
  // Step 1: Parse and validate input. Throw immediately on bad input.
  const parsed = UpdateVariantBodySchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input",
      code: "VALIDATION_ERROR",
    };
  }
  const input = parsed.data;

  // Step 2: Authenticate. requireAuthContext() throws on invalid session.
  const { accountId } = await requireAuthContext();

  // Step 3: Authorise. Verify the resource belongs to this account.
  // Use the user-scoped supabase client so RLS applies.
  const { supabase } = await requireAuthContext();
  const { data: variant, error: fetchError } = await supabase
    .from("content_variants")
    .select("id, content_item_id")
    .eq("id", input.variantId)
    .maybeSingle();

  if (fetchError) {
    console.error("[updateVariantBody] fetch error", fetchError);
    return { ok: false, error: "Database error", code: "DB_ERROR" };
  }

  if (!variant) {
    // RLS will return null for rows the user doesn't own — treat as not found.
    return { ok: false, error: "Not found", code: "NOT_FOUND" };
  }

  // Step 4: Business logic validation (beyond schema).
  if (input.body.length === 0 && input.mediaAttachments.length === 0) {
    return { ok: false, error: "Post must have copy or media", code: "EMPTY_POST" };
  }

  // Step 5: Mutation via service client (bypasses RLS for write operations
  // that require coordinating multiple tables atomically).
  // The service client is only used here; the authorisation check above
  // used the user client with RLS as the access control gate.
  const service = createServiceSupabaseClient();

  const { error: updateError } = await service
    .from("content_variants")
    .update({ body: input.body, updated_at: new Date().toISOString() })
    .eq("id", input.variantId);

  if (updateError) {
    console.error("[updateVariantBody] update error", updateError);
    return { ok: false, error: "Failed to save", code: "DB_ERROR" };
  }

  // Sync media attachments (delete + reinsert for ordered replace).
  await service
    .from("content_media_attachments")
    .delete()
    .eq("variant_id", input.variantId)
    .throwOnError();

  if (input.mediaAttachments.length) {
    await service
      .from("content_media_attachments")
      .insert(input.mediaAttachments.map((a) => ({
        variant_id: input.variantId,
        asset_id: a.assetId,
        position: a.position,
        alt_text: a.altText ?? null,
      })))
      .throwOnError();
  }

  // Step 6: Audit log entry.
  await service
    .from("audit_log")
    .insert({
      account_id: accountId,
      entity_type: "content_item",
      entity_id: variant.content_item_id,
      action: "updated",
      actor: "owner",
      new_state: { variantId: input.variantId, bodyLength: input.body.length },
    })
    .throwOnError();

  return { ok: true, data: undefined };
}
```

### 6.2 Error Handling Conventions

| Condition | Code | HTTP Analogue |
|---|---|---|
| Zod parse failure | `VALIDATION_ERROR` | 422 |
| Not authenticated | Redirect to /login (inside requireAuthContext) | 401 |
| Resource not found or not owned | `NOT_FOUND` | 404 |
| Business rule violation | `DOMAIN_ERROR` | 409 |
| Supabase/DB error | `DB_ERROR` | 500 |
| External API error (social providers) | `PROVIDER_ERROR` | 502 |
| Rate limit | `RATE_LIMITED` | 429 |

**Never throw from a server action.** Uncaught throws propagate as Next.js error boundaries, showing a 500 page. All expected error paths return `{ ok: false, error, code }`. Unexpected errors (e.g., network unreachable) should be caught at the top level and returned as `DB_ERROR` with the original message logged server-side.

**Never return raw Supabase rows to the client.** Transform into a typed DTO before returning. This prevents accidental leaking of columns that should not be client-visible (e.g., `access_token`, `api_key_enc`, `prompt_context` internals).

### 6.3 Mutation Patterns for Multi-Table Operations

For operations that touch multiple tables (e.g., creating a campaign + content_items + variants in one server action), use a Postgres function via `supabase.rpc()` to ensure atomicity. Do not rely on sequential Supabase client calls — a network error between calls leaves the database in a partial state.

```sql
-- Example: atomic campaign creation function.
create or replace function public.create_campaign_with_items(
  p_account_id uuid,
  p_campaign jsonb,
  p_items jsonb  -- array of {platform, placement, scheduled_for, prompt_context}
)
returns uuid  -- returns campaign id
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign_id uuid;
  v_item jsonb;
  v_item_id uuid;
begin
  insert into public.campaigns (account_id, name, campaign_type, start_at, end_at, metadata)
  values (
    p_account_id,
    p_campaign->>'name',
    p_campaign->>'campaign_type',
    (p_campaign->>'start_at')::timestamptz,
    (p_campaign->>'end_at')::timestamptz,
    coalesce(p_campaign->'metadata', '{}')
  )
  returning id into v_campaign_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.content_items (
      campaign_id, account_id, platform, placement,
      scheduled_for, status, prompt_context, auto_generated
    )
    values (
      v_campaign_id,
      p_account_id,
      v_item->>'platform',
      coalesce(v_item->>'placement', 'feed'),
      (v_item->>'scheduled_for')::timestamptz,
      'draft',
      coalesce(v_item->'prompt_context', '{}'),
      true
    )
    returning id into v_item_id;

    insert into public.content_variants (content_item_id, body)
    values (v_item_id, '');
  end loop;

  return v_campaign_id;
end;
$$;
```

---

## 7. Migration Strategy

### 7.1 Principles

1. **Never modify existing migration files.** All changes ship as new migration files with higher timestamps.
2. **Every migration is a forward-only one-way door.** No down migrations. If a migration is wrong, fix it with a new migration.
3. **Data migrations are separate from schema migrations.** Run schema changes first, then data transforms in a subsequent file.
4. **Every schema migration is safe to run on a live database** (no long locks, no table rewrites unless size permits).

### 7.2 Phase 1: Constraint and Index Hardening (Non-breaking)

These changes can be applied immediately without disrupting existing application code.

```sql
-- Migration: add missing constraints and indexes.

-- brand_profile tone range guards.
alter table public.brand_profile
  add constraint brand_profile_tone_formal_range
    check (tone_formal between 0.00 and 1.00);

alter table public.brand_profile
  add constraint brand_profile_tone_playful_range
    check (tone_playful between 0.00 and 1.00);

-- Campaign date order guard.
alter table public.campaigns
  add constraint campaigns_date_order
    check (start_at is null or end_at is null or end_at >= start_at);

-- notifications category constraint (add new enum values via new migration,
-- not by modifying check here — just add the missing ones).
-- Existing rows must be backfilled before constraint is added.
update public.notifications
  set category = 'system'
  where category is null or category not in (
    'publish_success','publish_failed','publish_retry',
    'story_publish_success','story_publish_failed','story_publish_retry',
    'connection_needs_action','connection_reconnected',
    'connection_metadata_updated','token_expiring','system'
  );

alter table public.notifications
  alter column category set not null;

-- Composite indexes replacing multi-single-column scans.
create index if not exists content_items_planner_idx
  on public.content_items (account_id, scheduled_for, status)
  where deleted_at is null;

create index if not exists content_items_campaign_idx
  on public.content_items (campaign_id)
  where deleted_at is null;

create index if not exists publish_jobs_worker_poll_idx
  on public.publish_jobs (next_attempt_at, status)
  where status in ('queued', 'in_progress');

create index if not exists publish_jobs_item_idx
  on public.publish_jobs (content_item_id, status, created_at desc);
```

### 7.3 Phase 2: New Tables (Non-breaking Additive)

Add the new tables (`media_renditions`, `content_media_attachments`, `content_item_versions`, `audit_log`) without touching existing tables. Application code can begin writing to them in parallel with the old patterns.

```sql
-- Add all new tables from Section 2 DDL (abbreviated here).
-- Each table ships in its own migration file for rollback granularity.
-- Order matters due to foreign keys:
-- 1. media_renditions (depends on media_assets)
-- 2. content_media_attachments (depends on content_variants)
-- 3. content_item_versions (depends on content_items, content_variants)
-- 4. audit_log (no FK dependencies on other custom tables)
```

### 7.4 Phase 3: idempotency_key on publish_jobs

```sql
-- Step 1: Add nullable column.
alter table public.publish_jobs
  add column if not exists idempotency_key text;

-- Step 2: Backfill existing rows.
-- Generate a deterministic key from existing data.
update public.publish_jobs
  set idempotency_key = encode(
    digest(
      content_item_id::text || '::' || placement || '::' || coalesce(
        extract(epoch from (
          select scheduled_for from public.content_items ci
          where ci.id = publish_jobs.content_item_id
        ))::bigint::text,
        '0'
      ),
      'sha256'
    ),
    'hex'
  )
  where idempotency_key is null;

-- Step 3: Set NOT NULL.
alter table public.publish_jobs
  alter column idempotency_key set not null;

-- Step 4: Add unique constraint.
alter table public.publish_jobs
  add constraint publish_jobs_idempotency_unique unique (idempotency_key);
```

### 7.5 Phase 4: media_ids → content_media_attachments Migration

This is the highest-risk migration. The `media_ids uuid[]` column is embedded in the `publish_jobs_with_variant` view and queried by multiple application paths.

```sql
-- Step 1: Populate content_media_attachments from existing media_ids arrays.
-- Runs on live data; no locks held beyond row-level.
insert into public.content_media_attachments (variant_id, asset_id, position)
select
  cv.id as variant_id,
  unnested.asset_id,
  (unnested.ordinal - 1) as position
from public.content_variants cv
cross join lateral unnest(cv.media_ids) with ordinality as unnested(asset_id, ordinal)
where array_length(cv.media_ids, 1) > 0
  -- Skip assets that no longer exist in media_assets (referential integrity gap).
  and exists (
    select 1 from public.media_assets ma where ma.id = unnested.asset_id
  )
on conflict (variant_id, asset_id) do nothing;

-- Step 2: Verify row counts match.
-- SELECT cv.id, array_length(cv.media_ids, 1) as old_count,
--        COUNT(cma.id) as new_count
-- FROM content_variants cv
-- LEFT JOIN content_media_attachments cma ON cma.variant_id = cv.id
-- WHERE array_length(cv.media_ids, 1) > 0
-- GROUP BY cv.id HAVING array_length(cv.media_ids, 1) != COUNT(cma.id);
-- Expected: 0 rows.

-- Step 3: Application code cutover.
-- Update all write paths to use content_media_attachments.
-- Update all read paths to join content_media_attachments.
-- Run for one release cycle while both paths are active.

-- Step 4 (next release): Drop media_ids column.
-- alter table public.content_variants drop column media_ids;
-- This is a breaking change; all code must be on new path before running.

-- Step 5: Drop publish_jobs_with_variant view.
drop view if exists public.publish_jobs_with_variant;
-- Replace with typed server action.
```

### 7.6 Phase 5: Campaign ON DELETE Behaviour Change

Changing `campaign_id` from `ON DELETE SET NULL` to `ON DELETE RESTRICT` requires no data migration but does require that all campaign deletion code is changed to soft-delete instead of hard delete.

```sql
-- Step 1: Add deleted_at to campaigns (already in Phase 2 DDL).

-- Step 2: Update application code to set deleted_at instead of deleting.

-- Step 3: Update FK constraint.
alter table public.content_items
  drop constraint content_items_campaign_id_fkey;

alter table public.content_items
  add constraint content_items_campaign_id_fkey
    foreign key (campaign_id) references public.campaigns (id)
    on delete restrict;
```

### 7.7 Rollback Strategy

Since down migrations are not supported, the rollback strategy is feature flags:

- New code paths (writing to `content_media_attachments`) are gated behind an environment variable `ENABLE_MEDIA_ATTACHMENTS_TABLE=true`.
- If issues are found, set `ENABLE_MEDIA_ATTACHMENTS_TABLE=false` to revert to the `media_ids` read path without requiring a schema rollback.
- Feature flags are removed once the new path has been stable in production for two weeks.

### 7.8 Testing Migration Safety

Before running any Phase 3-5 migration in production:

1. Restore a production database snapshot to a staging environment.
2. Run the migration against staging.
3. Run the full Playwright end-to-end suite against staging.
4. Check `pg_stat_user_tables` for unexpected seq_scans on hot tables.
5. Verify `pg_locks` shows no long-held locks during the migration.
6. Only then apply to production during low-traffic window (02:00–04:00 UTC).
