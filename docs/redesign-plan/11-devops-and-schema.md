# 11 — DevOps and Schema Specification

> **Scope**: Greenfield rebuild. This document is the single source of truth for the new database schema and the complete DevOps setup. Nothing from the existing repository is carried forward; the new Supabase project and Vercel project start clean.

---

## PART A: Consolidated Schema (Greenfield Baseline)

### Design rationale for enum approach

All status-style enumerations use **PostgreSQL `CHECK` constraints** rather than custom `ENUM` types. Reason: `ALTER TYPE ... ADD VALUE` requires a full transaction commit before the new value is usable in constraints or defaults in the same migration; `CHECK` constraints can be altered freely within a single migration with `DROP CONSTRAINT` / `ADD CONSTRAINT`. For a single-developer project with rapid iteration this eliminates a common foot-gun.

The `urgency` column on `notifications` and the `category` column use `CHECK` constraints for the same reason.

---

### A1. Complete Schema DDL

```sql
-- =============================================================================
-- CheersAI Greenfield Baseline — 0001_baseline.sql
-- Apply with: supabase db push  (or  psql -f supabase/migrations/0001_baseline.sql)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------------
-- 1. Utility: set_updated_at trigger function (applied in section 9)
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Generic before-update trigger that stamps updated_at to now().';

-- ---------------------------------------------------------------------------
-- 2. current_account_id() helper
--    Reads account UUID from JWT app_metadata (preferred) then falls back to
--    auth.uid() for the simple single-owner case where they are the same.
-- ---------------------------------------------------------------------------
create or replace function public.current_account_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  claim text;
  result uuid;
begin
  -- App_metadata is set server-side and cannot be spoofed by the client.
  claim := auth.jwt() -> 'app_metadata' ->> 'account_id';
  if claim is not null and length(trim(claim)) > 0 then
    begin
      result := claim::uuid;
      return result;
    exception when others then
      null; -- fall through
    end;
  end if;
  -- Single-owner fallback: account row id equals auth user id.
  return auth.uid();
end;
$$;

comment on function public.current_account_id() is
  'Resolves the application account id from JWT app_metadata or auth.uid().';

grant execute on function public.current_account_id() to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- 3. accounts
-- ---------------------------------------------------------------------------
create table public.accounts (
  id            uuid        primary key references auth.users (id) on delete cascade,
  email         text        not null unique,
  display_name  text,
  -- Timezone is hardcoded to Europe/London per product decision.
  -- No per-row timezone column; all scheduled_for values stored as UTC and
  -- displayed to the owner in Europe/London via application layer (Luxon).
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.accounts is
  'One row per owner. id mirrors auth.users.id. No multi-tenancy.';
comment on column public.accounts.email is
  'Denormalised from auth.users for faster queries; kept in sync via trigger.';

create index accounts_email_idx on public.accounts (email);

-- ---------------------------------------------------------------------------
-- 4. brand_profile (singleton per account, auto-created by trigger)
-- ---------------------------------------------------------------------------
create table public.brand_profile (
  account_id            uuid          primary key references public.accounts (id) on delete cascade,
  tone_formal           numeric(3,2)  not null default 0.50 check (tone_formal between 0 and 1),
  tone_playful          numeric(3,2)  not null default 0.50 check (tone_playful between 0 and 1),
  key_phrases           text[]        not null default array[]::text[],
  banned_phrases        text[]        not null default array[]::text[],
  banned_topics         text[]        not null default array[]::text[],
  default_hashtags      text[]        not null default array[]::text[],
  default_emojis        text[]        not null default array[]::text[],
  instagram_signature   text,
  facebook_signature    text,
  gbp_cta               text,
  updated_at            timestamptz   not null default now()
  -- No created_at: this is a singleton settings row, not an event.
);

comment on table public.brand_profile is
  'Brand voice settings. Auto-created when account is inserted.';
comment on column public.brand_profile.banned_phrases is
  'Exact phrases the AI must never produce (checked post-generation).';

-- ---------------------------------------------------------------------------
-- 5. posting_defaults (singleton per account)
-- ---------------------------------------------------------------------------
create table public.posting_defaults (
  account_id              uuid        primary key references public.accounts (id) on delete cascade,
  facebook_location_id    text,
  instagram_location_id   text,
  gbp_location_id         text,
  notifications           jsonb       not null default jsonb_build_object(
                                        'emailFailures',      true,
                                        'emailTokenExpiring', true
                                      ),
  gbp_cta_standard        text        not null default 'LEARN_MORE',
  gbp_cta_event           text        not null default 'LEARN_MORE',
  gbp_cta_offer           text        not null default 'REDEEM',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.posting_defaults is
  'Per-account operational defaults: location IDs, notification prefs, GBP CTA overrides.';

-- ---------------------------------------------------------------------------
-- 6. social_connections (encrypted token storage)
-- ---------------------------------------------------------------------------
create table public.social_connections (
  id                    uuid        primary key default gen_random_uuid(),
  account_id            uuid        not null references public.accounts (id) on delete cascade,
  provider              text        not null check (provider in ('facebook', 'instagram', 'gbp')),
  status                text        not null default 'needs_action'
                          check (status in ('active', 'expiring', 'needs_action', 'disconnected')),
  -- Encrypted with AES-256-GCM. Key = TOKEN_ENCRYPTION_SECRET env var.
  -- Format: base64(iv || ciphertext || auth_tag). Decrypted only in server
  -- actions and the publish worker; never exposed to the client.
  access_token_enc      text,
  refresh_token_enc     text,
  expires_at            timestamptz,
  external_page_id      text,
  external_location_id  text,
  display_name          text,
  last_synced_at        timestamptz,
  metadata              jsonb       not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on column public.social_connections.access_token_enc is
  'AES-256-GCM encrypted OAuth access token. Never store plaintext.';
comment on column public.social_connections.refresh_token_enc is
  'AES-256-GCM encrypted OAuth refresh token. Never store plaintext.';

create index social_connections_account_idx    on public.social_connections (account_id);
create index social_connections_metadata_idx   on public.social_connections using gin (metadata);
create unique index social_connections_unique_provider
  on public.social_connections (account_id, provider);

-- ---------------------------------------------------------------------------
-- 7. media_assets
-- ---------------------------------------------------------------------------
create table public.media_assets (
  id              uuid        primary key default gen_random_uuid(),
  account_id      uuid        not null references public.accounts (id) on delete cascade,
  storage_path    text        not null,
  file_name       text        not null,
  media_type      text        not null check (media_type in ('image', 'video')),
  mime_type       text,
  size_bytes      bigint,
  width           integer,
  height          integer,
  duration_seconds numeric,
  aspect_class    text        not null default 'square'
                    check (aspect_class in ('square', 'story', 'landscape')),
  tags            text[]      not null default array[]::text[],
  hidden_at       timestamptz,
  uploaded_at     timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on column public.media_assets.aspect_class is
  'Classified by media-derivatives worker after dimension analysis.';
comment on column public.media_assets.hidden_at is
  'Soft-delete: set by user to hide from library without losing publish history.';

create index media_assets_account_idx   on public.media_assets (account_id);
create index media_assets_uploaded_idx  on public.media_assets (uploaded_at desc);
create index media_assets_hidden_idx    on public.media_assets (hidden_at) where hidden_at is null;

-- ---------------------------------------------------------------------------
-- 8. media_renditions (new)
--    Stores derivative files produced by the media-derivatives worker:
--    square crops, story crops, compressed versions, video thumbnails.
-- ---------------------------------------------------------------------------
create table public.media_renditions (
  id              uuid    primary key default gen_random_uuid(),
  media_asset_id  uuid    not null references public.media_assets (id) on delete cascade,
  rendition_type  text    not null check (rendition_type in ('square', 'story', 'landscape', 'thumbnail')),
  storage_path    text    not null,
  width           integer,
  height          integer,
  size_bytes      bigint,
  mime_type       text,
  created_at      timestamptz not null default now()
  -- No updated_at: renditions are immutable; re-run produces a new row.
);

comment on table public.media_renditions is
  'Derivative files of media_assets. Immutable: new derivation = new row.';

create index media_renditions_asset_idx on public.media_renditions (media_asset_id);
create unique index media_renditions_unique_type
  on public.media_renditions (media_asset_id, rendition_type);

-- ---------------------------------------------------------------------------
-- 9. campaigns (soft delete)
-- ---------------------------------------------------------------------------
create table public.campaigns (
  id              uuid        primary key default gen_random_uuid(),
  account_id      uuid        not null references public.accounts (id) on delete cascade,
  name            text        not null,
  campaign_type   text        not null
                    check (campaign_type in ('event', 'promotion', 'weekly', 'instant', 'story_series')),
  start_at        timestamptz,
  end_at          timestamptz,
  hero_media_id   uuid        references public.media_assets (id) on delete set null,
  link_in_bio_url text,
  auto_confirm    boolean     not null default false,
  status          text        not null default 'draft'
                    check (status in ('draft', 'scheduled', 'completed', 'cancelled')),
  metadata        jsonb,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on column public.campaigns.deleted_at is
  'Soft delete. Application filters WHERE deleted_at IS NULL by convention.';

create index campaigns_account_idx   on public.campaigns (account_id);
create index campaigns_status_idx    on public.campaigns (status);
create index campaigns_deleted_idx   on public.campaigns (deleted_at) where deleted_at is null;
create index campaigns_link_bio_idx  on public.campaigns (account_id, link_in_bio_url);

-- ---------------------------------------------------------------------------
-- 10. content_items
--     campaign_id FK is ON DELETE RESTRICT (not SET NULL) because deleting a
--     campaign with active scheduled posts should be intentionally blocked.
--     Callers must soft-delete campaigns or unlink content first.
-- ---------------------------------------------------------------------------
create table public.content_items (
  id              uuid        primary key default gen_random_uuid(),
  campaign_id     uuid        references public.campaigns (id) on delete restrict,
  account_id      uuid        not null references public.accounts (id) on delete cascade,
  platform        text        not null check (platform in ('facebook', 'instagram', 'gbp')),
  placement       text        not null default 'feed' check (placement in ('feed', 'story')),
  scheduled_for   timestamptz,
  status          text        not null default 'draft'
                    check (status in ('draft', 'scheduled', 'queued', 'publishing', 'posted', 'failed')),
  prompt_context  jsonb,
  auto_generated  boolean     not null default true,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on column public.content_items.campaign_id is
  'FK ON DELETE RESTRICT: callers must detach or archive items before deleting the campaign.';
comment on column public.content_items.placement is
  'feed = standard post; story = ephemeral story format.';
comment on column public.content_items.deleted_at is
  'Soft delete. Filtered in all standard queries.';

create index content_items_account_idx   on public.content_items (account_id);
create index content_items_schedule_idx  on public.content_items (scheduled_for);
create index content_items_status_idx    on public.content_items (status);
create index content_items_deleted_idx   on public.content_items (deleted_at) where deleted_at is null;
create index content_items_campaign_idx  on public.content_items (campaign_id);

-- ---------------------------------------------------------------------------
-- 11. content_variants
-- ---------------------------------------------------------------------------
create table public.content_variants (
  id              uuid    primary key default gen_random_uuid(),
  content_item_id uuid    not null references public.content_items (id) on delete cascade,
  body            text,
  preview_data    jsonb,
  validation      jsonb,
  updated_at      timestamptz not null default now()
  -- media_ids uuid[] column is intentionally ABSENT.
  -- Media is linked via content_media_attachments junction table.
);

comment on table public.content_variants is
  'One variant per content_item (1:1 enforced by unique index). Body + validation.';

create index content_variants_content_idx on public.content_variants (content_item_id);
create unique index content_variants_unique_item
  on public.content_variants (content_item_id);

-- ---------------------------------------------------------------------------
-- 12. content_media_attachments (replaces media_ids uuid[])
--     Joins content_variants to media_assets with explicit position and alt text.
-- ---------------------------------------------------------------------------
create table public.content_media_attachments (
  id              uuid    primary key default gen_random_uuid(),
  variant_id      uuid    not null references public.content_variants (id) on delete cascade,
  media_asset_id  uuid    not null references public.media_assets (id) on delete restrict,
  position        integer not null default 0 check (position >= 0),
  alt_text        text,
  created_at      timestamptz not null default now()
  -- No updated_at: attachments are replaced wholesale; edit = delete + insert.
);

comment on table public.content_media_attachments is
  'Junction table replacing the media_ids uuid[] array on content_variants.
   ON DELETE RESTRICT on media_asset_id: cannot delete media while it is
   attached to a variant. Detach first.';

create index cma_variant_idx on public.content_media_attachments (variant_id);
create index cma_asset_idx   on public.content_media_attachments (media_asset_id);
create unique index cma_variant_position_unique
  on public.content_media_attachments (variant_id, position);

-- ---------------------------------------------------------------------------
-- 13. content_item_versions (new — immutable publish-time snapshot)
--     Written once at publish time; never mutated. Provides an audit trail of
--     exactly what was sent to each platform.
-- ---------------------------------------------------------------------------
create table public.content_item_versions (
  id              uuid    primary key default gen_random_uuid(),
  content_item_id uuid    not null references public.content_items (id) on delete cascade,
  variant_id      uuid    references public.content_variants (id) on delete set null,
  body_snapshot   text,
  media_snapshot  jsonb,   -- array of {media_asset_id, storage_path, alt_text, position}
  platform        text    not null check (platform in ('facebook', 'instagram', 'gbp')),
  placement       text    not null check (placement in ('feed', 'story')),
  captured_at     timestamptz not null default now()
  -- Intentionally no updated_at: this is an append-only audit record.
);

comment on table public.content_item_versions is
  'Immutable snapshot of exactly what was published. Written by the publish worker.';

create index civ_content_item_idx on public.content_item_versions (content_item_id);
create index civ_captured_idx     on public.content_item_versions (captured_at desc);

-- ---------------------------------------------------------------------------
-- 14. publish_jobs
--     idempotency_key prevents duplicate jobs for the same logical operation.
--     EXCLUDE constraint blocks concurrent active jobs for the same content_item.
-- ---------------------------------------------------------------------------
create table public.publish_jobs (
  id                uuid    primary key default gen_random_uuid(),
  content_item_id   uuid    not null references public.content_items (id) on delete cascade,
  variant_id        uuid    not null references public.content_variants (id) on delete cascade,
  placement         text    not null default 'feed' check (placement in ('feed', 'story')),
  attempt           integer not null default 0 check (attempt >= 0),
  status            text    not null default 'queued'
                      check (status in ('queued', 'in_progress', 'succeeded', 'failed')),
  idempotency_key   text    not null,
  last_error        text,
  provider_response jsonb,
  next_attempt_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint publish_jobs_idempotency_key_unique unique (idempotency_key)
);

comment on column public.publish_jobs.idempotency_key is
  'Unique key preventing duplicate job creation. Callers generate as:
   content_item_id || '':'' || placement || '':'' || attempt_epoch.';
comment on column public.publish_jobs.variant_id is
  'Snapshot of which variant was queued; survives variant replacement.';

create index publish_jobs_status_idx      on public.publish_jobs (status);
create index publish_jobs_next_idx        on public.publish_jobs (next_attempt_at);
create index publish_jobs_content_idx     on public.publish_jobs (content_item_id);

-- EXCLUDE constraint: at most one active (queued or in_progress) job per
-- content_item + placement combination at any time.
-- Requires btree_gist extension which Supabase enables by default.
create extension if not exists btree_gist;

alter table public.publish_jobs
  add constraint publish_jobs_no_concurrent_active
  exclude using gist (
    content_item_id with =,
    placement       with =,
    (case when status in ('queued', 'in_progress') then 1 else null end) with =
  );

comment on constraint publish_jobs_no_concurrent_active on public.publish_jobs is
  'Blocks two active (queued/in_progress) jobs for the same content_item+placement.';

-- Story uniqueness: at most one active story job per content_item.
create unique index publish_jobs_story_active_unique
  on public.publish_jobs (content_item_id, placement)
  where placement = 'story' and status in ('queued', 'in_progress');

-- ---------------------------------------------------------------------------
-- 15. notifications
-- ---------------------------------------------------------------------------
create table public.notifications (
  id          uuid    primary key default gen_random_uuid(),
  account_id  uuid    not null references public.accounts (id) on delete cascade,
  urgency     text    not null default 'standard'
                check (urgency in ('urgent', 'standard')),
  category    text    not null
                check (category in (
                  'publish_failure',
                  'token_expiring',
                  'token_expired',
                  'publish_success',
                  'system'
                )),
  message     text    not null,
  read_at     timestamptz,
  metadata    jsonb,
  created_at  timestamptz not null default now()
  -- No updated_at: notifications are write-once except for read_at.
);

comment on column public.notifications.urgency is
  'urgent = email + in-app; standard = in-app only.';
comment on column public.notifications.category is
  'Checked enum. Determines routing logic in the notification service.';

create index notifications_account_idx on public.notifications (account_id);
create index notifications_read_idx    on public.notifications (read_at) where read_at is null;
create index notifications_urgency_idx on public.notifications (account_id, urgency) where read_at is null;

-- ---------------------------------------------------------------------------
-- 16. analytics_snapshots (new — placeholder, spec in progress)
--     Stores periodic metric snapshots fetched from platform APIs.
--     Intentionally schemaless for metrics (jsonb) until analytics spec is final.
-- ---------------------------------------------------------------------------
create table public.analytics_snapshots (
  id              uuid    primary key default gen_random_uuid(),
  content_item_id uuid    not null references public.content_items (id) on delete cascade,
  account_id      uuid    not null references public.accounts (id) on delete cascade,
  platform        text    not null check (platform in ('facebook', 'instagram', 'gbp')),
  snapshot_type   text    not null default 'post_metrics'
                    check (snapshot_type in ('post_metrics', 'reach', 'engagement', 'story_metrics')),
  metrics         jsonb   not null default '{}'::jsonb,
  fetched_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
  -- No updated_at: snapshots are immutable. New fetch = new row.
);

comment on table public.analytics_snapshots is
  'Periodic snapshots of platform metrics per content_item. Append-only.
   Schema of metrics jsonb will be formalised in the analytics spec.';

create index analytics_content_idx   on public.analytics_snapshots (content_item_id);
create index analytics_fetched_idx   on public.analytics_snapshots (fetched_at desc);
create index analytics_platform_idx  on public.analytics_snapshots (account_id, platform);

-- ---------------------------------------------------------------------------
-- 17. audit_log (new)
--     Written exclusively by service role. Owners can SELECT only via RLS.
--     Covers: publish attempts, token refreshes, settings changes, admin ops.
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id          uuid    primary key default gen_random_uuid(),
  account_id  uuid    references public.accounts (id) on delete set null,
  actor       text    not null, -- 'service_role' | auth user id as text
  action      text    not null, -- e.g. 'publish_job.started', 'token.refreshed'
  table_name  text,
  row_id      text,
  old_data    jsonb,
  new_data    jsonb,
  metadata    jsonb,
  created_at  timestamptz not null default now()
  -- Intentionally immutable: no updated_at, no delete policy.
);

comment on table public.audit_log is
  'Append-only audit trail. Service role writes; owner can SELECT their own rows.';

create index audit_log_account_idx on public.audit_log (account_id);
create index audit_log_action_idx  on public.audit_log (action);
create index audit_log_created_idx on public.audit_log (created_at desc);

-- ---------------------------------------------------------------------------
-- 18. link_in_bio_profiles (singleton per account)
-- ---------------------------------------------------------------------------
create table public.link_in_bio_profiles (
  account_id      uuid    primary key references public.accounts (id) on delete cascade,
  slug            text    not null,
  display_name    text,
  bio             text,
  hero_media_id   uuid    references public.media_assets (id) on delete set null,
  theme           jsonb   not null default '{}'::jsonb,
  phone_number    text,
  whatsapp_number text,
  booking_url     text,
  menu_url        text,
  parking_url     text,
  directions_url  text,
  facebook_url    text,
  instagram_url   text,
  website_url     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index link_in_bio_profiles_slug_key on public.link_in_bio_profiles (slug);
create index link_in_bio_profiles_hero_idx        on public.link_in_bio_profiles (hero_media_id);

-- ---------------------------------------------------------------------------
-- 19. link_in_bio_tiles
-- ---------------------------------------------------------------------------
create table public.link_in_bio_tiles (
  id              uuid    primary key default gen_random_uuid(),
  account_id      uuid    not null references public.accounts (id) on delete cascade,
  title           text    not null,
  subtitle        text,
  cta_label       text    not null,
  cta_url         text    not null,
  media_asset_id  uuid    references public.media_assets (id) on delete set null,
  position        integer not null default 0 check (position >= 0),
  enabled         boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index link_in_bio_tiles_account_idx on public.link_in_bio_tiles (account_id, position);
create index link_in_bio_tiles_media_idx   on public.link_in_bio_tiles (media_asset_id);

-- ---------------------------------------------------------------------------
-- 20. user_auth_snapshot (mirrors auth.users for safe public-schema exposure)
-- ---------------------------------------------------------------------------
create table public.user_auth_snapshot (
  user_id         uuid    primary key,
  email           text    not null,
  status          text    not null default 'active',
  created_at      timestamptz not null,
  last_sign_in_at timestamptz,
  updated_at      timestamptz not null default now()
);

comment on table public.user_auth_snapshot is
  'Cached subset of auth.users safe for public schema RLS policies.';

-- ---------------------------------------------------------------------------
-- 21. management_app_connections (service-role only)
-- ---------------------------------------------------------------------------
create table public.management_app_connections (
  account_id        uuid    primary key references public.accounts (id) on delete cascade,
  base_url          text    not null,
  api_key           text    not null,
  enabled           boolean not null default true,
  last_tested_at    timestamptz,
  last_test_status  text    check (last_test_status in ('ok', 'error') or last_test_status is null),
  last_test_message text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 22. worker_heartbeats (service-role only)
-- ---------------------------------------------------------------------------
create table public.worker_heartbeats (
  name            text    primary key,
  last_run_at     timestamptz not null default now(),
  last_run_source text,
  metadata        jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
```

