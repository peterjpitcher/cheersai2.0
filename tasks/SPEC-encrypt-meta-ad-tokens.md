# SPEC: encrypt the paid-ads Meta tokens at rest

Status: phase 1 built on branch `fix/encrypt-meta-ad-tokens` (not merged, migration not applied). Phase 2 drafted only.

## Problem

`public.meta_ad_accounts` stores the Meta Ads long-lived access token (`access_token`) and the Conversions API token (`conversions_api_access_token`) in plaintext. CLAUDE.md requires social OAuth tokens to be encrypted with `src/lib/token-vault`.

It is worse than storage hygiene. Verified on live `nbkjciurhvkfpcpatbnt` on 2026-09-25:

- `anon` and `authenticated` hold SELECT, INSERT and UPDATE on both columns, and the only RLS policy is `is_account_member(account_id)` for ALL. Any signed-in member of a brand can read that brand's tokens with the public anon key and the browser client.
- One row (The Anchor, `account_id 91fda684-...`), both tokens present, `setup_complete = true`, `token_expires_at` null.
- No views, functions or triggers reference the table.

## Design

New table `public.meta_ad_account_tokens` (migration `20260925180000_meta_ad_account_tokens.sql`): one row per brand and token type (`access`, `conversions_api`), holding the token-vault payload (ciphertext, iv, tag, key_version). It mirrors `token_vault`, which cannot be reused because its rows reference `social_connections`. The foreign key is `account_id -> meta_ad_accounts(account_id) on delete cascade`. RLS on with no policies; `anon` and `authenticated` get nothing; `service_role` gets select, insert, update, delete.

One module owns every read and write: `src/lib/meta/ad-account-tokens.ts`.

- `getMetaAdAccountTokens(supabase, accountId)` returns `{ accessToken, conversionsApiToken }`. It reads the encrypted rows first. For a token type with no encrypted row it reads the plaintext column (phase 1 fallback) and copies it into the vault with insert-if-absent, so a concurrent reconnect is never overwritten by a stale value. A token that cannot be decrypted throws (never falls back), so callers fail visibly. A missing table (code deployed ahead of the migration) falls back to plaintext and logs an error.
- `storeMetaAdAccountToken(supabase, accountId, type, token)` upserts the encrypted row, then blanks the plaintext column. It throws if the encrypted write fails.
- Local ops scripts must never write: `copyPlaintext: false` turns off the lazy copy, because a local `TOKEN_VAULT_KEY` that differs from production's would write a row production cannot decrypt.

### Call sites moved to the module

| File | Before | After |
|---|---|---|
| `src/app/api/oauth/facebook-ads/callback/route.ts` | upsert `access_token` | upsert the row without the token, then `storeMetaAdAccountToken` (`db_error` redirect on failure) |
| `src/app/(app)/connections/actions-ads.ts` | read `access_token` (fetch and select account, status); re-wrote it on select; wrote CAPI token | read via module; select no longer rewrites the token; CAPI token stored via module, error returned if it fails |
| `src/app/(app)/campaigns/actions.ts` | 4 reads (conversion config, generate, apply recommendation, activate replacement) | module |
| `src/app/(app)/campaigns/[id]/actions.ts` | publish and pause | module |
| `src/lib/campaigns/performance-sync.ts`, `optimisation.ts`, `food-materialise.ts` | read `access_token` (and CAPI in optimisation) | module |
| `src/lib/meta/conversions-api.ts` | read CAPI token | module; an unreadable token returns `failed`, not `skipped` |
| `src/app/api/cron/optimise-meta-campaigns/route.ts` | filtered `access_token <> ''` in SQL | filter removed (it would skip every brand after phase 2); brands without a token are skipped in the loop |
| `scripts/ops/search-meta-interests.ts` | read plaintext | reads the encrypted row with a relative token-vault import, plaintext fallback, never writes |

Nothing in `supabase/functions` reads these columns.

## Rollout

Phase 1 (this branch):

