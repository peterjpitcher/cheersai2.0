# SPEC: Disconnect Meta Ads

Approved by Peter 2026-09-26 (separate PR from the Facebook and Instagram Disconnect, #105 and #112).

## What changes

1. `disconnectAdAccount()` in `src/app/(app)/connections/actions-ads.ts` (owner only, paid-ads brands only):
   - Refuses while a campaign can still spend: `meta_campaigns.status = 'ACTIVE'` and `end_date` null or on or after today (Europe/London). Without the token the app could no longer pause it.
   - Deletes the ads access token and the Conversions API token through `deleteMetaAdAccountTokens` (the encrypted `meta_ad_account_tokens` rows). Phase 2 (#104) already cleared the legacy plaintext columns and nothing writes them now; `access_token` stays `''` (NOT NULL), and this change never writes it.
   - Sets `meta_ad_accounts.setup_complete = false` and `token_expires_at = null`, as offboarding does. The ad account id, pixel id and conversion settings stay, so reconnecting is quick.
   - Every step scoped by `account_id`; any failure returns `{ error }` and is logged.
2. A Disconnect button on the "Meta Ads connected" panel (`AdAccountSetup`), shown only to owners, with a confirm step.
3. `sync-meta-campaigns` cron skips brands whose ads setup is not complete, as `optimise-meta-campaigns` already does. Without this, a disconnected brand's campaigns would fail to sync every day and the cron would report errors.

## Why

Tokens are only held while needed (CLAUDE.md, Security rules). There was no way for a venue to remove CheersAI's access to its ad account.

## Facts checked (live, 2026-09-26)

- `meta_campaigns`: 13 ACTIVE, 1 PAUSED, all The Anchor's. 9 of the 13 ACTIVE ended between 8 May and 14 August 2026: the status never changes after the end date, so "any ACTIVE campaign" (the offboarding rule) would block a disconnect forever. The 4 Weekday campaigns end 16 October 2026.
- `end_date` is a nullable `date`; `start_date` NOT NULL.
- `meta_ad_accounts`: one row (The Anchor), `setup_complete = true`, both tokens in `meta_ad_account_tokens`, plaintext columns empty. The new sync filter changes nothing today.
- Conversions API sends with no token return `skipped / not_configured`; the retry cron keeps those rows eligible, so bookings made while disconnected are sent once a token is saved again (Meta accepts events up to 7 days old).

## Decisions

- Disconnect deletes both tokens, not just the ads access token: CheersAI holds no Meta ads credentials afterwards. The confirm text says booking conversions pause until the venue reconnects and re-enters the Conversions API token.
- `meta_user_id` is left as is (the deauthorise and deletion callbacks can still find the brand), matching the Facebook and Instagram disconnect.
- Offboarding keeps its stricter "any ACTIVE" rule for now; not changed here.

## Tests

- `tests/lib/campaigns/actions-ads.test.ts`: in-memory store enforcing the live NOT NULL rules on `meta_ad_accounts` and the `token_type` CHECK on `meta_ad_account_tokens`, using the real `deleteMetaAdAccountTokens`. Cases: success; running campaign refuses; ended ACTIVE and PAUSED campaigns do not block; failing campaign check, token delete and account update each return an error.
- `AdAccountSetup.test.tsx`: button only for owners, cancel does nothing, success and failure toasts.
- `tests/app/sync-meta-campaigns-cron.test.ts`: a brand without completed setup is skipped.

## Rollback

Revert the PR. No schema change. A brand that disconnected reconnects through the normal Connect flow.