---

### A2. Triggers

```sql
-- =============================================================================
-- Triggers
-- =============================================================================

-- set_updated_at applied to all mutable tables
-- (read: all tables that have an updated_at column and are not append-only)

create trigger accounts_set_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();

create trigger brand_profile_set_updated_at
  before update on public.brand_profile
  for each row execute function public.set_updated_at();

create trigger posting_defaults_set_updated_at
  before update on public.posting_defaults
  for each row execute function public.set_updated_at();

create trigger social_connections_set_updated_at
  before update on public.social_connections
  for each row execute function public.set_updated_at();

create trigger media_assets_set_updated_at
  before update on public.media_assets
  for each row execute function public.set_updated_at();

create trigger campaigns_set_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();

create trigger content_items_set_updated_at
  before update on public.content_items
  for each row execute function public.set_updated_at();

create trigger content_variants_set_updated_at
  before update on public.content_variants
  for each row execute function public.set_updated_at();

create trigger publish_jobs_set_updated_at
  before update on public.publish_jobs
  for each row execute function public.set_updated_at();

create trigger link_in_bio_profiles_set_updated_at
  before update on public.link_in_bio_profiles
  for each row execute function public.set_updated_at();

create trigger link_in_bio_tiles_set_updated_at
  before update on public.link_in_bio_tiles
  for each row execute function public.set_updated_at();

create trigger management_app_connections_set_updated_at
  before update on public.management_app_connections
  for each row execute function public.set_updated_at();

create trigger worker_heartbeats_set_updated_at
  before update on public.worker_heartbeats
  for each row execute function public.set_updated_at();

create trigger user_auth_snapshot_set_updated_at
  before update on public.user_auth_snapshot
  for each row execute function public.set_updated_at();

-- NOTE: Tables intentionally without updated_at trigger:
--   media_renditions        (immutable)
--   content_media_attachments (replaced wholesale)
--   content_item_versions   (immutable)
--   analytics_snapshots     (immutable)
--   audit_log               (immutable)
--   notifications           (only read_at changes; no updated_at column)

-- ---------------------------------------------------------------------------
-- auto_create_brand_profile: fires when a new account row is inserted.
-- Also creates posting_defaults and link_in_bio_profiles singletons.
-- ---------------------------------------------------------------------------
create or replace function public.auto_create_account_singletons()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.brand_profile (account_id)
  values (new.id)
  on conflict (account_id) do nothing;

  insert into public.posting_defaults (account_id)
  values (new.id)
  on conflict (account_id) do nothing;

  return new;
end;
$$;

comment on function public.auto_create_account_singletons() is
  'Creates brand_profile and posting_defaults rows when a new account is inserted.';

create trigger accounts_auto_create_singletons
  after insert on public.accounts
  for each row execute function public.auto_create_account_singletons();

-- ---------------------------------------------------------------------------
-- sync_user_auth_snapshot: keeps user_auth_snapshot in sync with auth.users.
-- ---------------------------------------------------------------------------
create or replace function public.sync_user_auth_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.user_auth_snapshot (
    user_id, email, status, created_at, last_sign_in_at, updated_at
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'status', 'active'),
    new.created_at,
    new.last_sign_in_at,
    now()
  )
  on conflict (user_id) do update
    set email           = excluded.email,
        status          = excluded.status,
        last_sign_in_at = excluded.last_sign_in_at,
        updated_at      = now();
  return new;
end;
$$;

create or replace function public.purge_user_auth_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.user_auth_snapshot where user_id = old.id;
  return old;
end;
$$;

create trigger trg_sync_user_auth_snapshot
  after insert or update on auth.users
  for each row execute function public.sync_user_auth_snapshot();

create trigger trg_purge_user_auth_snapshot
  after delete on auth.users
  for each row execute function public.purge_user_auth_snapshot();
```

