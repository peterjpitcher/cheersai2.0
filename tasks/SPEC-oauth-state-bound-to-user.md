# SPEC: A connection can only be finished by the person who started it

Status: requested by Peter on 29 September 2026; branch `fix/oauth-state-bound-to-user`. Not merged or deployed. Complexity 3 (M): four source files and their tests, no schema, no environment variables, no Meta setting.

## Why

Finding 9 of the independent review of the Page chooser (#158): `completeOAuthConnect` accepted any unexpired, unused OAuth state for a brand the signed-in user owns, whoever started it. Until #163 removed them, row level security policies let any signed-in user insert `oauth_states` rows for any brand, so a planted state plus a crafted callback link could connect someone else's Facebook Page to a brand. Since #163 only the service role can write the table, but a co-owner or super-admin could still finish another person's flow, and any leak of a state value would let them. The Facebook Ads callback had no sign-in check at all.

## What changes

Start (the signed-in user's id goes in `oauth_states.created_by`):

- `initiateOAuthConnect` for Facebook, Instagram and Change Page (`src/app/(app)/connections/actions.ts`).
- `startAdsOAuth` for Facebook Ads (`src/app/(app)/connections/actions-ads.ts`).
- `createPageChoice`, the Page chooser hand-off row (`src/lib/connections/page-choice.ts`), with the same user id that is already inside its encrypted payload.

Finish (refused unless `created_by` equals the signed-in user's id, on top of the existing brand, provider, expiry, not-a-Page-choice and single-use checks):

- `completeOAuthConnect`: checked straight after the lookup, before the owner check and before the state is marked used, so someone else's attempt does not use the state up. The mark-used update is also scoped by `created_by`.
- Page chooser: `readPageChoice` (the chooser page and the pick) needs both the row's `created_by` and the payload's user id to be the signed-in user; an expired row only reveals its Start again mode to that person. `claimPageChoice`'s conditional update also requires `created_by`.
- Facebook Ads callback (`src/app/api/oauth/facebook-ads/callback/route.ts`): reads the signed-in user from the cookie session (`getCurrentUser`) straight after the state lookup. No session, someone else, a row without `created_by`, or a failed sign-in check gets the existing `invalid_state` redirect; nothing is marked used and Meta is not called. The unexpired and not-a-Page-choice checks from #158 are unchanged, and the mark-used update is also scoped by `created_by`.

What the owner sees on a refusal is the existing message on a screen with a way to start again: "Invalid or expired OAuth state" on Connections (Facebook, Instagram), "We could not find this Page choice. Start again from the Connections screen." (chooser), "Meta Ads connection failed: invalid state" (Ads). A signed-out visitor on the Facebook and Instagram callback is still sent to sign in (#168), with nothing touched.

Logs: a warning through `createLogger("connections")` with ids only: the state row id, brand id, platform, signed-in user id and the id that started it (or null). Never the state value, the choice reference or a token. A failed sign-in check on the Ads callback is logged as an error.

## Rows created before this deploys

Every row the old code made has `created_by` null, and is refused. OAuth states and Page choices expire 10 minutes after they are made, so at worst an owner who started connecting in the 10 minutes before the deploy is refused once and starts again. Production had 0 rows when read on 29 September 2026.

## Live schema (production `nbkjciurhvkfpcpatbnt`, read only, 29 September 2026)

`created_by` is `uuid`, nullable, no default, no foreign key, no trigger. `expires_at` defaults to `now() + 10 minutes` (the Ads state relies on it). The only policy is "OAuth states managed by service role". A local rebuild gives the same shape (`20260926130000`). No migration is needed.

## Decisions

- Refuse before marking used: a refused attempt leaves the state for the person who started it.
- Same answer as an unknown state, so a refusal does not reveal that the state exists.
- `markOAuthStateFailed` (Meta's error callback on the Facebook and Instagram route) is left as it is: it cannot connect anything, only mark an unfinished login failed, and needs the random state value.
- The in-memory test database now refuses a `created_by` that is not a uuid, in writes and filters, as Postgres does; test user ids are uuids.

## Tests

Mocked Supabase (the in-memory database with production's constraints) and Meta; no live service, no `.env.local`.

- Start: `created_by` recorded for Facebook, Instagram, Change Page and Facebook Ads; a signed-out visitor stores nothing; a failed insert stores nothing and says so.
- `completeOAuthConnect`: the starter finishes; another owner of the same brand is refused for a Facebook, Instagram and Change Page login, the state stays unused and the starter can still finish; a null `created_by` is refused; a signed-out visitor touches nothing; a failed lookup or mark-used fails closed.
- Page chooser: the hand-off row carries `created_by`; another user, a null `created_by`, or a row and payload that disagree are refused; a claim only succeeds on the starter's row; a signed-out visitor touches nothing; a failed lookup or claim fails closed.
- Ads callback: the starter finishes; another signed-in user, no session and a null `created_by` get `invalid_state` with the state unused and Meta not called; a failed sign-in check and a failed lookup fail closed; only the starter is told a state was already used.

## Deploy order and rollback

- Merge deploys it. Nothing must go first: #163 is live, so no row level security policy reads `created_by`.
- Rollback: revert this PR. Rows made by this version keep their `created_by`, which the old code ignores.
- Do not roll back #163's policies while this is live: its rollback restores policies keyed on `created_by`, which would let a signed-in user read their own rows and reset `used_at` or extend `expires_at`. Revert this PR first.
