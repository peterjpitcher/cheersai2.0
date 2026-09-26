# SPEC: bring back Google Business Profile posting (events first)

Status: draft v3, 2026-09-24. Revised after `tasks/REVIEW-gbp-posting-reintroduction.md` (findings GBP-01 to GBP-14, each mapped below) and Peter's decisions D7 to D9. No code written.

## Why

The Anchor wants its event posts on its Google Business Profile (GBP) as well as Facebook and Instagram, with no routine manual work. The management app lists "Add GBP Event Post" as a required manual checklist job (`OJ-AnchorManagementTools/src/lib/event-checklist.ts:36`); this automates it.

GBP was removed on 2026-06-29 (`1cdf7566`, `2e598111`) because it never worked. This spec rebuilds it on the lessons from that attempt.

Success measure: each eligible approved event gets one correct, visible (LIVE) GBP post, and its Facebook and Instagram schedule is never disturbed. No claim about bookings or rankings.

## Decisions made

- D1. Nothing is built until Google has approved API access for the Cloud project. Without it every call returns HTTP 429 `RESOURCE_EXHAUSTED`.
- D2. Event posts (GBP `EVENT`) are in scope from the first release, alongside `STANDARD` posts.
- D3. Direct Google API only; no aggregator.
- D4. Event end comes from the management app: explicit end time wins, otherwise start plus duration.
- D5. One GBP event post per event, published on the event's first scheduled post date.
- D6. `BOOK` button when the event has a `booking_url`, otherwise `LEARN_MORE`; both to the event's GBP tracked link.
- D7. Manually entered events get GBP event posts too: the event form gains an end time field. Imported events have it pre-filled from the management app and it stays editable. (Review D-A, GBP-06.)
- D8. No backfill. Event campaigns created before go-live get no GBP posts from CheersAI; Peter adds those to Google by hand. Turning the switch on never creates GBP work for existing campaigns. (Review D-B, GBP-07.)
- D9. Event changes and cancellations after the GBP post is out are corrected by hand in Google for the first release. CheersAI shows a direct link to each Google post to make that quick. Automatic updates are a later, separate piece of work. (Review D-C, GBP-08.)

## Root causes last time, and the fix

| Cause | Evidence | This design |
|---|---|---|
| API access never approved (confirmed 2026-09-24) | Cloud project `cheersai-469418` (number 344798984846): Business Information API quota 0 requests per minute; the posting API (Google My Business v4) not enabled; no access application on the owner account's support history | Phase 0 evidence gate |
| Location looked up on every sync | `07f2dd13` | Resolve at connect time only |
| Three location id formats in conflict | `location-id.ts` vs edge `metadata.ts:52` | One stored value, `accounts/{a}/locations/{l}` |
| Live worker only sent STANDARD | old `providers/gbp.ts` | EVENT support in the edge worker |
| Media paths not public | fixed in `d10ecde3` | Sign media at each attempt |
| Probable 7-day token death (OAuth app in "Testing") | Google OAuth docs | Phase 0 gate plus refresh-aware readiness |
| Reviews and metrics crons burned quota | removal spec | Out of scope |

## Phase 0 prerequisites (owner: Peter, outside the code) (GBP-11)

Record each item separately, all naming the same Cloud project number and OAuth client:
1. API access granted: quota page shows a non-zero limit (300 QPM on approval) for Account Management, Business Information and Google My Business v4.
2. OAuth consent screen external and "In production", scope `business.manage`.
3. Sensitive-scope verification passed (privacy policy, domain, demo video): a status screenshot, not inferred from "In production".
4. Redirect URI `https://cheers.orangejelly.co.uk/api/oauth/gbp/callback` registered.

Progress (2026-09-24):
- Access application submitted from the owner's Google account for project 344798984846, business Orange Jelly Limited. Google case ID 1-6436000041720; Google quotes 7 to 10 working days.
- OAuth client: origin and redirect URI for `https://cheers.orangejelly.co.uk` added, `cheersai.uk` entries replaced. Vercel and localhost entries kept.
- Branding: home, privacy and terms links moved to `cheers.orangejelly.co.uk`; `cheersai.uk` removed from authorised domains (the Vercel domain stays while the client uses it). Branding re-verification deliberately not requested; it needs a public home page first.
- Consent screen already "In production", external; `business.manage` is listed as non-sensitive, so no scope verification is needed.
- Still to do after approval: enable the Google My Business API (v4) for posting, then confirm a non-zero quota.

After the gate, and before PR2 is accepted: an authenticated accounts and locations read succeeds. No code retries against a zero quota.

## Scope

In: GBP connection per brand; `EVENT` posts for events and `STANDARD` posts for other content, from the live edge worker; Google moderation state tracked to LIVE or REJECTED with alerts; GBP copy and content rules; per-brand switch, default off. London-time locations only.