---

### A3. Row Level Security Policies

```sql
-- =============================================================================
-- Enable RLS on all tables
-- =============================================================================
alter table public.accounts                  enable row level security;
alter table public.brand_profile             enable row level security;
alter table public.posting_defaults          enable row level security;
alter table public.social_connections        enable row level security;
alter table public.media_assets              enable row level security;
alter table public.media_renditions          enable row level security;
alter table public.campaigns                 enable row level security;
alter table public.content_items             enable row level security;
alter table public.content_variants          enable row level security;
alter table public.content_media_attachments enable row level security;
alter table public.content_item_versions     enable row level security;
alter table public.publish_jobs              enable row level security;
alter table public.notifications             enable row level security;
alter table public.analytics_snapshots       enable row level security;
alter table public.audit_log                 enable row level security;
alter table public.link_in_bio_profiles      enable row level security;
alter table public.link_in_bio_tiles         enable row level security;
alter table public.user_auth_snapshot        enable row level security;
alter table public.management_app_connections enable row level security;
alter table public.worker_heartbeats         enable row level security;

-- Force RLS so service_role explicit grants work correctly
alter table public.accounts                  force row level security;
alter table public.brand_profile             force row level security;
alter table public.posting_defaults          force row level security;
alter table public.social_connections        force row level security;
alter table public.media_assets              force row level security;
alter table public.media_renditions          force row level security;
alter table public.campaigns                 force row level security;
alter table public.content_items             force row level security;
alter table public.content_variants          force row level security;
alter table public.content_media_attachments force row level security;
alter table public.content_item_versions     force row level security;
alter table public.publish_jobs              force row level security;
alter table public.notifications             force row level security;
alter table public.analytics_snapshots       force row level security;
alter table public.audit_log                 force row level security;
alter table public.link_in_bio_profiles      force row level security;
alter table public.link_in_bio_tiles         force row level security;
alter table public.user_auth_snapshot        force row level security;
alter table public.management_app_connections force row level security;
alter table public.worker_heartbeats         force row level security;

-- =============================================================================
-- accounts
-- =============================================================================
create policy "Owner access"
  on public.accounts for all
  using (public.current_account_id() = id)
  with check (public.current_account_id() = id);

-- =============================================================================
-- brand_profile
-- =============================================================================
create policy "Owner access"
  on public.brand_profile for all
  using (public.current_account_id() = account_id)
  with check (public.current_account_id() = account_id);

-- =============================================================================
-- posting_defaults
-- =============================================================================
create policy "Owner access"
  on public.posting_defaults for all
  using (public.current_account_id() = account_id)
  with check (public.current_account_id() = account_id);

-- =============================================================================
-- social_connections
-- =============================================================================
create policy "Owner access"
  on public.social_connections for all
  using (public.current_account_id() = account_id)
  with check (public.current_account_id() = account_id);

-- =============================================================================
-- media_assets
-- =============================================================================
create policy "Owner access"
  on public.media_assets for all
  using (public.current_account_id() = account_id)
  with check (public.current_account_id() = account_id);

-- =============================================================================
-- media_renditions
--    Join through media_assets to reach account_id.
-- =============================================================================
create policy "Owner access via media_assets"
  on public.media_renditions for all
  using (
    exists (
      select 1
      from public.media_assets ma
      where ma.id = media_asset_id
        and ma.account_id = public.current_account_id()
    )
  )
  with check (
    exists (
      select 1
      from public.media_assets ma
      where ma.id = media_asset_id
        and ma.account_id = public.current_account_id()
    )
  );

-- =============================================================================
-- campaigns
-- =============================================================================
create policy "Owner access"
  on public.campaigns for all
  using (public.current_account_id() = account_id)
  with check (public.current_account_id() = account_id);

-- =============================================================================
-- content_items
-- =============================================================================
create policy "Owner access"
  on public.content_items for all
  using (public.current_account_id() = account_id)
  with check (public.current_account_id() = account_id);

-- =============================================================================
-- content_variants
--    Join through content_items for account_id.
-- =============================================================================
create policy "Owner access via content_items"
  on public.content_variants for all
  using (
    exists (
      select 1
      from public.content_items ci
      where ci.id = content_item_id
        and ci.account_id = public.current_account_id()
    )
  )
  with check (
    exists (
      select 1
      from public.content_items ci
      where ci.id = content_item_id
        and ci.account_id = public.current_account_id()
    )
  );

-- =============================================================================
-- content_media_attachments
--    Join through content_variants → content_items for account_id.
-- =============================================================================
create policy "Owner access via content_variants"
  on public.content_media_attachments for all
  using (
    exists (
      select 1
      from public.content_variants cv
      join public.content_items ci on ci.id = cv.content_item_id
      where cv.id = variant_id
        and ci.account_id = public.current_account_id()
    )
  )
  with check (
    exists (
      select 1
      from public.content_variants cv
      join public.content_items ci on ci.id = cv.content_item_id
      where cv.id = variant_id
        and ci.account_id = public.current_account_id()
    )
  );

-- =============================================================================
-- content_item_versions
--    Join through content_items for account_id.
-- =============================================================================
create policy "Owner can select via content_items"
  on public.content_item_versions for select
  using (
    exists (
      select 1
      from public.content_items ci
      where ci.id = content_item_id
        and ci.account_id = public.current_account_id()
    )
  );

-- Service role inserts; owner cannot INSERT versions directly.
create policy "Service role insert"
  on public.content_item_versions for insert
  with check (auth.role() = 'service_role');

-- =============================================================================
-- publish_jobs
--    Join through content_items for account_id.
--    Owner can SELECT and UPDATE (for retry/cancel); INSERT is service role only.
-- =============================================================================
create policy "Owner can select via content_items"
  on public.publish_jobs for select
  using (
    exists (
      select 1
      from public.content_items ci
      where ci.id = content_item_id
        and ci.account_id = public.current_account_id()
    )
  );

create policy "Service role full access"
  on public.publish_jobs for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- =============================================================================
-- notifications
-- =============================================================================
create policy "Owner access"
  on public.notifications for all
  using (public.current_account_id() = account_id)
  with check (public.current_account_id() = account_id);

-- =============================================================================
-- analytics_snapshots
--    Join through content_items for account_id.
-- =============================================================================
create policy "Owner can select via content_items"
  on public.analytics_snapshots for select
  using (public.current_account_id() = account_id);

create policy "Service role insert"
  on public.analytics_snapshots for insert
  with check (auth.role() = 'service_role');

-- =============================================================================
-- audit_log
--    Owner SELECT only; all writes via service role.
-- =============================================================================
create policy "Owner can select own rows"
  on public.audit_log for select
  using (public.current_account_id() = account_id);

create policy "Service role insert"
  on public.audit_log for insert
  with check (auth.role() = 'service_role');

-- =============================================================================
-- link_in_bio_profiles
-- =============================================================================
create policy "Owner access or service role"
  on public.link_in_bio_profiles for all
  using (auth.role() = 'service_role' or account_id = public.current_account_id())
  with check (auth.role() = 'service_role' or account_id = public.current_account_id());

-- =============================================================================
-- link_in_bio_tiles
-- =============================================================================
create policy "Owner access or service role"
  on public.link_in_bio_tiles for all
  using (auth.role() = 'service_role' or account_id = public.current_account_id())
  with check (auth.role() = 'service_role' or account_id = public.current_account_id());

-- =============================================================================
-- user_auth_snapshot
-- =============================================================================
create policy "Authenticated or service role can read"
  on public.user_auth_snapshot for select
  to authenticated, service_role
  using (true);

-- =============================================================================
-- management_app_connections (service role only)
-- =============================================================================
create policy "Service role only"
  on public.management_app_connections for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- =============================================================================
-- worker_heartbeats (service role only)
-- =============================================================================
create policy "Service role only"
  on public.worker_heartbeats for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
```

