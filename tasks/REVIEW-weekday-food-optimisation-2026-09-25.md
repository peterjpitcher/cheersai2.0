# Developer review: weekday food optimisation

Reviewed 25 September 2026. Review only. No implementation, campaign changes, bookings, migrations or deployments were performed.

## Executive assessment

**Ready with specified conditions.** The landing-page direction is proportionate and addresses the stated friction. Implementing the entire draft literally would not reliably deliver its measurement or campaign-operation promises. C2 is **not ready for the affected implementation** until restart/reconciliation behaviour and external API checks are defined. W5 needs its contradictory consent requirement corrected before implementation. Other independent website work can proceed once the review is accepted.

The most consequential findings are:

1. Looking up a challenger by name does not make a multi-system creation operation idempotent. A timeout or interrupted run can leave an orphan Meta ad, a stranded draft or duplicate challengers.
2. W5 simultaneously preserves the current CheersAI forwarder and says it sends nothing without consent. The current code forwards confirmed booking facts without marketing consent, while withholding Meta identifiers.
3. The proposed page-source booking rate has no comparable pre-change baseline. Unmeasured attribution must not be reported as zero bookings.
4. “No review feedback” and an empty enhancement response are not sufficient proof that a new ad meets the launch requirements.
5. Literal M1 validation rejects wrong-type tags despite promising that optional measurement cannot reject a booking.

There is no substantiated P0. The P1 findings block their stated gates, not unrelated development. Production readiness is **not established**: neither the proposed implementation nor the full customer journey has been run.

## Outcome, scope and evidence

The intended business outcome is more weekday food covers within the existing campaign budget, with a clearer mobile journey and better visibility of which ads produce bookings. The main users are mobile Facebook/Instagram visitors, walk-in guests and bookers. Front-of-house staff supply the walk-in evidence; Peter owns launch and commercial decisions; developers/operators own release, reconciliation and reporting.

The draft changes three repositories: page variants and booking navigation, optional booking-source metadata, and four additional ads. Budgets, schedules, audiences, originals, booking-form relocation and Meta consent policy remain excluded. Those exclusions are sensible delivery boundaries, but existing booking forwarding, special opening hours, shared CTAs, analytics and daily checks remain affected dependencies.

This is a draft review to support implementation commitment, not approval to spend or deploy. D1-D6 are treated as recorded product decisions, not permission for this review session to mutate live services.

### Materials actually reviewed

| Evidence | Version and extent |
|---|---|
| Supplied review brief and two specification attachments | Read as supplied; both dated 25 September. The formatted attachment identifies the repository specification as the source of record. |
| `tasks/SPEC-weekday-food-optimisation.md` | Current untracked local draft, sections 1-11. Requirement references below refer to this copy. |
| Workspace and project instructions | `/Users/peterpitcher/Cursor/CLAUDE.md`, project instructions for all three repositories. Paid-ads and Supabase skills used as review guidance. |
| CheersAI | HEAD `7e51422b6e76820906f3ba0bab0a25cfd7679a9c`; campaign runbook, readout queries, ads playbook, paid-ads runbook; creative creation, CTA normalisation, tracking-link contracts, link resolver, copy validation, performance sync and relevant migration definitions. |
| Website | HEAD `6731814f52fcf979016be645ac02dbbcc94ed39d`; landing page, menu/hours helpers, booking page/form, submission and forwarding, attribution carrier, booking CTA and sticky UI. Package declares Next `^14.2.13`; do not apply CheersAI's Next 16 assumptions to it. |
| Management app | HEAD `a8e968fe8bfd646831827948dde7960e0c9b5728`; booking schema, idempotency/replay, creation analytics, analytics helper, pending-deposit timeout and analytics schema definition. |
| Live read-only evidence | CheersAI campaign/ad counts and `ads` indexes; management `analytics_events` column schema. Public landing-page GET returned HTTP 200, with cod image reference, source booking URL, `noindex` and the developer-note text. No tracking link was opened. |
| Targeted execution | The proposed M1 Zod string/transform pattern was exercised with the installed validator: null, numeric and object values fail. No full build or feature suite was run for this document-only review. |
| External references | Official Next 14 route configuration and ICO identifier guidance. Meta documentation fetches failed; current enhancement API acceptance remains unverified. |

