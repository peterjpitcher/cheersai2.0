-- Meta data-deletion and deauthorise callbacks (SPEC-new-customer-readiness
-- §4.8, finding M2; required for Meta App Review).
--
-- 1. meta_user_id on social_connections and meta_ad_accounts: the app-scoped
--    Meta user id of the person who connected, recorded at OAuth time. Meta
--    sends this id to both callbacks; without it no connection can be found.
--    Existing rows stay null until the brand reconnects.
--
-- 2. meta_data_requests: one row per verified callback, so the deletion status
--    URL reports what really happened (instead of always "completed") and the
--    operator has a record. Stores the confirmation code and outcome only, not
--    the Meta user id.
--
-- Expand only. Service-role only.
--
-- Rollback:
--   drop table if exists public.meta_data_requests;
--   alter table public.meta_ad_accounts drop column if exists meta_user_id;
--   alter table public.social_connections drop column if exists meta_user_id;

alter table public.social_connections add column if not exists meta_user_id text;
alter table public.meta_ad_accounts add column if not exists meta_user_id text;

create index if not exists social_connections_meta_user_id_idx
  on public.social_connections (meta_user_id) where meta_user_id is not null;
create index if not exists meta_ad_accounts_meta_user_id_idx
  on public.meta_ad_accounts (meta_user_id) where meta_user_id is not null;

comment on column public.social_connections.meta_user_id is
  'App-scoped Meta user id of the person who connected. Matched by the Meta deletion and deauthorise callbacks.';
comment on column public.meta_ad_accounts.meta_user_id is
  'App-scoped Meta user id of the person who connected ads. Matched by the Meta deletion and deauthorise callbacks.';

create table if not exists public.meta_data_requests (
  id                   uuid primary key default gen_random_uuid(),
  kind                 text not null check (kind in ('deletion', 'deauthorise')),
  confirmation_code    text not null,
  status               text not null check (status in ('completed', 'no_match', 'failed')),
  connections_revoked  integer not null default 0,
  ad_accounts_revoked  integer not null default 0,
  detail               text,
  meta_issued_at       timestamptz,
  created_at           timestamptz not null default now()
);

create index if not exists meta_data_requests_code_idx on public.meta_data_requests (confirmation_code, created_at desc);

comment on table public.meta_data_requests is
  'Verified Meta data-deletion and deauthorise callbacks and their outcomes. Service-role only.';

alter table public.meta_data_requests enable row level security;
revoke all on public.meta_data_requests from anon, authenticated;
grant select, insert on public.meta_data_requests to service_role;
