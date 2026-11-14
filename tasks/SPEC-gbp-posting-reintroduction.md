# SPEC: Google Business Profile posting as a third channel

Status: draft v4, 14 November 2026. Replaces v3 (24 September 2026). No code written. Review history: `tasks/REVIEW-gbp-posting-reintroduction.md` (findings GBP-01 to GBP-14, all still addressed below).

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

- D1 (amended by Peter, 14 November 2026). Nothing that calls Google is built until Google has approved API access for the Cloud project (quota above zero). PR1, which never calls Google, is built and shipped now.
- D2. Event posts (`EVENT`) and ordinary posts (`STANDARD`) are both in the first release.
- D3. Direct Google API only; no aggregator.
- D4. Event end comes from the management app: explicit end time wins, otherwise start plus duration.
- D5. One Google event post per event, on the event's first scheduled post date.
- D6. `BOOK` button when the event takes bookings, otherwise `LEARN_MORE`; both to the event's Google tracked link.
- D7. Manually entered events get Google event posts too: the event form gains an end time field.
- D8 (replaced by Peter, 14 November 2026). Once the build is finished, one deliberate pass creates a Google version of every post already scheduled (PR6 below). Turning the switch on still never creates Google work by itself.
- D9. Changes and cancellations after a Google post is out are corrected by hand in Google; CheersAI shows a link to the post.
- D10 (new, 14 November 2026). Own profiles only. A brand can post to Google only when the super-admin has switched it on; customers who sign up themselves never see Google anywhere in the app. The Anchor is the only brand to be switched on for now.
- D11 (Peter, 14 November 2026). The Google login for the access application and the connection is `thepitchersummers@gmail.com`.

## Phase 0: Google access (owner: Peter, outside the code)

Console facts below were last seen on 24 September 2026 and must be re-checked as step 1.

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
   - Vercel, Production only: `GOOGLE_BUSINESS_CLIENT_ID`, `GOOGLE_BUSINESS_CLIENT_SECRET`
   - Supabase edge function secrets for `publish-queue` (the worker refreshes tokens itself, so it needs both; v3 missed this)
6. **Proof before PR2 is accepted:** one signed-in read of accounts and locations succeeds from production.

## Scope

In: a Google connection per enabled brand; `EVENT` and `STANDARD` posts from the create wizard and the planner composer, sent by the live edge worker; Google's moderation state tracked to LIVE or REJECTED with alerts; Google copy rules; a per-brand admin switch, default off. London-time locations only. Feed posts only.

Out: stories (Google has no equivalent; a story is never sent to Google), reviews, metrics and post results, Q&A, OFFER and product posts, video, multiple photos, Google's own scheduling and recurrence, calendar fill, tournament posts, link in bio, paid ads, automatic completion of the management checklist. Those features keep iterating Facebook and Instagram only.

## Design

### 1. Access: admin switch, own profiles only (D10)

- New column `accounts.google_posts_enabled boolean not null default false`, following `paid_ads_enabled`, `tournaments_enabled` and `management_import_enabled` (read in `src/lib/auth/membership.ts:25`, set by the super-admin in `src/app/(app)/admin/actions.ts:383`, listed in `src/lib/admin/data.ts:58`).
- Off (the default, and every self-serve brand): no Google card on Connections, no Google option in create or the planner, the AI is not asked for Google copy, `initiateOAuthConnect` and the callback refuse provider `gbp`, and the worker sends nothing.
- Google's API policy allows automated use on listings you own or manage, so no consent record is needed. If a brand Peter does not own or manage is ever to be switched on, stop and re-read Google's policy first.
- Keep `src/content/claims.ts:21` and `tests/lib/anchor-coupling.test.ts`, which stop marketing copy claiming Google posting: it is not sold.

### 2. Data: one tracked row per Google post

New table `gbp_posts`, `account_id`-scoped:

- `id`, `account_id`, `content_item_id` (unique), `publish_job_id`
- `source_event_key` (`mgmt:<management event id>` for imported events, `campaign:<campaign id>` for manual events, null for STANDARD) and `local_post_parent` (the destination, captured when the job is created)
- `google_post_name`, `search_url` (the link Google returns, shown in the planner for D9), `google_state` (`PROCESSING`, `LIVE`, `REJECTED`, other), `delivery_state` (`not_scheduled`, `claimed`, `sent`, `uncertain`, `failed`)
- `last_checked_at`, `next_check_at`, `check_attempts`, `last_error` (sanitised)
- Unique partial index on `(account_id, source_event_key, local_post_parent)` where `source_event_key is not null`: the guarantee behind D5.

Send sequence in the worker:
1. Claim: insert the row as `claimed`. A unique violation means another attempt owns it: stop.
2. Create the post at Google.
3. Record `google_post_name`, `search_url`, `delivery_state = sent` and `google_state`.
4. Response lost, timeout or 5xx after the request left: `delivery_state = uncertain`. Never re-create blindly. List the location's `localPosts` and match on event title and start (EVENT) or summary prefix and create time (STANDARD). A match is adopted; no match allows one create; still unclear raises an alert.

`publish_jobs.status = succeeded` for Google means Google accepted it, never that it is public. The planner reads `gbp_posts.google_state` for Google labels.

Migration rules (all newer than v3):
- PR1: one additive migration, `supabase/migrations/*_gbp_posts_and_switch.sql`, with `gbp_posts` and `accounts.google_posts_enabled`. The app selects the new column on every sign-in, so the migration is applied before the deploy and the column is never dropped while the code reads it.
- PR3: `gbp_disabled` added to `publish_jobs_resolution_kind_check`, when the worker first uses it (the constraint is dropped and re-created with the extra value in one transaction; no data changes). The `DROP CONSTRAINT` will trigger the connector's destructive-SQL confirmation, so it is named in that approval packet. Moved out of PR1 on 14 November 2026: nothing writes the value until then.
- Written against production's shape, with its own grants stated. `gbp_posts` is service role only, like `team_invitations`: RLS on with no policies, everything revoked from `public`, `anon` and `authenticated`. Every read goes through server code with the service-role client scoped by `account_id` (this replaces v4's first draft, which gave `authenticated` a read policy nothing needed).
- `supabase/tests/gbp_posts_verify.sql` checks the column, the grants, the constraints and the one-per-event index; CI runs it on a from-scratch database.
- Applied through `prod-migrate` before the merge, then the file renamed to the version production recorded.

### 3. Event data, source to Google

