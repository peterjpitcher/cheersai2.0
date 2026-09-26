# Review: Google Business Profile posting reintroduction

Reviewed 24 September 2026. Separate review of the supplied draft specification. No implementation changes or live writes.

## Executive assessment

**Specification readiness: Not ready for the affected implementation.** The direction is sensible, but implementing the text literally would not reliably deliver one correct Google post per event while allowing Facebook and Instagram to continue independently.

The main corrections are:

1. Preserve source event identity, booking classification and the complete GBP link and schedule through the creation flow.
2. Define duplicate prevention and recovery when Google creates a post but CheersAI cannot record success.
3. Make GBP validation failures independent of Meta scheduling and make readiness understand refreshable Google tokens.
4. Reconcile Google's moderation state with the actual legacy job states and specify a durable polling and alert path.
5. Decide how existing campaigns, manual events, changes and cancellations behave.

**Production readiness: Insufficient evidence to assess readiness.** There is no new implementation to exercise. Google project approval, OAuth verification, actual posting eligibility, deployed worker version and end-to-end behaviour have not been demonstrated.

No P0 finding is justified by the evidence. P1 findings block their affected design or release gate, not all discovery. D1 remains the owner's explicit no-build gate until Google access is evidenced; this review does not override it.

The strongest existing choices are direct integration, one stored destination per brand, encrypted tokens, per-brand opt-in, no fabricated event end, no reviews/metrics expansion and recognition that rollback cannot remove posts already sent.

## Purpose, scope and evidence

The business outcome is to remove routine manual GBP event posting for The Anchor while retaining reliable Facebook and Instagram delivery. Users include venue owners creating and approving content, staff working the management checklist, administrators connecting brands, and operators recovering failed posts. Customers depend on correct event times and booking destinations.

The reviewed draft includes EVENT and STANDARD feed posts, OAuth connection, scheduling, moderation checks and a brand switch. Paid ads, reviews, metrics, offers, video, stories and multiple photos remain excluded. These exclusions do not remove the need to protect shared creation, queue, connection, notification and planner behaviour.

Evidence inspected:

- The two supplied attachments: review brief and draft dated 2026-09-24. The supplied draft is the review subject; the existing local specification was not edited.
- CheersAI working tree at `722e7c97c2f6e2658446cefe3a786c39abb30a09`, branch `docs/stage1-results`. Existing changes to `tasks/lessons.md` and the untracked `tasks/SPEC-gbp-posting-reintroduction.md` were left alone.
- Workspace/project instructions; publishing queue, preflight, handler, state machine and edge worker; creation actions, event form/schema and management mapper; OAuth actions, connection health, notification cron, cron configuration, package/test configuration and GBP removal/resolution migrations.
- Paired management repository at `a8e968fe8bfd646831827948dde7960e0c9b5728`: event response and event end-time handling, inspected read-only.
- Read-only schema queries against Supabase project `nbkjciurhvkfpcpatbnt`: `publish_jobs` has no `platform` column and permits `queued`, `in_progress`, `succeeded`, `failed`; `social_connections.provider` is text and permits `gbp`; its status constraint permits `active`, `expiring`, `needs_action`. `content_items.platform` is text.
- Current official Google references linked below, accessed on the review date.

The live schema supports the specification's edge-worker route: current scheduler code selects that route when `publish_jobs.platform` is absent. This is a code-plus-schema conclusion, not proof of which deployed binary handled a particular job. The project guidance's QStash description must not be used to dismiss the legacy production path.

Not inspected: Google Cloud console, approval correspondence, actual OAuth credentials, live event payloads, deployment artefacts, live worker logs, live Google posts or the unspecified full discovery touchpoint document. Historical 429s do not establish that approval was absent; that remains the draft's plausible hypothesis. Local paired code establishes the response contract, not live data completeness. No publishing, OAuth connection, backfill, test campaign or full CI run was performed for this document-only review.

## Wider impact and dependencies