Code inspection establishes local behaviour, not deployment equivalence. Existing dirty/untracked files were left alone. No full production browser session, actual Meta read-back, campaign metrics re-calculation, privacy-notice audit or Mac automation inspection was performed. The draft's spend, prices, mobile share and walk-in observations remain author-supplied facts, not independently re-certified figures. No customer-identifying rows or secrets were needed for this review.

## Wider impact and dependency map

| Input and changed behaviour | Downstream dependency and consequence | Evidence / boundary |
|---|---|---|
| Campaign URL selects landing variant | Hero, dishes, live menu cache, regular hours, shared links | Current helpers inspected; special-date availability is a separate concern, R06. |
| Landing CTA carries URL tags into booking | Hero/footer button navigation and sticky link take different code paths | Existing carrier preserves fragments and works without consent; sticky integration needs proof, R10. |
| URL labels pass through website API to management API | Idempotent booking, customer-linked analytics, reporting | Schema and code inspected; preserve `brand_site`, payment/Christmas behaviour and booking success. |
| New first-party metadata | Existing CheersAI and Meta forwarding must remain isolated | Current forwarder inspected; draft contradicts it, R02. |
| One challenger per campaign | Short-link service, snapshot, local ad row, image upload, Meta creative/ad | Separate writes with no common transaction; R01 and R03. |
| Ads become active | Existing lifetime budget, review, daily sync, operator pause and monitoring | Local sync traverses ads by stored Meta IDs. It cannot discover an orphan whose ID was never saved. |
| Bookings and staff walk-in logs | Readout, covers, cash-up comparison and £1-per-extra-cover judgement | Historical attribution unavailable; zero service versus unlogged service needs distinction. |

Existing originals and the paused rewrite must retain their IDs, settings and history. Historical bookings gain no inferred tags. Existing forms/tabs can submit without the new fields. Scheduled future bookings remain eligible only under the explicitly chosen reporting rules. Shared WeekHours note removal is intentionally site-wide; existing auth, capacity, Turnstile, deposits, confirmation messages and cancellations must remain unchanged.

## Findings, ordered by priority

### R01. P1: C2 has no sufficient restart and reconciliation contract

**Type/domain:** confirmed specification omission; integration reliability and operations. **Disposition:** required correction before C2 implementation. **Owner:** campaign developer/operator.

C2 calls name lookup “idempotent”, then creates a short link, updates a snapshot, inserts a draft, uploads an image, creates a creative, creates a Meta ad and saves its ID. A failure between any two steps is not defined. Live `ads` indexes contain only the primary-key uniqueness constraint and a non-unique UTM index. Names cannot prevent concurrent runs from passing the same lookup.

For example, Meta creates an ad but the response or following database update fails. A retry can create another; simply skipping an existing DRAFT row instead leaves the run permanently incomplete. A regenerated unique key can also abandon the already-created short link. This matters because activation spends real money and daily sync needs the stored Meta ID (`src/lib/campaigns/performance-sync.ts:51`, `:108`).

**Smallest adequate correction:** one documented runner, an enforced single-run lock using an existing supported mechanism, stable per-campaign challenger identity, and a checkpoint/reconciliation table in the operation's output or existing records. Persist and reuse the chosen UTM key. Recover a known object by its ID; after an ambiguous external response, stop and reconcile remote objects before creating another. Merge the new variant into the latest snapshot without overwriting existing entries. Refuse ambiguous multiple matches. No new generic job framework is necessary.

**Acceptance:** inject failure after every external success and before each local save; retry produces exactly one intended challenger per campaign. A second invocation is rejected while the first runs. An interrupted activation is reconciled from Meta state. `--pause` can pause every identified challenger even if the campaign is no longer ACTIVE, and reports any remote/local mismatch. Original objects and snapshot variants remain unchanged.

