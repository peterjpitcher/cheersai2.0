-- Keep public.user_auth_snapshot in step with auth.users on a rebuilt database, as
-- production does.
--
-- WHY
-- Production (nbkjciurhvkfpcpatbnt) has two triggers on auth.users that mirror each
-- login into public.user_auth_snapshot:
--
--   trg_sync_user_auth_snapshot   AFTER INSERT OR UPDATE, runs public.sync_user_auth_snapshot()
--   trg_purge_user_auth_snapshot  AFTER DELETE,           runs public.purge_user_auth_snapshot()
--
-- The v1 baseline (supabase/baseline/v1_baseline.sql) creates both functions, with the
-- same bodies, SECURITY DEFINER and search_path as production, but not the triggers, and
-- no migration creates them. So on a rebuild (`npm run db:rebuild`, CI's migration-check)
-- a new login never got a snapshot row, and anything that reads the snapshot (team
-- invitations, billing, the admin list, self-serve sign-up) saw nobody unless a test
-- inserted the row by hand. Found while building self-serve sign-up (PR #144).
--
-- WHAT
-- Each trigger is created only if it is missing, with the definition production's
-- pg_get_triggerdef returned on 28 September 2026. The functions are not recreated: the
-- baseline already has them exactly as production does. Their EXECUTE grants are stated
-- as production has them (service_role only; the owner, postgres, keeps its own right)
-- and changed only where they differ. A trigger does not need EXECUTE to fire; the
-- grants only keep the functions away from the API roles.
--
-- Production has both triggers and those grants, so nothing runs there: no DDL, no lock
-- on auth.users, no grant change, only catalogue reads.
--
-- A rebuild has no logins when this runs, so there is nothing to backfill.
--
-- ROLLBACK
-- Nothing to roll back on production (nothing runs there). A local database is rebuilt,
-- not rolled back: `npm run db:rebuild`.

do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'auth.users'::regclass
                    and tgname = 'trg_sync_user_auth_snapshot'
                    and not tgisinternal) then
    create trigger trg_sync_user_auth_snapshot
      after insert or update on auth.users
      for each row execute function public.sync_user_auth_snapshot();
  end if;

  if not exists (select 1 from pg_trigger
                  where tgrelid = 'auth.users'::regclass
                    and tgname = 'trg_purge_user_auth_snapshot'
                    and not tgisinternal) then
    create trigger trg_purge_user_auth_snapshot
      after delete on auth.users
      for each row execute function public.purge_user_auth_snapshot();
  end if;
end $$;

do $$
declare
  fn text;
begin
  foreach fn in array array['public.sync_user_auth_snapshot()', 'public.purge_user_auth_snapshot()'] loop
    if has_function_privilege('public', fn, 'execute')
       or has_function_privilege('anon', fn, 'execute')
       or has_function_privilege('authenticated', fn, 'execute')
       or not has_function_privilege('service_role', fn, 'execute') then
      execute format('revoke execute on function %s from public, anon, authenticated', fn);
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end $$;
