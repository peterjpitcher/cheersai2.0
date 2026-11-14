-- Only a super-admin (or server code) may change accounts.google_posts_enabled
-- (tasks/SPEC-gbp-posting-reintroduction.md v4, D10 and section 1).
--
-- Why a trigger: on this project `authenticated` holds table-wide UPDATE on
-- public.accounts and the accounts_update policy lets any member of a brand
-- update that brand's row. So a signed-in customer could switch Google posting
-- on for their own brand straight through the Supabase API, skipping the
-- super-admin check in setBrandFeature(). A column-level revoke cannot fix
-- that while the table-wide grant stands, and narrowing that grant would touch
-- every other column, which is a separate change.
--
-- The rule: a request made with a user session (the `authenticated` role) or
-- no session (`anon`) may change this one column only when the user is a
-- super-admin (public.is_super_admin(), the same test the accounts policies
-- use). Server code using the service role, migrations and the dashboard are
-- unaffected. Every other column behaves exactly as before.
--
-- The function is SECURITY INVOKER on purpose: current_user must be the
-- caller's role. It reads no table itself.
--
-- Rollback:
--   drop the trigger accounts_guard_google_posts_enabled on public.accounts,
--   then the function public.guard_google_posts_enabled().

create or replace function public.guard_google_posts_enabled()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.google_posts_enabled is distinct from old.google_posts_enabled
     and current_user in ('authenticated', 'anon')
     and not public.is_super_admin() then
    raise exception 'Only a super-admin can change Google posting for a brand.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.guard_google_posts_enabled() is
  'Refuses a change to accounts.google_posts_enabled from a user session unless the user is a super-admin (SPEC-gbp-posting-reintroduction D10).';

-- A trigger function is only ever run by its trigger; nobody needs to call it.
revoke all on function public.guard_google_posts_enabled() from public, anon, authenticated;

create or replace trigger accounts_guard_google_posts_enabled
  before update of google_posts_enabled on public.accounts
  for each row
  execute function public.guard_google_posts_enabled();