### R02. P1: W5 gives incompatible instructions about consent and CheersAI

**Type/domain:** confirmed contradiction against inspected implementation; privacy boundary and compatibility. **Disposition:** required correction before W5 implementation. **Owner:** paired-system developer; Peter only if existing policy is to change.

W5 requires the existing forwarder to stay unchanged and also says a booking without consent sends nothing to CheersAI. Website `app/api/table-bookings/route.ts:464-514` forwards confirmed booking facts, sets `metaConsentGranted` false when appropriate, and gates identifiers separately. `lib/booking-conversion-forwarding.ts:54-81` sends when configured. The campaign runbook/readout also describe non-consented conversions in CheersAI.

Following the “nothing” sentence would change an explicitly excluded integration and reduce reporting. Following “unchanged” fails its stated acceptance expectation.

**Proposed wording:** “Preserve the existing confirmed-booking forward to CheersAI, including its current consent flags. New `page_source` fields are management-app-only and must never populate that forwarder's attribution or Meta payload. Preserve existing Meta consent enforcement.”

**Acceptance:** compare consent absent, declined, accepted and withdrawn cases before/after using mocked outbound calls. New labels reach management in each case but do not leak into CheersAI attribution. Existing aggregate forwarding and consented CAPI behaviour stay unchanged. A policy change, if desired, needs its own explicit scope decision.

### R03. P1: creative and activation checks need a complete external contract

**Type/domain:** confirmed omissions plus unverified API compatibility risk; external integration and spend. **Disposition:** required investigation/correction before C1 is finalised and C2 activation. **Owner:** Meta integration developer/operator.

C1 sends only `standard_enhancements: OPT_OUT`, but C2 promises every creative enhancement is off. Whether that bundle is accepted and sufficient on the configured Meta version has not been established. The new reader returns creative fields only, yet the script also needs ad review feedback and status. A pending review can have no rejection feedback. An absent/empty feature object can accidentally pass an “every entry is OPT_OUT” test.

There is also a concrete comparison mismatch: the app maps `BOOK_NOW` to `BOOK_TRAVEL` (`src/lib/meta/marketing.ts:356-359`, `:571`), so literal raw equality to the draft's CTA would reject an otherwise expected response.

**Correction:** establish the supported opt-out fields on the configured API version before fixing the request fixture. Read both the ad and its creative, including configured/effective status and review feedback. Explicitly classify missing enhancement data as unverified; normalise the known CTA representation and compare both destination links. Carry forward the existing runbook's account, schedule, placement-preview and approval checks instead of replacing them with the shorter C2 list. Re-read remote state after activation and pause. Waiting/review states need a visible pending result and bounded operator follow-up, not a false pass.

**Acceptance:** fixtures cover missing, empty, OPT_IN and unknown feature states; CTA normalisation; mismatched link; pending/rejected review; expired token; activation success with failed local save. A paused real creative must pass the documented read-back on the configured API before activation. This review does not claim the proposed Meta request has already failed.

### R04. P1: the new booking metric cannot support the proposed before/after comparison

**Type/domain:** confirmed measurement contradiction; product success and reporting. **Disposition:** required correction before readout implementation and interpretation. **Owner:** readout author/Peter.

Section 10 compares query 5e before and after adding the very fields it filters on. Existing management creation metadata only records party size, purpose, status and table name (`src/app/api/table-bookings/route.ts:762-773`). A historical result of zero under the new filter is missing measurement, not zero landing-page bookings.

**Correction:** start page-source conversion reporting at the verified deployment timestamp. Label the earlier value unavailable. Retain existing overall bookings, walk-ins and food takings as contextual measures. Compare challengers and originals over the same post-activation period, not challenger-to-date versus originals since 11 September. Keep the accepted directional interpretation: website changes and Meta's unequal allocation prevent a causal copy-test claim.

**Acceptance:** a report with no historical tags displays “not measured”, not 0% or infinite improvement; QA visits/bookings are excluded; numerator and denominator dates are stated in London time; zero clicks produces an unavailable rate. Do not add first-party and CheersAI/Meta booking totals together.

