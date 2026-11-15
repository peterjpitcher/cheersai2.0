-- A signed-in user can no longer write to public.accounts directly
-- (tasks/SPEC-accounts-member-writes-revoked.md; approved by Peter on
-- 15 November 2026: "Yes, fix it").
--
-- The gap: `authenticated` (any signed-in user, calling the Supabase API with
-- their own session) held INSERT, UPDATE and DELETE on public.accounts, and
-- the accounts_update policy lets any member of a brand update that brand's
-- row. So a customer could set their own billing_override to 'comped' (free),
-- switch on paid ads, tournaments or the management import, or change the
-- booking ingest secret, without going through the app. Row level security
-- limits WHICH row, never WHICH column.
--
-- Nothing legitimate uses that access: every write to accounts goes through
-- server code with the service role (the admin actions, offboarding, and
-- provision_self_serve_brand, which authenticated cannot execute). So the
-- write privileges are removed outright. SELECT stays: signed-in reads of
-- the member's own brands go through the accounts_select policy.
--
-- "revoke all, then grant select" is used so that anything else the role
-- holds on the table (REFERENCES, TRIGGER, column grants) goes too. Both
-- statements run in the migration's one transaction, so there is no moment
-- when signed-in reads fail.
--
-- The policies are left in place; without the privilege they no longer grant
-- anything to a user session. The guard trigger on google_posts_enabled
-- (20261114212215) stays as a second layer. anon and service_role are not
-- changed.
--
-- Rollback (restores the old, unsafe state):
--   grant insert, update, delete, truncate, references, trigger on table public.accounts to authenticated;

revoke all on table public.accounts from authenticated;
grant select on table public.accounts to authenticated;

-- Abort unless the result is exactly what is intended.
do $$
declare
  v_priv text;
  v_col text;
begin
  foreach v_priv in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('authenticated', 'public.accounts', v_priv) then
      raise exception 'authenticated still holds % on public.accounts', v_priv;
    end if;
  end loop;
  for v_col in
    select attname from pg_attribute
     where attrelid = 'public.accounts'::regclass and attnum > 0 and not attisdropped
  loop
    if has_column_privilege('authenticated', 'public.accounts', v_col, 'INSERT')
       or has_column_privilege('authenticated', 'public.accounts', v_col, 'UPDATE') then
      raise exception 'authenticated can still write public.accounts.%', v_col;
    end if;
  end loop;
  if not has_table_privilege('authenticated', 'public.accounts', 'SELECT') then
    raise exception 'authenticated lost SELECT on public.accounts';
  end if;
  foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if not has_table_privilege('service_role', 'public.accounts', v_priv) then
      raise exception 'service_role lacks % on public.accounts', v_priv;
    end if;
  end loop;
end $$;
