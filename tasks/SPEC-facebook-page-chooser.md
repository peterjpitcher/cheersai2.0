# SPEC: Facebook Page chooser

Status: approved for shipping by Peter on 29 September 2026 (PR #158, `feat/facebook-page-chooser`), after an independent review said merge with small findings; those fixes are recorded under "Review fixes" below.

## Why

`selectFacebookPage` in `src/lib/connections/token-exchange.ts` takes `pages[0]` when no Page id is stored, and Instagram separately takes the first Page with an Instagram account. An owner who manages several Pages can get the wrong venue connected, Facebook and Instagram can come from different Pages, and there is no way to choose. Self-serve sign-up opens after Meta App Review, so every owner with more than one Page would hit this.

## What changes

1. After the Facebook or Instagram login, if the owner manages more than one Page and no stored Page matches, CheersAI shows a chooser at `/connections/choose-page` listing their Pages: the name, and whether each has a linked Instagram professional account. The owner picks one and CheersAI connects it.
2. One Page, or a stored Page that still matches (every reconnect today, including The Anchor's), connects exactly as now with no extra step.
3. Facebook and Instagram use the same Page (rules below).
4. "Change Page" on the connections screen runs the same chooser.
5. `fetchManagedPages` also reads each Page's `tasks` (a default field of `/me/accounts`, per Meta's reference) and follows `paging.next` (up to 4 requests, Graph host only), so an owner with more than 25 Pages sees all of them.

## Selection rules

`resolvePageSelection` in `src/lib/connections/page-selection.ts` (pure, unit tested). "Linked Page" means the other platform's stored `pageId`, used only while that connection holds an access token.

Facebook login:

1. No Pages returned: error, as now.
2. Change Page: chooser.
3. The linked Instagram Page is returned: connect it.
4. Facebook's own stored `pageId` is returned: connect it (as now).
5. Exactly one Page: connect it (as now).
6. Otherwise: chooser.

Instagram login:

1. No Pages, or no Page with an Instagram account: error, as now.
2. Facebook is connected: Instagram always uses Facebook's Page. If that Page has no Instagram account, or the login did not return it, the owner gets a clear error. Change Page cannot override this.
3. Change Page: chooser.
4. The stored Instagram account id matches: connect it (as now).
5. Instagram's own stored `pageId` is returned with an Instagram account: connect it.
6. Exactly one Page: connect it (as now).
7. Otherwise: chooser.

For every brand in production today, Facebook and Instagram hold the same `pageId` (checked read-only on 29 September 2026), so steps 3 (Facebook) and 2 (Instagram) pick exactly the Page the old rules picked.

## Decisions

1. **Facebook is the anchor.** Only the Facebook login can serve both platforms (its scopes include `instagram_basic` and `instagram_content_publish`; the Instagram login lacks `pages_manage_posts`). So Change Page is offered on the Facebook card whenever Facebook is connected, and on the Instagram card only when Facebook is not connected.
2. **Instagram follows a Facebook choice.** When the owner picks a Page in a Facebook chooser and Instagram is connected to a different Page: if the new Page has an Instagram account the owner can post to, Instagram moves to it using the new Page token from the same login (its stored scopes become the Facebook list); if not, Instagram is disconnected (tokens deleted, `needs_action`), exactly as the Disconnect button does. The chooser warns about both outcomes next to each Page before the owner picks.
3. **Which Pages can be picked.** Facebook: the Page returned an access token and, when Meta sends `tasks`, it includes `CREATE_CONTENT` (Meta's publishing requirement). Instagram: an Instagram account is linked, a token was returned and, when `tasks` is sent, it includes `CREATE_CONTENT`, `MODERATE` or `MANAGE` (Meta lists Instagram publishing under `MODERATE`). Other Pages are listed but cannot be picked, with the reason shown. Missing `tasks` does not block. The automatic paths keep today's check (token present) and do not add the `tasks` check, so nothing that connects today stops connecting.
4. **The hand-off stays on the server.** The callback stores one encrypted record in `oauth_states`: the long-lived Meta user token, its expiry, the Meta user id, the signed-in user id, the brand, the platform and the display list (Page id, name, Instagram username, whether each can be picked). No Page token is stored; they are fetched again when the owner picks. The browser gets only a random 32-byte reference in the chooser URL, the Page names and flags; no token ever reaches it.
5. **No schema change.** The record is an `oauth_states` row: `state` is the random reference (unique), `account_id` the brand, `provider` the platform, `auth_code` the AES-256-GCM payload from `src/lib/token-vault`, `redirect_to` is `/connections/choose-page`, `expires_at` is 10 minutes, `used_at` marks it used. `created_by` is left empty on purpose: production's `oauth_states_select` and `oauth_states_update` policies let a signed-in user read and update rows whose `created_by` is their own id, which would let them reset `used_at` or extend `expires_at`. The app reaches this table only with the service role.
6. **Single use, bound to the owner and the brand.** Reading requires the row's brand to be one the user owns (or super-admin), the decrypted payload's user id to be the signed-in user and its brand and platform to match the row. Picking first claims the row with a conditional update (`used_at is null`, not expired) that also clears the encrypted payload, so a double submit or a replay gets "already used". A row with no payload is refused, so an OAuth state can never be used as a choice, and the OAuth callback now ignores rows that carry a payload, so a choice can never be used as an OAuth state.
7. **Checked again when the owner picks.** The Page must be one they were shown, still returned by Meta for that login, and still pickable (fresh token, `tasks` and Instagram link). Any failure shows the reason and a Start again button, and logs a warning through `createLogger("connections")` (Axiom and Vercel logs) with the brand, platform and reason, never a token.
8. **Owner of the initiating brand.** `completeOAuthConnect` checked only membership of the brand that started the flow; it now requires owner (or super-admin), matching decision D4. This only refuses more: an owner who started the flow still passes. The chooser page and the pick both check ownership of the brand the choice is for, not of the brand selected now (review fix 4).
9. **Change Page on a one-Page login still shows the chooser**, with a note that Facebook only shared one Page and how to share more.
10. **The chooser keeps its own result.** Picking a Page uses the choice up, and Next.js re-renders the page after the server action (seen when the session cookie is refreshed), which on its own would replace a specific error, or the success, with "already used". Found by running the page locally; one client component now renders every case and its own outcome wins. On a later reload a used choice says: "This Page choice has already been used. If your Page is not connected yet, start again from the Connections screen."

## Security notes

- Tokens stay encrypted at rest (the hand-off payload with the vault key, connection tokens in `token_vault` as now) and are never logged. Graph error text passes through `redactMetaAccessTokens` (`src/lib/meta/redact.ts`) before it is logged or shown. The chooser page sets `referrer: same-origin`.
- Every new service-role query is scoped by `account_id` (`token_vault` by the brand's own connection ids, as `disconnectProvider` does).
- Every `oauth_states` read and write in this change uses the service role; nothing relies on the table's user-scoped policies or grants, which a separate PR removes.
- An expired choice has its encrypted payload dropped the first time it is read after expiry (the chooser page or a pick). A choice nobody opens again keeps it until the existing data-retention cron deletes `oauth_states` rows 24 hours after expiry.

## Review fixes (29 September 2026)

From the independent review of PR #158, all in the same PR:

1. The Ads OAuth callback (`/api/oauth/facebook-ads/callback`) only accepts an unexpired login state without an `auth_code`, and marks used only that row, so a pending Page choice can never pass as its login check.
2. `markOAuthStateFailed` in the Facebook and Instagram callback skips rows with an `auth_code`, so an error callback naming a choice's reference cannot use the choice up.
3. A Facebook pick is refused, with Start again, when Instagram was connected, disconnected or moved since the login, because the chooser's Instagram notes came from the login: "Your Instagram connection changed while you were choosing, so the Instagram notes on this screen are out of date. Start again."
4. The pick checks ownership of the brand the choice is for (as the chooser page does), not of the brand selected now, so an owner who switched brand while choosing can finish; anyone else is refused with a logged reason.
5. A Page that cannot be picked dims only its radio and name, so the reason (6.6:1) and the Instagram line (5.0:1) keep full contrast.
6. After a failed pick, focus moves to the reason.
7. An expired choice has its encrypted payload dropped as soon as it is read (see Security notes). Start again is offered only on that first look, when the flow's mode is still known; later looks say "This Page choice has expired. Start again from the Connections screen." with Back to Connections.
8. Graph error text from the connection, Ads callback and Ads setup code has anything shaped like a Meta access token (`EAA` plus token characters) replaced with "[redacted token]" before it is logged or put in an address.

Binding the OAuth state to the user who started the flow is a separate follow-up, not part of this PR.

## Not handled

- If Instagram is connected to Page A and a later Facebook login returns only one other Page B (the owner removed CheersAI's access to A in Facebook), Facebook connects B as it does today and Instagram stays on A. Change Page on the Facebook card fixes it.
- The manual Page ID and Instagram ID fields on the cards are unchanged.

## Deploy order and rollback

- No migration, no new environment variable, no Meta setting. Uses `TOKEN_VAULT_KEY`, already set in Vercel.
- Rollback: revert the PR. A chooser link in flight then 404s and the owner connects again from the connections screen; hand-off rows expire on their own.