### R05. P1: M1's proposed validator can reject a valid booking for bad tags

**Type/domain:** confirmed requirement/implementation-pattern contradiction, directly exercised; API reliability. **Disposition:** required correction before M1 implementation. **Owner:** management API developer.

`z.string().trim()` rejects nulls, numbers, arrays and objects before a truncating transform executes. The route returns 400 for schema failures (`src/app/api/table-bookings/route.ts:352-359`). Thus “odd values must never fail validation” is not met by the prescribed implementation. Website sanitisation reduces exposure but does not satisfy the receiving API contract.

**Correction:** preprocess each optional label: retain only strings, trim/truncate them, map empty or wrong-type values to undefined. Apply equivalent leniency to the website wrapper. Do not loosen validation of actual booking details.

**Acceptance:** malformed wrapper, null/numeric/object/array fields, excessive length and blank values do not reject otherwise valid bookings. Same idempotency key plus different tags returns the original booking and retains its original attribution. Existing replay already returns early (`:444-450`); document this first-success behaviour.

### R06. P2: current-service wording can disagree with date-specific availability

**Type/domain:** verified helper limitation applied to a proposed claim; content and customer journey. **Disposition:** required correction before website release. **Owner:** website developer/content owner.

W3 uses regular weekday windows for “just come in”; W2 says “Dinner tonight”. `lib/lunch-and-dinner.ts:178-187` calls the shared regular-window helper; `lib/hours-utils.ts:340-375` does not resolve special-date closures for that claim. Tagged URLs can be revisited or shared on Sunday or after service. Ad delivery hours do not constrain those visits. The missing-hours fallback also drops “Tuesday to Friday”.

The daily ad check already covers special hours, so a new monitoring system is unnecessary. It cannot prevent an old URL from making an immediate promise during a closure.

**Correction:** prefer regular-service wording such as “Dinner, Tuesday to Friday”, retaining the weekday qualifier even when times are unavailable. If “tonight” or a current availability promise remains, use the existing date-aware hours resolution and closure message. D5 remains the recorded seating policy; do not silently add a different capacity policy.

**Acceptance:** test Sunday, after dinner, a special kitchen closure, one missing service window and unavailable hours. Regular information stays clearly regular; no immediate availability claim overrides a closure. Use London dates, including boundary fixtures.

### R07. P2: W7's network check cannot happen before submission

**Type/domain:** confirmed unexecutable acceptance step; testing and customer side effects. **Disposition:** required correction before browser verification. **Owner:** QA/developer.

The form builds the body during submit (`ManagementTableBookingForm.tsx:2018`) and sends at `:2054`. There is no booking request body to inspect while stopping before submit. An improvised real submit can create a booking and send a confirmation SMS; cancelling it cannot undo the message.

**Correction:** install a browser interception for the booking POST, then submit and capture/fulfil it locally without forwarding it. Keep the separately authorised real-booking validation in section 6. Retain the runbook's fresh-browser and analytics-blocking precautions; `utm_source=qa` alone does not block third-party analytics.

**Acceptance:** captured body has expected page source; an assertion proves zero upstream booking requests. Actual production booking confirmation remains a separate organic/explicitly authorised observation. An available-slots response alone is not proof of successful booking.

### R08. P2: source labels are customer-linked data, not anonymous campaign totals

**Type/domain:** confirmed data-description error; privacy, retention and untrusted input. **Disposition:** required clarification before release. **Owner:** data owner and management developer.

M1 calls the fields “not personal data”. The insert attaches `customer_id` and `table_booking_id` (`src/lib/analytics/events.ts:20-26`), and live schema confirms both fields. Arbitrary URL text can also contain a name/email even if intended for campaign labels. Absence of browser storage does not make the resulting customer-linked record anonymous. The ICO explains that identifiability depends on context and combinations of data: [identifier guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/personal-information-what-is-it/what-is-personal-data/what-are-identifiers-and-related-factors/).

