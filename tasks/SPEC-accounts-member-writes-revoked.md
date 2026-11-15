# Spec: a signed-in user can no longer write to the accounts table

Owner approval: 15 November 2026. Asked: "Shall I close the gap that lets a customer change their own billing and feature flags?" Peter's reply: "Yes, fix it".

## Problem

- `authenticated` is the role behind every signed-in session. A customer can call the Supabase API directly with their own session; the app is not the only way in.
- On 14 November 2026 `authenticated` held INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER on `public.accounts`, and the `accounts_update` policy allows any member of a brand to update that brand's row.
- Row level security decides which row, never which column. So a member could change, on their own brand:
  - `billing_override` (set it to `comped`, which is free);
  - `paid_ads_enabled`, `tournaments_enabled`, `management_import_enabled`;
  - `booking_ingest_secret`, `archived_at`, `offboarded_at`, `purge_after`.
- Found during the review of peterjpitcher/cheersai2.0#233. `google_posts_enabled` was guarded there with a trigger; the older columns were not.

## Checked live on 14 and 15 November 2026 (project nbkjciurhvkfpcpatbnt)

- **Proved, then undone.** Inside a rolled-back transaction, with a real non-admin member's session claims, a direct update of their own brand's row succeeded (one row). No data was changed.
- **Nothing legitimate needs the access.** Every write to `accounts` in `src/` uses the service role:
  - the admin actions (`src/app/(app)/admin/actions.ts`): `requireAuthContext()` hands back the service-role client (`src/lib/auth/server.ts:102`);
  - offboarding (`src/lib/admin/offboarding.ts`);
  - sign-up, through `provision_self_serve_brand`, which `authenticated` and `anon` cannot execute.
- No browser-client or session-client code writes to `accounts`. Session clients only read it, through the `accounts_select` policy.
- No function that `authenticated` can execute writes to `accounts`.
- `anon` already holds no write (24 October 2026, #223).

## Decision

- One migration: `revoke all on table public.accounts from authenticated`, then `grant select` back, in one transaction. It checks its own result and aborts otherwise.
- The policies stay; without the privilege they grant a user session nothing. The guard trigger on `google_posts_enabled` stays as a second layer.
- `anon` and `service_role` are not changed.
- `supabase/tests/accounts_member_writes_revoked_verify.sql` checks the catalogue and asks the role itself; CI runs it on every from-scratch rebuild.

## Out of scope, reported to Peter

Other tables give a member direct write access to their own brand's rows through the API, by the same pattern (`publish_jobs`, `social_connections`, `token_vault`, `meta_campaigns`, `campaigns` and more). Most of that is the brand's own content. Two matter for billing and safety: a member could move a job held for non-payment (`publish_jobs.status = 'held'`) back to `queued`, and could write their own `token_vault` rows. Closing those needs an audit of every session-client write first, so it is a separate change.

## Rollback

`grant insert, update, delete, truncate, references, trigger on table public.accounts to authenticated;` restores the old state. No app deploy is tied to this migration in either direction.

## Tests

- The migration's own check.
- The verify script, on CI's fresh rebuild and on production after applying.
- On production, in a rolled-back transaction with a real member's claims: the member can still read their brand, cannot update it, and the service role still can.
- CI's e2e smoke suite (real sign-in) on the PR.