---

### A4. Storage Buckets

Supabase Storage bucket definitions and their Storage RLS policies.

```sql
-- =============================================================================
-- Storage Buckets
-- (Run via Supabase dashboard or supabase CLI storage commands)
-- =============================================================================

-- media-originals: private; original uploads from the owner.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media-originals',
  'media-originals',
  false,
  104857600,  -- 100 MB
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm']
)
on conflict (id) do nothing;

-- media-renditions: private; derivative files produced by workers.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media-renditions',
  'media-renditions',
  false,
  52428800,   -- 50 MB
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do nothing;

-- link-in-bio-avatars: public; served directly without signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'link-in-bio-avatars',
  'link-in-bio-avatars',
  true,
  5242880,    -- 5 MB
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do nothing;

-- =============================================================================
-- Storage RLS policies
-- =============================================================================

-- media-originals: owner only
create policy "Owner upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'media-originals'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Owner read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'media-originals'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Owner delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'media-originals'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Service role full access to originals"
  on storage.objects for all
  to service_role
  using (bucket_id = 'media-originals')
  with check (bucket_id = 'media-originals');

-- media-renditions: owner read; worker (service role) write
create policy "Owner read renditions"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'media-renditions'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Service role full access to renditions"
  on storage.objects for all
  to service_role
  using (bucket_id = 'media-renditions')
  with check (bucket_id = 'media-renditions');

-- link-in-bio-avatars: public read, owner write
create policy "Public read avatars"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'link-in-bio-avatars');

create policy "Owner upload avatar"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'link-in-bio-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Owner delete avatar"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'link-in-bio-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

---

## PART B: Environment Configuration

### B1. Environment Variables (Complete Inventory)

| Variable | Description | Source | Build-time? | Runtime? | Environments |
|---|---|---|---|---|---|
| **Supabase** | | | | | |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project REST URL | Supabase dashboard | Yes | Yes | All |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key (safe to expose) | Supabase dashboard | Yes | Yes | All |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server only, never client) | Supabase dashboard | No | Yes | All |
| `SUPABASE_DB_URL` | Direct Postgres connection string (migrations only) | Supabase dashboard → Settings → Database | No | No (CI only) | CI |
| **Auth / OAuth** | | | | | |
| `NEXT_PUBLIC_FACEBOOK_APP_ID` | Facebook App ID for OAuth JS SDK | Meta Developer Console | Yes | Yes | All |
| `FACEBOOK_APP_SECRET` | Facebook App Secret for token exchange | Meta Developer Console | No | Yes | All |
| `INSTAGRAM_APP_ID` | Instagram App ID (if separate from Facebook) | Meta Developer Console | No | Yes | All |
| `INSTAGRAM_APP_SECRET` | Instagram App Secret | Meta Developer Console | No | Yes | All |
| `INSTAGRAM_VERIFY_TOKEN` | Webhook verification token | Self-generated secret | No | Yes | All |
| `GOOGLE_MY_BUSINESS_CLIENT_ID` | GBP OAuth client ID | Google Cloud Console | No | Yes | All |
| `GOOGLE_MY_BUSINESS_CLIENT_SECRET` | GBP OAuth client secret | Google Cloud Console | No | Yes | All |
| **Token encryption** | | | | | |
| `TOKEN_ENCRYPTION_SECRET` | 32-byte hex key for AES-256-GCM token encryption | `openssl rand -hex 32` | No | Yes | All |
| **OpenAI** | | | | | |
| `OPENAI_API_KEY` | OpenAI API key | platform.openai.com | No | Yes | All |
| `OPENAI_ORG_ID` | OpenAI organisation ID (optional but recommended) | platform.openai.com | No | Yes | All |
| **QStash** | | | | | |
| `QSTASH_URL` | QStash publish endpoint (usually `https://qstash.upstash.io`) | Upstash console | No | Yes | All |
| `QSTASH_TOKEN` | QStash bearer token for publishing messages | Upstash console | No | Yes | All |
| `QSTASH_CURRENT_SIGNING_KEY` | Current signing key for verifying incoming QStash requests | Upstash console | No | Yes | All |
| `QSTASH_NEXT_SIGNING_KEY` | Next signing key (for zero-downtime key rotation) | Upstash console | No | Yes | All |
| **Resend** | | | | | |
| `RESEND_API_KEY` | Resend email API key | resend.com | No | Yes | All |
| `RESEND_FROM` | From address for transactional emails | resend.com verified domain | No | Yes | All |
| **Axiom** | | | | | |
| `AXIOM_DATASET` | Axiom dataset name for structured logs | axiom.co | No | Yes | All |
| `AXIOM_TOKEN` | Axiom API ingest token | axiom.co | No | Yes | All |
| **App config** | | | | | |
| `NEXT_PUBLIC_APP_URL` | Canonical URL of the deployed app | Vercel env / manual | Yes | Yes | All |
| `META_GRAPH_VERSION` | Facebook/Instagram Graph API version (e.g. `v24.0`) | Hardcoded / env | No | Yes | All |
| `CRON_SECRET` | Shared secret for authenticating internal cron-style API routes | `openssl rand -hex 32` | No | Yes | All |
| `ALERTS_SECRET` | Shared secret for internal alert endpoints | `openssl rand -hex 32` | No | Yes | All |
| `ENABLE_CONNECTION_DIAGNOSTICS` | Feature flag: `true` enables extra OAuth debug logging | Manual | No | Yes | Dev / Staging |

