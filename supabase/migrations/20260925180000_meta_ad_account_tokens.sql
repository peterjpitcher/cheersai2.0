-- Encrypted storage for paid-ads Meta tokens (tasks/SPEC-encrypt-meta-ad-tokens.md, phase 1).
--
-- meta_ad_accounts.access_token and conversions_api_access_token hold plaintext
-- Meta tokens, and the table's member RLS policy lets any signed-in member of
-- the brand read them with the browser client. This table holds the same tokens
-- encrypted with src/lib/token-vault (AES-256-GCM). It mirrors token_vault,
-- which cannot be reused because its rows hang off social_connections.
--
-- Expand-only: a new table, nothing existing changes. The app reads this table
-- first and falls back to the plaintext columns until phase 2 clears them.
-- Service-role only: no RLS policies, and anon and authenticated get nothing.
--
-- Rollback: drop table public.meta_ad_account_tokens;
-- (safe while the plaintext columns are still populated, i.e. before phase 2)

create table if not exists public.meta_ad_account_tokens (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.meta_ad_accounts(account_id) on delete cascade,
  token_type   text not null check (token_type in ('access', 'conversions_api')),
  ciphertext   text not null,
  iv           text not null,
  tag          text not null,
  key_version  integer not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (account_id, token_type)
);

comment on table public.meta_ad_account_tokens is
  'Encrypted (token-vault AES-256-GCM) Meta paid-ads tokens, one row per brand and token type. Service-role only.';

drop trigger if exists trg_meta_ad_account_tokens_updated_at on public.meta_ad_account_tokens;
create trigger trg_meta_ad_account_tokens_updated_at
  before update on public.meta_ad_account_tokens
  for each row execute function public.set_updated_at();

alter table public.meta_ad_account_tokens enable row level security;
revoke all on public.meta_ad_account_tokens from public, anon, authenticated;
grant select, insert, update, delete on public.meta_ad_account_tokens to service_role;