- Event form (`src/features/create/forms/event-fields.tsx`, `src/features/create/schemas/content-schemas.ts:151`): add "End time" (`eventEndTime`) beside the start time and the optional end date. Optional for Facebook and Instagram. When Google is selected and no end can be resolved, the form says "Add an end time to post this event to Google" rather than failing later. On import it is pre-filled from the management app and stays editable.
- At event campaign creation, store on `campaigns.metadata`: `sourceEventKey`, `eventStart`, `eventEnd`, `eventEndProblem` (why no end could be resolved, or null), `eventTitle`, `takesBookings` (the management event has a `booking_url`), and `googleCtaUrl` (a top-level key, because `PlatformCtaLinks` is not widened until PR2). Built in PR1: `src/lib/scheduling/event-end.ts` (the resolver) and `src/lib/publishing/build-campaign-metadata.ts`. The form now holds the management event id (`event-fields.tsx:126`, added for artwork import); it must be carried into the metadata. The management app sends everything needed (checked 14 November 2026: `cta_links.gbp` and `google_business_profile`, `end_time`, `duration_minutes` in `OJ-AnchorManagementTools/src/app/api/events/[id]/route.ts:216-231`). CheersAI reads only part of it: `src/lib/management-app/client.ts` parses `end_time` (line 688) and `booking_url` (633, 662), but `ManagementEventCtaLinks` and `readCtaLinks` (152, 721) have no Google key and `duration_minutes` is not parsed at all. PR1 adds both to the client and carries them through `mappers.ts` as `endTime`, `endDate`, `managementEventId`, `googleCtaUrl` and `takesBookings`; the event brief schema keeps them. PR2 adds the Google key to `PlatformCtaLinks` (`src/types/content.ts:15`).
- The worker builds the EVENT body from stored metadata, with no management call at publish time.

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
- Token refresh is new to this codebase (Meta tokens are never refreshed). For Google, an expired access token with a stored refresh token counts as ready: change `src/lib/connections/health.ts:21`, `readiness.ts:40`, `src/lib/publishing/preflight.ts:44-84` and the worker's `isConnectionUsable` (`worker.ts:1153`). The worker refreshes immediately before send; keeps the old refresh token if Google omits a new one; writes with a compare-and-set so parallel refreshes cannot overwrite newer tokens. `invalid_grant` means revoked: one `needs_action` state and one alert. A token endpoint outage is retried, with no reconnect prompt. No token or signed URL in logs.
- `notify-expiring-connections` (`route.ts:41`) must skip Google: its access tokens expire hourly by design.
- Changing the location never retargets existing work: a job whose captured `local_post_parent` differs from the connection fails with "destination changed".
- Disconnect reuses `disconnectProvider` (`actions.ts:332`): vault rows deleted, status `needs_action`, no new Google work.
- Env vars, added to `src/env.ts` first, both optional at build time: `GOOGLE_BUSINESS_CLIENT_ID`, `GOOGLE_BUSINESS_CLIENT_SECRET`. Missing means the Google card says "Google posting is not set up".

### 5. Create flow: Google never disturbs Meta

- `createScheduledBatch` (`src/app/actions/content.ts:647`, work in `src/lib/content/schedule-batch.ts`) rolls the whole batch back when any enqueue fails (lines 608 to 631). Change: Facebook and Instagram behave exactly as today; Google items are validated first and enqueued last, and a Google failure leaves that item visible as "needs attention" with the reason, without rolling back Meta. `content_items.status` has no such value (live CHECK: draft, scheduled, queued, publishing, posted, failed), so the item stays `draft` with no publish job, and its `gbp_posts` row holds `delivery_state = not_scheduled` and the reason; the planner shows the label from that row.
- The result screen states partial success plainly ("Facebook and Instagram scheduled. Google not scheduled: <reason>"). Fixing a Google item re-queues only that item.
- Events: one Google item per event (the first slot), whatever the cadence. Other content: one Google item per scheduled feed slot.
- Story placements never create a Google item (`schedule-batch.ts:110`).
- Brands with the switch off, and old drafts, stay Meta-only.

### 6. Copy

- `AiGenerationResponseSchema` (`src/lib/ai/schemas.ts:14-25`) has two fixed keys. Google becomes an optional third key, requested only when the brand is enabled and Google is selected. `PlatformCopy` (`src/types/content.ts:50`), `toPlatformCopy`, `src/lib/ai/prompts.ts`, `write-copy.ts:19-21` (limit 1,500), `content-rules.ts`, `postprocess.ts` and `src/lib/publishing/copy-rules.ts:11,21` gain the Google rules.
- Rules: 1,500 characters; no phone numbers, emails, social handles or hashtags; no invented times or booking facts. They apply to manual edits as well as AI output.
- Google restricts posts promoting regulated products. Drinks price offers and alcohol-led promotions are flagged at preflight for a person to review the Google version and are not auto-sent; ordinary events (quiz, music bingo, live sport) pass.
- The Google version is approved by a person like the other platforms.

### 7. Publishing runtime

