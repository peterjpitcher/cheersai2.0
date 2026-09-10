# Independent technical and delivery review: weekday food campaign

**Reviewed:** 10 September 2026  
**Documents:** independent review brief and approval test plan supplied by the owner  
**Scope:** campaign design, delivery, creative, landing and booking journey, attribution, compliance, operations, monitoring and reporting  
**Source documents changed:** none

## Executive assessment

**Readiness: not ready to start spending.** The build is substantially complete and many practical checks are strong, but five matters should be closed before first delivery:

1. The site writes paid-ad attribution to local storage and a cookie before marketing consent.
2. The documents promise a clear message and photo winner, but the setup is not a controlled split test and cannot support that strength of conclusion.
3. The pizza and pie imagery needs a recorded compliance decision. The pizza does not represent a menu item and the pie includes an unlisted element.
4. Facebook opening hours are known to be wrong, and Google Business Profile hours remain unverified.
5. The account spending limit exactly equals the planned media budget, leaving no tolerance for other spend or account-level adjustments.

The safest simplified launch is to correct those blockers, describe the campaign as an exploratory creative test, use one canonical result key per ad, and predefine the reporting calculations and operational stop rules. No database migration is required by this review. Any implementation change to consent or attribution needs its own website specification and tests.

## Priority and type key

- **P0:** must be resolved before delivery because it creates a legal, privacy or fundamental validity risk.
- **P1:** should be resolved before delivery because it can materially damage spend, customer trust or the usefulness of the result.
- **P2:** should be resolved before the first readout.
- **P3:** optional improvement for a later round.
- **Confirmed issue:** directly evidenced by the supplied documents, current code or live page.
- **Optional improvement:** the current approach can run without it, but the change would improve reliability or efficiency.

## Findings

### F01. Paid-ad attribution is stored before consent

- **Relevant section:** Tracking and how we'll judge it; PLAN workstream B
- **Priority:** P0
- **Type:** Confirmed issue, privacy and technical
- **Description:** The approval material says the site's own attribution storage is written before consent and parks the review until after launch. Current website code confirms a 90-day `anchor-booking-attribution` record is written to both local storage and a cookie without checking marketing consent. The stored values include UTM fields, click IDs and the short code.
- **Rationale:** Current ICO guidance says consent is required for measuring whether a person clicked an advert and for linking a visitor ID to a conversion shared with an advertising partner. The consent check around Meta browser identifiers does not prevent the separate attribution store being created.
- **Impact:** Regulatory and trust risk. The consent implementation and the brief's claim that marketing tracking waits for consent do not describe the whole system accurately.
- **Recommended action:** Do not park this. Classify the storage with the privacy owner, gate paid-ad attribution storage on marketing consent, clear it on withdrawal, and add tests for reject, accept-on-page, returning consent, withdrawal and expiry. Keep aggregate short-link counts that do not require device storage separate from visitor-level booking attribution.
- **Acceptance evidence:** A fresh browser that rejects marketing creates no advertising-attribution cookie or local-storage entry; accepting enables it; withdrawing removes it; a booking without consent sends no Meta identifiers or advertising attribution.
- **Open questions:** Held for the owner handoff, in line with the project's rule that questions do not live in files.

Evidence: `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/lib/booking-attribution.ts`, lines 3 to 6, 78 to 107 and 261 to 272. External basis: [ICO storage and access guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/).

### F02. The stated learning claim is stronger than the design supports

- **Relevant section:** What this test will tell us; How the test works; Known limits and risks
- **Priority:** P0
- **Type:** Confirmed issue, test design
- **Description:** The documents say the test will identify which message and photo works. They also acknowledge that it is not a randomised split test, the four campaigns compete for the same audience, and Meta reallocates delivery towards early leaders.
- **Rationale:** Campaign-level photo comparisons are affected by separate auctions, delivery timing and audience composition. Message comparisons within each campaign are affected by Meta's optimisation. Equal budgets do not create equal exposure or comparable groups.
- **Impact:** A reported winner may reflect delivery bias rather than creative quality. Round two could move budget towards the wrong message or image.
- **Recommended action:** Change the intended conclusion to an exploratory directional result, or rebuild using Meta's controlled A/B test with one variable at a time. If the current setup stays, report results with exposure, reach, frequency, placement, age and platform breakdowns and do not call any result causal or proven.
- **Suggested wording:** Replace “a clear answer on which message and which photo work” with “directional evidence on which messages and photos merit a controlled follow-up test”.
- **Open questions:** Held for the owner handoff.