| Upstream source | Changed path | Downstream dependency and consequence |
|---|---|---|
| Management event ID, timing, booking URL, tracked links | Client, mapper, form, validation, campaign snapshot | Deduplication, EVENT payload, correct CTA, backfill and amendments |
| Brand membership and Google consent | OAuth state, picker, token vault | Correct destination, disconnect, refresh and worker authority |
| Selected platforms and cadence | Wizard, batch creation, queue | GBP occurs once; Meta slots remain unchanged; partial failures are visible |
| Stored media and generated copy | Platform validation and actual worker payload | Google acceptance, moderation, signed-URL lifetime, customer-visible accuracy |
| Worker response and Google resource name | Job/content state, moderation checks | Planner labels, retries, alerts and operational reconciliation |
| Brand switch and location replacement | Queued and in-flight jobs | Stop behaviour, backlog handling, protection against posting to a new destination |
| GBP post and tracked URL | Public profile, destination website, staff checklist | Working bookings, attribution and avoidance of manual duplicates |
| Shared Platform union and AI schema | Exhaustive maps and generation contracts | Disabled brands, old drafts, analytics presentation and Meta-only regressions |

## Findings, ordered by priority

### GBP-01, P1: Persist event identity and enforce one post across attempts

**Type/domain:** Required correction; data integrity and asynchronous publishing. **Evidence:** Confirmed omission, supported by inspected code. D5 and Create flow require one post per event; [event import](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/features/create/forms/event-fields.tsx:80) and [mapper](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/management-app/mappers.ts:103) do not retain the management event ID. [Queue deduplication](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/publishing/queue.ts:46) uses content ID, platform and scheduled time.

Two imports of the same event, rescheduling, simultaneous submissions or a response lost after Google's successful create can produce two posts. A wizard limit of one slot does not enforce D5. The [create method](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts/create) documents no caller-supplied idempotency key.

**Smallest adequate action:** Persist brand-scoped source event identity and occurrence identity, bind the intended destination, and enforce uniqueness atomically. Persist the returned Google resource name. An ambiguous external result must enter reconciliation rather than blind create retry. Do not promise exactly-once external delivery without such a recovery path. A schema change may be necessary; the old enum does not settle this.

**Owner/gate:** Publishing/data developer before PR1 data design and PR3 retry implementation. Manual-event identity follows decision D-A below. **Acceptance:** Concurrent submissions, repeated imports, lost response and database failure after create produce at most one confirmed post; uncertain outcomes remain visible and recoverable without re-publishing Meta. Priority is high because duplicate public posts directly defeat D5.

### GBP-02, P1: GBP-only failure must not roll back Meta

**Type/domain:** Required correction; shared scheduling and UX. **Evidence:** Specification says missing end data blocks GBP only. [Batch creation](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/app/actions/content.ts:1070) enqueues platforms in sequence and rolls back the whole batch after any enqueue error.

**Smallest adequate action:** Define a per-platform result before enqueueing. Preserve valid Meta work and a visible, correctable GBP item or explicit omitted-GBP result. Correcting GBP must not create another Meta campaign. Account for an immediate job already dispatched before a later failure; deleting database rows cannot retract an external post.

**Owner/gate:** Creation/publishing developer before PR4. **Acceptance:** Through the real wizard, schedule all three platforms with missing GBP end, invalid GBP media and a GBP enqueue failure. Meta remains scheduled exactly once, the screen accurately describes partial success, and GBP can be repaired independently. Priority is high because this change could disrupt existing working channels.

### GBP-03, P1: Refreshable expiry conflicts with existing readiness and health

**Type/domain:** Required correction; authentication and reliability. **Evidence:** Publishing promises refresh at expiry, but [preflight](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/publishing/preflight.ts:67) rejects expired access tokens and tells users to reconnect. Connection health also classifies access-token expiry as failure.

**Smallest adequate action:** Give GBP a refresh-aware readiness/health contract. A usable refresh credential permits scheduling; refresh before sending. Distinguish revoked/missing refresh credentials from temporary token-endpoint failure. Preserve an existing refresh token when Google omits a replacement, prevent concurrent refresh writes from overwriting newer credentials, and make notifications reflect actionable connection failure.

**Owner/gate:** Connection developer before PR2/PR3 integration. **Acceptance:** Scheduling with expired access but valid refresh succeeds; revoked refresh produces one actionable reconnect state; transient refresh failure retries within bounds; no token or signed URL appears in logs. Priority is high because otherwise unattended posting can stop after ordinary access-token expiry. Moving OAuth to production addresses Google's [testing-token limitation](https://developers.google.com/identity/protocols/oauth2), not all revocation or refresh failures.