**Correction:** describe customer-linked first-party attribution accurately. Identify the existing notice, access and retention/deletion treatment that covers it; verify rather than presume a new policy is needed. Treat tags as untrusted reporting hints, never permissions or authoritative proof of ad exposure. For this campaign, prefer recognised campaign/code values in the readout and do not log rejected raw inputs.

**Acceptance:** only the six allowed fields persist, with bounded strings; `fbclid`, `gclid` and arbitrary extra fields do not enter this path. Existing analytics access/deletion behaviour is documented and checked. This is not a finding of unlawful processing or a demand for a new consent banner.

### R09. P2: query 5e and walk-in denominators need precise eligibility

**Type/domain:** confirmed reporting omission; lifecycle and operational measurement. **Disposition:** required definition before the first new readout. **Owner:** readout author/front-of-house owner.

Creation analytics can exist for pending-payment bookings (`src/app/api/table-bookings/route.ts:781-800`). Excluding only cancelled/no-show therefore counts an unpaid hold as a success. The timeout cron can later cancel it (`src/app/api/cron/table-booking-deposit-timeout/route.ts:73-79`). “By week” also needs to distinguish booking creation from dining date. The existing runbook already chooses creation date for attributed bookings and service date for covers.

“Per logged day” is not computable reliably from positive walk-in rows alone. A service with zero walk-ins and a service nobody logged look identical.

**Correction:** count distinct booking IDs, join using `analytics_events.table_booking_id`, define confirmed/attended eligibility and report pending separately. Separate all landing-page bookings from Tue-Fri food-service bookings/covers. Use current status at the stated readout time; mark historical revisions. Keep first-party and consented attribution separate. Add a simple lunch/dinner logging-complete tick, including zero-cover services, to the existing tally process.

**Acceptance:** fixtures include duplicate events, payment pending/expired, cancelled, amended dining date, weekend/drinks booking, zero-cover completed logging and absent logging. Reconcile sampled totals against existing booking reports. Show counts beside rates and missing-day coverage beside walk-in averages.

### R10. P2: navigation requirements reference the wrong UI contract

**Type/domain:** verified implementation mismatch and integration gap; UX/accessibility. **Disposition:** required test adjustment before W4 merge. **Owner:** website developer.

The booking anchor already exists (`app/book-table/page.tsx:194`). `BookTableButton` renders a button and navigates in its click handler (`components/BookTableButton.tsx:104-119`), so an href assertion on it is not sufficient. Sticky CTAs use a plain `action.href` (`components/layout/StickyCtas.tsx:194`); updating the pathname resolver alone does not invoke the attribution carrier.

**Correction:** reuse the existing anchor, add the offset, and test actual navigation for hero, footer and sticky actions. Confirm the anchor in each applicable booking layout. Preserve query/fragment handling using the existing carrier (`lib/booking-attribution.ts:148-174`). Clarify that the measured source covers these paths, not every visitor who leaves via directions/menu and later books elsewhere.

**Acceptance:** each click lands at the form with current tags and fragment, without storage, including declined consent. Back/refresh does not alter booking values. Keyboard activation and focus make the destination usable; the sticky header/bar does not cover the form or consent controls at the specified phone size and enlarged text. Other paths retain current behaviour. Check one real Facebook/Instagram in-app browser when available; desktop Chromium alone does not represent the claimed 97% audience.

### R11. P2: short-link and ad-count checks need precise response selection

**Type/domain:** confirmed contract ambiguity and arithmetic error; integration and release evidence. **Disposition:** required correction before C2/C4 tests. **Owner:** campaign developer.

`createManagementMetaAdsLink` returns parent link fields plus a `variants` array (`src/lib/management-app/client.ts:192-208`, `:706-725`). C2's “response has a new shortCode” can select the parent instead of the requested child. On retry, an existing child is success, not a failure to return a new code.

C4's “16 rows (12 originals, the paused rewrite and 4 challengers)” totals 17. Live read-only data showed Lunch A has four rows, three ACTIVE; each other campaign has three, all ACTIVE. All four campaigns were locally ACTIVE and `controlled_test=true`. These are database statuses, not fresh Meta approval evidence.