**Key principles:**
- `NEXT_PUBLIC_*` variables are embedded in the client bundle at build time. Never put secrets here.
- `TOKEN_ENCRYPTION_SECRET` must be 32 bytes (64 hex chars). Rotation requires re-encrypting all stored tokens — plan carefully.
- Staging and production must have **separate** values for every secret and every Supabase key.

---

### B2. Environment Variable Validation

Complete `src/env.ts` using `@t3-oss/env-nextjs` for compile-time and runtime validation.

```typescript
// src/env.ts
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Server-side environment variables.
   * These are never exposed to the browser.
   */
  server: {
    // Supabase
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SUPABASE_DB_URL: z.string().url().optional(), // CI migrations only

    // Token encryption — must be 64 hex chars (32 bytes)
    TOKEN_ENCRYPTION_SECRET: z
      .string()
      .regex(/^[0-9a-f]{64}$/i, "Must be 64 hex characters (openssl rand -hex 32)"),

    // Social OAuth
    FACEBOOK_APP_SECRET: z.string().min(1),
    INSTAGRAM_APP_ID: z.string().min(1),
    INSTAGRAM_APP_SECRET: z.string().min(1),
    INSTAGRAM_VERIFY_TOKEN: z.string().min(1),
    GOOGLE_MY_BUSINESS_CLIENT_ID: z.string().min(1),
    GOOGLE_MY_BUSINESS_CLIENT_SECRET: z.string().min(1),

    // OpenAI
    OPENAI_API_KEY: z.string().startsWith("sk-"),
    OPENAI_ORG_ID: z.string().optional(),

    // QStash
    QSTASH_URL: z.string().url(),
    QSTASH_TOKEN: z.string().min(1),
    QSTASH_CURRENT_SIGNING_KEY: z.string().min(1),
    QSTASH_NEXT_SIGNING_KEY: z.string().min(1),

    // Resend
    RESEND_API_KEY: z.string().startsWith("re_"),
    RESEND_FROM: z.string().email(),

    // Axiom
    AXIOM_DATASET: z.string().min(1),
    AXIOM_TOKEN: z.string().min(1),

    // Security
    CRON_SECRET: z.string().min(32),
    ALERTS_SECRET: z.string().min(32),

    // Graph API version
    META_GRAPH_VERSION: z.string().default("v24.0"),

    // Feature flags
    ENABLE_CONNECTION_DIAGNOSTICS: z
      .enum(["true", "false", "1", "0"])
      .optional()
      .default("false"),

    // Node environment
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  },

  /**
   * Client-side environment variables (embedded in bundle at build time).
   * MUST be prefixed with NEXT_PUBLIC_.
   */
  client: {
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    NEXT_PUBLIC_APP_URL: z.string().url(),
    NEXT_PUBLIC_FACEBOOK_APP_ID: z.string().min(1),
    NEXT_PUBLIC_META_GRAPH_VERSION: z.string().default("v24.0"),
  },

  /**
   * Runtime environment variable destructuring.
   * Required by @t3-oss/env-nextjs to access process.env correctly.
   */
  runtimeEnv: {
    // Server
    SUPABASE_SERVICE_ROLE_KEY:          process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_DB_URL:                    process.env.SUPABASE_DB_URL,
    TOKEN_ENCRYPTION_SECRET:            process.env.TOKEN_ENCRYPTION_SECRET,
    FACEBOOK_APP_SECRET:                process.env.FACEBOOK_APP_SECRET,
    INSTAGRAM_APP_ID:                   process.env.INSTAGRAM_APP_ID,
    INSTAGRAM_APP_SECRET:               process.env.INSTAGRAM_APP_SECRET,
    INSTAGRAM_VERIFY_TOKEN:             process.env.INSTAGRAM_VERIFY_TOKEN,
    GOOGLE_MY_BUSINESS_CLIENT_ID:       process.env.GOOGLE_MY_BUSINESS_CLIENT_ID,
    GOOGLE_MY_BUSINESS_CLIENT_SECRET:   process.env.GOOGLE_MY_BUSINESS_CLIENT_SECRET,
    OPENAI_API_KEY:                     process.env.OPENAI_API_KEY,
    OPENAI_ORG_ID:                      process.env.OPENAI_ORG_ID,
    QSTASH_URL:                         process.env.QSTASH_URL,
    QSTASH_TOKEN:                       process.env.QSTASH_TOKEN,
    QSTASH_CURRENT_SIGNING_KEY:         process.env.QSTASH_CURRENT_SIGNING_KEY,
    QSTASH_NEXT_SIGNING_KEY:            process.env.QSTASH_NEXT_SIGNING_KEY,
    RESEND_API_KEY:                     process.env.RESEND_API_KEY,
    RESEND_FROM:                        process.env.RESEND_FROM,
    AXIOM_DATASET:                      process.env.AXIOM_DATASET,
    AXIOM_TOKEN:                        process.env.AXIOM_TOKEN,
    CRON_SECRET:                        process.env.CRON_SECRET,
    ALERTS_SECRET:                      process.env.ALERTS_SECRET,
    META_GRAPH_VERSION:                 process.env.META_GRAPH_VERSION,
    ENABLE_CONNECTION_DIAGNOSTICS:      process.env.ENABLE_CONNECTION_DIAGNOSTICS,
    NODE_ENV:                           process.env.NODE_ENV,
    // Client
    NEXT_PUBLIC_SUPABASE_URL:           process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY:      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL:                process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_FACEBOOK_APP_ID:        process.env.NEXT_PUBLIC_FACEBOOK_APP_ID,
    NEXT_PUBLIC_META_GRAPH_VERSION:     process.env.NEXT_PUBLIC_META_GRAPH_VERSION,
  },

  /**
   * Skip validation in environments that don't have all vars
   * (e.g. Edge Runtime during local dev before env is set).
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,

  /**
   * Treat empty strings as undefined so required fields fail properly.
   */
  emptyStringAsUndefined: true,
});

// Convenience re-exports for ergonomic access
export const serverEnv = env;
export const clientEnv = env;
```

