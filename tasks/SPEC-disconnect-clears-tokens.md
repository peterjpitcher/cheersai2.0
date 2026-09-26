# SPEC: Disconnect deletes the stored Facebook and Instagram tokens

## What changes

`disconnectProvider` in `src/app/(app)/connections/actions.ts`:

1. Writes `status: 'needs_action'` directly. The old first write, `status: 'disconnected'`, is rejected by the live CHECK `social_connections_status_check` (allowed: `active`, `expiring`, `needs_action`), so every call errored before a fallback wrote `needs_action`.
2. Deletes the brand's credentials for that provider: the `token_vault` rows for the provider's connection ids, then nulls `access_token`, `refresh_token`, `token_expires_at` and `expires_at` on `social_connections`. Every query is scoped by `account_id` and `provider`. This mirrors `offboardBrand` (`src/lib/admin/offboarding.ts`) and `revokeMetaUserData` (`src/lib/meta/data-requests.ts`).
3. Any failed step returns `{ success: false, error }` and logs it; nothing reports success while a token is still stored.

The `social_connections` row itself stays (metadata and history kept for a reconnect).

## Why

Security rule in CLAUDE.md: tokens are only held while needed. After Disconnect, the tokens stayed in the vault and in the legacy plaintext columns.

## Live schema checked (2026-09-25, project nbkjciurhvkfpcpatbnt)

- `social_connections`: `access_token`, `refresh_token`, `expires_at`, `token_expires_at` nullable; `status` NOT NULL, CHECK as above; `updated_at` NOT NULL.
- `token_vault.social_connection_id` FK to `social_connections(id)` ON DELETE CASCADE; no `account_id` column, so it is scoped through the brand's connection ids.
- `meta_ad_accounts.access_token` NOT NULL default `''`.

## Decisions

- No migration.
- No change on the ads side: `actions-ads.ts` has no disconnect action, and the shared revocation helper `deleteMetaAdAccountTokens` already blanks `meta_ad_accounts.access_token` to `''` (not null) and is covered by `tests/lib/meta/ad-account-tokens.test.ts`.
- `disconnectProvider` has no caller in the UI today (no Disconnect button on the connection cards). The fix makes it correct for when one is added.

## Tests

`src/app/(app)/connections/actions.test.ts`: an in-memory Supabase mock that rejects writes breaking the live NOT NULL and CHECK rules, plus failing-dependency cases (lookup, vault delete, connection update) asserting the caller sees the failure.

## Rollback

Revert the PR. No data or schema to undo.