- One supported runtime: the Supabase edge worker (`supabase/functions/publish-queue/worker.ts`), which production uses while `publish_jobs` has no `platform` column. Platform comes from `content_items.platform`.
- Worker changes: `SUPPORTED_PUBLISH_PLATFORMS` (line 154), the `publishByPlatform` switch (1118), a new `providers/gbp.ts`, a Google branch in `loadConnection` (1353) for refresh, and a Google error classifier beside the Meta-only one in `handleFailure` (1840). The dead `gbp` case in `metadata.ts:47` is rewritten to the single stored id format.
- Guard: `src/lib/publishing/queue.ts:13` accepts Google only in legacy-bridge mode; `src/lib/publishing/handler.ts:23` keeps refusing it. A later schema switch cannot silently move Google to an unsupported path.
- Shared request-building fixtures run under Vitest against the edge provider code, so the tested body is the sent body.
- Before each create: re-check the brand switch and the destination.
- Media: one image, signed at attempt time, bytes checked (JPG or PNG, 10 KB to 5 MB, at least 250 by 250). PR3 measures Google's fetch timing on the first live post and lengthens the signed URL if needed.
- Errors: 400 hard fail with Google's message; 401 one refresh then `needs_action`; 403 and 404 hard fail and alert; 429 and 5xx before acceptance retry with backoff and jitter; timeout after send is `uncertain` (section 2); event already ended stops retrying.
- User-facing messages: `src/lib/publishing/failure-messages.ts:71` gains Google entries, and line 299 stops treating `gbp` as a retired platform.
- Deploy the function by name with `/opt/homebrew/bin/supabase`, never deploy-all. The caller check is unaffected.

### 8. Moderation checks and alerts

- Checks run from the minute scheduler as a bounded batch (at most 10 due rows, 5-second budget, Google failures caught) so Meta dispatch is never delayed.
- Cadence after send: 2, 10 and 30 minutes, then hourly to 24 hours.
- `LIVE`: stop. `REJECTED`: one alert (content, reason, links), no automatic retry. Still `PROCESSING` after 24 hours: one alert, then daily checks until the event ends. Reads failing for 6 hours: one "cannot confirm" alert.
- Alerts are selected from unresolved rows, not a time window, so a missed run catches up.
- Planner: Google badge and dot (`components/ui/platform-badge.tsx:12`, `platform-dot.tsx:6`), label from `google_state`, link to the Google post, and a short list on the publishing status card (uncertain, long PROCESSING, REJECTED, connection needing action).

### 9. Switch-off and rollback

