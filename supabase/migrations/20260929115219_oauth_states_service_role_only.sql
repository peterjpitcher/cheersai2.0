-- oauth_states: service role only.
--
-- WHY
-- public.oauth_states holds OAuth handshakes in flight (state, PKCE verifier,
-- auth code) and, once the Facebook Page chooser (PR #158) ships, an encrypted
-- Meta user token waiting for the owner's Page choice. Every app path reaches
-- it with the service-role client (createServiceSupabaseClient): the connect and
-- ads actions, both OAuth callbacks and the Page chooser. Expired rows are
-- deleted by public.run_data_retention, which is SECURITY DEFINER, owned by
-- postgres and executable by service_role only. No path uses a signed-in user's
-- session, yet on 29 September 2026 production still let a signed-in user in:
--   - three policies from the v2 chain (00000000000007_provider_integration),
--     all for role public: oauth_states_select and oauth_states_update (using
--     created_by = auth.uid()) and oauth_states_insert (with check
--     created_by = auth.uid()). No app row sets created_by, so they matched
--     nothing the app wrote, but a signed-in user could insert rows directly,
--     for any account_id, and read and update their own;
--   - every table privilege for authenticated (arwdDxtm), TRUNCATE included,
--     which row level security does not govern.
-- anon's table privileges were already revoked by 20260905053345. Peter
-- approved removing the rest on 29 September 2026.
--
-- WHAT
-- 1. Drops the three user policies. "OAuth states managed by service role"
--    stays: it matches only a service-role JWT, and service_role bypasses row
--    level security anyway, so it lets nobody else in.
-- 2. Revokes every table privilege from PUBLIC, anon and authenticated. PUBLIC
--    and anon hold none on production; the revoke keeps it that way.
-- 3. Restates service_role's grant. It already holds every privilege, so this is
--    a no-op on production. The owner, postgres, is not touched.
-- 4. Checks the result and raises, which rolls the migration back, if PUBLIC,
--    anon or authenticated can still reach the table, if a policy could let
--    them in, if service_role lost a privilege the app needs, or if row level
--    security is off. Row level security stays on as the second layer.
--
-- Resulting grants on public.oauth_states: postgres (owner) and service_role
-- hold every privilege; nobody else holds any. Remaining policy: "OAuth states
-- managed by service role".
--
-- Production shape: oauth_states is v1-shaped on production, and a local rebuild
-- is reshaped to match it, with production's 26 September grants, by
-- 20260926130000 before this runs. Nothing here depends on the columns and no
-- row changes. DROP POLICY takes a brief ACCESS EXCLUSIVE lock on the table,
-- which is small (0 rows on 29 September 2026) and used only while an owner
-- connects an account. Running this twice changes nothing the second time.
--
-- ROLLBACK: restores exactly what production had on 29 September 2026.
--   create policy "oauth_states_select" on public.oauth_states
--     for select using (created_by = auth.uid());
--   create policy "oauth_states_insert" on public.oauth_states
--     for insert with check (created_by = auth.uid());
--   create policy "oauth_states_update" on public.oauth_states
--     for update using (created_by = auth.uid());
--   grant select, insert, update, delete, truncate, references, trigger, maintain
--     on table public.oauth_states to authenticated;

drop policy if exists "oauth_states_select" on public.oauth_states;
drop policy if exists "oauth_states_insert" on public.oauth_states;
drop policy if exists "oauth_states_update" on public.oauth_states;

revoke all on table public.oauth_states from public, anon, authenticated;
grant all on table public.oauth_states to service_role;

do $$
declare
  v_service_role_only constant text := '(auth.role() = ''service_role''::text)';
  -- MAINTAIN is a table privilege from Postgres 17 (production and the local stack run 17).
  v_table_privs constant text[] := array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']
    || case when current_setting('server_version_num')::int >= 170000 then array['maintain'] else array[]::text[] end;
  v_role text;
  v_priv text;
  v_open text;
begin
  foreach v_role in array array['public', 'anon', 'authenticated'] loop
    foreach v_priv in array v_table_privs loop
      if has_table_privilege(v_role, 'public.oauth_states', v_priv) then
        raise exception 'oauth_states_service_role_only: % still has % on public.oauth_states', v_role, v_priv;
      end if;
    end loop;
    foreach v_priv in array array['select', 'insert', 'update', 'references'] loop
      if has_any_column_privilege(v_role, 'public.oauth_states', v_priv) then
        raise exception 'oauth_states_service_role_only: % still has % on a column of public.oauth_states', v_role, v_priv;
      end if;
    end loop;
  end loop;

  foreach v_priv in array array['select', 'insert', 'update', 'delete'] loop
    if not has_table_privilege('service_role', 'public.oauth_states', v_priv) then
      raise exception 'oauth_states_service_role_only: service_role lacks % on public.oauth_states', v_priv;
    end if;
  end loop;

  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.oauth_states'::regclass) then
    raise exception 'oauth_states_service_role_only: row level security is off on public.oauth_states';
  end if;

  select string_agg(format('%s (%s)', p.policyname, p.cmd), ', ' order by p.policyname) into v_open
    from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'oauth_states'
     and p.roles && array['public', 'anon', 'authenticated']::name[]
     and not (coalesce(p.qual, '') = v_service_role_only
              and coalesce(p.with_check, '') = v_service_role_only);
  if v_open is not null then
    raise exception 'oauth_states_service_role_only: policies could still let anon or authenticated in: %', v_open;
  end if;
end;
$$;