### GBP-04, P1: Moderation needs its own persisted state and recovery contract

**Type/domain:** Required correction; state, observability and operations. **Evidence:** Publishing says a job stays `published` on HTTP 200 and later becomes failed. Live jobs instead use `succeeded`; the [edge worker](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/supabase/functions/publish-queue/worker.ts:880) marks content `posted`. The alternative [Next state machine](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/publishing/state-machine.ts:22) treats `published` as terminal. Google distinguishes acceptance from visibility: `PROCESSING` is not public, `LIVE` is public, and `REJECTED` is a moderation outcome. See [LocalPost](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts).

**Smallest adequate action:** Define stored resource name, provider state, last/next check and pending-age handling separately from transport success. Name the scheduled check and its cadence. Continue checking delayed PROCESSING, retry failed reads, and surface prolonged uncertainty. Do not offer generic create retry for a moderation rejection. Define corrections to an existing post versus a deliberately authorised replacement.

The hourly failure notifier cannot meet a 10 to 30 minute check promise. A bounded due-check batch in the minute scheduler is a possible implementation, provided Google failure cannot delay Meta dispatch. Existing [failure email selection](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/app/api/cron/notify-failures/route.ts:16) has a two-hour window: cron outages need catch-up or explicit unresolved-alert handling.

**Owner/gate:** Publishing/operations developer before PR3 state design; PR5 is mandatory before enabling posting. **Acceptance:** PROCESSING to LIVE, immediate/delayed REJECTED, long PROCESSING, poll outage and repeated checks give accurate planner state and one actionable alert per incident. Raw HTTP 200 never alone means visible on Google. Priority is high because silent non-public posts defeat the business outcome.

### GBP-05, P1: Specify the complete event payload path and enabled worker contract

**Type/domain:** Required correction; integration and compatibility. **Evidence:** The edge route is supported by live schema, but the shared [queue guard](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/publishing/queue.ts:13) still rejects GBP. The edge request currently passes campaign name, prompt context and preview data, not a defined event schedule object. The Next payload builder also lacks campaign event mapping. Adding `readCtaLinks.gbp` alone is insufficient: [mapper](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/management-app/mappers.ts:123) rebuilds Facebook/Instagram links and the wizard schema excludes GBP. Booking classification is lost in the form.

**Smallest adequate action:** Specify the full contract from source ID, booking flag, GBP URL, title and resolved start/end through form/schema, campaign/content persistence, queue and actual provider request. Cover STANDARD CTA source and default too. Choose the supported runtime explicitly: support both enabled routes, or detect and prevent a later schema switch from silently moving GBP to an unsupported path. Sharing an interface does not by itself share validation across Node and Deno.

**Owner/gate:** Integration lead before PR1/PR3. **Acceptance:** A captured request from the actual worker contains the stored EVENT details and correct tracked CTA, with no management call during publish. The alternate runtime either passes the same contract fixtures or fails visibly before work is accepted. Disabled brands remain Meta-only, including old drafts and AI output parsing. Priority is high because isolated adapter tests would miss the missing wiring.

### GBP-06, P1: End-time precedence does not resolve an end date or manual-event recovery

**Type/domain:** Required correction plus decision D-A; dates and UX. **Evidence:** The paired [event API](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/events/[id]/route.ts:218) does expose `end_time` and `duration_minutes`. End time is time-only, and the management service normalises `24:00` to `00:00`. The manual wizard has an end date but no duration/end-time input. The specified error directs manual users to an event that may not exist in the management app.

**Smallest adequate action:** Define precedence between explicit end date/time, duration and existing brief dates. Explicitly handle overnight rollover, equal start/end, non-positive/invalid duration and missing start. Reject unresolved multi-day intent rather than guessing. State whether duration means elapsed minutes. Detect ambiguous/nonexistent London local times or provide a documented resolution policy. Limit initial support to London locations unless another location-timezone contract is provided.

The proposed 31 October event test checks scheduling across a clock change, not an event spanning the change. Add 25 October 2026 repeated-hour and 28 March 2027 missing-hour fixtures. Luxon alone does not establish the intended interpretation.

