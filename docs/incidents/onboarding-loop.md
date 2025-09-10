# Incident: Onboarding Loop After Completion

Status: Open
Owner: Platform
Last updated: 2025-09-10

## Summary

Users who complete onboarding are redirected back to `/onboarding` instead of landing on `/dashboard`. This presents as a loop where the flow appears to “finish” but the app renders the first onboarding step again.

## Impact

- Users cannot proceed to the application after onboarding.
- Per logs, the server action issues a redirect (303), but routing ends up on `/onboarding`.

## Observed Behaviour

From local dev logs (Next 15):

- POST `/onboarding` → 303
- Followed by GET `/onboarding` → 200 (multiple)
- Also observed GET `/dashboard` → 200 earlier in the session

This indicates:

1) The server action finished and attempted a redirect (303 is expected for POST).
2) After the action, the client or server routing brought the user back to `/onboarding`.

## Expected Behaviour

- Completing onboarding should redirect to `/dashboard` and stay there.

## Architecture Notes (relevant pieces)

- Frontend:
  - `app/onboarding/page.tsx` (client) calls server action `completeOnboarding()`.
  - `app/actions/onboarding.ts` (server action) creates/ensures a tenant, updates profile, and calls `redirect('/dashboard')`.
  - `app/onboarding/layout.tsx` (server) should redirect to `/dashboard` when the user already has a tenant (or membership).
  - `app/(authed)/dashboard/page.tsx` gates access, ensuring a tenant exists.
  - `middleware.ts` treats `/onboarding` as an authenticated section but does not force `/onboarding`.

- Backend / DB:
  - `public.create_tenant_and_assign(...)` (SECURITY DEFINER) creates a tenant, assigns `users.tenant_id`, creates a `user_tenants` membership, and upserts brand profile.
  - RLS policies allow selecting `users` (own row) and `user_tenants` (self membership).

## Hypotheses

1) Gating based on `users.tenant_id` is false-negatives in prod (NULL), and the membership fallback is not consistently used → server routes redirect to `/onboarding`.

2) RLS blocks the `tenants` inner-join used by some routes, and the route interprets the missing row as “no tenant”, redirecting to `/onboarding`.

3) The server action’s redirect is sent (303), but the subsequent navigation evaluates a server gate (dashboard or layout) that again decides “no tenant”, sending the user back to `/onboarding`.

4) Environment drift: the web is pointed at a Supabase project that doesn’t contain the user’s membership or `users.tenant_id`, so gating fails.

## Changes Already Implemented

Code (server gating and idempotency):

- `app/actions/onboarding.ts`: Idempotent logic — if RPC returns “already has tenant”, fetch and reuse the existing tenant; do not throw.
- `app/onboarding/layout.tsx`: Server-side redirect to `/dashboard` when `users.tenant_id` or a `user_tenants` membership exists.
- `app/(authed)/dashboard/page.tsx`: Removed `tenants!inner` join; prefer `users.tenant_id`, fall back to `user_tenants`; persist `users.tenant_id` best‑effort; fetch tenant separately (non-fatal).
- `app/(authed)/campaigns/page.tsx`: Same fallback and persistence.
- `lib/settings/service.ts (getUserAndTenant)`: Same fallback and persistence; avoids inner join for gating.
- `lib/supabase/auth-cache.ts (getAuthWithCache)`: Same fallback; persists `users.tenant_id`; fetches tenant separately.

Database (migrations; applied to linked project):

- `20250910141000_make_create_tenant_idempotent.sql`: `create_tenant_and_assign` returns existing tenant instead of raising.
- `20250910142000_backfill_user_tenant_id.sql`: Backfills `users.tenant_id` from `user_tenants` or `tenants.owner_id`.

CLI verification:

- `supabase db push` executed against the linked project (pooler). Non-blocking notice about role grant; migrations listed as applied.

## Current Status

