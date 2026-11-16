# SPEC: Google Business Profile posting as a third channel

Status: draft v4, 14 November 2026. Replaces v3 (24 September 2026). PR1 (data and contracts) shipped in November 2026 (#233). PR2 (connection) built 16 November 2026, before Google's approval, so it fails closed at Google's quota wall and cannot be accepted until the quota is above zero (section 4, "Built in PR2"). Review history: `tasks/REVIEW-gbp-posting-reintroduction.md` (findings GBP-01 to GBP-14, all still addressed below).
- 16 November 2026 (D12): Google versions are attached to Facebook feed posts and sent by their own cron. Sections 2, 5, 6, 7 and 8, the wiring checklist and Delivery are rewritten to describe what is built. The publish worker, the queue, the handler, preflight and the `Platform` types are untouched. Built and tested against mocked Google only; the migration is written but not applied.
- After review (16 November 2026): the callback needs only a signed-in user and then checks ownership of the brand recorded in the state row, so an owner who switches brand during the sign-in can still finish. A reconnect verifies, after its last write, that the stored tokens are the ones it wrote; if another save for the same brand got in between, the connection is set to `needs_action` and the owner is asked to connect again (there is no transaction across the token vault and the connection row).

## What changed since v3

- **Scope is Peter's own profiles only.** Google posting is not a product feature for customers. It is switched on per brand by the super-admin and never offered at sign-up. This removes the third-party consent and policy work in v3 section 9.
- **Google refused API access on 30 September 2026** (case 1-6436000041720). Nothing can post until a new application is approved. Phase 0 below is rewritten around the two reasons Google gave.
- **Live schema moved** (checked 14 November 2026): `publish_jobs.status` now also allows `held`; `publish_jobs.resolution_kind` has a CHECK that would refuse v3's `gbp_disabled`; anon has no table writes (#223); the publish worker checks its caller (v49+). Still true: `publish_jobs` has no `platform` column, and the CHECKs on `social_connections.provider`, `oauth_states.provider` and `content_items.platform` still allow `gbp`, so those need no migration.
- **Code moved.** File and line references come from a search of `main` at `46d4ef49` on 14 November 2026. Checked directly: the worker allow-list, the queue and handler guards, the batch rollback, the management client and mapper, the admin switch pattern, the live CHECK constraints and the paired management app routes. The rest of the wiring checklist comes from the same search but each line was not opened; confirm each as it is touched.
- **Google's API is unchanged where it matters** (official pages read 14 November 2026): `accounts.locations.localPosts` (create, get, list, patch, delete) on the v4 API is current with no sunset date; the v4 `accounts` resource is deprecated, so accounts and locations are listed through the v1 APIs.

## Why

The Anchor wants its posts on its Google Business Profile as well as Facebook and Instagram, with no routine manual work. The management app still lists "Add GBP Event Post" as a manual checklist job. GBP was removed on 29 June 2026 (`1cdf7566`, `2e598111`) because it never worked: the Cloud project had never been approved, so every call was refused.

Success measure: each eligible approved post gets one correct, visible (LIVE) Google post, and its Facebook and Instagram schedule is never disturbed. No claim about bookings or rankings.

## Decisions made

D1 to D9 stand from v3 unless marked.

- D1 (amended by Peter, 14 and 16 November 2026). The original rule was that nothing that calls Google is built until Google has approved API access (quota above zero). On 14 November PR1, which never calls Google, was shipped. On 16 November, with a new access request submitted, Peter asked for the connection and publishing to be built now ("Yes, build it") so they are ready when Google approves. Until then they are tested against mocked Google only and fail closed at Google's refusal.
- D2. Event posts (`EVENT`) and ordinary posts (`STANDARD`) are both in the first release.
- D3. Direct Google API only; no aggregator.
- D4. Event end comes from the management app: explicit end time wins, otherwise start plus duration.
- D5. One Google event post per event, on the event's first scheduled post date.
- D6. `BOOK` button when the event takes bookings, otherwise `LEARN_MORE`; both to the event's Google tracked link.
- D7. Manually entered events get Google event posts too: the event form gains an end time field.
- D8 (replaced by Peter, 14 November 2026). Once the build is finished, one deliberate pass creates a Google version of every post already scheduled (PR5 below). As built (16 November 2026): "already scheduled" means created before the Google connection was last made. The connection save now records `metadata.connectedAt` (every first connection and reconnect); once the switch is on, the cron gives versions to upcoming Facebook feed posts created after it, and a connection without it gets nothing automatically. Everything older goes through the dry-run-first ops script. So switching on for a brand that is already connected does create versions, but only for posts made since its last connection; switching off and on again does the same. A reconnect moves `connectedAt`, so posts made between the first connection and a reconnect get nothing automatically.
- D9. Changes and cancellations after a Google post is out are corrected by hand in Google; CheersAI shows a link to the post.
- D10 (new, 14 November 2026). Own profiles only. A brand can post to Google only when the super-admin has switched it on; customers who sign up themselves never see Google anywhere in the app. The Anchor is the only brand to be switched on for now.
- D11 (Peter, 14 November 2026). The Google login for the access application and the connection is `thepitchersummers@gmail.com`.
- D12 (Peter, 16 November 2026). The Google version is attached to each Facebook feed post (same time, same picture) and is not a separate planner item; this keeps the live Facebook and Instagram worker untouched. A Google version is one `gbp_posts` row pointing at the Facebook feed `content_items` row. It is never a `content_items` row and never a `publish_jobs` row, and it is created, sent and checked by its own cron (`/api/cron/google-posts`), never by the publish scheduler or the edge worker.

## Phase 0: Google access (owner: Peter, outside the code)

Console facts below were last seen on 24 September 2026 and must be re-checked as step 1.

Reapplied 16 November 2026: case ID 5-7355000042029, submitted from the owner login for The Anchor with the website exactly as on the profile; Google quoted seven to ten working days. Console re-checked 16 November 2026: OAuth client redirect URIs present for production and localhost, consent screen External and In production, Account Management and Business Information APIs enabled, quota still 0 requests per minute, Google My Business API not yet enabled.

### 0.1 Why Google refused, and what must be true before reapplying

Google's reply (30 September 2026) and its prerequisites page give the same two rules:

1. The email that submits the application must be listed as an **Owner or Manager** of a Business Profile that has been **verified and active for 60 days or more**.
2. That profile must show a **website on the business's own domain**, and the URL typed in the application must **match it exactly** (same https, www and trailing slash).

So the application is made in the name of the venue whose profile qualifies (for example The Anchor and its website exactly as shown on the profile), from a Google login that is an Owner or Manager of that profile. The September application was made as Orange Jelly Limited; apply as the profile's business this time.

Google's pages do not say the applying login must own the Cloud project, only that it gives the project number (not confirmed with Google). The safest route is one login that is both an Owner or Manager of the profile and a member of the Cloud project: if `thepitchersummers@gmail.com` is not on the profile, add it as a Manager, or add the profile's owner login to the project and apply from that.

### 0.2 Apply

1. Open the "GBP API contact form": https://support.google.com/business/contact/api_default
2. Choose **Application for Basic API Access**.
3. Give project number **344798984846** (project `cheersai-469418`), the qualifying email, and the website URL copied from the profile.
4. Record the new case ID. In September Google quoted 7 to 10 working days.
5. Do not request a quota increase while the quota is 0: Google's limits page says not to.

### 0.3 After approval, in Google Cloud Console (project `cheersai-469418`)

1. **Confirm approval.** APIs and Services, then Quotas: the Business Profile APIs show 300 requests per minute instead of 0.
2. **Enable three APIs** (APIs and Services, then Library):
   - **Google My Business API** (the v4 API that holds `localPosts`; it only appears in the Library once access is approved)
   - **My Business Account Management API** (lists the accounts the login can manage)
   - **My Business Business Information API** (lists locations)
   Google's setup page lists four more (Lodging, Place Actions, Notifications, Verifications). This design never calls them; leave them off.
3. **OAuth consent screen.** User type External, publishing status **In production** (last seen: already so). It must not be "Testing": Google expires refresh tokens after 7 days in Testing, which would stop posting every week. Scope: `https://www.googleapis.com/auth/business.manage` only (last seen listed as non-sensitive, so no Google verification review). Leave the user type as External (the "Internal" type is for Google Workspace organisations, as far as we know; not checked on Google's pages).
4. **OAuth client** (Credentials): type Web application. Authorised redirect URIs:
   - `https://cheers.orangejelly.co.uk/api/oauth/gbp/callback` (last seen: added)
   - `http://localhost:3000/api/oauth/gbp/callback` for local work
5. **Secrets.** Copy the client ID and secret into:
   - Vercel: `GOOGLE_MY_BUSINESS_CLIENT_ID`, `GOOGLE_MY_BUSINESS_CLIENT_SECRET`. These are the names the code reads (`src/env.ts`); Vercel already holds both, in every environment, so no new names were introduced. The `GOOGLE_BUSINESS_*` names in earlier drafts are superseded.
   - No edge function secrets are needed: under D12 Google versions are sent by the app's own cron (section 7), not the `publish-queue` worker.
6. **Proof once approved:** one signed-in read of accounts and locations succeeds from production. Until then the connect flow is expected to stop at the listing with the "not approved yet" message and save nothing.

## Scope

In: a Google connection per enabled brand; `EVENT` and `STANDARD` Google versions attached to Facebook feed posts (D12), sent by their own cron; Google's moderation state tracked to LIVE or REJECTED with alerts; Google copy rules; a per-brand admin switch, default off. London-time locations only. Feed posts only.

Out: stories (Google has no equivalent; a story is never sent to Google), reviews, metrics and post results, Q&A, OFFER and product posts, video, multiple photos, Google's own scheduling and recurrence, calendar fill, tournament posts, link in bio, paid ads, automatic completion of the management checklist. Those features keep iterating Facebook and Instagram only.

## Design

### 1. Access: admin switch, own profiles only (D10)

- New column `accounts.google_posts_enabled boolean not null default false`, following `paid_ads_enabled`, `tournaments_enabled` and `management_import_enabled` (read in `src/lib/auth/membership.ts:25`, set by the super-admin in `src/app/(app)/admin/actions.ts:383`, listed in `src/lib/admin/data.ts:58`).
- The switch is enforced in the database as well as in the admin action (`*_guard_google_posts_switch.sql`, added after review on 14 November 2026). On this project a signed-in member can update their own brand's `accounts` row straight through the Supabase API (`authenticated` holds table-wide UPDATE and the `accounts_update` policy allows any member), so without a guard a customer could switch Google posting on for themselves. A trigger refuses a change to this one column from a user session unless the user is a super-admin; server code is unaffected. The same gap exists for the older operator-only columns (`paid_ads_enabled`, `tournaments_enabled`, `management_import_enabled`, `billing_override` and others); that is a separate change, not part of this work.
- Off (the default, and every self-serve brand): no Google card on Connections, no Google option in create or the planner, the AI is not asked for Google copy, `initiateOAuthConnect` and the callback refuse provider `gbp`, and the google-posts cron creates and sends nothing for the brand.
- Google's API policy allows automated use on listings you own or manage, so no consent record is needed. If a brand Peter does not own or manage is ever to be switched on, stop and re-read Google's policy first.
- Keep `src/content/claims.ts:21` and `tests/lib/anchor-coupling.test.ts`, which stop marketing copy claiming Google posting: it is not sold.

### 2. Data: one row per Google version (D12)

`gbp_posts` (PR1, `20261114211618_gbp_posts_and_switch.sql`) gains the columns the attached model needs in one additive migration, `supabase/migrations/20261116120000_gbp_posts_attached_versions.sql` (written 16 November 2026, not applied):

- `state`: `pending` (waiting for its post's time), `held` (needs a person, with `hold_reason`), `claimed` (a send is in flight), `sent`, `uncertain` (the answer was lost), `failed`, `skipped`. Default `pending`.
- `hold_reason`: why it is held, failed or skipped, as a short code (`alcohol_promotion`, `no_wording`, `parent_removed`, `too_late`, `destination_changed`, `reconnect_needed` and so on; the plain wording for each is in `src/lib/google-posts/model.ts`).
- What is sent: `topic_type` (`STANDARD` or `EVENT`), `summary` (at most 1,500 code points), `cta_type` (`BOOK`, `LEARN_MORE` or none) with `cta_url` (https only), and for an event `event_title`, `event_start`, `event_end` (instants; London wall time is worked out at send).
- Sending: `attempts`, `next_attempt_at` (backoff), `claimed_at`, `sent_at`, `resend_count` (0 or 1: the one re-send an uncertain send may have), `summary_edited_at` (set once a person edits or releases the wording; until then it follows the Facebook post).
- CHECKs, each added only if missing: the state and type lists, the button pair, complete event fields with the end after the start, a reason on every held row, `claimed_at` on claimed and uncertain rows, a Google name and `sent_at` on sent rows, the summary length, attempts at least 0, `resend_count` 0 or 1.
- A partial index `gbp_posts_live_states` on `(account_id, state, next_attempt_at)` for the cron's pending, claimed and uncertain reads.
- `delivery_state` and its CHECK are left in place and marked superseded in a comment: replacing the CHECK is a destructive change that was not approved, and nothing reads the column now.
- Kept from PR1: `content_item_id` unique (one version per post), the one-per-event partial unique index on `(account_id, source_event_key, local_post_parent)`, `local_post_parent` captured at creation, service role only (RLS on, no policies, grants restated).
- `supabase/tests/gbp_posts_verify.sql` gains blocks for the new columns, CHECKs and index, and a probe that tries each CHECK inside a rolled-back transaction.
- Applied through `prod-migrate` before the merge, then the file renamed to the version production records.

### 3. Event data, source to Google

- Event form (`src/features/create/forms/event-fields.tsx`, `src/features/create/schemas/content-schemas.ts:151`): add "End time" (`eventEndTime`) beside the start time and the optional end date. Optional for Facebook and Instagram. When Google is selected and no end can be resolved, the form says "Add an end time to post this event to Google" rather than failing later. On import it is pre-filled from the management app and stays editable.
- At event campaign creation, store on `campaigns.metadata`: `sourceEventKey`, `eventStart`, `eventEnd`, `eventEndProblem` (why no end could be resolved, or null), `eventTitle`, `takesBookings` (the management event has a `booking_url`), and `googleCtaUrl` (a top-level key, because `PlatformCtaLinks` is not widened until PR2). Built in PR1: `src/lib/scheduling/event-end.ts` (the resolver) and `src/lib/publishing/build-campaign-metadata.ts`. The form now holds the management event id (`event-fields.tsx:126`, added for artwork import); it must be carried into the metadata. The management app sends everything needed (checked 14 November 2026: `cta_links.gbp` and `google_business_profile`, `end_time`, `duration_minutes` in `OJ-AnchorManagementTools/src/app/api/events/[id]/route.ts:216-231`). CheersAI reads only part of it: `src/lib/management-app/client.ts` parses `end_time` (line 688) and `booking_url` (633, 662), but `ManagementEventCtaLinks` and `readCtaLinks` (152, 721) have no Google key and `duration_minutes` is not parsed at all. PR1 adds both to the client and carries them through `mappers.ts` as `endTime`, `endDate`, `managementEventId`, `googleCtaUrl` and `takesBookings`; the event brief schema keeps them. PR2 adds the Google key to `PlatformCtaLinks` (`src/types/content.ts:15`).
- The EVENT details are fixed on the Google version when it is created (section 5), with no management call at send time.

End time rules (Europe/London, Luxon). The same resolver pre-fills the form and computes the stored `eventEnd`:
1. Start = event date + start time. Missing start: not eligible for Google.
2. Explicit end time: end date = `eventEndDate` if set, otherwise the start date; if that gives an end at or before the start (including `00:00`, which the management app uses for midnight), end date = next day.
3. Import only, no `end_time`: `duration_minutes` above 0 gives end = start plus that many real minutes.
4. Otherwise not eligible until the user adds an end time.
5. A later `eventEndDate` needs an explicit end time; otherwise not eligible.
6. A start or end in the spring-forward gap (for example 01:30 on 28 March 2027) is not eligible; a repeated autumn hour takes the first (BST) occurrence.

Google takes local wall time with no zone field, so the London wall time is sent as is. "Not eligible" never stops Facebook or Instagram. Title: cut at a word boundary to 58 characters (a product rule matching the Business Profile editor; the API states no limit, and Google's own error is shown if it disagrees).

### 4. Connection and tokens

- Start: `initiateOAuthConnect` (`src/app/(app)/connections/actions.ts:92`) and `buildOAuthRedirectUrl` (`src/lib/connections/oauth.ts:42`) gain a Google branch: scope `business.manage`, `access_type=offline`, `prompt=consent`. Callback: `src/app/api/oauth/[provider]/callback/route.ts:12` allow-list and `completeOAuthConnect` (`actions.ts:161`) gain a Google code exchange beside `token-exchange.ts`. The brand travels in the `oauth_states` row and membership is re-checked, as today.
- Location picker: reuse the pending-choice pattern Facebook Pages use (`src/lib/connections/page-choice.ts`, `page-selection.ts`, `choose-page/page.tsx`). List accounts from `mybusinessaccountmanagement.googleapis.com/v1/accounts` (20 per page) and locations from `mybusinessbusinessinformation.googleapis.com/v1/{account}/locations` (needs `readMask`, up to 100 per page), following every page. Never auto-select. The chosen location is checked server-side against the stored candidates; the connection becomes active only after the location and the token vault write both succeed. Labels include the address.
- Stored: `social_connections` row with provider `gbp`, `platform_account_id` = `accounts/{a}/locations/{l}`, and `metadata` holding `localPostParent`, `locationTitle` and `placeId` only. Tokens go to `token_vault` like Meta's (`src/lib/connections/persist.ts:108`); its live CHECK already allows `token_type` `access` and `refresh`.
- Token refresh is new to this codebase (Meta tokens are never refreshed). For Google, an expired access token with a stored refresh token counts as ready: change `src/lib/connections/health.ts:21`, `readiness.ts:40`, `src/lib/publishing/preflight.ts:44-84` and (superseded by D12: the edge worker is untouched, and the google-posts cron refreshes through `getGoogleAccessToken`) the worker's `isConnectionUsable`. The token is refreshed immediately before send; keeps the old refresh token if Google omits a new one; writes with a compare-and-set so parallel refreshes cannot overwrite newer tokens. `invalid_grant` means revoked: one `needs_action` state and one alert. A token endpoint outage is retried, with no reconnect prompt. No token or signed URL in logs.
- `notify-expiring-connections` (`route.ts:41`) must skip Google: its access tokens expire hourly by design.
- Changing the location never retargets existing work: a job whose captured `local_post_parent` differs from the connection fails with "destination changed".
- Disconnect reuses `disconnectProvider` (`actions.ts:332`): vault rows deleted, status `needs_action`, no new Google work.
- Env vars, added to `src/env.ts` first, both optional at build time: `GOOGLE_MY_BUSINESS_CLIENT_ID`, `GOOGLE_MY_BUSINESS_CLIENT_SECRET` (the names Vercel already holds; the `GOOGLE_BUSINESS_*` names in earlier drafts are superseded). Missing means the Google card says "Google posting is not set up".

#### Built in PR2 (16 November 2026), and what was decided that the lines above did not say

Where it lives: `src/lib/connections/google-*.ts` (messages and constants, access rule, OAuth, listing, pending choice, save, token refresh, card data), `src/app/(app)/connections/google-actions.ts` (start, callback, choice), `src/app/(app)/connections/choose-location/page.tsx`, `src/features/connections/google-connection-card.tsx` and `location-chooser.tsx`. Nothing in PR2 publishes, and nothing in it can be exercised against real Google until the quota is above zero.

- **Google is a connection-side provider only.** `Platform` (`src/types/content.ts`), `PLATFORMS`, `ProviderPlatform` and the Facebook and Instagram `Provider` type (`src/lib/connections/oauth.ts`) are NOT widened. Only connection-side types gained `gbp`: `ConnectionProvider` in `metadata.ts` and `readiness.ts`, the new `ConnectionHealthProvider` in `src/types/providers.ts`, and the disconnect schema. Under D12 no piece needs `Platform` widened (see the wiring checklist). `PlatformCtaLinks` is not widened either.
- **Google has its own actions, not a branch in the Facebook ones.** `initiateOAuthConnect` and `completeOAuthConnect` still refuse `gbp` at their schema. `initiateGoogleConnect`, `completeGoogleConnect` and `chooseGoogleLocation` are separate, so the Facebook flow is untouched. The callback route accepts `gbp` and hands it to `completeGoogleConnect`. `disconnectProvider` is shared.
- **The switch is checked on the brand the flow belongs to.** Start and disconnect check the active brand. The callback and the choice check the brand recorded in the `oauth_states` row (looked up in the caller's brand list; a brand that is not there counts as off), because the owner may have changed brand during the sign-in. Disconnect is refused too when the switch is off: with it off Google does not exist for the brand, and offboarding already deletes every stored token.
- **A stored Google row is hidden when the switch is off.** The Connections card, the sidebar health dots, the login health toast and the diagnostics table all leave it out. The location picker page answers "We could not find this choice" without naming Google.
- **The picker always runs.** No automatic selection, including a single location and a reconnect to the stored location. Reconnecting is also how the location is changed ("Update connection" on the card).
- **Pending choice.** One `oauth_states` row, provider `gbp`, `redirect_to = /connections/choose-location`, payload encrypted with the token vault and bound to the brand and the signed-in user, 10 minutes. It is written only after the accounts and locations have been listed, so a refusal at Google leaves nothing to delete. A choice refused because the switch went off or the client is not configured is discarded on the spot; an expired one has its payload dropped when it is next read.
- **Failing closed at the quota wall.** Any failure to list stores no connection, no token and no pending row, and returns the owner to Connections with one of four plain messages: not approved (HTTP 429, status `RESOURCE_EXHAUSTED`, or a 403 whose reason or wording is about quota or a switched-off API), permission denied (any other 403, a 401, or a sign-in that did not grant the business scope), Google unavailable (5xx, timeout, unreadable reply), and a general "could not list" for anything else. Cancelling the sign-in has its own message. Google's own error text is never shown or logged: the log keeps the HTTP status, Google's status code and the reason code only. The Google grant itself is not revoked when a connect fails (that would be another Google call); the tokens are simply dropped.
- **Listing limits.** Up to 5 pages of accounts (100) and 5 pages of locations per account (500). A list cut short by those limits, or an account whose locations could not be read while others could, shows what loaded with a notice that the list may be incomplete. If nothing loaded, or nothing was found while part of the list was refused, that is a failure, never "no locations".
- **Location id.** The Business Information API names a location `locations/{id}` with no account, so the account it was listed under is joined on: `accounts/{accountId}/locations/{locationId}`. The same value is `platform_account_id` and `metadata.localPostParent`. A location that appears under two accounts is listed once for each, labelled with the account name.
- **Saving.** A first connection inserts the row as `needs_action`, stores both tokens, then activates it; if the tokens cannot be stored the new row is removed. A reconnect writes the tokens first and touches the existing row last, in one update; if either step fails the tokens held before are put back (best effort, logged if it cannot), so the previous connection keeps working. `last_synced_at` is not set on connect: the card shows it as "Last published" for Facebook, and nothing has been published.
- **No refresh token means the connect fails**, with a plain message. A sign-in without the business scope is refused before any listing.
- **Token refresh helper** (`getGoogleAccessToken` in `src/lib/connections/google-token.ts`; under D12 no Deno copy is needed, the google-posts cron calls this one). It returns the stored token while it has more than 5 minutes left, otherwise refreshes. The compare-and-set is on the connection's `updated_at`, in three steps: claim the row (only if `updated_at` is still what was read), store the token, then record the new expiry (only if nobody claimed the row since). The loser of a race stores nothing and returns the token Google just gave it, which is valid in its own right. Because the expiry is recorded after the token is stored, a reader never sees a fresh expiry beside a stale token. Results are typed: `not_connected`, `reconnect_needed` (Google answered `invalid_grant`, or no refresh token is stored: the row is marked `needs_action` once, and only if it has not changed since it was read, so a reconnect that landed meanwhile is not undone) and `try_again` (timeout, 5xx, 429, any other refusal such as a wrong client secret, a database or decryption failure: the row is left alone). The helper does not check the brand switch (it has no signed-in user); its caller must. The alert on `invalid_grant` is raised by the google-posts cron (section 7).
- **Readiness and health for `gbp`.** The access token's expiry is ignored entirely (no "expired", no 7-day "expiring" warning): ready and green with a stored refresh token, "Google needs to be reconnected" and red without one. `src/lib/publishing/preflight.ts` is unchanged in PR2: it only serves Facebook and Instagram until Google can be selected.
- **Not touched in PR2, on purpose:** `supabase/functions/**`, the create wizard, the planner, AI copy, preflight, onboarding (`setup-progress.ts` and the checklist never mention Google; a test holds that), calendar fill, tournaments, analytics and link in bio. `tests/msw/handlers/gbp.ts` is left as it was: nothing in PR2 uses it (the new tests stub `fetch` directly); it is rewritten with the edge provider in PR3.

### 5. Creating Google versions (D8, D5, D12)

Nothing in the create wizard, calendar fill, tournaments or the composer changes. The cron (`src/lib/google-posts/create.ts`) looks at each enabled brand's Facebook feed posts and attaches versions:

- Candidates: the brand's `content_items` with platform `facebook`, placement `feed`, status `scheduled` or `queued`, not trashed, created after `connectedAt`, with no version yet. They are read in pages of 200 in post-time order (so posts that already have a version never crowd out later ones), at most 2,000 a pass; a dry run that reaches that limit says so. Stories, Instagram, drafts and posts more than 5 minutes in the past never get one.
- Events (campaign type `event`): only the earliest upcoming Facebook feed post of the event gets a version, and none at all once any post of the event has one (D5). The event details come from the campaign metadata (`eventStart`, `eventEnd`, `eventTitle`, `googleCtaUrl`, `takesBookings`, `sourceEventKey`). When the metadata has no end, the brand has management import on and a working management connection, the management app is asked: by the stored event id, otherwise by listing that date and keeping only an event whose name (trimmed, any case), date and start time all match exactly. Zero or several matches, or any management error, means "not matched".
- An event with a start and an end (stored or matched) becomes `EVENT` with `BOOK` when it takes bookings, otherwise `LEARN_MORE`, both only when there is an https Google link; no link means no button. An event without a known end becomes `STANDARD`, still keyed to the event so it stays one per event. An event already over gets nothing.
- `source_event_key`: the stored key, else `mgmt:<id>` for a matched management event, else `campaign:<campaign id>`.
- Other posts become `STANDARD`, with `LEARN_MORE` only when the campaign holds a `googleCtaUrl`.
- Management calls: at most 10 a run, one second apart, and only in the first 15 seconds of the run; an event that could not be looked up in time is left for the next run, not guessed.
- The insert relies on the database: a unique violation (another run got there first) counts as "already has one", never an error.

The existing schedule (D8): `npm run ops:google-versions-existing-schedule -- --account <id>` is a dry run that writes `temp/google-versions-existing-schedule/<time>/plan.json` and prints what would be created, held, skipped and left for later. `-- --apply --plan <file> --asked "<words>"` creates exactly the versions in that plan (it re-checks the switch, the connection, the location and that each post is unchanged), records the approval words, and writes `applied-<time>.json` beside the plan. A second apply creates nothing.

### 6. Copy

No AI call and no change to the AI schemas, prompts or copy rules for Facebook and Instagram. The Google wording is derived from the Facebook post's copy (`content_variants.body`) by `src/lib/google-posts/summary.ts`:

- Links, email addresses, phone numbers, hashtags and @ handles are removed, along with the lead-in that pointed at them ("Call us on", "Book here:", "Follow"), and the spacing and punctuation are tidied.
- The result is cut to 1,500 code points, at the last sentence end if one falls in the last 40 per cent, otherwise at a word boundary.
- Nothing left means the version is `held` with `no_wording`.
- A small detector holds alcohol price promotions (a price, "2 for 1", "half price" or "happy hour" wording next to a drink word, in one sentence) as `held` with `alcohol_promotion`; ordinary events pass. A held version is never sent until a person releases it.
- The wording is worked out again at send time from the current Facebook copy, until a person edits or releases it (`summary_edited_at`); after that it is frozen. A person's own wording goes through the same rules.

### 7. Sending (`src/lib/google-posts/send.ts`)

The cron at `src/app/api/cron/google-posts/route.ts` runs every minute (`vercel.json`), authenticates with `verifyCronAuth`, has a 60-second maximum and starts no new work after 50 seconds. For each brand with the switch on AND an active `gbp` connection, it creates, then sends, then checks, each step catching its own failure so one brand cannot stop another. With no such brand it reads two tables and calls nothing else. The publish scheduler, the edge worker, `queue.ts`, `handler.ts` and `preflight.ts` are untouched.

- Due: `pending`, any backoff passed, and the Facebook post's current time has passed. The version follows its post: moved later, it waits; trashed or gone, `skipped`; back to draft, `skipped`; failed or posted on Facebook, still sent (Google is independent). More than 24 hours late, or an event already over: `skipped`.
- Up to 5 sends per brand per run, oldest post time first.
- Before the claim, read fresh: the switch (off: `skipped`), the connection (gone: `failed`, no alert), the destination (a different location: `failed` with "destination changed", never retargeted), the wording (may move it to `held`), the token, and the image. The claim is a compare-and-set from `pending` to `claimed` made immediately before the request, so a failure before sending never becomes `uncertain`, and of two racing runs only one sends.
- Request: `POST https://mybusiness.googleapis.com/v4/{parent}/localPosts` with `languageCode` `en-GB`, `summary`, `topicType`, `callToAction` (only with an https link), `event` (title and a London-wall-time schedule with seconds and nanos 0) and one `PHOTO`. Timeout 15 seconds.
- Image: the first media id of the Facebook feed post's variant, the stored asset itself (never a story rendition and never the date strip the Facebook worker draws), JPG or PNG, 10 KB to 5 MB where the size is stored, signed for an hour. A video or unsuitable file means the words go without a picture; a signing failure is tried again. Google's 250 by 250 minimum cannot be checked (no dimensions are stored).
- Answers: success records the post name, link and state, `sent`, with the first check in 2 minutes; 400 `failed` with Google's words (links and long tokens removed, at most 300 characters) and an alert; 401 one forced token refresh and one more try, a second 401 `failed` with a reconnect alert; 403 and 404 `failed` with an alert; 429 and 5xx (and a refused connection) back to `pending` with backoff of about 1, 2, 4 and 8 minutes (jitter of 20 per cent, at most 30 minutes), `failed` with an alert after 5 tries; a timeout or lost answer `uncertain`.
- Uncertain: never re-sent blindly. From 10 minutes after the claim the location's posts are listed (3 pages); a post with the same event title and start (EVENT) or the same opening words created after the claim (STANDARD) is adopted. With no match, exactly one more send is allowed (`resend_count`). Still unclear after that: one "cannot confirm" alert, checked again hourly. A claim older than 5 minutes (a crashed run) becomes `uncertain` the same way.
- Tokens: `getGoogleAccessToken` with one token per brand per run; it gained a `forceRefresh` option for the 401 path. `reconnect_needed` fails with a reconnect alert; `try_again` backs off.
- Logs keep counts, ids and codes only: no token, signed URL or post text.

### 8. Moderation checks and alerts (`src/lib/google-posts/moderation.ts`, `alerts.ts`)

- Each run reads at most 10 sent versions per brand whose check is due, with `GET .../v4/{name}` (10-second timeout).
- Cadence after send: 2, 10 and 30 minutes, then hourly to 24 hours, then daily until the event ends (EVENT) or for 7 days (STANDARD).
- `LIVE`: stop. `REJECTED`: stop and one alert, no automatic retry. Still `PROCESSING` after 24 hours: one alert, then daily checks. A 404 (removed on Google by hand, D9): stop. A failed read is tried again within 10 to 60 minutes; no good read for 6 hours: one "cannot confirm" alert.
- Alerts go through the shared `insertNotification` (category `google_post_failed`, `google_post_rejected`, `google_post_processing`, `google_post_unconfirmed` or `google_reconnect_needed`, resource `gbp_post` and the version id). All but "processing" are urgent. One alert per incident: before raising one, an alert of the same kind for the same version since the incident began is looked for, with no time window. `notify-failures` reads publish jobs only and cannot see Google problems, so these alerts are the only ones.
- Planner actions (`src/app/(app)/planner/google-version-actions.ts`, logic in `src/lib/google-posts/data.ts`): load, edit the wording (needs the `create` entitlement; pending or held only), release a held version (`publish`), skip (pending, held or failed) and retry a failed one (`publish`, attempts reset). Each checks the switch in the session and, read fresh, the switch and an active connection, fails closed, and writes through the service-role client scoped by the active brand, as a compare-and-set on the state it read. No page calls them yet: the planner view (badge, label, link, buttons) is the next piece.

### 9. Switch-off and rollback

- Switch off: Google hidden everywhere; the cron skips the brand entirely, and a version found due while the switch is off at send time is `skipped` with `switched_off`. Skipped versions are not replayed if the switch goes back on (simpler than v3's park and release, and safe for a single owner). `gbp_disabled` and the `publish_jobs_resolution_kind_check` change are no longer needed: Google never has a publish job.
- Rollback cannot remove posts already on Google, an accepted in-flight create or the OAuth grant. Posts are removed by hand in Business Profile; `gbp_posts` keeps the links.
- The migration is additive; rollback leaves the table and column in place.

### 10. Data kept

Only routing identifiers, post state and the location title. Google's policy limits storing profile content to 30 days; nothing else from Google is stored.

## Platform wiring checklist

Under D12 no platform union is widened, so almost all of the old checklist falls away. `Platform` (`src/types/content.ts`), `PLATFORMS` (`src/lib/constants.ts`), `ProviderPlatform` (`src/types/providers.ts`) and the Facebook and Instagram `Provider` type stay Facebook and Instagram only, and so does everything that iterates them (the wizard, calendar fill, tournaments, analytics, link in bio, onboarding, scheduling spread and conflicts, rate limits, preflight, `compose-body.ts`, the AI schemas).

What did change outside `src/lib/google-posts/`:
- `src/lib/connections/google-token.ts`: a `forceRefresh` option for the 401 path.
- `src/lib/connections/google-persist.ts`: the connection metadata records `connectedAt` (D8).
- `src/lib/notifications/routing.ts`: the five Google alert categories, four of them urgent.
- `vercel.json`, `package.json` (the ops script) and `docs/agent-reference.md` (the cron and the script).

Still to do, in the planner piece: the Google badge and label on the post page, the action buttons, and showing the Google categories in the notifications feed. Tidy later: `tests/msw/handlers/gbp.ts` (unused, still the old contract), the stale `gbp_*` fixtures in `tests/lib/settings/data.test.ts`, and the CLAUDE.md lines saying GBP was removed.

## Delivery (independently deployable PRs)

1. **PR1, data and contracts.** Shipped (#233): `gbp_posts`, the admin switch, the management mapping, the event end time field and resolver.
2. **PR2, connection.** Shipped (#236): OAuth, the location picker, refresh-aware readiness and health, disconnect.
3. **PR3, Google versions (D12).** Built 16 November 2026, branch `feat/gbp-publishing`: the migration in section 2 (to be applied through `prod-migrate` before the merge), the copy rules, creation for new posts, sending with claim and reconcile, moderation checks and alerts, the planner actions (not yet on a page), and the D8 ops script. Nothing it does reaches Google until access is approved, and nothing runs for a brand until its switch is on and Google is connected.
4. **PR4, planner view.** The Google version on the post page and the planner (badge, state, link, edit, release, skip, retry), and the Google alerts in the notifications feed. Must ship before the switch is turned on.
5. **PR5, existing schedule (D8).** No code: run the ops script's dry run for The Anchor, show Peter the list, and apply that plan only with his approval.
6. **Go-live.** Switch on for The Anchor with Peter's explicit approval; one real EVENT and one STANDARD post reach LIVE; image, times, button and link checked on the profile. Deployment id recorded.

Under D1 as amended, each piece ships when built. Nothing after the sign-in can be exercised against Google until it approves; every piece says so in its PR.

### Defaults taken in PR3 (16 November 2026)

- The cron runs every minute, separate from the publish scheduler; 60-second maximum, no new work after 50 seconds; management calls only in the first 15 seconds, at most 10 a run, one second apart.
- Candidate posts read in pages of 200, at most 2,000 per brand per pass; 5 versions sent and 10 moderation reads per brand per run; `in` filters carry at most 100 ids.
- A held version raises no alert; it waits in the planner view (PR4) for a person.
- A post more than 5 minutes in the past when first seen gets no version; a version more than 24 hours late is skipped.
- For an event, the earliest upcoming Facebook feed post gets the version, and no other post of that event ever does, even if that version is later skipped.
- 5xx answers are retried like 429 (up to 5 tries). Google may have created the post before answering 5xx, so this carries a small risk of a duplicate.
- An image that cannot be signed is tried again; an unsuitable image (video, GIF, under 10 KB or over 5 MB) means the words go without a picture.
- A connection that is no longer active fails the version without an alert (the connection card already shows it).
- A 404 on a moderation read stops the checks: the post was removed on Google by hand.
- Google's error text is kept on the version, sanitised (links become "[link]", long tokens removed, at most 300 characters).
- The ops script's apply takes the dry run's plan file, so it creates exactly what was approved.

## Tests (required)

Mocked Google only; no live post without separate approval. `npm run ci:verify`.

- Access: a brand with the switch off cannot start OAuth, complete a callback, select Google in create, or have a Google job sent; a self-serve brand never sees Google.
- One post: concurrent submissions, repeated import, lost response after create and database failure after create each end with at most one confirmed post.
- Meta untouched (D12): nothing in the wizard, queue, handler, preflight or edge worker changes, so the existing Facebook and Instagram suites stand unchanged.
- PR2 tests (in place): switch off blocks start, callback, choice and disconnect; missing env; the consent URL; code exchange; the quota wall (429 and 403) saving nothing; two pages of accounts and of locations; no accounts; no locations; partial failure; forged location; expired choice; repeated callback; removed membership; missing refresh token; the stored id, metadata and tokens; vault failure on a first connect and on a reconnect; the refresh helper (fresh, expired, omitted refresh token, `invalid_grant`, timeout, concurrent); readiness and health; the expiring-connection cron; onboarding; the card hidden without the switch.
- Tokens: expired access with valid refresh sends; revoked refresh gives one reconnect state; token endpoint timeout retries; concurrent refresh keeps the newest token; the expiring-connection email ignores Google.
- Moderation: PROCESSING to LIVE, immediate and delayed REJECTED, 24-hour PROCESSING, read outage; one alert per incident.
- PR3 tests (in place, `tests/lib/google-posts/`, `tests/ops/google-versions-existing-schedule.test.ts`): the copy rules and the alcohol detector both ways; building for each case; D8 (old posts get nothing automatically; dry run, apply, second apply); one per event under concurrent creation; management match, ambiguous, missing, failure, cap and pacing; the exact request body in London and UTC including both clock changes; every sending case in section 7; reconcile adopt, re-send once and still unclear; moderation; the cron and route; the four actions with permission and state refusals; no token, signed URL or post text in any log. They run against an in-memory database that enforces every `gbp_posts` CHECK, the unique indexes and foreign keys.
- Contract fixture: stored campaign metadata to the exact request body the cron sends (BOOK, LEARN_MORE, Google link, no button when no link).
- Dates: overnight end, `00:00` end, explicit end beats duration, zero or missing duration, multi-day without end time, 25 October 2026 and 28 March 2027; London and UTC.
- Connection: forged location, expired picker, removed membership, repeated callback, vault failure, location change with queued jobs, second page of accounts and locations.
- Stories and the left-alone features create no Google items.
- Content: alcohol price promotion flagged, normal event passes, contact details and hashtags stripped, Unicode title cut.
- Errors: 400, 401, 403, 404, 429, 5xx, timeout.
- Database: the verify script, the anon write check and a clean rebuild.

## Paired repository

The management app already provides the Google short link, `booking_url`, `end_time`, `duration_minutes` and `event_status`; no change is needed there.

Staff handover: for events created in CheersAI after go-live, staff tick "Add GBP Event Post" once CheersAI shows the Google post as LIVE, and do not post by hand. Events created before go-live, and changes or cancellations after a post is out, stay manual in Google.

## Sources (read 14 November 2026)

- https://developers.google.com/my-business/content/prereqs
- https://developers.google.com/my-business/content/basic-setup
- https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts
- https://developers.google.com/my-business/content/sunset-dates and the change log
- https://developers.google.com/my-business/content/limits
- https://developers.google.com/my-business/content/policies
- https://developers.google.com/identity/protocols/oauth2
