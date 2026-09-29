-- Stop new functions granting EXECUTE to PUBLIC, which anon inherits.
--
-- WHY
--   20260905053036 ran `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE
--   EXECUTE ON FUNCTIONS FROM PUBLIC`, and that line did nothing. Default
--   privileges set for a schema are ADDED to the global ones and cannot take
--   away a privilege granted globally, and EXECUTE for PUBLIC on every new
--   function is Postgres's built-in global default. With no global
--   pg_default_acl row to override it, a function created by postgres in public
--   still gets PUBLIC EXECUTE, and anon is a member of PUBLIC, so anon can call
--   it with nobody having granted anything. The same migration's revokes from
--   anon, on tables, sequences and functions, did work.
--
--   Read-only on production (nbkjciurhvkfpcpatbnt, Postgres 17.6) on 29
--   September 2026: pg_default_acl holds no global row, and for postgres-owned
--   functions in public only `postgres/public/f {postgres=X, authenticated=X,
--   service_role=X}`, so a new function there would read {=X/postgres,
--   postgres=X, authenticated=X, service_role=X}. Of the 24 existing public
--   functions, three are anon-executable, all allowlisted: is_super_admin() and
--   is_account_member(uuid) by explicit grant, and current_account_id() through
--   PUBLIC. RLS policies call all three, and this migration changes none of
--   them. The risk is the next function someone creates without `revoke ...
--   from public`.
--
-- WHAT THIS CHANGES
--   One global default for the postgres role: new functions it creates, in any
--   schema, no longer grant EXECUTE to PUBLIC. The per-schema grants still add
--   on top, so in public a new function reads {postgres=X, authenticated=X,
--   service_role=X}. A function the public site genuinely needs must carry an
--   explicit GRANT to anon, which is the point, and so must a new function that
--   an RLS policy anon queries through calls, or that query fails with 42501
--   instead of returning rows. Existing functions are untouched: default
--   privileges only apply when an object is created, and CREATE OR REPLACE
--   keeps an existing function's grants.
--
--   Checked before choosing the global form, because it reaches beyond public:
--     extensions  postgres owns pgcrypto, uuid-ossp and pg_stat_statements on
--                 production, all at their default version, so no pending
--                 update can create a function under the new default.
--                 btree_gist, in public, is owned by supabase_admin. A NEW
--                 extension created as postgres is owned by supabase_admin
--                 (checked on this project's image, supabase/postgres
--                 17.6.1.011), so its functions keep PUBLIC EXECUTE.
--     graphql, graphql_public, realtime, vault, pgbouncer, auth, storage
--                 functions there are owned by supabase_admin or a Supabase
--                 service role, and postgres cannot create in any of them.
--
--   supabase_admin is deliberately left alone. Its default privileges in public
--   grant anon EXECUTE outright, but postgres is not a member of supabase_admin
--   on production (checked with pg_has_role), so a migration cannot change them.
--   Nothing in this repository creates functions as supabase_admin.
--
-- GUARDED
--   It refuses to run as any role but postgres, because the proof below creates a
--   function as the current role and would test the wrong defaults otherwise. It
--   then creates a probe function in public and raises, rolling the whole
--   migration back, if the probe carries a PUBLIC grant or anon can execute it.
--   The probe is dropped in the same transaction, so nobody ever sees it.
--
-- IDEMPOTENT: yes. Revoking what is already revoked leaves the same global row.
--
-- ROLLBACK (restores exactly the state before this ran: no global row)
--   alter default privileges for role postgres grant execute on functions to public;
--   Re-granting PUBLIC makes the global ACL equal to the built-in default, and
--   Postgres removes such a row rather than storing it.

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'default_privileges_revoke_public_execute_globally: run as postgres, not %', current_user;
  end if;
end;
$$;

alter default privileges for role postgres revoke execute on functions from public;

-- Prove the behaviour rather than trusting the statement above. has_function_privilege
-- answers what anon can actually do, including anything inherited via PUBLIC.
do $$
declare
  v_acl aclitem[];
begin
  create function public.default_privileges_probe() returns int
    language sql immutable as 'select 1';

  select proacl into v_acl from pg_proc
   where oid = 'public.default_privileges_probe()'::regprocedure;

  if v_acl is null or exists (select 1 from aclexplode(v_acl) a where a.grantee = 0) then
    raise exception 'default_privileges_revoke_public_execute_globally: a new function in public still grants PUBLIC EXECUTE (proacl %)',
      coalesce(v_acl::text, 'NULL, the built-in default');
  end if;

  if has_function_privilege('anon', 'public.default_privileges_probe()', 'EXECUTE') then
    raise exception 'default_privileges_revoke_public_execute_globally: anon can execute a new function in public (proacl %)',
      v_acl::text;
  end if;

  drop function public.default_privileges_probe();
end;
$$;