Meta itself describes A/B testing as the route for measuring creative impact: [Meta Reels ads guidance](https://www.facebook.com/business/ads/facebook-instagram-reels-ads).

### F03. The audience conflicts with the owner's exclusion of travellers

- **Relevant section:** Owner's decisions; Settings as live on Meta
- **Priority:** P1
- **Type:** Confirmed issue, requirements contradiction
- **Description:** The owner chose people who live or work within five miles, “not travellers”. The live audience includes people who were recently in or are often in the radius. Around Heathrow, “recently in” can include travellers and cannot be treated as a proxy for local workers.
- **Rationale:** The implementation does not enforce the stated audience boundary.
- **Impact:** Budget can be spent on people unlikely to return, and results may not generalise to the intended local market.
- **Recommended action:** Either narrow the audience to a location option that supports residents where Meta permits it, or record that travellers cannot be excluded and amend the objective and analysis accordingly. Do not state that the setup targets workers but not travellers unless verified by Meta's actual audience controls.
- **Open questions:** Held for the owner handoff.

### F04. The account cap leaves no spend tolerance

- **Relevant section:** Settings as live on Meta; Known limits and risks
- **Priority:** P1
- **Type:** Confirmed issue, delivery
- **Description:** The £500 account spending limit equals the sum of the four campaign budgets.
- **Rationale:** Any other account spend, adjustment or resumed campaign can stop all delivery before this test completes.
- **Impact:** Uneven truncation would invalidate comparisons and could miss service days without immediate notice.
- **Recommended action:** Raise the account limit above the approved media budget while retaining the four campaign caps, or reduce campaign budgets to leave a documented reserve. Add a daily check of remaining account limit and unexpected active campaigns.
- **Open questions:** Held for the owner handoff.

### F05. Public opening hours contradict the ads

- **Relevant section:** Known limits and risks; Landing page and booking path
- **Priority:** P1
- **Type:** Confirmed issue, customer journey and dependency
- **Description:** The Facebook Page is known to show old hours and Google Business Profile is unverified. An advert viewer can move from the ad to the Page or search listing rather than the landing page.
- **Rationale:** Correct landing-page hours do not remove conflicting information in adjacent customer journeys.
- **Impact:** Customers may believe lunch is unavailable, abandon a visit or arrive at the wrong time. It weakens the campaign precisely where awareness is the goal.
- **Recommended action:** Make corrected Facebook hours and verified Google Business Profile hours launch gates. Capture dated screenshots or API read-backs as evidence.
- **Open questions:** None for the developer. Platform access is an owner dependency.

### F06. The food images carry unresolved misleading-imagery risk

- **Relevant section:** The images; Known limits and risks
- **Priority:** P0
- **Type:** Confirmed issue, compliance and creative
- **Description:** The pizza image shows toppings on no available pizza. The pie adds crispy onions not listed on the menu. Naming a category rather than a specific pizza does not by itself remove the overall impression that the pictured food can be bought.
- **Rationale:** ASA guidance says imagery can mislead where it shows the wrong product, extras or an exaggerated representation. Separate 2026 less-healthy-food rules also apply to paid online food advertising, although a food or drink SME exemption may apply if the paying business qualifies.
- **Impact:** Complaint, takedown, wasted creative spend and customer disappointment. The unknown SME status means the less-healthy-food analysis is incomplete.
- **Recommended action:** Prefer accurate photographs or generated images matching an actual served product. At minimum, remove unlisted toppings and extras. Record who pays for the advert, whether the business qualifies for the SME exemption including its Greene King tenancy position, and the nutrient-profile or exemption basis relied on.
- **Open questions:** Held for the owner handoff.

Sources: [ASA guidance on misleading imagery](https://www.asa.org.uk/news/a-picture-says-a-thousand-words-avoiding-misleading-imagery-in-ads.html), [CAP less-healthy-food rules](https://www.asa.org.uk/news/new-rules-and-guidance-for-less-healthy-food-and-drink-advertising.html), and [CAP Code food SME exemption text](https://www.asa.org.uk/static/0f018b1a-ae1f-44e4-ba06708a5248b1bd/70ce10d5-745b-4116-965b8416d5ed8350/The-CAP-Code-Food-food-supplements-and-associated-health-or-nutrition-claims.pdf).

### F07. One square asset is not a complete automatic-placement specification

- **Relevant section:** Placements; Creative; Checks already done
- **Priority:** P1
- **Type:** Confirmed issue, accessibility and delivery
- **Description:** All ads use a 1:1 image while placements are automatic. The checks mention approximate previews but do not require per-placement review for feeds, Stories and Reels, crop safety, text legibility, alt treatment or the landing page after an in-app browser transition.
- **Rationale:** Automatic placements can render the same asset in materially different frames. Small price and service labels are especially vulnerable to cropping or unreadable sizing.
- **Impact:** Some placements may lose the price, hours, logo or food focus, creating a different test stimulus and poor accessibility.
- **Recommended action:** Capture and approve previews for every enabled placement and both platforms. Exclude placements that crop or make the label unreadable, or supply placement-specific 4:5 and 9:16 variants while holding content constant. Define a mobile legibility threshold and safe-zone check.
- **Open questions:** None.

### F08. The alcohol reference needs a recorded targeting and copy check

- **Relevant section:** Dinner message 2; What we'd like you to review
- **Priority:** P1
- **Type:** Confirmed issue, compliance
- **Description:** “With a pint” brings the advert within the CAP alcohol rules even though food is the main subject. The brief notes this but contains no completed compliance assessment.
- **Rationale:** CAP Section 18 applies to marketing communications that feature or refer to alcohol. The copy appears moderate, but audience composition and all creative context still need checking.
- **Impact:** Avoidable policy review or complaint risk, and potential restrictions on delivery.
- **Recommended action:** Record a Section 18 check covering age targeting, likely adult audience composition, responsible portrayal and the absence of youth appeal. The simplest alternative is to remove “and a pint” so the food test does not introduce a separate regulated variable.
- **Open questions:** Held for the owner handoff.

Source: [CAP Code Section 18, Alcohol](https://www.asa.org.uk/type/non_broadcast/code_section/18.html).

### F09. The measurement systems and click definitions are conflated

- **Relevant section:** Tracking; What counts; request not to open tracking links
- **Priority:** P1
- **Type:** Confirmed issue, analytics
- **Description:** Meta link clicks, short-link redirects, GA landing-page visits and booked conversions are different events. The brief says opening a short link counts as an ad click “in the results”, which is not true of Meta's link-click metric. It may count in the internal short-link data only.
- **Rationale:** Each system filters bots, repeat clicks, redirects, consent and sessions differently.
- **Impact:** Reconciliation can be interpreted as data loss or campaign performance when it is normal metric variation. Test visits can contaminate internal data but not Meta link clicks.
- **Recommended action:** Define a metric dictionary with source, event boundary, bot treatment, deduplication, consent dependency, reporting delay and owner. Report the funnel separately: Meta impressions, Meta link clicks, short-link human redirects, GA landing sessions, booking starts, confirmed bookings, attended covers and food takings.
- **Suggested wording:** Replace “Every visit through one counts as an ad click in the results” with “Every visit through one adds a short-link redirect to our internal results and can contaminate that cross-check; it does not create a Meta-reported ad click.”
- **Open questions:** None.

### F10. Tracking identifiers are inconsistent and the link count is contradictory

- **Relevant section:** Tracking; Note on leftover labels; Checks already done
- **Priority:** P1
- **Type:** Confirmed issue, data contract
- **Description:** The campaign has 12 ads and says all 12 links were tested, but later says none of the 16 links expires. It also says one link exists per ad while some `utm_content` values are shared or carry unrelated AI angle labels.
- **Rationale:** Human interpretation by Var number is not a reliable join key for repeatable reporting.
- **Impact:** Ads can be double-counted, mislabelled or joined to the wrong creative. A developer cannot know whether 12 or 16 records are in scope.
- **Recommended action:** Create one immutable mapping table with app campaign ID, Meta campaign ID, ad set ID, Meta ad ID, short code, service, image variant, message variant and canonical UTM values. Make `utm_content` unique per ad or use Meta ad ID as the canonical result key. Explain any four additional links or correct 16 to 12.
- **Open questions:** None.

### F11. The attribution model is not specified

- **Relevant section:** Bookings; What counts
- **Priority:** P1
- **Type:** Confirmed issue, functional detail
- **Description:** The documents do not say whether reporting uses first touch, last touch or Meta's attribution window. Current website code stores first landing URL but reports the latest campaign UTMs for up to 90 days and carries click IDs forward across later campaign visits.
- **Rationale:** A customer can click two ads, return organically, use another channel, book on another device or book after the campaign ends. Those paths can produce different owners for the same booking.
- **Impact:** Counts will differ between the database, GA and Meta, and a “winning ad” can depend on an unstated attribution rule.
- **Recommended action:** Specify first-touch, last-touch and Meta-reported views as separate measures. Define the lookback window, same-device limitation, cross-campaign overwrite behaviour and treatment of bookings after 16 October. Freeze the rule before first delivery.
- **Open questions:** Held for the owner handoff.

### F12. Conversion API security and deduplication acceptance criteria are absent

- **Relevant section:** Bookings; Cookie consent
- **Priority:** P1
- **Type:** Confirmed issue, security and integration
- **Description:** The brief states that consenting bookings are sent to Meta but does not specify event IDs, browser/server deduplication, allowed customer fields, hashing, retry idempotency, consent withdrawal, retention or dead-letter monitoring.
- **Rationale:** A browser Pixel event and server event can count twice without a shared event ID. Retries can also duplicate conversion events. Customer data must be minimised and protected.
- **Impact:** Inflated results, personal-data leakage or silent loss of conversions.
- **Recommended action:** Add acceptance criteria for stable per-booking event IDs, Pixel and CAPI deduplication, allowlisted and hashed customer fields, consent proof, idempotent retry, provider error capture and an operational failure alert. Test duplicate delivery and consent denial.
- **Open questions:** None.

### F13. The baseline cannot support the stated business-effect conclusion

- **Relevant section:** Baseline; Business result; Why this campaign
- **Priority:** P1
- **Type:** Confirmed issue, measurement
- **Description:** Lunch is compared with only 1 to 11 September, immediately after launch. The baseline is provisional, spans fewer than two weeks and contains incomplete walk-in records. Dinner is also described as about 21 covers in the supplied brief but about 25 booked covers in the repository brief.
- **Rationale:** New-service awareness, weather, events, payday, seasonality and ordinary weekly noise are not controlled. The source values are not internally stable.
- **Impact:** A change cannot be confidently attributed to the ads, and the starting point may move after launch.
- **Recommended action:** Freeze a reconciled baseline before delivery. Show daily values and uncertainty, not only weekly averages. Treat lunch as a launch cohort with no valid pre-period and use tagged demand plus operational trend, not a causal uplift claim. Reconcile the 21 versus 25 dinner figure and define booked, walk-in and all-food covers once.
- **Open questions:** None.

### F14. Success and stop criteria are incomplete

- **Relevant section:** Goal; What counts; Expected volume
- **Priority:** P1
- **Type:** Confirmed issue, delivery and analytics
- **Description:** The goal is 20 extra covers per week, but there is no rule for success, failure or continuation that combines covers, cost and takings. No target exists for cost per incremental cover, booking conversion, revenue, contribution or minimum data quality.
- **Rationale:** CTR can improve while the business result worsens. A traffic objective optimises the top of the funnel, not profitable visits.
- **Impact:** The final decision can be made after seeing the data and favour whichever metric looks best.
- **Recommended action:** Before delivery, define primary, secondary and guardrail metrics. Suggested primary outcome: attended incremental covers with cost per attended cover. Secondary: qualified landing sessions and confirmed bookings. Guardrails: food takings, cancellations, no-shows, frequency, complaints and service capacity. State how the £500 cost is treated.
- **Open questions:** Held for the owner handoff.

### F15. The mid-test pause rule is arbitrary and operationally ambiguous

- **Relevant section:** Readouts; Mid-test rule
- **Priority:** P1
- **Type:** Confirmed issue, test design and delivery
- **Description:** “Below 70% of the best CTR once each has at least 4,000 impressions” does not define whether “each” means all three ads or only the candidate and current leader. It ignores uncertainty, multiple comparisons, placement mix and the effect of moving budget after a pause.
- **Rationale:** A 30% relative difference can still be random at low click volume, while a real difference can be hidden by unequal delivery.
- **Impact:** Premature pauses can lock in an early false leader and further reduce comparability.
- **Recommended action:** Use click counts and confidence intervals, require the same placement breakdown and a minimum observation window, and predefine what happens to freed budget. If statistical support is unavailable, do not pause for learning reasons; pause only for delivery, compliance or clearly poor business-quality traffic.
- **Open questions:** Held for the owner handoff.

### F16. Reach, frequency and creative fatigue are missing

- **Relevant section:** Expected volume; Audience; What counts
- **Priority:** P2
- **Type:** Confirmed issue, performance
- **Description:** The forecast is about 320,000 impressions inside a five-mile radius, but audience size, estimated reach and frequency are absent.
- **Rationale:** A local audience may see the twelve ads repeatedly. Frequency can raise annoyance, distort late-flight CTR and cause campaigns to compete for the same people.
- **Impact:** Wasted spend and a time trend mistaken for a creative difference.
- **Recommended action:** Record Meta's estimated audience before launch and report daily reach, frequency and overlap. Add a review threshold for excessive frequency or falling CTR, with any pause still requiring owner approval.
- **Open questions:** None.

### F17. Dynamic menu and hours changes have no flight-time control

- **Relevant section:** Claims and sources; Landing page and booking path; Rules during the test
- **Priority:** P1
- **Type:** Confirmed issue, integration and operations
- **Description:** The landing page reads live prices and hours, while the ads contain fixed prices and service times and should not be edited during the flight.
- **Rationale:** A menu price, dish availability, exceptional closure or hours version can change after 10 September. The landing page may update while the approved ads do not.
- **Impact:** Misleading ads, failed bookings or customers arriving for unavailable food.
- **Recommended action:** Add a daily automated claim-parity check for every advertised price, dish and service time. Alert on mismatch and pause affected ads under a pre-approved emergency rule. Define handling for sold-out items, menu API failure, exceptional closures and booking API failure.
- **Open questions:** Held for the owner handoff.

### F18. Delivery monitoring and incident ownership are not specified

- **Relevant section:** Checks already done; Readouts; Rules during the test
- **Priority:** P1
- **Type:** Confirmed issue, monitoring and delivery
- **Description:** Daily sync is mentioned, but no alert thresholds, named owner, response time or fallback are defined for zero spend, overspend, rejected ads, broken redirects, landing-page errors, booking failures, stale data or expired connections.
- **Rationale:** Weekly reviews are too slow for a short, day-parted local campaign.
- **Impact:** Several serving days can be lost before anyone notices.
- **Recommended action:** Define a daily health check before lunch delivery and an alert route. Monitor campaign and ad status, spend versus pace, account limit, short-link response, landing-page response and freshness, book-button path, booking availability and data-sync timestamp. State who may emergency-pause and who owns recovery.
- **Open questions:** Held for the owner handoff.

### F19. Walk-in measurement is not sufficiently controlled

- **Relevant section:** Walk-ins; Baseline
- **Priority:** P2
- **Type:** Confirmed issue, operational data quality
- **Description:** Staff use a paper tally, existing records are known to be incomplete, and a photo is sent weekly. There is no instruction for repeat guests, mixed answers, multiple tables, covers versus tables, missing shifts or transcription checks.
- **Rationale:** Manual collection changes with staff workload and can be influenced by knowledge of the campaign.
- **Impact:** The main offline outcome may be undercounted or inconsistently classified.
- **Recommended action:** Give staff one short script and a field definition sheet. Capture date, service, covers, one source category and unknown. Reconcile each day against till food covers, record missingness and keep “Facebook/Instagram ad” separate from the venue's own posts only when the guest can distinguish them.
- **Open questions:** None.

### F20. Booking outcome rules need an explicit data contract

- **Relevant section:** Business result; Bookings
- **Priority:** P2
- **Type:** Confirmed issue, functional detail and testing
- **Description:** Cancellations and no-shows are excluded, but the documents do not define cut-off time, booking amendments, party-size changes, duplicate bookings, deposits, walk-in conversions, bookings created by staff, or whether a booking during lunch hours counts as lunch by arrival time or kitchen sitting.
- **Rationale:** The result must be reproducible after operational changes to bookings.
- **Impact:** Weekly readouts may disagree or change retrospectively.
- **Recommended action:** Write and test one readout query with fixed inclusion rules, London time, service classification by booking date and sitting, final party size, cancellation/no-show status and attribution snapshot. Version the query and retain raw extracts for every readout.
- **Open questions:** None.

### F21. Landing-page noindex signals are inconsistent and non-functional QA is incomplete

- **Relevant section:** Landing page and booking path; Checks already done
- **Priority:** P2
- **Type:** Confirmed issue, technical and accessibility
- **Description:** The live page returns `<meta name="robots" content="noindex, follow">` but its HTTP `X-Robots-Tag` is `all`. The documents do not record keyboard, screen-reader, reduced-motion, contrast, Core Web Vitals, slow-network or failure-path checks.
- **Rationale:** Mixed crawler signals weaken the explicit noindex requirement, and a working phone tap does not establish accessibility or performance.
- **Impact:** Search-indexing uncertainty and avoidable loss of paid visitors on slower devices or assistive technology.
- **Recommended action:** Align the HTTP and HTML robots directives, verify absence from the sitemap, and add automated accessibility plus mobile performance checks. Manually test keyboard focus, labels, panel dismissal, reduced motion, 3G loading, menu API failure and booking API failure.
- **Open questions:** None.

Live evidence on 10 September 2026: `200`, `X-Robots-Tag: all`, meta robots `noindex, follow`.

### F22. The handoff documents contain stale and contradictory states

- **Relevant section:** Whole approval plan; repository PLAN status and checklist
- **Priority:** P1
- **Type:** Confirmed issue, delivery governance
- **Description:** The supplied approval plan says campaigns and the landing page will be built after approval. The independent brief says they are already published and approved. The repository plan has a “done” progress block followed by unchecked build steps, refers in places to six ads instead of twelve, gives conflicting final-review dates, and contains an obsolete build budget and flight.
- **Rationale:** A developer following the checklist could rebuild, republish or verify the wrong scope.
- **Impact:** Duplicate campaigns, unintended spend or work against superseded requirements.
- **Recommended action:** Mark the approval document as historical and non-executable. Create one canonical runbook containing current IDs, 12-ad scope, £500 budget, 15 September to 16 October flight, 19 October final review, known blockers and read-only versus mutating actions. Archive or clearly strike obsolete checklist steps without rewriting the signed approval record.
- **Open questions:** None.

### F23. Change and rollback rules do not cover operational emergencies

- **Relevant section:** Rules during the test; Known limits; PLAN rollback
- **Priority:** P2
- **Type:** Confirmed issue, deployment and operations
- **Description:** The rules say no live edits and owner-approved pauses only. They do not distinguish test optimisation from an emergency stop caused by wrong hours, unavailable food, a broken booking path, policy action or overspend.
- **Rationale:** Waiting for approval during a known harmful delivery can prolong customer or financial impact. Conversely, broad automatic mutation would breach the owner's approval control.
- **Impact:** Slow incident response or unauthorised changes.
- **Recommended action:** Pre-authorise a narrow emergency pause only, never copy or budget edits. Define triggers, audit record, notification and restart approval. Keep the optimiser suggestion-only. Document rollback separately for app code, GTM, website and Meta campaign state.
- **Open questions:** Held for the owner handoff.

### F24. Connection expiry is treated only as a round-two issue

- **Relevant section:** Note on Meta data access expiry
- **Priority:** P2
- **Type:** Confirmed issue, integration and reporting
- **Description:** Meta data access expires on 25 October, six days after the final scheduled review. The brief assumes this cannot affect the test.
- **Rationale:** Late corrections, attribution lag, reruns, audit queries and a delayed final report may still need API access. Expiry could also stop retry or reconciliation jobs before the result is fully preserved.
- **Impact:** Incomplete evidence and inability to reproduce the final report.
- **Recommended action:** Renew before the final week or persist all raw daily campaign, ad set and ad metrics needed for reporting before expiry. Add connection-expiry alerting and a documented manual export fallback.
- **Open questions:** None.

### F25. Forecast assumptions need ranges and reconciliation

- **Relevant section:** Expected volume
- **Priority:** P2
- **Type:** Confirmed issue, planning
- **Description:** The forecast combines historical CPM and CPC as point estimates, then applies an unmeasured 1 to 2 percent visit rate and 2.5 covers per table. It does not show uncertainty, audience saturation, booking lag or consent loss.
- **Rationale:** Historical campaigns and this local food campaign may have different audience and creative response.
- **Impact:** Stakeholders may treat 3,500 clicks and 17 to 35 weekly covers as commitments.
- **Recommended action:** Label these as planning scenarios, show low, central and high cases, and state that £500 divided by 14p gives about 3,571 clicks while the CPM estimate gives about 320,513 impressions. Reforecast after three serving days without changing success criteria.
- **Open questions:** None.

### F26. A simpler design would yield a more useful first result

- **Relevant section:** Structure; Goal; Known limits
- **Priority:** P3
- **Type:** Optional improvement, simplification
- **Description:** Twelve ads across four overlapping campaigns ask a small local budget to learn service, image and message effects at once.
- **Rationale:** Fewer variables and fewer competing campaigns improve interpretability and reduce operational load.
- **Impact:** The current approach spreads evidence thinly and makes the final story complex.
- **Recommended action:** For round one, prioritise the new lunch service and test one variable through Meta's A/B tooling, with dinner held as a stable support campaign or deferred. Use the winning dimension in round two. If the current build must remain, do not add more variants.
- **Open questions:** Held for the owner handoff.

## Required changes before first delivery

1. Resolve F01 and prove consent behaviour through the real landing-to-booking path.
2. Resolve the creative compliance basis in F06, replacing inaccurate imagery where possible.
3. Correct and verify public platform hours in F05.
4. Create spend tolerance and daily delivery monitoring under F04 and F18.
5. Reframe the learning claim and freeze the metric, attribution and mapping contracts under F02, F09, F10, F11, F13, F14 and F15.
6. Produce one current operational runbook under F22.

## Major risks if launched unchanged

- Consent-required advertising attribution is stored before consent.
- The result may identify delivery bias as a creative winner.
- Food imagery may be misleading or lack a recorded 2026 food-advertising exemption basis.
- Conflicting public hours can suppress the lunch response.
- The account can stop early at its spending limit.
- A broken link, booking path or data sync may go unnoticed until the weekly readout.

## Recommended delivery sequence

1. Owner resolves the decisions listed in the chat handoff.
2. Developer writes a short consent and attribution specification, then implements and tests it in the website repository.
3. Campaign owner replaces or formally clears the food images and corrects external hours.
4. Analyst freezes the mapping table, metric dictionary, baseline extract and readout query.
5. Operator completes the preflight against all 12 Meta ad IDs and every enabled placement.
6. Start only after all P0 items and launch-gating P1 items have dated evidence.
7. Run daily health checks, weekly readouts and the final review without changing the pre-agreed measurement rules.

## Verification performed for this review

- Read both supplied documents in full.
- Read the current CheersAI campaign brief and implementation plan.
- Verified 15 September 2026 is Tuesday and 16 October 2026 is Friday.
- Inspected the website's current attribution implementation.
- Fetched the live landing page on 10 September 2026 and checked its response and robots directives.
- Checked current primary guidance from the ICO, ASA and CAP, and Meta's own A/B test guidance.

This is an engineering and delivery review, not formal legal advice. The privacy owner or legal adviser should confirm the final compliance position where indicated.
