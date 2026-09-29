# SPEC: oauth_states reachable by the service role only

Status: applied to production on 29 September 2026 through the Supabase MCP, recorded as version `20260929115219` (the file is renamed to match; the stored SQL equals the file minus its final newline, sha256 `d44fa114a23b9176c6ec8bd9e5f8d5e1ee9ee25a3f23faacd13df1b5f6e24790`). `supabase/tests/oauth_states_service_role_only_verify.sql` passes on production.

## Why

`public.oauth_states` holds OAuth handshakes in flight and, with the Facebook Page chooser (PR #158), an encrypted Meta user token waiting for the owner's Page choice. The app only ever reaches it with the service-role client, but production still lets a signed-in user in: three row level security policies let them insert rows directly (for any `account_id`) and read and update rows carrying their own `created_by`, and `authenticated` holds every table privilege, TRUNCATE included, which row level security does not govern. Peter approved removing that access on 29 September 2026 ("remove unused database permissions that let signed-in users write sign-in records directly").

## What changes

- Migration `supabase/migrations/20260929115219_oauth_states_service_role_only.sql`: drops `oauth_states_select`, `oauth_states_insert` and `oauth_states_update`; revokes every table privilege from PUBLIC, anon and authenticated; restates `grant all ... to service_role`; then raises (rolling itself back) if anything is still open. Row level security stays on. No row changes.
- Check `supabase/tests/oauth_states_service_role_only_verify.sql`: read-only, safe on production. Fails if PUBLIC, anon or authenticated hold any table or column privilege, if any policy other than the service-role one applies to them, if a SELECT as anon or authenticated is not refused, if row level security is off, or if service_role lost select, insert, update or delete.
- No app code changes.

## Live state (production `nbkjciurhvkfpcpatbnt`, read 29 September 2026)

- Policies, all permissive and for role `public`: "OAuth states managed by service role" (ALL, using and with check `auth.role() = 'service_role'`), `oauth_states_select` (SELECT, using `created_by = auth.uid()`), `oauth_states_insert` (INSERT, with check `created_by = auth.uid()`), `oauth_states_update` (UPDATE, using `created_by = auth.uid()`, no with check).
- Grants: `postgres` (owner) arwdDxtm, `authenticated` arwdDxtm, `service_role` arwdDxtm; anon none (revoked by `20260905053345`); no column grants. Row level security on, not forced. 0 rows.
- Dependencies: the only function naming the table is `public.run_data_retention(boolean)` (SECURITY DEFINER, owner postgres, EXECUTE for postgres and service_role). No views, triggers, incoming foreign keys or publications.

## Code paths checked (main and `feat/facebook-page-chooser`)

Every read and write uses `createServiceSupabaseClient()`: `initiateOAuthConnect` and `completeOAuthConnect` (`src/app/(app)/connections/actions.ts`), `startAdsOAuth` (`actions-ads.ts`), `markOAuthStateFailed` (`src/app/api/oauth/[provider]/callback/route.ts`), the ads callback (`src/app/api/oauth/facebook-ads/callback/route.ts`), and on the chooser branch `createPageChoice`, `readPageChoice` and `claimPageChoice` (`src/lib/connections/page-choice.ts`, called only with the service client from `actions.ts`, `page-choice-actions.ts` and `choose-page/page.tsx`). The retention cron calls `run_data_retention` through `tryCreateServiceSupabaseClient()`. Nothing in `supabase/functions/`, `scripts/` or `e2e/` touches the table, and no app path sets `created_by`.

## Decisions

- "OAuth states managed by service role" stays: it matches only a service-role JWT, and service_role bypasses row level security anyway, so it lets nobody else in. A rebuild creates the same policy (`20260926130000`).
- PUBLIC is revoked as well as anon and authenticated (a no-op on production), so neither role can get in through PUBLIC.
- The service_role grant is restated so the migration states the table's full grants; it is a no-op on production.
- `supabase/anon-access-allowlist.ts` (a stale oauth_states entry since 5 September, which the test reports without failing) and the `supabase/SCHEMA.md` snapshot are left as they are.

## Deploy order and rollback

1. Apply the migration to production through the Supabase MCP `apply_migration` tool, then run the verify check there: it must end with `oauth_states_service_role_only_verify: pass`.
2. Rename the file to the version production recorded (`list_migrations`), commit that to this branch, then merge. No app deploy is needed, and the order against #158 does not matter: both only use the service role.

Rollback (restores exactly what production had on 29 September 2026):

```sql
create policy "oauth_states_select" on public.oauth_states
  for select using (created_by = auth.uid());
create policy "oauth_states_insert" on public.oauth_states
  for insert with check (created_by = auth.uid());
create policy "oauth_states_update" on public.oauth_states
  for update using (created_by = auth.uid());
grant select, insert, update, delete, truncate, references, trigger, maintain
  on table public.oauth_states to authenticated;
```