**Install the dependency:**
```bash
pnpm add @t3-oss/env-nextjs
```

---

## PART C: Repository Setup

### C1. New Repository Structure

File tree of root-level configuration files. The full `src/` tree is in `02-nextjs-architecture.md`.

```
cheersai-rebuild/
├── .env.local.example
├── .eslintrc.json                   (or eslint.config.mjs for flat config)
├── .github/
│   └── workflows/
│       └── ci.yml
├── .gitignore
├── next.config.ts
├── package.json
├── postcss.config.mjs
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   │   └── 0001_baseline.sql       (Part A DDL, triggers, RLS, buckets)
│   └── seed.sql
├── tailwind.config.ts               (minimal with v4 — see note below)
├── tsconfig.json
└── vitest.config.ts
```

**Note on Tailwind v4:** Tailwind v4 reads configuration from CSS (`@import "tailwindcss"`) rather than `tailwind.config.ts`. The config file is only needed if you use the compatibility `@tailwindcss/vite` plugin or need to export tokens for use in JS. Keep an empty/minimal `tailwind.config.ts` for IDE tooling only.

---

#### `package.json`

```json
{
  "name": "cheersai",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "eslint src",
    "lint:ci": "eslint src --max-warnings=0",
    "typecheck": "tsc --noEmit",
    "test": "vitest",
    "test:ci": "CI=1 vitest run --reporter=verbose",
    "test:coverage": "vitest run --coverage",
    "ci:verify": "pnpm lint:ci && pnpm typecheck && pnpm test:ci && pnpm build",
    "db:push": "supabase db push",
    "db:reset": "supabase db reset",
    "db:types": "supabase gen types typescript --local > src/lib/supabase/database.types.ts"
  },
  "dependencies": {
    "@hookform/resolvers": "^5.0.0",
    "@radix-ui/react-dialog": "^1.1.0",
    "@radix-ui/react-label": "^2.1.0",
    "@radix-ui/react-separator": "^1.1.0",
    "@radix-ui/react-slot": "^1.2.0",
    "@radix-ui/react-tooltip": "^1.2.0",
    "@supabase/ssr": "^0.8.0",
    "@supabase/supabase-js": "^2.89.0",
    "@t3-oss/env-nextjs": "^0.11.0",
    "@tanstack/react-query": "^5.90.0",
    "@tanstack/react-query-devtools": "^5.90.0",
    "@upstash/qstash": "^2.7.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "framer-motion": "^12.0.0",
    "lucide-react": "^0.460.0",
    "luxon": "^3.7.0",
    "next": "16.1.0",
    "openai": "^4.67.0",
    "react": "19.2.0",
    "react-dom": "19.2.0",
    "react-hook-form": "^7.69.0",
    "resend": "^4.0.0",
    "tailwind-merge": "^3.4.0",
    "tailwindcss-animate": "^1.0.7",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.0.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.0.0",
    "@tailwindcss/postcss": "^4.0.0",
    "@types/luxon": "^3.7.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "@vitest/coverage-v8": "^3.0.0",
    "eslint": "^9.0.0",
    "eslint-config-next": "16.1.0",
    "jsdom": "^25.0.0",
    "tailwindcss": "^4.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  }
}
```

**Key differences from the existing repo:**
- `"dev": "next dev --turbopack"` — Turbopack enabled; `--webpack` flag removed from build.
- `@upstash/qstash` added as a dependency.
- `@t3-oss/env-nextjs` replaces the hand-rolled env validation.
- `@testing-library/*` and `@vitest/coverage-v8` added for proper test infrastructure.
- Zod pinned to v3 (v4 is a significant API change; update deliberately when ready).

---

#### `next.config.ts`

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Strict TypeScript checking at build time
  typescript: {
    ignoreBuildErrors: false,
  },

  // Zero ESLint warnings allowed in CI
  eslint: {
    ignoreDuringBuilds: false,
  },

  // Security headers applied to all routes
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Prevent search engine indexing (private single-owner app)
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          // Content security hardening
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },

  // Allow Supabase storage domains for images
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/**",
      },
    ],
  },
};

export default nextConfig;
```

---

#### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

**Notable strict flags beyond `"strict": true`:**
- `noUncheckedIndexedAccess`: array indexing returns `T | undefined`, preventing off-by-one crashes.
- `exactOptionalPropertyTypes`: distinguishes `key?: T` from `key: T | undefined`.
- `noImplicitOverride`: forces explicit `override` keyword in class inheritance.

---

#### `tailwind.config.ts`

With Tailwind v4, CSS-first configuration is the primary approach. This file exists only for IDE tooling compatibility.

```typescript
// tailwind.config.ts
// Tailwind v4 is configured via CSS (@import "tailwindcss" in globals.css).
// This file exists only for editor tooling. Do not add theme config here.
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/app/**/*.{ts,tsx}",
  ],
};

export default config;
```

---

#### `.env.local.example`

```bash
# =============================================================================
# CheersAI — Local Development Environment Variables
# Copy to .env.local and fill in real values.
# NEVER commit .env.local to git.
# =============================================================================

# --- Supabase ----------------------------------------------------------------
NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your-local-anon-key-from-supabase-start"
SUPABASE_SERVICE_ROLE_KEY="your-local-service-role-key-from-supabase-start"

# --- App URL -----------------------------------------------------------------
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# --- Token Encryption --------------------------------------------------------
# Generate with: openssl rand -hex 32
TOKEN_ENCRYPTION_SECRET="replace-with-64-hex-chars"

# --- Facebook / Instagram OAuth ----------------------------------------------
NEXT_PUBLIC_FACEBOOK_APP_ID="your-facebook-app-id"
FACEBOOK_APP_SECRET="your-facebook-app-secret"
INSTAGRAM_APP_ID="your-instagram-app-id"
INSTAGRAM_APP_SECRET="your-instagram-app-secret"
INSTAGRAM_VERIFY_TOKEN="your-webhook-verify-token"

# --- Google Business Profile OAuth -------------------------------------------
GOOGLE_MY_BUSINESS_CLIENT_ID="your-gbp-client-id"
GOOGLE_MY_BUSINESS_CLIENT_SECRET="your-gbp-client-secret"

# --- OpenAI ------------------------------------------------------------------
OPENAI_API_KEY="sk-your-openai-key"
OPENAI_ORG_ID=""

# --- QStash ------------------------------------------------------------------
# For local dev use the QStash dev server or ngrok tunnel (see DevOps doc C5)
QSTASH_URL="https://qstash.upstash.io"
QSTASH_TOKEN="your-qstash-token"
QSTASH_CURRENT_SIGNING_KEY="sig_your-current-key"
QSTASH_NEXT_SIGNING_KEY="sig_your-next-key"

# --- Resend ------------------------------------------------------------------
RESEND_API_KEY="re_your-resend-key"
RESEND_FROM="CheersAI <notifications@yourdomain.com>"

# --- Axiom -------------------------------------------------------------------
AXIOM_DATASET="cheersai-dev"
AXIOM_TOKEN="your-axiom-token"

