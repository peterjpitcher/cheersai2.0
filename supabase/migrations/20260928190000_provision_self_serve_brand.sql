-- Self-serve venue creation (tasks/SPEC-self-serve-signup.md §4.4, §4.3, §4.12;
-- §5 PR 6). Approved by Peter on 28 September 2026 (his question 53: build
-- every stage now behind app_flags('self_serve_signup'), which stays off).
--
-- public.provision_self_serve_brand(p_user_id, p_venue_name, p_business_type,
-- p_email, p_legal_version) creates a self-serve venue in ONE transaction:
--   1. locks the login's self_serve_signups row (select ... for update). This
--      is the same row lock public.delete_stale_self_serve_login (PR 5) holds
--      while it re-checks and deletes a stale login, and the lock
--      record_self_serve_signup_request's upsert takes, so venue creation and
--      the login clean-up serialise: provisioning either waits for the delete
--      (and then finds the login gone and makes nothing: no_login) or
--      finishes first (and the clean-up then keeps the login, which now has a
--      venue). Provisioning must keep taking this lock.
--   2. re-checks everything under the lock, before writing anything:
--      - a venue already made for this sign-up is returned as it is (a double
--        submit, a refresh or a second tab ends here, so one sign-up makes at
--        most one brand); a venue that was made and has since been deleted is
--        refused rather than replaced;
--      - the sign-up switch is still on (switch off mid-journey: refused);
--      - the login belongs to no brand (a second venue for an existing member
--        is out of scope, spec §8);
--      - the login still exists, and the email matches its current email
--        (public.user_auth_snapshot, kept in step with auth.users by
--        triggers), because it becomes the brand's contact email.
--      A signed-in login with no brand that starts from /no-access (spec
--      §4.4) has no sign-up row yet: once every check has passed, the row is
--      made here, in the same transaction as the venue, and locked. The
--      /no-access button itself writes nothing, because a sign-up row with no
--      venue on a login that confirmed its email more than 30 days ago is
--      exactly what the nightly clean-up deletes (self_serve_login_is_stale):
--      a click on an old login would otherwise get that login deleted within
--      a day.
--   3. inserts public.accounts (business_name and display_name = the venue
--      name, email = the sign-up email, Europe/London, created_by_user_id and
--      auth_user_id = the login). The per-brand switches (paid_ads_enabled,
--      tournaments_enabled, management_import_enabled) and billing_override
--      are left at their defaults (false, false, false, null): no paid ads,
--      tournaments or management import for new customers (D1b, D1c), and no
--      billing override, so the brand is 'incomplete' until Checkout;
--   4. inserts public.account_members (role owner, created_by the login) and
--      public.brand_profile (business_type), which ticks the setup
--      checklist's profile step (F13);
--   5. fills the sign-up row: verified_at (if the page had not already),
--      account_id, venue_created_at, business_confirmed_at, legal_version.
-- Any error undoes all of it: no account, no membership, no brand profile.
--
-- Returns jsonb {"status": ..., "account_id"?: uuid}:
--   created       a new brand; account_id is it
--   existing      this sign-up already made a brand; account_id is it
--   closed        the sign-up switch is off (or its row is missing)
--   no_login      the login no longer exists (for example deleted by the
--                 clean-up while this call waited for the lock)
--   venue_closed  this sign-up made a venue that has since been deleted
--   member        the login already belongs to a brand
--   email_mismatch the email is not the login's current email
-- Only 'created' writes anything: every refusal is decided before the first
-- write. Bad arguments raise 22023.
--
-- Why SECURITY INVOKER (not definer): the only caller is the app's
-- service-role client, and service_role can already read and write every
-- table this touches (self_serve_signups, app_flags, account_members,
-- user_auth_snapshot, accounts, brand_profile; all checked read-only on
-- production on 28 September 2026) and bypasses RLS. It never reads
-- auth.users (which service_role cannot read): the login's existence and
-- email come from user_auth_snapshot (on production every login has its row,
-- 3 of 3, checked read-only 28 September 2026), backed by the foreign keys
-- from self_serve_signups and account_members to auth.users. Email confirmation is checked by the app from the
-- verified session (auth.getUser) before it calls this; a confirmed email is
-- never unconfirmed.
--
-- Written for production's shape (read-only catalogue checks on
-- nbkjciurhvkfpcpatbnt, 28 September 2026):
--   accounts: id uuid default gen_random_uuid() (set explicitly here anyway),
--     email text NOT NULL (not unique since #75), auth_user_id uuid NOT NULL
--     with no foreign key, business_name NOT NULL and not blank (CHECK),
--     display_name nullable, timezone NOT NULL default 'Europe/London',
--     created_by_user_id references auth.users on delete set null, switches
--     NOT NULL default false, billing_override CHECK in (comped, suspended)
--     or null; one trigger, BEFORE UPDATE (updated_at).
--   account_members: primary key (account_id, user_id), role CHECK in
--     (owner, member) default owner, user_id references auth.users on delete
--     cascade, created_by references auth.users on delete set null; trigger
--     account_members_keep_an_owner fires on DELETE or UPDATE OF role only.
--   brand_profile: primary key account_id (references accounts on delete
--     cascade), business_type at most 60 characters (CHECK), every other
--     NOT NULL column has a default; no trigger.
--   self_serve_signups: as created by 20260928170000 (account_id unique,
--     legal_version 1 to 40 characters).
--   admin_audit.action has no CHECK, so the app's new action name needs no
--   migration.
--
-- Access: service role only. EXECUTE is revoked from public, anon and
-- authenticated (authenticated would otherwise inherit it from the postgres
-- default ACL on this project, spec F15). supabase/tests/
-- self_serve_grants_verify.sql checks it, read only.
--
-- Deploy order: apply this migration BEFORE the app that calls it deploys.
-- Applying it first changes nothing for the live app (nothing calls it yet,
-- and the switch is off). Without it the new venue page refuses with a
-- visible error and an operator alert.
--
-- Rollback (revert the app first; nothing else depends on it):
--   drop function if exists public.provision_self_serve_brand(uuid, text, text, text, text);

create or replace function public.provision_self_serve_brand(
  p_user_id uuid,
  p_venue_name text,
  p_business_type text,
  p_email text,
  p_legal_version text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_name text := pg_catalog.btrim(p_venue_name);
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_signup record;
  v_has_row boolean;
  v_login_email text;
  v_account_id uuid;
  v_now timestamptz := pg_catalog.now();
begin
  -- The app has already validated all of this; these stop a bad call writing anything.
  if p_user_id is null then
    raise exception 'provision_self_serve_brand: user id is required' using errcode = '22023';
  end if;
  if v_name is null or pg_catalog.char_length(v_name) < 1 or pg_catalog.char_length(v_name) > 120 then
    raise exception 'provision_self_serve_brand: venue name must be 1 to 120 characters' using errcode = '22023';
  end if;
  -- No links in a venue name: it goes into our emails (spec §4.4, §4.6).
  if pg_catalog.strpos(pg_catalog.lower(v_name), '://') > 0
     or pg_catalog.strpos(pg_catalog.lower(v_name), 'www.') > 0
     or pg_catalog.strpos(v_name, '@') > 0 then
    raise exception 'provision_self_serve_brand: venue name may not contain a link or an email address' using errcode = '22023';
  end if;
  if v_name ~ '[[:cntrl:]]' then
    raise exception 'provision_self_serve_brand: venue name may not contain control characters' using errcode = '22023';
  end if;
  -- What the sign-up form stores for each venue type (src/lib/signup/venue.ts).
  if p_business_type is null
     or p_business_type not in ('pub', 'bar', 'restaurant', 'cafe', 'hotel', 'hospitality venue') then
    raise exception 'provision_self_serve_brand: unknown business type' using errcode = '22023';
  end if;
  if v_email is null or pg_catalog.char_length(v_email) < 3 or pg_catalog.char_length(v_email) > 254
     or pg_catalog.strpos(v_email, '@') = 0 then
    raise exception 'provision_self_serve_brand: email is required' using errcode = '22023';
  end if;
  if p_legal_version is null or pg_catalog.char_length(p_legal_version) < 1 or pg_catalog.char_length(p_legal_version) > 40 then
    raise exception 'provision_self_serve_brand: legal version must be 1 to 40 characters' using errcode = '22023';
  end if;

  -- 1. The sign-up row lock, shared with delete_stale_self_serve_login and
  --    record_self_serve_signup_request. Held until this transaction ends.
  select s.id, s.account_id, s.venue_created_at
    into v_signup
    from public.self_serve_signups s
   where s.user_id = p_user_id
     for update;
  v_has_row := found;

  -- 2. Everything again, under the lock. Nothing here writes, so a refusal
  --    leaves the database exactly as it was (no sign-up row is left behind
  --    on a login that did not get a venue).
  if v_has_row then
    if v_signup.account_id is not null then
      return pg_catalog.jsonb_build_object('status', 'existing', 'account_id', v_signup.account_id);
    end if;
    if v_signup.venue_created_at is not null then
      return pg_catalog.jsonb_build_object('status', 'venue_closed');
    end if;
  end if;

  if not coalesce(
    (select f.enabled from public.app_flags f where f.name = 'self_serve_signup'),
    false
  ) then
    return pg_catalog.jsonb_build_object('status', 'closed');
  end if;

  if exists (select 1 from public.account_members m where m.user_id = p_user_id) then
    return pg_catalog.jsonb_build_object('status', 'member');
  end if;

  -- user_auth_snapshot has a row exactly while the login exists (triggers on
  -- auth.users keep it in step), so a missing row means the login is gone.
  select pg_catalog.lower(pg_catalog.btrim(a.email))
    into v_login_email
    from public.user_auth_snapshot a
   where a.user_id = p_user_id;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'no_login');
  end if;
  if v_login_email is null or v_login_email <> v_email then
    return pg_catalog.jsonb_build_object('status', 'email_mismatch');
  end if;

  -- No sign-up row yet (a login starting from /no-access): make it and lock
  -- it. A login deleted since the check above fails the foreign key. If a
  -- second tab made the row and its venue first, this insert waits for that
  -- tab to commit, does nothing, and the venue it made is returned.
  if not v_has_row then
    begin
      insert into public.self_serve_signups (user_id) values (p_user_id)
      on conflict (user_id) do nothing;
    exception when foreign_key_violation then
      return pg_catalog.jsonb_build_object('status', 'no_login');
    end;
    select s.id, s.account_id, s.venue_created_at
      into v_signup
      from public.self_serve_signups s
     where s.user_id = p_user_id
       for update;
    if not found then
      raise exception 'provision_self_serve_brand: could not lock the sign-up row' using errcode = '40001';
    end if;
    if v_signup.account_id is not null then
      return pg_catalog.jsonb_build_object('status', 'existing', 'account_id', v_signup.account_id);
    end if;
    if v_signup.venue_created_at is not null then
      return pg_catalog.jsonb_build_object('status', 'venue_closed');
    end if;
  end if;

  -- 3. The brand. Switches and billing_override stay at their defaults.
  v_account_id := pg_catalog.gen_random_uuid();
  insert into public.accounts (id, business_name, display_name, email, timezone, created_by_user_id, auth_user_id)
  values (v_account_id, v_name, v_name, v_email, 'Europe/London', p_user_id, p_user_id);

  -- 4. The owner membership and the brand profile.
  insert into public.account_members (account_id, user_id, role, created_by)
  values (v_account_id, p_user_id, 'owner', p_user_id);

  insert into public.brand_profile (account_id, business_type)
  values (v_account_id, p_business_type);

  -- 5. The sign-up row.
  update public.self_serve_signups
     set verified_at = coalesce(verified_at, v_now),
         account_id = v_account_id,
         venue_created_at = v_now,
         business_confirmed_at = v_now,
         legal_version = p_legal_version
   where id = v_signup.id;

  return pg_catalog.jsonb_build_object('status', 'created', 'account_id', v_account_id);
end;
$$;

comment on function public.provision_self_serve_brand(uuid, text, text, text, text) is
  'Creates a self-serve venue in one transaction (spec §4.4): locks the login''s self_serve_signups row (the lock delete_stale_self_serve_login takes), re-checks the switch, the sign-up, membership and email, then inserts accounts, account_members (owner) and brand_profile and fills the sign-up row. Returns {"status", "account_id"?}; a second call for the same sign-up returns the same brand. Service role only.';

revoke all on function public.provision_self_serve_brand(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.provision_self_serve_brand(uuid, text, text, text, text) to service_role;

notify pgrst, 'reload schema';
