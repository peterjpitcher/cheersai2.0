-- Verification for 20260714120000_multibrand_foundation.
-- Run AFTER applying the migration (preview branch or local). Each block
-- raises an exception if the expectation is not met; a clean run = pass.
-- Usage: psql "$DATABASE_URL" -f supabase/tests/multibrand_foundation_verify.sql
--    or: execute this file's body via the Supabase SQL editor / MCP execute_sql.

do $$
begin
  -- new tables exist
  if to_regclass('public.app_admins')      is null then raise exception 'app_admins missing'; end if;
  if to_regclass('public.account_members') is null then raise exception 'account_members missing'; end if;
  if to_regclass('public.admin_audit')     is null then raise exception 'admin_audit missing'; end if;

  -- helper functions exist and are SECURITY DEFINER
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'is_super_admin' and p.prosecdef)
    then raise exception 'is_super_admin missing or not SECURITY DEFINER'; end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'is_account_member' and p.prosecdef)
    then raise exception 'is_account_member missing or not SECURITY DEFINER'; end if;

  -- additive accounts columns exist
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'accounts' and column_name = 'created_by_user_id')
    then raise exception 'accounts.created_by_user_id missing'; end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'accounts' and column_name = 'archived_at')
    then raise exception 'accounts.archived_at missing'; end if;

  -- backfill: one membership per account, and created_by_user_id populated
  if (select count(*) from public.account_members)
     <> (select count(*) from public.accounts where auth_user_id is not null)
    then raise exception 'account_members backfill count mismatch'; end if;
  if exists (select 1 from public.accounts where auth_user_id is not null and created_by_user_id is null)
    then raise exception 'created_by_user_id not fully backfilled'; end if;

  -- the UNIQUE constraint on accounts.auth_user_id is STILL present (PR1 must not drop it)
  if not exists (
    select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
    where t.relname = 'accounts' and c.contype = 'u'
      and pg_get_constraintdef(c.oid) ilike '%auth_user_id%')
    then raise exception 'accounts.auth_user_id UNIQUE was unexpectedly removed in PR1'; end if;

  raise notice 'PR1 foundation verification PASSED';
end $$;