**Correction:** choose exactly one returned variant by its persisted `utmContent`; validate parent relationship, trusted host, final path, campaign and content parameters; accept `alreadyExists`. Preserve all existing variants. Assert 17 total rows and the exact four challenger IDs, with 16 intended active originals/challengers and the rewrite still paused, subject to fresh remote verification.

**Acceptance:** shuffled/missing/multiple variants and parent-only responses fail safely; rerun reuses the same code; originals' codes and paused rewrite remain unchanged. Counts supplement identity checks rather than replace them.

### R12. P2: rollback and same-day sequencing overstate what can be restored

**Type/domain:** confirmed delivery/operational omissions; recovery. **Disposition:** required runbook clarification before live apply. **Owner:** operator/Peter.

Pausing challengers stops their delivery; it cannot restore spent money, previous allocation/learning, impressions or sent booking messages. A database save can fail after Meta accepts a pause. Reverting the website while challengers remain live also restores the mismatched landing page. Section 6's real tagged-booking prerequisite can delay section 7 indefinitely if no organic booking arrives, despite the same-day intent. Existing emergency-pause authority must remain intact.

**Correction:** preserve a manifest of local/remote IDs, stages and checks. Verify remote pause before reporting success, and reconcile local state separately. If reverting the landing page, assess and pause only affected challengers under the relevant authority. Keep links/history for reporting. Treat the organic-booking gate as a real release condition: no automatic test booking or bypass. Where an approved staff test is used, record and exclude it from metrics and acknowledge any confirmation message.

**Acceptance:** exercise partial activation/pause failure with mocks; output identifies remaining active IDs and the responder. Daily checks/readouts are updated and their next scheduled run verified before relying on them. Reverting M1 stops new metadata but does not erase existing records. No migration is proposed or applied.

## Additional acceptance and coverage

The draft already includes useful pure-function tests, copy checks, price omission behaviour, explicit account scoping, preserved `brand_site`, hash exclusions and Christmas payload stripping. Keep these. Add the following targeted checks rather than a broad new test platform:

| Area | Required verification |
|---|---|
| Analytics failure | Inject the actual Supabase insert error as well as a throwing helper. `src/lib/analytics/events.ts:29-39` catches its own insert errors, so the draft's throwing mock tests only the outer wrapper. Booking succeeds; warning is observable without raw tags or PII. Lost measurement remains a documented limitation, not a mandatory repair queue. |
| Privileged operation | All reads/writes remain account-scoped; assert campaign/ad-set/Meta account/Page identity. Missing/expired credentials, unsupported campaign kind, expired flight or unexpected object count stop before mutations. Pause is not blocked by creation-only prerequisites. |
| Dry run | Assert no short-link POST, image upload, database mutation, creative/ad creation or status call. Output redacts tokens and connection secrets. |
| Page variants | Repeated query parameters, unknown/mixed-case values, missing section, missing/invalid prices, unavailable menu and no duplicate promoted dish cards. Default layout remains defined. |
| Cache assumptions | W2 cites a 300-second fetch, but `getBusinessHoursSnapshot` defaults to 3,600 seconds (`lib/api/client.ts:1539`). State actual menu/hours freshness. Verify built-server fetch behaviour on the website's installed Next 14 version; do not infer it from Next 15/16 defaults. No new infrastructure is warranted at the stated traffic. [Next 14 configuration](https://nextjs.org/docs/14/app/api-reference/file-conventions/route-segment-config). |
| Shared regressions | W1 allowed routes still show the seasonal lightbox; W6 note removal changes only that note on all consumers; default landing metadata/noindex/canonical and sitemap exclusion persist. Other booking routes, deposits, Christmas, errors and confirmation messages retain behaviour. |
| Final evidence | Run each repository's required checks, paired API contract tests and the intercepted customer path; record deployment IDs and production observations. A build and HTTP 200 alone do not establish feature correctness. |

## Decision and investigation register

