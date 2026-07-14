-- PR2 RLS rewrite verification.
--
-- Run AFTER 20260714130000_multibrand_rls_membership.sql (which itself runs
-- after the PR1 foundation migration). Raises an exception on the first failed
-- assertion; prints 'PR2 RLS verification PASSED' only if every check holds.
--
-- Usage: psql "$DATABASE_URL" -f supabase/tests/multibrand_rls_verify.sql
--
-- Asserts:
--   1. No public/storage policy still references auth_user_id = auth.uid() or
--      current_account_id() in USING/WITH CHECK.
--   2. All 7 Meta/oauth_states account_id FKs now target public.accounts (and
--      none still target auth.users).
--   3. accounts_auth_user_id_key UNIQUE no longer exists.
--   4. accounts.business_name is NOT NULL.
--   5. public.is_account_member(uuid) and public.is_super_admin() exist.

do $$
declare
  v_leftover_policies bigint;
  v_leftover_list     text;
  v_to_accounts       bigint;
  v_to_authusers      bigint;
  v_unique_exists     boolean;
  v_business_nullable text;
  v_has_is_member     boolean;
  v_has_is_super      boolean;
begin
  -- 1) No residual single-owner tenancy predicates ---------------------------
  select count(*),
         string_agg(format('%s.%s/%s', schemaname, tablename, policyname), ', ')
    into v_leftover_policies, v_leftover_list
    from pg_policies
   where schemaname in ('public', 'storage')
     and (
       coalesce(qual, '')       ilike '%current_account_id(%'
       or coalesce(with_check, '') ilike '%current_account_id(%'
       or coalesce(qual, '')       ilike '%auth_user_id%'
       or coalesce(with_check, '') ilike '%auth_user_id%'
     );
  if v_leftover_policies <> 0 then
    raise exception 'PR2 verify FAILED (1): % policy/policies still reference current_account_id()/auth_user_id: %',
      v_leftover_policies, v_leftover_list;
  end if;

  -- 2) Meta/oauth_states account_id FKs re-pointed to public.accounts --------
  with meta_tables(t) as (
    values ('meta_campaigns'), ('meta_ad_accounts'), ('meta_optimisation_actions'),
           ('meta_optimisation_runs'), ('ad_metrics_history'),
           ('booking_conversion_events'), ('oauth_states')
  ),
  fks as (
    select mt.t,
           (select a.attnum
              from pg_attribute a
             where a.attrelid = ('public.' || mt.t)::regclass
               and a.attname = 'account_id') as anum,
           c.confrelid,
           c.conkey
      from meta_tables mt
      join pg_constraint c
        on c.conrelid = ('public.' || mt.t)::regclass
       and c.contype = 'f'
  )
  select
    count(*) filter (where confrelid = 'public.accounts'::regclass and anum = any (conkey)),
    count(*) filter (where confrelid = 'auth.users'::regclass     and anum = any (conkey))
    into v_to_accounts, v_to_authusers
    from fks;
  if v_to_accounts <> 7 then
    raise exception 'PR2 verify FAILED (2a): expected 7 account_id FKs to public.accounts, found %', v_to_accounts;
  end if;
  if v_to_authusers <> 0 then
    raise exception 'PR2 verify FAILED (2b): % Meta/oauth_states account_id FK(s) still target auth.users', v_to_authusers;
  end if;

  -- 3) Single-owner UNIQUE dropped -------------------------------------------
  select exists (
    select 1
      from pg_constraint c
     where c.conrelid = 'public.accounts'::regclass
       and c.conname = 'accounts_auth_user_id_key'
  ) into v_unique_exists;
  if v_unique_exists then
    raise exception 'PR2 verify FAILED (3): accounts_auth_user_id_key still exists';
  end if;

  -- 4) accounts.business_name is NOT NULL ------------------------------------
  select is_nullable
    into v_business_nullable
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'accounts'
     and column_name = 'business_name';
  if v_business_nullable is distinct from 'NO' then
    raise exception 'PR2 verify FAILED (4): accounts.business_name is_nullable = % (expected NO)',
      coalesce(v_business_nullable, '<column missing>');
  end if;

  -- 5) Membership helpers exist ----------------------------------------------
  select exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'is_account_member'
  ) into v_has_is_member;
  select exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'is_super_admin'
  ) into v_has_is_super;
  if not v_has_is_member then
    raise exception 'PR2 verify FAILED (5a): public.is_account_member is missing';
  end if;
  if not v_has_is_super then
    raise exception 'PR2 verify FAILED (5b): public.is_super_admin is missing';
  end if;

  raise notice 'PR2 RLS verification PASSED';
end $$;