# --- Security ----------------------------------------------------------------
# Generate with: openssl rand -hex 32
CRON_SECRET="replace-with-random-secret"
ALERTS_SECRET="replace-with-random-secret"

# --- Graph API ---------------------------------------------------------------
META_GRAPH_VERSION="v24.0"
NEXT_PUBLIC_META_GRAPH_VERSION="v24.0"

# --- Feature Flags -----------------------------------------------------------
ENABLE_CONNECTION_DIAGNOSTICS="false"
```

---

#### `supabase/config.toml`

```toml
project_id = "cheersai"

[api]
enabled = true
port = 54321
schemas = ["public", "storage"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = 54322
shadow_port = 54320
major_version = 15

[studio]
enabled = true
port = 54323

[inbucket]
enabled = true
port = 54324

[storage]
enabled = true
# 100 MB default upload size limit
file_size_limit = "100MiB"

[auth]
enabled = true
site_url = "http://localhost:3000"
additional_redirect_urls = [
  "http://localhost:3000/auth/callback",
  "http://localhost:3000/auth/v1/callback"
]
jwt_expiry = 3600
enable_refresh_token_rotation = true
refresh_token_reuse_interval = 10

[auth.email]
enable_signup = true
double_confirm_changes = false
enable_confirmations = false   # disabled for single-owner dev convenience

[auth.sms]
enable_signup = false

[auth.external.google]
enabled = false   # GBP uses server-side OAuth, not Supabase social login

[auth.external.facebook]
enabled = false   # Facebook uses server-side OAuth, not Supabase social login

[realtime]
enabled = true

[functions."publish-worker"]
verify_jwt = false   # QStash signs requests; JWT verification handled in middleware

[functions."media-derivatives"]
verify_jwt = false

[functions."materialise-weekly"]
verify_jwt = false
```

---

#### `vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", ".next", "e2e"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "src/test/**",
        "src/**/*.d.ts",
        "src/app/**/page.tsx",    // Page components tested via e2e
        "src/app/**/layout.tsx",
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
```

Create the Vitest setup file at `src/test/setup.ts`:

```typescript
// src/test/setup.ts
import "@testing-library/jest-dom";
```

---

### C2. CI/CD Pipeline

#### `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

env:
  # Prevents interactive prompts in scripts
  CI: true
  # Skip env validation in CI build — real vars are injected per step below
  SKIP_ENV_VALIDATION: true
  # pnpm caching
  PNPM_VERSION: "9"

jobs:
  # ============================================================
  # 1. Install & cache dependencies
  # ============================================================
  install:
    name: Install Dependencies
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}

      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "pnpm"

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

  # ============================================================
  # 2. Type check
  # ============================================================
  typecheck:
    name: Type Check
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "pnpm"
      - run: pnpm install --frozen-lockfile
      - name: TypeScript check
        run: pnpm typecheck

  # ============================================================
  # 3. Lint
  # ============================================================
  lint:
    name: Lint
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "pnpm"
      - run: pnpm install --frozen-lockfile
      - name: ESLint (zero warnings)
        run: pnpm lint:ci

  # ============================================================
  # 4. Unit + integration tests with coverage
  # ============================================================
  test:
    name: Tests
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "pnpm"
      - run: pnpm install --frozen-lockfile
      - name: Run tests with coverage
        run: pnpm test:coverage
      - name: Upload coverage report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage-report
          path: coverage/
          retention-days: 14

  # ============================================================
  # 5. Build
  #    Uses CI-safe placeholder env vars. Real secrets are never
  #    needed at build time for App Router server components.
  # ============================================================
  build:
    name: Build
    needs: [typecheck, lint, test]
    runs-on: ubuntu-latest
    env:
      SKIP_ENV_VALIDATION: true
      NEXT_PUBLIC_SUPABASE_URL: https://placeholder.supabase.co
      NEXT_PUBLIC_SUPABASE_ANON_KEY: placeholder-anon-key
      NEXT_PUBLIC_APP_URL: https://placeholder.cheersai.app
      NEXT_PUBLIC_FACEBOOK_APP_ID: "000000000000000"
      NEXT_PUBLIC_META_GRAPH_VERSION: v24.0
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "pnpm"
      - run: pnpm install --frozen-lockfile
      - name: Next.js build
        run: pnpm build
      - name: Upload build artifact
        uses: actions/upload-artifact@v4
        with:
          name: nextjs-build
          path: .next/
          retention-days: 3

  # ============================================================
  # 6. Database migration dry-run (on PRs only)
  #    Validates that the migration file is syntactically valid
  #    without touching the real staging DB.
  # ============================================================
  migration-check:
    name: Migration Syntax Check
    needs: install
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - name: Start local Supabase
        run: supabase start --exclude studio,inbucket,imgproxy,edge-runtime,logflare,vector
      - name: Verify migrations apply cleanly
        run: supabase db reset
      - name: Generate types (smoke check)
        run: supabase gen types typescript --local > /tmp/database.types.ts
      - name: Stop local Supabase
        run: supabase stop
        if: always()
```

**All six jobs must pass before a PR can be merged.** Configure this as a branch protection rule on `main` in GitHub repository settings → Branches → Require status checks.

---

### C3. Deployment Strategy

#### Vercel project configuration

| Setting | Value |
|---|---|
| Framework preset | Next.js |
| Build command | `pnpm build` |
| Install command | `pnpm install --frozen-lockfile` |
| Output directory | `.next` (auto-detected) |
| Root directory | `/` (repo root) |
| Node.js version | 22.x |

#### Environment variable setup per environment

Vercel has three environment scopes: **Development**, **Preview**, and **Production**.

| Variable category | Development | Preview | Production |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Local (`127.0.0.1:54321`) | Staging Supabase URL | Production Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Local anon key | Staging anon key | Production anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Local service role key | Staging service role key | Production service role key |
| `TOKEN_ENCRYPTION_SECRET` | Dev key (can be reused in staging) | Staging key | **Production key — never share** |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Vercel preview URL (`https://*.vercel.app`) | `https://app.cheersai.app` |
| All other secrets | Dev/test values | Staging values | Production values |

Set variables via Vercel dashboard (Settings → Environment Variables) or Vercel CLI:
```bash
vercel env add TOKEN_ENCRYPTION_SECRET production
```

#### Preview deployments

Every PR branch gets a Vercel preview deployment automatically. Preview deployments connect to the **staging Supabase project** (not local, not production). This means:
- Preview URLs have fully functional auth, DB, and storage.
- Staging DB must have seed data (see C4).
- Staging social OAuth app credentials must whitelist `*.vercel.app` redirect URIs.

**Important:** Never use production Supabase credentials in preview environments.

#### Production deployment: recommendation

**Recommendation: auto-deploy from `main`, but with a manual migration gate.**

Rationale: For a single-developer project, fully manual deploys add friction with no meaningful safety benefit. However, database migrations must run **before** the new code lands in production to avoid schema mismatches. The workflow is:

1. PR is reviewed and merged to `main`.
2. CI runs on `main` (all checks pass — build artefact uploaded).
3. **Before** Vercel deploys: developer runs `supabase db push --project-ref <prod-ref>` from local or CI.
4. Vercel auto-deploys from `main` once push succeeds.

To enforce this, configure Vercel to use a **Deploy Hook** triggered by a CI step rather than automatic Git integration. The CI `build` job uploads the build artefact; a separate `deploy-production` job (manual trigger or runs after `migration-check` passes on main) calls the hook.

Alternatively, for full automation, add a `deploy` job to `ci.yml` that:
1. Runs `supabase db push` with production credentials (stored as GitHub secrets).
2. On success, triggers the Vercel deploy hook.

---

### C4. Supabase Project Setup

#### Two Supabase projects

| Project | Purpose |
|---|---|
| `cheersai-staging` | Preview deployments, PR testing, QA |
| `cheersai-production` | Live production; never used for testing |

The two projects are completely independent: separate Postgres instances, separate Auth configurations, separate Storage buckets, separate API keys.

#### Local development

```bash
# Start local Supabase stack (Postgres, Auth, Storage, Studio at localhost:54323)
supabase start

# Apply all migrations to local DB
supabase db reset   # drops and recreates local DB, applies all migrations in order

# Generate TypeScript types from local schema
pnpm db:types

# Stop local stack
supabase stop
```

Local Supabase listens on:
- API: `http://127.0.0.1:54321`
- Studio: `http://127.0.0.1:54323`
- DB: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`

#### Migration workflow

1. Write new migration file: `supabase/migrations/<timestamp>_<description>.sql`
   - Timestamp format: `YYYYMMDDHHMMSS` (e.g. `20260310120000`)
2. Test locally: `supabase db reset` (applies all migrations from scratch).
3. Commit the migration file with the feature branch.
4. CI runs `supabase db reset` in the migration-check job to validate syntax.
5. Merge to `main`.
6. Run `supabase db push --project-ref <staging-ref>` for staging.
7. Run `supabase db push --project-ref <prod-ref>` for production (before Vercel deploys).

Never edit or delete existing migration files. Only add new ones.

#### Seed data (`supabase/seed.sql`)

```sql
-- supabase/seed.sql
-- Applied automatically by `supabase db reset` for local development.
-- Also manually applied to staging after first db reset.
-- Do NOT apply to production.

