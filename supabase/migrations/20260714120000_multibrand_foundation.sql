-- Multi-brand tenancy PR1: backward-compatible foundation.
-- Adds membership + super-admin + admin-audit infrastructure and additive
-- accounts columns. Does NOT rewrite existing RLS, does NOT drop the
-- accounts.auth_user_id UNIQUE constraint, and does NOT change app behaviour.
-- Safe to deploy ahead of the PR2 app/auth changes (expand phase).
-- See tasks/SPEC-multi-brand-tenancy.md (v2) and tasks/PLAN-multi-brand-PR1-foundation.md.

begin;

-- 1) Super-admin registry --------------------------------------------------
create table if not exists public.app_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;
-- defence-in-depth: a would-be anon/authenticated read only ever sees own row.
drop policy if exists app_admins_select_self on public.app_admins;
create policy app_admins_select_self on public.app_admins
  for select using (user_id = auth.uid());

-- is_super_admin() FIRST (is_account_member references it).
create or replace function public.is_super_admin()
returns boolean language sql stable security definer
set search_path = public, pg_catalog as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid());
$$;
revoke execute on function public.is_super_admin() from public;
grant execute on function public.is_super_admin() to authenticated, service_role;

-- 2) Membership (access-only, no role tiers) -------------------------------
create table if not exists public.account_members (
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (account_id, user_id)
);
create index if not exists idx_account_members_user on public.account_members(user_id);
alter table public.account_members enable row level security;
revoke all on public.account_members from anon, authenticated;
drop policy if exists account_members_select on public.account_members;
create policy account_members_select on public.account_members
  for select using (user_id = auth.uid() or public.is_super_admin());

create or replace function public.is_account_member(target uuid)
returns boolean language sql stable security definer
set search_path = public, pg_catalog as $$
  select public.is_super_admin()
      or exists (select 1 from public.account_members
                 where account_id = target and user_id = auth.uid());
$$;
revoke execute on function public.is_account_member(uuid) from public;
grant execute on function public.is_account_member(uuid) to authenticated, service_role;

-- 3) Global admin audit trail (survives brand deletion) --------------------
create table if not exists public.admin_audit (
  id                uuid primary key default gen_random_uuid(),
  actor_user_id     uuid,
  action            text not null,
  target_user_id    uuid,
  target_account_id uuid,
  detail            jsonb,
  result            text not null default 'success',
  created_at        timestamptz not null default now()
);
alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from anon, authenticated;
drop policy if exists admin_audit_select_admin on public.admin_audit;
create policy admin_audit_select_admin on public.admin_audit
  for select using (public.is_super_admin());

-- 4) accounts: additive creator + archive columns --------------------------
alter table public.accounts
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null;
alter table public.accounts
  add column if not exists archived_at timestamptz;
update public.accounts
  set created_by_user_id = auth_user_id
  where created_by_user_id is null and auth_user_id is not null;

-- 5) Backfill one membership per existing account --------------------------
--    Runs while accounts.auth_user_id is still UNIQUE NOT NULL, so exactly
--    one clean membership row per account.
insert into public.account_members (account_id, user_id)
select id, auth_user_id
from public.accounts
where auth_user_id is not null
on conflict (account_id, user_id) do nothing;

commit;