0. Apply migration `20260925181000_meta_ad_accounts_service_role_only.sql` (approved 2026-09-25): revokes `anon` and `authenticated` access to `meta_ad_accounts`, which closes the browser read of the plaintext tokens immediately. Every app path already uses the service role.
1. Apply migration `20260925180000_meta_ad_account_tokens.sql` to production (needs explicit approval; expand-only).
2. Merge and deploy the code. Order matters only softly: code before the migration still works (plaintext fallback), but a reconnect would fail until the table exists.
3. The first read of each brand's tokens copies them into the vault: the daily `optimise-meta-campaigns` cron, any `/connections` or `/campaigns` load, or a CAPI forward. No backfill script is needed and the key never leaves production.
4. Verify (read only, no token values):

```sql
select m.account_id,
       coalesce(m.access_token, '') <> '' as has_plain_access,
       coalesce(m.conversions_api_access_token, '') <> '' as has_plain_capi,
       exists (select 1 from meta_ad_account_tokens t where t.account_id = m.account_id and t.token_type = 'access') as vault_access,
       exists (select 1 from meta_ad_account_tokens t where t.account_id = m.account_id and t.token_type = 'conversions_api') as vault_capi
from meta_ad_accounts m;
```

   and confirm in Axiom that `[meta-ad-tokens]` shows `copied plaintext Meta Ads token into the vault` and no `could not be decrypted` errors, and that the next sync, optimiser run and CAPI forward succeeded.

Phase 2 (separate PR, after step 4 is clean for every brand):

1. Code: delete `readPlaintextTokens`, `copyPlaintextToVault` and the plaintext blanking from the module; drop the plaintext fallback from `scripts/ops/search-meta-interests.ts`.
2. Migration: `tasks/DRAFT-phase2-clear-meta-ad-plaintext-tokens.sql` moves into `supabase/migrations/`. It aborts if any plaintext token lacks an encrypted copy, blanks both columns, and adds CHECK constraints so nothing can write plaintext there again.
3. Dropping the two columns is a later, separate decision (column drop needs explicit approval).

## Rollback

- Phase 1 code: revert the deploy. The old code reads the plaintext columns, which the lazy copy never clears. Only a brand that reconnected Meta Ads or saved a new CAPI token after the deploy has a blank plaintext column; on old code it shows as disconnected and must reconnect.
- Phase 1 migration: `drop table public.meta_ad_account_tokens;` (only while plaintext is still populated, i.e. before phase 2).
- Phase 2: drop the two constraints. Cleared plaintext is not restorable from the database; the encrypted rows are the source of truth.

## Decisions and assumptions

- A new table rather than widening `token_vault`: keeps the organic vault's foreign key and RLS unchanged.
- Lazy copy on read instead of a backfill script: the encryption key stays in production.
- Rows are keyed by `account_id` so every query carries `.eq('account_id', accountId)` (tenancy rule).
- A decrypt failure fails loudly (error shown, cron marks the brand failed, CAPI returns `failed`) rather than treating the brand as disconnected, except on the Connections status card, where "disconnected" is the right prompt to reconnect.
- Tokens are trimmed on write and read; blank values count as absent (matches the old `?.trim()` checks).
- Key rotation works as for organic tokens: `decrypt()` uses the current key.

## Tests

- `tests/lib/meta/ad-account-tokens.test.ts`: real AES-GCM round trips; vault-first; plaintext fallback and lazy copy (encrypted, insert-if-absent); `copyPlaintext: false`; copy failure still returns the token; decrypt failure throws without fallback; read error throws; missing table falls back; store encrypts, replaces and blanks the right column; store failure throws and leaves plaintext; empty token and missing key refused.
- `tests/app/facebook-ads-callback-route.test.ts`: the token never reaches `meta_ad_accounts`; stored after the row exists; store failure redirects with `db_error`.
- `tests/app/optimise-meta-campaigns-cron.test.ts`: brands without a token are skipped; an unreadable token is reported as a failure.
- `tests/lib/campaigns/actions-ads.test.ts`, `tests/lib/meta/conversions-api.test.ts`: new cases for status, CAPI save failure and CAPI decrypt failure; existing suites mock the module.