**Owner/gate:** Product owner chooses manual-event support before affected UI design; developer resolves date contract before PR1. **Acceptance:** Overnight, explicit end, missing/zero duration, multi-day and clock-change cases preserve the intended start/end without invented duration. Manual users have an achievable recovery action. Priority is high because wrong event times reach customers.

### GBP-07, P1: Existing campaigns and backfill need identity and eligibility rules

**Type/domain:** Unresolved decision D-B and required correction; migration and rollout. **Evidence:** PR1 backfills only `eventEnd`, while historical campaign metadata has no reliable management event identity. Updating metadata does not create a GBP item or job. The draft does not define events whose first cadence slot is already past.

**Smallest adequate action:** Produce an account-scoped dry-run inventory of safely matched, ambiguous, unmatched, ended and already-manually-posted events. Never match solely by title. Persist source identity and missing CTA/booking fields where evidence supports them. Decide explicitly whether old campaigns receive jobs; do not replay old schedules on enablement. Make the backfill repeatable and protect concurrent edits.

**Owner/gate:** Product owner before backfill design; developer before approved execution. **Acceptance:** A second dry run produces no additional changes; ambiguous records are excluded and reported; past/ended events and manual posts are not duplicated; existing Meta jobs remain untouched. Priority is high because metadata-only migration would give false confidence that existing events are covered.

### GBP-08, P1: Define amendments, cancellations and the staff handover

**Type/domain:** Unresolved decision D-C; lifecycle and operations. **Evidence:** `eventEnd` is snapshotted at creation, but no amendment/cancellation behaviour is specified. The source exposes event status; the current mapper uses it only in prompt text. The management checklist still tells staff to add a GBP post manually.

**Smallest adequate action:** Define which snapshot is authoritative and how changes reach queued or published GBP work. For a modest first release, an explicit correction procedure with an owner and visible Google post link may be sufficient, but it qualifies the promise of no manual work. Automated updates/cancellations are a separate scope choice. Staff need a handover rule preventing duplicate manual posting; automatic checklist completion may remain optional.

**Owner/gate:** Product/venue owner before release scope is fixed. **Acceptance:** A cancelled or retimed event before and after first publication has a demonstrated recovery route; removing CheersAI content does not falsely imply removal from Google; staff can determine whether manual posting is required. Priority is high because an otherwise successful system could advertise cancelled events.

### GBP-09, P1: Rebuilt OAuth must preserve brand authority through location selection

**Type/domain:** Required acceptance correction; security and connection lifecycle. **Evidence:** Current [OAuth completion](</Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/app/(app)/connections/actions.ts:98>) preserves the initiating brand and checks membership again. The spec proposes historical code reuse plus a new picker, without defining the pending connection boundary. A canonical-name regex validates shape, not authority. These are implementation risks, not a verified new vulnerability.

**Smallest adequate action:** Use the current security flow as the base. Bind picker candidates to the initiating brand and authorised Google session, validate the selected candidate server-side, recheck access, and activate only after location and vault writes succeed. Handle abandoned/expired selection and concurrent reconnects without overwriting a newer choice. Jobs must not silently retarget when a location is replaced.

The existing disconnect action writes `disconnected`, but the inspected live connection constraint does not allow that status. The new GBP disconnect path must use supported state/schema and remove or revoke the intended credentials appropriately, without disrupting another brand sharing the Google grant. This is a verified code/schema mismatch; the live action was not run.

**Owner/gate:** Connection developer before PR2 release. **Acceptance:** Brand switch, removed membership, forged location, repeated callback, expired picker, vault failure and simultaneous reconnect all fail closed or retain the correct connection. Disconnect prevents subsequent GBP work and is exercised against the real schema. Priority is high because a destination error affects another public business profile.

### GBP-10, P1: Hospitality content needs Google-specific policy handling

