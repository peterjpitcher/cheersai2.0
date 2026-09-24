-- Owner and member roles (SPEC-new-customer-readiness §4.5, decision D4).
--
-- Owners handle billing, inviting and removing people, Facebook and Instagram
-- connections, export and deletion requests. Members create, edit and
-- schedule content. Every existing membership becomes an owner (D4).
--
-- account_members is already read-only for anon and authenticated (all writes
-- go through service-role server actions), so a member cannot promote
-- themselves; the role checks live in the server actions.
--
-- A live brand must keep at least one owner: removing or demoting its last
-- owner is refused. Archived brands, and brands being deleted, are exempt so
-- offboarding still works.
--
-- Rollback:
--   drop trigger if exists account_members_keep_an_owner on public.account_members;
--   drop function if exists public.account_members_keep_an_owner();
--   alter table public.account_members drop column if exists role;

alter table public.account_members
  add column if not exists role text not null default 'owner'
  check (role in ('owner', 'member'));

comment on column public.account_members.role is
  'owner: billing, people, connections, export. member: content only. Last owner of a live brand cannot be removed.';

create or replace function public.account_members_keep_an_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.role <> 'owner' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role = 'owner' then
    return new;
  end if;
  -- Brand gone (cascade delete) or archived: offboarding may remove everyone.
  if not exists (
    select 1 from accounts a where a.id = old.account_id and a.archived_at is null
  ) then
    return coalesce(new, old);
  end if;
  if not exists (
    select 1 from account_members m
    where m.account_id = old.account_id
      and m.role = 'owner'
      and m.user_id <> old.user_id
  ) then
    raise exception 'A brand must keep at least one owner. Add another owner first.'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.account_members_keep_an_owner() from public, anon, authenticated;

drop trigger if exists account_members_keep_an_owner on public.account_members;
create trigger account_members_keep_an_owner
  before delete or update of role on public.account_members
  for each row execute function public.account_members_keep_an_owner();