- Switch off: Google hidden everywhere; the worker resolves due Google jobs as `gbp_disabled` and sends nothing. They are not replayed if the switch goes back on (simpler than v3's park and release, and safe for a single owner).
- Rollback cannot remove posts already on Google, an accepted in-flight create or the OAuth grant. Posts are removed by hand in Business Profile; `gbp_posts` keeps the links.
- The migration is additive; rollback leaves the table and column in place.

### 10. Data kept

Only routing identifiers, post state and the location title. Google's policy limits storing profile content to 30 days; nothing else from Google is stored.

## Platform wiring checklist

Adding `gbp` to `Platform` (`src/types/content.ts:13`), `ProviderPlatform` (`src/types/providers.ts:6`) and `PLATFORMS` (`src/lib/constants.ts:29`) breaks or silently changes every list below. Each is either extended or deliberately left as Facebook and Instagram, with a comment.

Extend:
- Connections: `src/lib/connections/{oauth.ts:40, metadata.ts:1,8, readiness.ts:1,40,42, diagnostics.ts:6,18, data.ts:12,31,47, persist.ts:62, health.ts:21}`, `src/app/(app)/connections/actions.ts:42,45,50`, `src/features/connections/connection-cards.tsx:22-40,57`, `health-dots:19`
- Create and copy: `src/features/create/schemas/content-schemas.ts:83,140`, `src/lib/create/schema.ts:6`, wizard steps (`brief-step.tsx:52`, `create-wizard.tsx:119,368`, `generate-step.tsx:92,107`, `streaming-preview.tsx:13`, `media-step.tsx:91`, `schedule-calendar.tsx:31,78`), `src/app/actions/content.ts:70,401,566`, `src/lib/ai/*` (section 6), `src/lib/publishing/compose-body.ts:47-68`
- Planner: `src/app/(app)/planner/actions.ts:92,276,1205`, `src/lib/planner/data.ts:124-789`, `features/planner/{calendar-cell,planner-agenda,planner-calendar,status-filters,planner-content-composer,utils,activity-feed}`
- Publishing: section 7, plus `src/lib/publishing/preflight.ts:9,26,31`, `src/lib/providers/rate-limits.ts:11`
- Scheduling: `src/lib/scheduling/spread.ts:15,33`, `conflicts.ts:32` (a Google post must not count as a clash with Meta slots)

Leave as Facebook and Instagram only: `src/types/tournament.ts:14` and tournament code, `src/lib/content/calendar-fill*.ts`, `rewrite-event-posts.ts`, `booking-line-backfill.ts`, `src/lib/analytics/*` and post results, `src/lib/link-in-bio/*`, `src/lib/onboarding/setup-progress.ts:14,48` and `setup-checklist.tsx:32` (a new customer must not be asked to connect Google), `proximity-label.ts` and `banner-label.ts`, settings signatures and location ids.

Tidy in the same work: `tests/msw/handlers/gbp.ts` (rewrite to the new contract), stale `gbp_*` fixtures in `tests/lib/settings/data.test.ts:83-133`, and the CLAUDE.md lines saying GBP was removed.

## Delivery (independently deployable PRs)

1. **PR1, data and contracts.** Migration (section 2); admin switch (off); management mapping; event end time field and resolver with tests. The only visible changes are the optional end time field on the event form and the new switch on the admin page. The `Platform` type is not widened here: widening it with nothing using it only adds risk, so it moves to PR2 with the wiring checklist.
2. **PR2, connection.** OAuth, picker, refresh-aware readiness and health, disconnect. Accepted by connecting The Anchor on production with posting still impossible (worker unchanged).
3. **PR3, publishing.** Edge provider (EVENT and STANDARD), claim and reconcile, error classes, media, copy rules, runtime guard. Edge secrets set, function deployed by name.
4. **PR4, moderation.** Checks, alerts, planner labels and link. Must ship before the switch is turned on.
5. **PR5, create and planner.** Google option in the wizard and composer, partial-success batch, one Google item per event.
6. **PR6, existing schedule (D8).** A one-off, dry-run-first ops script that creates a Google version of each feed post already scheduled for an enabled brand: one per event (D5), stories skipped, anything that cannot be matched or has no end time listed, not guessed. Run only with Peter's approval of the dry-run list; a second run changes nothing.
7. **Go-live.** Switch on for The Anchor with Peter's explicit approval; one real EVENT and one STANDARD post reach LIVE; image, times, button and link checked on the profile. Deployment id and worker version recorded.

Under D1, PR1 ships now; PR2 onwards waits for Google's approval.

## Tests (required)

Mocked Google only; no live post without separate approval. `npm run ci:verify`.

- Access: a brand with the switch off cannot start OAuth, complete a callback, select Google in create, or have a Google job sent; a self-serve brand never sees Google.
- One post: concurrent submissions, repeated import, lost response after create and database failure after create each end with at most one confirmed post.
- Meta untouched: three-platform wizard with Google not eligible, invalid Google media and Google enqueue failure; Meta scheduled exactly once and the screen says so.
- Tokens: expired access with valid refresh sends; revoked refresh gives one reconnect state; token endpoint timeout retries; concurrent refresh keeps the newest token; the expiring-connection email ignores Google.
- Moderation: PROCESSING to LIVE, immediate and delayed REJECTED, 24-hour PROCESSING, read outage; one alert per incident.
- Contract fixture: stored campaign metadata to the actual edge request body (BOOK, LEARN_MORE, Google link, no button when no link).
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