**Type/domain:** Required correction; content and AI oversight. **Evidence:** Scope includes general promotions and evergreen content. The copy rules only address length and contact/hashtag formatting. Google's [post guidance](https://support.google.com/business/answer/7342169?hl=en) restricts content about regulated products, relevant to a pub's alcohol promotions. Its [restricted-content policy](https://support.google.com/business/answer/7400114) also addresses promotional offers and destinations selling restricted goods.

**Smallest adequate action:** Add GBP-specific eligibility checks and review guidance for text, artwork and destination. Preserve human approval of the GBP variant. Do not treat an AI instruction or post-publication rejection alert as a preflight guarantee. Clearly distinguish the product's conservative formatting rules from verified Google API limits; the inspected API reference does not establish the stated 58-character title limit.

**Owner/gate:** Content/product owner with developer before PR3 rules and release. **Acceptance:** A normal music/quiz event, alcohol-price promotion, unsuitable artwork and risky destination are evaluated with documented expected outcomes. Imported prompt text cannot change posting permissions or invent timing/booking facts. Test manual edits as well as AI output. Priority is high because the venue's ordinary content mix makes this a realistic rejection risk, not a generic compliance checklist.

### GBP-11, P2: Phase 0 evidence should separate API approval from OAuth verification

**Type/domain:** Required clarification; external dependency. **Evidence:** D1 prohibits building before API approval; the root-cause table says before merges. Phase 0's gate requests quota and production-status screenshots, but its prerequisites also require sensitive-scope verification. Google's [quota guidance](https://developers.google.com/my-business/content/limits) confirms zero quota means access has not been granted. It does not make a historical 429 conclusive proof of that cause.

**Action:** Record the project identity, relevant enabled services and access grant separately from OAuth production status and verification. A positive approved quota need not remain exactly 300 forever. After the gate, verify authenticated account/location reads and real posting eligibility during explicitly authorised acceptance. Preserve D1's stricter no-build interpretation unless Peter changes it. Privacy policy/domain/demo ownership must be assigned; verification cannot be inferred from an In production screenshot.

**Owner/gate:** Peter for project evidence before build; developer for connection evidence before PR2 acceptance. **Verification:** Evidence consistently names the same project/client; no zero-quota retry loop; release approval includes verification status and a refreshed credential. Priority is medium because the gate is sound but its proof is incomplete.

### GBP-12, P2: Location discovery cannot promise exactly two calls

**Type/domain:** Required correction; integration and UX. **Evidence:** Connection specifies one accounts call and one locations call. Both are paginated; accounts can include several managed accounts. The [accounts method](https://developers.google.com/my-business/reference/accountmanagement/rest/v1/accounts/list) returns at most 20 per page; the [locations method](https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations/list) requires `readMask` and supports `nextPageToken`.

**Action:** Discover accounts and locations at connection time, using pagination and a selected-account flow where appropriate. Preserve the matching account/location pair. Show no-access, no-location, partial-error, loading and expired-consent states without selecting the first result silently. Use accessible labels including enough location detail to distinguish names; keyboard selection and focus recovery must work.

**Owner/gate:** Connection developer before PR2. **Acceptance:** Multiple accounts, empty first account, later-page location, abandoned picker and partial failure cannot connect the wrong venue. Priority is medium: the fixed call count is an unnecessary constraint and can hide the intended destination.

### GBP-13, P2: Define bounded retry, media fetch and rollback behaviour

**Type/domain:** Required correction; reliability and operations. **Evidence:** Publishing covers 400/401/429 but not 403, 404, 5xx, timeouts or network loss. Media reuse is unspecified across retries; the edge worker's configured signed URL default is 3,600 seconds. Rollback says refuse jobs, with no backlog or in-flight rule.

**Action:** Classify access loss and invalid destination separately from transient failures; use bounded backoff with jitter and an event-expiry cutoff. Never retry an ambiguous create without GBP-01 reconciliation. Sign media at attempt time, validate the actual selected bytes, and verify fetch lifetime under Google processing delays. Google's [photo guidance](https://support.google.com/business/answer/6103862?hl=en) supports the draft's format, size and dimensions, but does not prove that every delayed fetch fits the current URL TTL.

Check the switch immediately before external create, stop new dispatch, and specify whether queued work is parked or terminally resolved. Re-enable must not silently replay stale work. Keep already-created posts under observation where credentials permit. Code rollback cannot undo an in-flight accepted request, a post, OAuth grant or backfill write.

**Owner/gate:** Publishing/operations developer before PR3 and rollback rehearsal. **Acceptance:** Exercise each error class, expired image URL, switch-off during dispatch, off/on backlog and dependency outage; Meta continues. Priority is medium because the failure types are ordinary but the current text leaves recovery ambiguous.

### GBP-14, P2: Policy, consent and retention boundaries need an explicit check

**Type/domain:** Investigation and release condition; supplier policy/privacy. **Evidence:** Per-brand automation extends beyond the single venue. Google's [API policies](https://developers.google.com/my-business/content/policies) distinguish own automated use from third-party programmatic access, require prior specific consent for automated actions, and restrict some stored API content. The exact application to this product and stored identifiers has not been established; no violation is asserted.

**Action:** Record the permitted operating model, obtain/record posting consent, and review retention of location titles, place identifiers and provider responses. Keep the efficient stored routing identifier; resolve the policy interpretation before assuming permanent caching of all returned data. Provide a working stop/disassociation flow. Do not introduce reviews or analytics storage to solve posting.

**Owner/gate:** Product/project owner, with Google clarification if needed, before multi-brand release; developer implements the agreed retention/disconnect behaviour. **Verification:** Approved operating model, minimal retained data and consent/withdrawal behaviour documented. Priority is medium because the consequence could be serious but applicability remains unverified.

## Material edge cases and acceptance gaps

These are proposed acceptance additions, not claims about tests already present.

| Journey or invariant | Verification | Findings |
|---|---|---|
| One source event and destination produce one confirmed GBP post | Concurrent import, reschedule, duplicate delivery, external success followed by lost response/database failure | 01 |
| GBP failure never removes valid Meta work | Real three-platform wizard flow, partial enqueue failure, GBP repair only | 02, 05 |
| Tokens refresh without routine reconnect | Expired access/valid refresh, missing refresh, revoked consent, refresh timeout and concurrent refresh | 03 |
| Acceptance is distinct from visibility | Immediate rejection, delayed processing, poll outage, repeated alert, correction of existing post | 04 |
| Correct imported data reaches the external request | Stored-to-worker integration fixture with source ID, full schedule, BOOK/LEARN_MORE and GBP link | 05, 06 |
| Event dates retain intended meaning | Overnight, multi-day ambiguity, zero duration, equal times, both clock changes; London and UTC test runs | 06 |
| Existing work is not silently duplicated or missed | Dry-run backfill twice, unmatched source, past first slot, manual Google post already present | 07 |
| Changes have a recovery path | Cancel/retime before and after publish, trash/restore, lost access during correction | 08, 13 |
| Correct brand and location remain bound | Two tabs/brands, revoked membership, forged location, disconnect and location replacement | 09, 12 |
| Copy and media remain truthful and eligible | Long/unbroken title, Unicode boundaries, empty trimmed copy, manual edits, alcohol promotion/artwork and invalid destination | 10, 13 |
| Feature off is stable during partial rollout | Old drafts and Meta-only AI schema, worker/app version skew, queued work while off, re-enable without stale replay | 05, 13 |
| Connection and planner are usable | Keyboard-only picker, focus after errors, screen-reader status, no colour-only badge, narrow/mobile layout | 04, 12 |
| Public journey works | Authorised real EVENT reaches LIVE; image, local times and tracked button checked on the actual profile and destination; STANDARD checked separately | 04, 05, 10 |

Use mocked Google contracts and worker integration tests before any external write. Run the existing `npm run ci:verify`, which already includes London and UTC test commands. Add coverage for the actual edge path; adapter-only tests are insufficient. The draft's CALL test is not a substitute for BOOK/LEARN_MORE and no-button tests, since CALL is not otherwise in scope. Tests must not send live posts without separate approval.

## Decision register

Open decision prompts are in the accompanying chat, in accordance with the workspace instruction. This register records the decision topics and proposed defaults without treating them as agreed requirements.

| ID | Decision topic | Proposed direction and trade-off | Owner | Timing |
|---|---|---|---|---|
| D-A | Manually entered EVENT support | Initially limit GBP EVENT to imported events with verified timing; avoids a new timing UI but narrows manual-event support | Peter/product | Before PR1/PR4 scope |
| D-B | Upcoming campaigns that predate enablement | Backfill only explicitly reviewed matches and schedule GBP prospectively; less coverage than automatic replay but avoids duplicates/past posts | Peter/venue operator | Before live backfill/job creation |
| D-C | Event changes and cancellations | Accept a named manual correction procedure for first release, or fund source-to-Google synchronisation; manual option is smaller but qualifies the no-manual-work promise | Peter/product | Before release commitment |

Technical contracts, polling implementation, authentication tests and schema validation are developer responsibilities rather than extra product approval questions. Google project approval/verification evidence is a prerequisite owned by Peter, not a question this review can answer.

## Simplification and optional improvements

- Keep one confirmed posting runtime for the initial rollout, with an explicit compatibility guard for the other route. Do not build two independent rule sets merely to satisfy an interface name.
- Use existing job/content storage where it can express the required state and uniqueness. Do not commit to no migrations before proving the invariants, or introduce a large new subsystem by default.
- Keep native Google scheduling and recurrence out of this release even though the current API reference exposes them. The existing scheduler can own timing.
- Keep one bounded moderation task; no reviews/metrics synchronisation or enterprise monitoring platform is needed.
- **GBP-15, P3, optional:** Automatically complete the management checklist only after LIVE confirmation. Evidence: the draft already labels this optional. It reduces staff reconciliation but adds paired-system write/failure handling. Product and management-app owner can consider it after first release; verify idempotent completion and a failed callback without hiding the published post. It is not a release condition if the staff procedure in GBP-08 is agreed.

## Operational success and coverage

Proposed business measure: each eligible approved event receives one correct, visible GBP post without routine manual posting, while its Meta schedule remains intact. Do not promise increased bookings or search rankings from the evidence available.

A small operational view is sufficient: eligible events missing a GBP job, due but unsent jobs, uncertain create outcomes, prolonged PROCESSING, REJECTED posts and connections requiring action. Retain correlation IDs, event identity, destination and sanitised failure reason. Identify the responder and provide links to the content and Google post. Provider acceptance counts must not be reported as LIVE counts. Tracked-link attribution is useful but GBP metrics remain out of scope.

Expected volume is unspecified. At this venue scale no independent load-testing programme or performance target is justified yet. Bound polling batches, retries and shared-project quota consumption; show that an unavailable Google service does not starve Meta. No cost or delivery estimate is supported. Additional GBP AI generation has incremental usage cost and should remain disabled for brands not using GBP.

| Area | Coverage result |
|---|---|
| Product and scope | Reviewed; existing/manual event and correction decisions remain |
| Data, lifecycle, concurrency | Reviewed; identity, backfill, duplicate and amendment findings |
| Integrations and asynchronous work | Reviewed code, live schema and official API contracts; execution not tested |
| Security and privacy | Reviewed relevant trust boundaries; no penetration test or compliance certification |
| UX and accessibility | Contract gaps identified; no rendered implementation available to assess |
| AI and content | Reviewed relevant policy and validation needs; no generated-output evaluation performed |
| Reliability, quota and cost | Proportionate retry/polling requirements identified; no traffic/cost measurements available |
| Measurement and operations | Reviewed status/alert contracts and manual checklist impact |
| Release and rollback | Reviewed phased plan, live schema dependence and irreversible external effects |
| Paid Meta ads, reviews, GBP metrics | No direct change needed; preserve explicit exclusions |
| Public SEO, URL migrations and consent banners | No new website page or redirect proposed; not applicable beyond destination/link verification |
| Payments, currency and rounding | No payment processing change; booking URL accuracy is in scope |
| Google approval, actual quota/client, live eligibility, deployed binary | Not verified; prerequisite and release evidence still needed |

## Readiness and next steps

The draft is **Not ready for the affected implementation** because its data, duplicate, partial-failure and state contracts remain incomplete. Read-only discovery, Phase 0 evidence collection and specification corrections can proceed. D1 prevents coding until Google approval is evidenced.

Resolve GBP-01 through GBP-10 at their stated gates, record D-A through D-C, and attach the concrete touchpoint inventory. Then sequence the existing PRs around the corrected contracts: data identity before connection/publishing, actual worker integration before creation UI, moderation and operational recovery before enabling the brand.

Before release, prove the real schema/runtime combination, connection and refresh, exact wizard-to-worker path, partial-platform failure, duplicate recovery, moderation and switch-off. An explicitly authorised real EVENT must reach LIVE with correct timing/media/link; verify STANDARD separately. Capture deployed app and edge versions. No implementation or production-readiness claim follows from this review alone.

**Done** - Separate review report, local only. Original specification and implementation unchanged. No migration created or applied.
**Next:** Resolve the recorded specification conditions and product decisions before implementation.
