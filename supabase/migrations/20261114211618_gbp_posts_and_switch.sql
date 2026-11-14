-- Google Business Profile posting, piece 1: data only
-- (tasks/SPEC-gbp-posting-reintroduction.md v4, sections 1 and 2; approved by
-- Peter on 14 November 2026).
--
-- 1. accounts.google_posts_enabled: the per-brand switch, off by default and
--    set only by a super-admin on /admin. Google posting is for the owner's
--    own profiles; a brand that signs itself up never has it on (D10).
-- 2. public.gbp_posts: one row per Google post CheersAI tracks. It records
--    where the post was meant to go, what Google called it, and Google's
--    moderation state (accepted is not the same as visible). The unique index
--    on (account_id, source_event_key, local_post_parent) is what guarantees
--    one Google post per event per profile, whatever retries happen.
--
-- Nothing reads or writes gbp_posts yet: the connection, the publish worker
-- and the moderation checks arrive in later pieces. The app reads
-- accounts.google_posts_enabled as soon as this piece deploys, so this
-- migration must be applied BEFORE that deployment.
--
-- Access: service role only. Every read and write goes through server code
-- with the service-role client, scoped by account_id, so RLS is on with no
-- policies and every privilege is revoked from public, anon and
-- authenticated (on this project `authenticated` still inherits privileges on
-- new tables from the postgres default ACL). The new accounts column takes
-- the table's existing grants and policies. supabase/tests/gbp_posts_verify.sql
-- checks all of it.
--
-- Written for production's shape (accounts, content_items and publish_jobs as
-- they are live). Purely additive: no existing row or constraint changes.
--
-- Rollback (revert the app first: it selects the column on every sign-in):
--   drop table if exists public.gbp_posts;
--   alter table public.accounts drop column if exists google_posts_enabled;

alter table public.accounts
  add column if not exists google_posts_enabled boolean not null default false;

comment on column public.accounts.google_posts_enabled is
  'Google Business Profile posting for this brand. Off by default; set only by a super-admin, for the owner''s own profiles (SPEC-gbp-posting-reintroduction D10).';

create table if not exists public.gbp_posts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  publish_job_id uuid references public.publish_jobs(id) on delete set null,
  -- 'mgmt:<management event id>' or 'campaign:<campaign id>' for an event post; null for an ordinary post.
  source_event_key text,
  -- The profile the post is for, 'accounts/{account}/locations/{location}', captured when the work is created.
  local_post_parent text not null,
  -- What Google returned: the post's resource name and its public link.
  google_post_name text,
  search_url text,
  -- Google's moderation state: PROCESSING, LIVE, REJECTED or anything newer it sends. Null until sent.
  google_state text,
  delivery_state text not null default 'not_scheduled',
  last_checked_at timestamptz,
  next_check_at timestamptz,
  check_attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gbp_posts_delivery_state_check
    check (delivery_state in ('not_scheduled', 'claimed', 'sent', 'uncertain', 'failed')),
  constraint gbp_posts_check_attempts_check check (check_attempts >= 0),
  constraint gbp_posts_source_event_key_check
    check (source_event_key is null or source_event_key ~ '^(mgmt|campaign):.+'),
  constraint gbp_posts_local_post_parent_check
    check (local_post_parent ~ '^accounts/[^/]+/locations/[^/]+$')
);

comment on table public.gbp_posts is
  'One row per Google Business Profile post CheersAI tracks (SPEC-gbp-posting-reintroduction §2). Service role only.';

-- One tracked Google post per content item.
create unique index if not exists gbp_posts_content_item_key
  on public.gbp_posts (content_item_id);

-- One Google post per event per profile (D5), enforced here and not by the wizard.
create unique index if not exists gbp_posts_one_per_event
  on public.gbp_posts (account_id, source_event_key, local_post_parent)
  where source_event_key is not null;

-- The moderation check picks up rows that are due.
create index if not exists gbp_posts_due_checks
  on public.gbp_posts (next_check_at)
  where next_check_at is not null;

create index if not exists gbp_posts_account
  on public.gbp_posts (account_id);

create index if not exists gbp_posts_publish_job
  on public.gbp_posts (publish_job_id)
  where publish_job_id is not null;

alter table public.gbp_posts enable row level security;

revoke all on table public.gbp_posts from public, anon, authenticated;
grant all on table public.gbp_posts to service_role;