Out: reviews, metrics, Q&A, OFFER posts, video, multiple photos, Google-native scheduling or recurrence, paid Meta ads, automatic management checklist completion (GBP-15, later and optional).

## Design

### 1. Data: one tracked row per GBP post (GBP-01, GBP-04)

New table `gbp_posts`, `account_id`-scoped, RLS membership policies like other content tables:

- `id`, `account_id`, `content_item_id`, `publish_job_id`
- `source_event_key` (`mgmt:<management event id>` for imported events, `campaign:<campaign id>` for manually entered events, null for STANDARD) and `local_post_parent` (destination, captured when the job is created)
- `google_post_name` (resource name returned by Google), `google_state` (`PROCESSING`, `LIVE`, `REJECTED`, other), `delivery_state` (`claimed`, `sent`, `uncertain`, `failed`)
- `last_checked_at`, `next_check_at`, `check_attempts`, `last_error` (sanitised)
- Unique partial index on `(account_id, source_event_key, local_post_parent)` where `source_event_key is not null`: the atomic guarantee of D5. Unique on `content_item_id`.

Send sequence in the worker:
1. Claim: insert or lock the row as `claimed`. A unique violation means another attempt owns it: stop, no create.
2. Create the post at Google.
3. Record `google_post_name`, `delivery_state = sent`, `google_state` from the response.
4. Response lost, timeout or 5xx after the request left: `delivery_state = uncertain`. Never re-create blindly. Reconcile by listing the location's `localPosts` and matching on event title and start (EVENT) or summary prefix and create time (STANDARD). A match is adopted; no match after reconciliation allows one create; still unclear raises an operator alert.

The existing `publish_jobs` state (`queued`, `in_progress`, `succeeded`, `failed`) keeps meaning "transport". `succeeded` for GBP means Google accepted it, never that it is public; the planner reads `gbp_posts.google_state` for GBP labels.

### 2. Event data contract, source to Google (GBP-05, GBP-06)

Event form (`src/features/create/forms/event-fields.tsx`): add "End time" (`eventEndTime`) next to the existing start time (`eventTime`) and optional end date (`eventEndDate`), with a matching field in `src/features/create/schemas/content-schemas.ts`. Optional for Facebook and Instagram; when Google is selected and no end can be resolved, the form says so inline ("Add an end time to post this event to Google") rather than failing later. On import, the field is pre-filled with the end computed from the management app (rules below) and stays editable.

At event campaign creation, store on `campaigns.metadata`:
- `sourceEventKey` (see section 1; today the form and `src/lib/management-app/mappers.ts` drop the management event id)
- `eventStart` (exists), `eventEnd` (new, computed below), `eventTitle`
- `takesBookings` (true when the management event has a `booking_url`)
- `ctaLinks.gbp` (the management app already sends `gbp` and `google_business_profile` from `api/events/[id]/route.ts:204-205`; `readCtaLinks` in `src/lib/management-app/client.ts:633` and the mapper at `mappers.ts:123` must stop dropping it)

The edge worker already selects `campaigns(name, campaign_type, metadata)` (`worker.ts:1179`), so it builds the EVENT body from stored metadata with no management call at publish time.