- Despite the above, the loop is still reproducible locally against the remote project. Logs show the action redirect (303) followed by GET `/onboarding` (200).

## Likely Root Cause (Working Theory)

- After the server action’s 303 to `/dashboard`, a subsequent gate (on `/dashboard` or `/onboarding`) evaluates “no tenant” due to state that is still not visible (e.g. `users.tenant_id` not set yet, membership not readable under RLS in that request, or environment mismatch). That gate then sends the user to `/onboarding`, and the onboarding layout fails to detect tenancy for the same reason, rendering a 200 page.

## Immediate Next Steps (Senior Dev Guidance Requested)

1) Instrument the flow with request-scoped logs (requestId) and explicit values:
   - In `completeOnboarding`: log user id, pre/post `users.tenant_id`, RPC result, and the final `tenantId` used before redirect.
   - In `app/onboarding/layout.tsx`: log user id, `users.tenant_id`, membership query result, and branch taken.
   - In `app/(authed)/dashboard/page.tsx`: log the computed `tenantId` (from user vs membership) and whether a redirect happened.

2) Validate user state in the DB (Supabase SQL):
   ```sql
   -- Replace placeholders
   select id, tenant_id from public.users where email = '<user-email>';
   select * from public.user_tenants where user_id = '<auth-user-id>' limit 5;
   select id, owner_id, slug, name from public.tenants where id in (
     select tenant_id from public.user_tenants where user_id = '<auth-user-id>'
   );
   ```

3) Confirm the function version:
   ```sql
   select p.oid, p.proname, pg_get_functiondef(p.oid)
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_tenant_and_assign';
   ```

4) Confirm web → Supabase project alignment:
   - Verify `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` point to the same project where you checked the rows.

5) Make onboarding completion unambiguous:
   - Add an explicit `users.onboarding_complete boolean default false`.
   - Set to `true` at the end of `completeOnboarding`.
   - Gate `/onboarding` solely on `onboarding_complete === false` (not on tenant visibility), and make `/dashboard` always accessible (showing an empty state if tenant data isn’t visible yet).

6) DB safety net (optional but recommended):
   - Add an AFTER INSERT trigger on `user_tenants` to set `users.tenant_id` when missing (owner first). This prevents a state where membership exists but `users.tenant_id` is NULL.

## Proposed Fix Plan

Phase 1 (diagnostics):

- Add structured logs as in step (1) above with `requestId` propagation.
- Run the flow in prod/staging and capture a single timeline showing values and redirect branches.

Phase 2 (state correctness):

- Add `users.onboarding_complete boolean not null default false`.
- Update `completeOnboarding` to set it true in the same transaction/RPC.
- Gate `/onboarding` and login redirect logic using `onboarding_complete` instead of derived tenant visibility.

Phase 3 (hardening):

- Add the `user_tenants` → `users.tenant_id` backfill trigger.
- Remove inner-join-based gating permanently (already mostly done).

## Acceptance Criteria

- Completing onboarding always lands on `/dashboard`.
- Visiting `/onboarding` after completion always redirects server-side to `/dashboard`.
- Users with existing memberships bypass onboarding reliably, with or without `users.tenant_id` set.
- No RLS-induced redirects to onboarding after completion.

## Rollout & Validation

- Apply SQL migrations (schema change + trigger).
- Redeploy the app.
- Verify with a fresh user and with an existing user whose `users.tenant_id` is NULL but has membership.

## Appendix: Relevant Files

- Frontend:
  - `app/actions/onboarding.ts`
  - `app/onboarding/layout.tsx`
  - `app/(authed)/dashboard/page.tsx`
  - `app/(authed)/campaigns/page.tsx`
  - `lib/settings/service.ts`
  - `lib/supabase/auth-cache.ts`
  - `middleware.ts`

- DB:
  - `supabase/migrations/20250910141000_make_create_tenant_idempotent.sql`
  - `supabase/migrations/20250910142000_backfill_user_tenant_id.sql`