These are outstanding matters for the delivery gate, not a request to stop this completed review. Proposed wording above is not an owner-approved change.

| ID | Resolution needed | Recommended handling | Owner / timing |
|---|---|---|---|
| R02 | Conflict between “unchanged forwarding” and “nothing to CheersAI” | Preserve existing forwarding; isolate new metadata. A change to existing consent policy requires Peter's decision. | Developer before W5; Peter only for policy change |
| R03 | Supported creative opt-out and meaningful remote approval states | Verify the configured API and a paused creative; do not assume bundle coverage. | Meta developer before activation |
| R04/R09 | Comparable success measures and eligibility | Post-release source rate; historical context separately; pending bookings separate; same-period ad comparison. | Readout author/Peter before first report |
| R06 | Immediate versus regular availability copy | Use regular weekday wording to avoid additional live-state complexity. | Content owner before release |
| R08 | Existing treatment of customer-linked campaign labels | Confirm notice/access/retention mapping, with no unsupported anonymity claim. | Data owner before release |
| R12 | Timing of the real-booking release gate | Retain the specified organic wait; a staff booking remains conditional on explicit owner approval. | Operator/Peter before live activation |

## Simplification and optional improvements

Reuse the existing booking anchor and attribution carrier. Keep the form on its current page. Keep analytics non-blocking. A narrowly scoped, recoverable script is adequate for four ads; a new campaign wizard, generic workflow engine, attribution database or queue is unnecessary. No migration is justified by the reviewed requirements.

**R13, P3 optional:** group the four challengers by their stable IDs and activation timestamp in the report output, avoiding repeated manual editing of lists where feasible. The current explicit query/runbook updates are acceptable if cross-checked. Owner: readout developer, after essential corrections. Verify that the group contains exactly four IDs and excludes the paused rewrite.

## Coverage summary and readiness

| Area | Assessment |
|---|---|
| Product/scope/value | Sound limited intervention; success interpretation needs R04/R09. No requirement for a new experiment platform. |
| UX/content/accessibility | Main mobile friction addressed; R06/R10 and browser verification remain. No visual/accessibility pass was claimed. |
| Data/lifecycle/reporting | M1 storage approach is compatible; malformed labels, customer linkage, pending bookings and historical gaps require corrections. |
| Security/privacy | No verified exploit identified. Fixed variant allow-list and server-side credentials are appropriate. Preserve tenancy and consent boundaries; R08 is a data-treatment clarification. |
| Integrations/reliability | Principal risk is C2 partial success and incomplete read-back. Remote Meta compatibility remains unverified. |
| Performance/cost | No evidence for an enterprise-scale solution. Preserve caching and budget invariants; no latency/load benchmark was run. |
| Operations/release | Existing runbooks cover monitoring, prices, emergency pause and ownership. Recovery and release evidence need R12; actual Mac tasks were not inspected. |
| SEO/discovery | No intended indexable route or metadata change; regression check suffices. Shared/tagged links remain relevant to availability wording. |
| Payments/messages | No payment logic change proposed. Existing pending states and irreversible confirmation messages still affect reporting and testing. |
| AI/licensing/portability | Fixed approved copy uses no new model pipeline. Automated Meta creative changes are covered by R03. No new licence or supplier migration is proposed. |

Final challenge: even a competent literal implementation could duplicate an ad after a lost response, omit or alter existing CheersAI reporting, call an unmeasured baseline zero, count an unpaid hold, or show “tonight” after service. These are the reasons for the conditions above. The review does not reopen the accepted budget, original-ad retention or directional-test decisions.

**Specification readiness:** Ready with specified conditions overall; C2 and the contradictory W5 contract need correction before their affected implementation. W1, W6 and independent landing presentation work can proceed through normal review and tests. **Production readiness:** insufficient evidence to assess an unbuilt change. Resolve the affected conditions, implement, run the specified paths and preserve the existing explicit live-action gates.

**Done** - Separate developer review delivered, local only. Original specification and implementation files unchanged; no migration applied.
**Next:** Specification author resolves the listed conditions before the affected implementation and release gates.