End time rules (Europe/London, Luxon, elapsed-minute duration). The same resolver pre-fills the form on import and computes the stored `eventEnd` from what the form finally holds:
1. Start = event date + start time. Missing start: not eligible for GBP.
2. Explicit end time (the form's `eventEndTime`, pre-filled from management `end_time`): end date = `eventEndDate` if set, otherwise the start date; if that gives an end at or before the start (including `00:00`, which the management app uses for `24:00`), end date = next day.
3. Import pre-fill only, when the management app has no `end_time`: `duration_minutes` > 0 gives end = start plus that many real minutes, written into the form as an end time.
4. Else (no end time, zero, negative or invalid duration): not eligible for GBP until the user adds an end time.
5. Multi-day intent (`eventEndDate` later than the start date) needs an explicit end time; otherwise not eligible.
6. A start or end in the spring-forward gap (for example 01:30 on 28 March 2027) is not eligible; an ambiguous fall-back time (01:00 to 02:00 on 25 October 2026) takes the first (BST) occurrence.

GBP takes local wall time with no zone field, so the stored London wall time is sent as is.

"Not eligible" never stops Facebook or Instagram (see section 4); it shows on the GBP item with the reason.

Title: event title cut at a word boundary to 58 characters. This is a conservative product rule matching the Business Profile editor, not a verified API limit; Google's own validation error is surfaced if it disagrees.

### 3. Connection and tokens (GBP-03, GBP-09, GBP-12, GBP-14)

- Base on the current OAuth flow in `src/app/(app)/connections/actions.ts` (brand kept through the state value, membership re-checked), not the removed code. Scope `business.manage`, `access_type=offline`, `prompt=consent`.
- Location picker: paginate `accounts.list` and `accounts.locations.list` (with `readMask`); never auto-select. Picker candidates are held server-side bound to the brand and the OAuth state; the chosen location is validated server-side against that list; the connection becomes active only after the location and the token vault write both succeed. Abandoned or expired picks leave the old connection untouched. States shown: loading, no access, no locations, partial error, expired consent. Keyboard and screen-reader usable; labels include address so similar names can be told apart.
- Stored in `social_connections.metadata`: `localPostParent`, `locationTitle`, `placeId` only. Consent to automated posting recorded at connect (who, when).
- Readiness: for GBP, an expired access token with a stored refresh token is ready. Refresh happens in the worker immediately before send; keep the old refresh token if Google omits a new one; write with a compare-and-set on `updated_at` so parallel refreshes cannot overwrite newer tokens. `invalid_grant` = revoked: one `needs_action` state and one alert. Token endpoint outage: retry within bounds, no reconnect prompt. No token or signed URL in logs.
- Changing the location never retargets existing work: a job whose captured `local_post_parent` differs from the current connection fails with "destination changed".
- Disconnect for GBP sets `needs_action` (the live status check allows `active`, `expiring`, `needs_action`; the existing disconnect action tries `disconnected` and falls back), clears GBP tokens from the vault for that brand only, and stops new GBP work.

Env vars, added to `src/env.ts` first: `GOOGLE_BUSINESS_CLIENT_ID`, `GOOGLE_BUSINESS_CLIENT_SECRET`.

### 4. Create flow: GBP never disturbs Meta (GBP-02)

- `createScheduledBatch` (`src/app/actions/content.ts:1070`) currently rolls back the whole batch when any enqueue fails. Change: Facebook and Instagram behave exactly as today; GBP items are validated before enqueue and enqueued last, and a GBP failure (not eligible, invalid media, enqueue error) leaves the GBP item in a visible "needs attention" state with the reason, without rolling back Meta.
- The wizard result screen states partial success plainly ("Facebook and Instagram scheduled. Google not scheduled: <reason>").
- Fixing a GBP item re-queues only that item.
- For events, only one GBP item is created per event (the first slot), whatever the cadence.
- Brands with the switch off, and old drafts, stay Meta-only; the AI output schema only asks for GBP copy when the brand has GBP on.

### 5. Publishing runtime (GBP-05, GBP-13)

- One supported runtime: the Supabase edge worker (`supabase/functions/publish-queue/worker.ts`, allow-list at line 126, provider switch near 973), which production uses while `publish_jobs` has no `platform` column (checked live 2026-09-24).
- Guard: the Next.js queue (`src/lib/publishing/queue.ts:13`) accepts GBP only in `legacy-bridge` schema mode; in any other mode a GBP enqueue fails visibly. A later schema switch cannot silently move GBP to an unsupported path.
- Shared request-building fixtures run under Vitest against the edge provider code, so the tested body is the sent body.
- Before each create: re-check the brand switch and the connection destination.
- Media: signed at attempt time from the stored asset; bytes checked (JPG or PNG, 10 KB to 5 MB, at least 250x250). The signed URL lifetime covers Google's fetch; PR3 measures fetch timing on the first live post and lengthens the URL lifetime if needed.
- Errors:
  - 400: hard fail, Google's message kept.
  - 401: one refresh, then `needs_action`.
  - 403: access lost, hard fail and alert.
  - 404: destination gone, hard fail and alert.
  - 429 and 5xx before a request was accepted: retry with backoff and jitter.
  - Timeout or network loss after send: `uncertain` (section 1).
  - Event already ended: stop retrying.
- Deploy the edge function by name, never deploy-all.

### 6. Moderation checks and alerts (GBP-04)

- Checks run from the existing minute scheduler (`publish-scheduler`) as a bounded batch (at most 10 due rows, 5-second budget, Google failures caught) so Meta dispatch is never delayed.
- Cadence after send: 2, 10 and 30 minutes, then hourly to 24 hours.
- `LIVE`: stop checking.
- `REJECTED`: one alert (content, reason, links), no automatic retry; a correction is a deliberate new post by a user.
- Still `PROCESSING` after 24 hours: one alert, then daily checks until the event ends.
- A read that fails: retry on the next cycle; after 6 hours of failed reads, one "cannot confirm" alert.
- Alerts carry the brand, content link and Google post name. A failed alert run is caught up by selecting unresolved rows, not a time window.
- A small operator view (can live on the existing publishing status card): eligible events without a GBP post, due but unsent, uncertain, long PROCESSING, REJECTED, connections needing action.

### 7. Content rules (GBP-10)

- Copy: 1,500 characters max, no phone numbers, emails, social handles or hashtags, no invented times or booking facts; applies to manual edits as well as AI output.
- Hospitality: Google restricts posts promoting regulated products. Drinks price offers and alcohol-led promotions are flagged at preflight for human review of the GBP variant and not auto-sent; normal events (quiz, music bingo, live sport) pass. Artwork reviewed by the same approval step.
- The GBP variant is approved by a person like the other platforms.

### 8. Per-brand switch and rollback (GBP-13)

- Switch pattern from PR #82 (`dcbe10fe`); off by default.
- Switch off: GBP hidden in create; the worker parks due GBP jobs with resolution `gbp_disabled` and sends nothing. Switch back on: parked jobs whose event has ended, or whose slot is more than 24 hours past, are resolved as skipped, not replayed; the rest are released.
- Rollback cannot remove posts already on Google, an in-flight accepted create or an OAuth grant. Posts are removed by hand in Business Profile if needed; `gbp_posts` keeps the links to find them.
- The `gbp_posts` migration is additive; rollback leaves the table in place.

### 9. Policy and data retention (GBP-14)

- CheersAI posts for brands it does not own, which Google's API policies treat as third-party programmatic access needing prior specific consent. Consent is captured at connect (section 3).
- Only routing identifiers and post state are kept; no Google profile content is cached beyond `locationTitle` for display.
- Before a second brand is enabled: confirm this operating model against Google's API policies, and ask Google if unclear.

## Delivery (independently deployable PRs)

1. **PR1, data and contracts:**
   - `gbp_posts` migration.
   - `Platform` type and the per-brand switch (off).
   - Management mapping: keep the management event id, `ctaLinks.gbp`, `takesBookings`, `end_time`, `duration_minutes`.
   - Event form end time field (`eventEndTime`), pre-filled on import.
   - End-time resolver with tests.
   - No user-visible change.
2. **PR2, connection:** OAuth, paginated picker, refresh-aware readiness and health, GBP disconnect. Accepted by connecting The Anchor on production (posting switch still off).
3. **PR3, publishing:** edge provider (EVENT and STANDARD), claim and reconcile, error classes, media signing, content rules, runtime guard.
4. **PR4, moderation:** checks in the minute scheduler, alerts, operator view. Must ship before the switch is turned on.
5. **PR5, create and planner:** partial-success batch, one GBP item per event, planner labels from `google_state`, and a direct link to each Google post (D9).
6. **Go-live:** switch on for The Anchor with explicit approval; one real EVENT reaches LIVE; image, times and button checked on the profile and destination; one STANDARD post checked separately. App deployment id and edge function version recorded.

## Tests (required)

Mocked Google only; no live post without separate approval. `npm run ci:verify` (runs London and UTC).
- One post: concurrent submissions, repeated import, lost response after create, database failure after create each end with at most one confirmed post.
- Meta untouched: three-platform wizard with GBP not eligible, invalid GBP media and GBP enqueue failure; Meta scheduled exactly once and the screen says so.
- Tokens: expired access with valid refresh schedules and sends; revoked refresh gives one reconnect state; token endpoint timeout retries; concurrent refresh keeps the newest token.
- Moderation: PROCESSING to LIVE, immediate and delayed REJECTED, 24-hour PROCESSING, read outage; one alert per incident.
- Contract fixture: stored campaign metadata to the actual edge request body (source id, schedule, BOOK and LEARN_MORE, GBP link, no button when no link).
- Manual event: end time typed in the form reaches the Google request; no end time shows the inline message and leaves Meta unaffected.
- No GBP work is created for campaigns that existed before the switch was turned on.
- Dates: overnight end, `00:00` end, explicit end beats duration, zero or missing duration, multi-day without end time, event spanning 25 October 2026 (repeated hour) and 28 March 2027 (missing hour).
- Connection: forged location, expired picker, removed membership, repeated callback, vault failure, simultaneous reconnect, location change with queued jobs.
- Switch: off during dispatch, off then on with past-due jobs.
- Content: alcohol price promotion flagged, normal event passes, contact details stripped, Unicode title cut.
- Errors: 400, 401, 403, 404, 429, 5xx, timeout.

## Paired repository

The management app already provides the GBP short link, `booking_url`, `end_time`, `duration_minutes` and `event_status`; no change needed there for this spec.

Staff handover: for events created in CheersAI after go-live, staff tick "Add GBP Event Post" in the management checklist once CheersAI shows the Google post as LIVE, and do not post by hand. Events created before go-live, and all changes or cancellations after a post is out (D8, D9), stay manual in Google, using the post link CheersAI shows.