-- Create a test auth user (password: cheersai-test-2026)
insert into auth.users (
  id,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data
) values (
  'a1b2c3d4-0000-0000-0000-000000000001',
  'dev@cheersai.test',
  crypt('cheersai-test-2026', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{}'::jsonb
)
on conflict (id) do nothing;

-- account row (mirrors auth user id)
insert into public.accounts (id, email, display_name)
values (
  'a1b2c3d4-0000-0000-0000-000000000001',
  'dev@cheersai.test',
  'Dev Owner'
)
on conflict (id) do nothing;

-- brand_profile (auto-created by trigger, but seed explicit values)
update public.brand_profile set
  tone_formal     = 0.40,
  tone_playful    = 0.60,
  key_phrases     = array['quality first', 'locally sourced'],
  default_hashtags = array['#cheers', '#localbusiness']
where account_id = 'a1b2c3d4-0000-0000-0000-000000000001';

-- stub social_connections (tokens are fake; sufficient for UI rendering)
insert into public.social_connections (account_id, provider, status, display_name)
values
  ('a1b2c3d4-0000-0000-0000-000000000001', 'facebook',  'needs_action', 'Test Facebook Page'),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'instagram', 'needs_action', 'Test Instagram Account'),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'gbp',       'needs_action', 'Test Business')
on conflict do nothing;
```

#### Backup strategy

- **Supabase automatic backups**: Supabase Pro tier provides daily point-in-time recovery (PITR) and 7-day backup retention. Enable on the production project.
- **Pre-migration snapshot**: Before any production migration, take a manual backup via Supabase dashboard (Database → Backups → Create backup) or via `pg_dump`:
  ```bash
  pg_dump "$(supabase status --project-ref <prod-ref> --output json | jq -r .db_url)" \
    > backups/pre-migration-$(date +%Y%m%d-%H%M%S).sql
  ```
- Store manual backups in a private S3 bucket or similar; retain for 30 days minimum.

---

### C5. QStash Setup

QStash replaces Vercel Cron for all background job triggering. It provides:
- Guaranteed delivery with retries.
- Signed HTTP requests (HMAC-SHA256) verifiable by the receiving endpoint.
- Schedules (cron-style) and immediate message publishing.

#### Queue definitions

There is no "queue" concept in QStash — messages are published to HTTP endpoints. The queues are logical groupings by endpoint URL:

| Logical queue | Endpoint | Trigger |
|---|---|---|
| Publish worker | `POST /api/worker/publish` | On-demand (content scheduled) + cron fallback |
| Token health check | `POST /api/worker/token-health` | Cron: `0 2 * * *` (02:00 UTC daily) |
| Weekly materialiser | `POST /api/worker/materialise-weekly` | Cron: `0 6 * * 1` (06:00 UTC every Monday) |

#### QStash schedule registration

Schedules are registered once via the Upstash console or CLI. They do not live in code or config files (QStash holds them server-side):

```bash
# Install QStash CLI
pnpm dlx @upstash/qstash-cli

# Register daily token health check
qstash schedule create \
  --cron "0 2 * * *" \
  --url "https://app.cheersai.app/api/worker/token-health" \
  --header "Authorization: Bearer $CRON_SECRET"

# Register weekly materialiser
qstash schedule create \
  --cron "0 6 * * 1" \
  --url "https://app.cheersai.app/api/worker/materialise-weekly" \
  --header "Authorization: Bearer $CRON_SECRET"
```

The publish worker endpoint is called on-demand by server actions (when content is scheduled) and also triggered by a QStash cron every 2 minutes as a polling fallback.

#### Signed request verification middleware

QStash signs every request with the current and next signing keys. Verify this signature in a shared middleware before processing any worker endpoint.

```typescript
// src/lib/qstash/verify.ts
import { Receiver } from "@upstash/qstash";
import { env } from "@/env";

let _receiver: Receiver | null = null;

function getReceiver(): Receiver {
  if (!_receiver) {
    _receiver = new Receiver({
      currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY,
    });
  }
  return _receiver;
}

/**
 * Verifies that an incoming request is signed by QStash.
 * Returns true if valid, throws or returns false if invalid.
 *
 * Usage in an App Router Route Handler:
 *
 *   export async function POST(req: Request) {
 *     await verifyQStashSignature(req);
 *     // ... process job
 *   }
 */
export async function verifyQStashSignature(req: Request): Promise<void> {
  const signature = req.headers.get("upstash-signature");
  if (!signature) {
    throw new Response("Missing QStash signature", { status: 401 });
  }

  const body = await req.text();

  const isValid = await getReceiver().verify({
    signature,
    body,
  });

  if (!isValid) {
    throw new Response("Invalid QStash signature", { status: 401 });
  }
}
```

```typescript
// src/app/api/worker/publish/route.ts (example usage)
import { verifyQStashSignature } from "@/lib/qstash/verify";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    await verifyQStashSignature(req);
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse body and process the publish job
  // ...
  return NextResponse.json({ ok: true });
}
```

#### Publishing messages from server actions

```typescript
// src/lib/qstash/publish.ts
import { Client } from "@upstash/qstash";
import { env } from "@/env";

let _client: Client | null = null;

function getClient(): Client {
  if (!_client) {
    _client = new Client({ token: env.QSTASH_TOKEN });
  }
  return _client;
}

export async function enqueuePublishJob(payload: {
  contentItemId: string;
  placement: "feed" | "story";
}): Promise<void> {
  const client = getClient();
  await client.publishJSON({
    url: `${env.NEXT_PUBLIC_APP_URL}/api/worker/publish`,
    body: payload,
    retries: 3,
    delay: 0,
  });
}
```

#### Local development with QStash

QStash cannot call `localhost` directly. Two options:

**Option A: ngrok tunnel (recommended for realistic testing)**

```bash
# Terminal 1: start Next.js
pnpm dev

# Terminal 2: expose localhost via ngrok
ngrok http 3000

# Set NEXT_PUBLIC_APP_URL to the ngrok URL in .env.local
# QStash will call the ngrok tunnel which forwards to localhost:3000
```

**Option B: QStash local development server**

Upstash provides `@upstash/qstash` with a local development mode that bypasses network calls and invokes the handler directly in-process. Use this for unit tests:

```typescript
// src/test/qstash-helpers.ts
import { Client } from "@upstash/qstash";

// In test environment, use the in-process publisher
export const testQstashClient = new Client({
  token: "test-token",
  baseUrl: "http://localhost:3000", // calls handler directly in vitest
});
```

For integration tests, mock the QStash client entirely — test the handler logic independently of QStash delivery.

**Option C: bypass for dev**

In development, call worker endpoints directly from server actions using a shared `CRON_SECRET` header instead of QStash signatures. Add a check in `verifyQStashSignature`:

```typescript
// Allow direct calls in development via CRON_SECRET header
if (process.env.NODE_ENV === "development") {
  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret === env.CRON_SECRET) return; // valid dev bypass
}
```

---

## Reference: Key Design Decisions Summary

| Decision | Chosen approach | Rationale |
|---|---|---|
| Enum implementation | `CHECK` constraints | Simpler ALTER in single migration; no transaction boundary issues |
| Timezone | Hardcoded `Europe/London` in app layer | No per-row column; all DB timestamps are UTC; Luxon handles display conversion |
| Token storage | AES-256-GCM encrypted columns | Plaintext tokens in DB removed; decryption in server only |
| Media attachments | `content_media_attachments` junction table | Enables position ordering, alt text, FK constraints; eliminates `uuid[]` |
| Campaign delete | Soft delete (`deleted_at`) + `ON DELETE RESTRICT` on FK | Preserves history; prevents accidental cascade delete of scheduled posts |
| Publish job uniqueness | `idempotency_key` unique constraint + `EXCLUDE` constraint | Prevents duplicate jobs and concurrent active jobs for same item |
| Cron replacement | QStash | Retries, delivery guarantees, signed requests; no Vercel Cron vendor lock-in |
| Env validation | `@t3-oss/env-nextjs` | Build-time failure if required vars missing; typed access; replaces ad-hoc checks |
| CI gate | All 6 jobs must pass | Type check + lint + tests + coverage + build + migration syntax before merge |
| Deployment | Auto-deploy from `main` with manual migration gate | Single developer — friction of full manual deploy is unnecessary, but schema safety is enforced |
