# SPEC: weekday food ads, mid-flight optimisation

Status: revised after review, 26 September 2026; ready to build on Peter's go-ahead per stage. Nothing in this spec has been built or deployed.
Owner: Peter Pitcher. Author: Claude.
Review: `tasks/REVIEW-weekday-food-optimisation-2026-09-25.md`. Every finding (R01 to R13 and the extra coverage checks) is folded into the section it affects; section 12 maps each one.
Campaign: the four "Weekday Lunch/Dinner" Meta campaigns for The Anchor (current state and ids in
`tasks/RUNBOOK-weekday-food-campaign.md`, which wins on ids; queries in `tasks/READOUT-weekday-food-queries.md`).

Three repositories change:

| Repo | Part | What |
|---|---|---|
| `OJ-The-Anchor.pub` (website) | W1 to W7 | Landing page fixes, booking path, page source on bookings, privacy notice line |
| `OJ-AnchorManagementTools` (management app) | M1 | Store the page source and ad tags on each website table booking |
| `OJ-CheersAI2.0` (this repo) | C1 to C4 | One new "walk in" challenger ad per campaign, created by a recoverable script, and the readout and runbook updates |

The website and the management app are one paired system (workspace rule). M1 and W5 are the paired change; they are safe to deploy in either order (section 6).

**Launch gates (kept from the draft).** Nothing ships or goes live without Peter's explicit go-ahead at the time. Each website deploy, each management-app deploy, and the creation (`--apply`) and activation (`--activate`) of the Meta challenger ads each need their own yes. A yes for one stage does not carry to the next.

---

## 1. Why

Readout on 25 September 2026 (data to the end of Thursday 24 September):

- £189.56 spent of £500, on plan; 1,283 Meta link clicks at about 15p; 1,905 human short-link clicks.
- **No booking carries an ad tag.** 21 website table bookings reached CheersAI since 11 September; none has a paid-social tag, an ad short code or a Facebook click id.
- **Walk-ins rose.** Tuesday to Friday walk-in covers logged: summer average about 7 a week; 15 (week of 31 August), 22 (7 September), 29 (14 September, the first full ad week and the highest since June), of which 19 were lunch walk-ins, a record. Lunch bookings fell to almost none the same week. Staff log walk-ins on only 1 to 3 of 4 days a week, so this is a floor and part of the rise may be better logging.
- About 97% of ad visitors are on a phone inside the Facebook or Instagram app.

What was found on the live landing page (`https://www.the-anchor.pub/lunch-and-dinner`, checked 25 September on a 375 x 812 viewport):

| # | Finding | Evidence |
|---|---|---|
| F1 | A "Christmas 2026" pop-up covers the page 10 seconds after arrival | Seen live. `components/features/christmas/ChristmasLightbox.tsx:39-54` suppresses booking and event routes but not `/lunch-and-dinner`; 10-second timer at `:192-212`; live until 15 December |
| F2 | The page does not match the ad | Every ad lands on the same page with a cod and chips hero. The "Lunch from £9" ad lands on dishes at £14 to £16 with no snack pots; the pie and pizza dinner ads land on cod |
| F3 | Booking is slow on a phone | "Book a table" opens `/book-table`, which starts with a second hero; the form begins at about 957px, below the first 812px screen |
| F4 | Nothing says people can just walk in | Ads and page only say "Book". The walk-in data says lunch customers walk in |
| F5 | Ad bookings are invisible without cookie consent | The booking form reads `?source=` (`ManagementTableBookingForm.tsx:214-218`) but only for analytics events; `buildTableBookingPayload` (`lib/table-booking/submission.ts:174-221`) drops it, and no attribution reaches the management app at all (`app/api/table-bookings/route.ts:667-685`). UTM tags go only to CheersAI and only with marketing consent (`lib/booking-attribution.ts:177`) |
| F6 | A developer note is visible to customers | "Bar and kitchen live from /api/business/hours..." is `FOOTER_NOTE` in `components/WeekHours.tsx:37-38`, shown on 5 pages |

Not a fault: the booking system works. The availability API returned 20 open slots, lunch and dinner, for Tuesday 29 September (checked 25 September).

## 2. Owner decisions

### 25 September 2026

| # | Decision |
|---|---|
| D1 | Keep all 12 original ads running; no pausing for learning (restates 10 September) |
| D2 | Build the landing page fixes now, not on Tuesday |
| D3 | Add one "walk in" challenger ad to each of the four campaigns now, keeping the originals |
| D4 | Record which page and ad a website table booking came from, taken from the page address, with no cookie or browser storage involved |
| D5 | "No need to book" is true: staff will always seat walk-ins at lunch (12pm to 3pm) and dinner (4pm to 9pm), Tuesday to Friday |
| D6 | The whole spec goes to an independent reviewer before any build. Done: `tasks/REVIEW-weekday-food-optimisation-2026-09-25.md` |

### 26 September 2026, after the review

| # | Decision | Finding |
|---|---|---|
| D7 | The new walk-in challenger ads keep the "Book now" button, as the originals do, so only the wording changes | C2 |
| D8 | Keep the current booking forwarding to CheersAI exactly as it is, including its consent flags. The new page-source label is stored only in the management app | R02 (review recommendation accepted) |
| D9 | The page says "No need to book" with the regular Tuesday to Friday times. No live "today" or "tonight" wording on the page | R06 (review recommendation accepted) |
| D10 | The landing-page change and the page-source label are judged on figures from launch only. Earlier weeks are rough context; no before-and-after claim | R04, R09 (review recommendation accepted) |
| D11 | No staff test booking before the challenger ads go live. The challengers wait for a real booking from the landing page to show the page-source label, with no bypass | R12 (review recommendation accepted) |
| D12 | The page and ad label is treated as personal data, because it sits against named bookings. The Anchor's privacy notice must say so when it ships | R08 |
| D13 | The Meta ad account spending limit stays as it is: about £310 left against roughly £287 still planned. Raise it only if other ads are added before 16 October | C2, C4 |
| D14 | From 25 September: run the full test to 16 October and optimise; never recommend stopping | Section 10 |

D14 does not change the narrow emergency pause Peter pre-authorised on 10 September (runbook section 6); the review asks for that authority to stay intact (R12).

## 3. Out of scope

- Budgets, schedules, audiences, placements and the 12 original ads (no edits).
- The existing forward of confirmed bookings to CheersAI, and on to Meta where consent allows. It stays exactly as it is, including its current consent flags (D8). D4 adds a separate, first-party record in the management app only. Any change to the existing consent policy needs its own decision.
- The Facebook click id (`fbclid`) and Google click id (`gclid`). Neither is recorded under D4.
- Moving the booking form onto the landing page. Rejected for now: the form is a 3,824-line client component that reads `useSearchParams()` with no internal Suspense, and `/book-table` picks its layout from a runtime flag fetched with `no-store`; embedding it would need a Suspense boundary and a flag decision, which is too much risk for a same-day change. W4 gets most of the benefit by jumping straight to the form.
- The staff tally sheet and walk-in logging (operational, section 9).
- A new job framework, attribution database, queue or campaign wizard. A narrow, recoverable script is enough for four ads (review, simplification).

---

## 4. Website changes (`OJ-The-Anchor.pub`)

One PR, branch `feat/lunch-dinner-ad-match`. The website runs Next 14 (`next ^14.2.13`), not CheersAI's Next 16, so do not apply Next 15 or 16 defaults to it. Test runner Jest 29 (`npm test`, which pins `TZ=Europe/London`); CI runs lint, tests and `next build`. Website rules that apply: copy follows `docs/SSOT.md`; prices are read live, never hard-coded, and shown bare except "from" prices, which keep the £ (`lib/lunch-and-dinner.ts:100-101`); no em dashes in customer text; the page stays `noindex` and out of the sitemap.

### W1. No Christmas pop-up on the landing page (F1)

- Add `'/lunch-and-dinner'` to `SUPPRESSED_ROUTE_PREFIXES` in `components/features/christmas/ChristmasLightbox.tsx`, with a comment saying it is the paid-ads landing page.
- Tests: add `/lunch-and-dinner` and `/lunch-and-dinner?utm_campaign=x` rows to the suppressed cases in `components/features/christmas/__tests__/lightbox-suppression.test.ts`; keep the existing allowed cases passing (`/`, `/sunday-roast`, `/food-menu` still show it).

### W2. Match the page to the ad (F2)

The short links already send `utm_campaign` to the page. The page reads it on the server and picks a variant from a fixed allow-list; anything else gets today's page unchanged.

| `utm_campaign` | Variant | Hero image (existing file in `public/images/food/weekday-2026/`) | Hero title | Dishes shown first |
|---|---|---|---|---|
| `weekday_lunch_a_cod_and_chips` | Lunch | `beer-battered-cod-and-chips.jpg` | "Lunch, Tuesday to Friday" | Snack pots card, wraps, then the current list |
| `weekday_lunch_b_spicy_chicken_stack` | Lunch | `spicy-chicken-stack.jpg` | "Lunch, Tuesday to Friday" | as above |
| `weekday_dinner_a_pizza` | Dinner | `stone-baked-pizza.jpg` | "Dinner, Tuesday to Friday" | Pizzas card, pie, then the current list |
| `weekday_dinner_b_beef_and_ale_pie` | Dinner | `beef-and-ale-pie.jpg` | "Dinner, Tuesday to Friday" | Pie, pizzas card, then the current list |
| anything else, repeated, or none | Default (today's page) | `beer-battered-cod-and-chips.jpg` | unchanged | unchanged |

The dinner title no longer says "tonight" (D9): a tagged link can be opened or shared on a Sunday or after service, and ad delivery hours do not limit when the page is visited.

Rules:

- The lunch variant shows the lunch time badge first and the dinner variant the dinner badge first; both badges stay, with times read live as today (`getWeekdayServiceTimes`).
- **Snack pots card:** a new card built like the existing pizza card: "Snack pots, from £X", where X is the cheapest live item in the menu section whose name matches `/^snack pots?$/i`. If the section or its prices are missing or invalid, the card is left out (same rule as every other dish). Use a text tile (the existing no-image card), because there is no snack pot photo. Live menu check on 25 September: the Snack Pots section has three items at £9 (Chicken Goujons & Chips, Fish Fingers & Chips, Salt & Chilli Squid & Chips).
- A dish promoted to the front is not shown a second time further down the list.
- Matching is exact and case-insensitive after trimming. If `utm_campaign` appears more than once in the address, the default page is shown. The value is never echoed into the page, so it cannot inject content.
- Rendering: reading `searchParams` makes the route render on demand instead of statically (it is currently prerendered with a 5-minute refresh). That is accepted at about 1,000 visits a week. Keep `export const revalidate` out of the page, or set `dynamic = 'force-dynamic'` explicitly, so the behaviour is stated rather than inferred.
- Freshness: menu requests revalidate every 300 seconds (`lib/api/client.ts:839`); `getBusinessHoursSnapshot` defaults to 3,600 seconds (`lib/api/client.ts:1539`). The PR states which applies to each fetch on this page. Verify on the built server of the installed Next 14 (`next build` then `next start`) that the page renders per request and the data cache still applies. No new infrastructure.
- Metadata (title, description, `noindex`, canonical `./`) does not change with the variant, and the page stays out of the sitemap.

Tests (`tests/unit/lunch-and-dinner-page.test.tsx`, extend):
- Each of the four `utm_campaign` values renders its hero image, title and first dish.
- An unknown value, an empty value, a repeated value, a mixed-case value (`Weekday_Lunch_A_Cod_And_Chips` maps to Lunch) and no value; the default layout is always defined.
- The snack pots card: shows "from £9" from fixture data; is absent when the section is missing, when prices are missing, when prices are invalid, and when the menu is unavailable.
- No promoted dish card appears twice.
- Default metadata, `noindex`, canonical and sitemap exclusion are unchanged.
- A pure function (for example `resolveLunchDinnerVariant(utmCampaign)` in `lib/lunch-and-dinner.ts`) with its own unit tests, so the mapping is tested without rendering.

### W3. Say people can walk in (F4, D5, D9)

- Under the hero buttons, one line in the page's voice, with the regular times: "No need to book. Just come in: lunch 12pm to 3pm, dinner 4pm to 9pm, Tuesday to Friday." The lunch variant may put lunch first and the dinner variant dinner first. This is regular-service information, not a promise about today (D9).
- The times come from the regular-window helper (`lib/lunch-and-dinner.ts:178-187`), which does not resolve special-date closures (`lib/hours-utils.ts:340-375`). That is acceptable only because the wording is regular. Nowhere on the page (hero, walk-in line or variant titles) uses "today", "tonight" or any other immediate-availability claim.
- If one service window is missing, show only the window that is present, still with "Tuesday to Friday". If the hours fetch fails (`times` is null), show "No need to book, just come in, Tuesday to Friday." with no times rather than stale ones.
- D5 stays the recorded seating policy; this change adds no capacity rule.
- Add a third hero action, "Get directions", linking to `/find-us` (existing page). Walk-in customers need the route more than the form.
- SSOT: add a line to `docs/SSOT.md` recording the owner decision of 25 September 2026: weekday lunch and dinner take walk-ins for the whole kitchen window, Tuesday to Friday. (SSOT currently records walk-ins only for Sunday roast.)
- Tests: the line renders with the regular times; renders the no-times fallback with "Tuesday to Friday" when hours are missing; renders only the present window when one is missing; the directions link points to `/find-us`. Render with the clock fixed (London dates) on a Sunday, on a weekday after dinner service, on a date with a special kitchen closure, and either side of a clock change (BST and GMT fixtures): the line stays the regular line and no immediate-availability wording appears in any of them.

### W4. Take "Book a table" straight to the form (F3)

- The booking form's section on `/book-table` already has `id="booking-form"` (`app/book-table/page.tsx:194`). Reuse it; add a `scroll-margin-top` that clears the sticky header. Confirm the anchor is present in each booking layout that `/book-table` can pick from its runtime flag.
- Change `BOOKING_HREF` in `app/lunch-and-dinner/page.tsx` to `/book-table?source=lunch_dinner_lp#booking-form`. The query must come before the `#` fragment.
- Hero and footer buttons: `BookTableButton` renders a button and navigates in its click handler through `withCarriedAttributionParams` (`components/BookTableButton.tsx:104`, carrier at `lib/booking-attribution.ts:148`), which keeps the fragment and works without consent. Tests must assert the actual navigation target, not an `href`.
- Sticky bar: on `/lunch-and-dinner`, `resolveBookingCta` (`lib/booking-cta.ts`) currently opens the generic quick-book sheet, whose bookings do not carry `lunch_dinner_lp`. Make it return a link to the same `BOOKING_HREF` on this path. `components/layout/StickyCtas.tsx` renders a plain `<Link href={action.href}>`, so changing the resolver alone does not carry the UTM tags: the sticky link on this path must also go through `withCarriedAttributionParams`.
- What the source measures: bookings that start from these three buttons. A visitor who leaves through directions or the menu and books later by another route is not counted as `lunch_dinner_lp`. Section 10 reports it that way.
- Tests: for the hero, footer and sticky actions, the navigation lands on `/book-table` with `source=lunch_dinner_lp`, the carried `utm_campaign`, `utm_content` and `short_code`, and ends in `#booking-form`; this holds with consent declined and writes nothing to storage; `resolveBookingCta('/lunch-and-dinner')` returns the link; other paths' sticky behaviour is unchanged (existing tests).
- Acceptance on the preview (W7): each click lands at the form; back and refresh do not change the booking form's values; keyboard activation works and focus lands somewhere usable; the sticky header or bar does not cover the form or the consent controls at 375 x 812 and with text enlarged to 200%. When a real Facebook or Instagram in-app browser is available, repeat the check there by opening the page address directly (never through an `l.the-anchor.pub` link); desktop Chromium alone does not represent the 97% phone audience.

### W5. Send the page source with the booking (F5, D4, D8, D12)

Paired with M1.

- In `ManagementTableBookingForm`, build a `page_source` object at submit time **from the current page address only** (`useSearchParams`), never from cookies, `localStorage` or `sessionStorage`, and never stored:
  - `booking_source`: the existing `bookingSource` value (the `?source=` value, capped at 80 characters, default `'direct'`)
  - `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `short_code`: from the URL if present, each trimmed and capped (80, 80, 160, 160, 32 characters). `fbclid`, `gclid` and any other parameter are not included.
- `page_source` never changes any booking detail (date, time, party size, contact details).
- `buildTableBookingPayload` (`lib/table-booking/submission.ts`) adds `page_source` to the body.
- `app/api/table-bookings/route.ts` treats `page_source` leniently, the same way M1 does: a `page_source` that is not an object is dropped; each of the six fields is kept only if it is a string, then trimmed and truncated; blank or wrong-type values become undefined; any other key is dropped. None of this is ever a reason to reject the booking. Validation of the actual booking details does not loosen. The route forwards the six fields to the management app as flat optional fields in the existing `POST ${API_BASE_URL}/table-bookings` body.
- **CheersAI and consent (D8, R02).** Preserve the existing confirmed-booking forward to CheersAI (`app/api/table-bookings/route.ts:464-514`, `lib/booking-conversion-forwarding.ts:54-81`), including its current consent flags (`metaConsentGranted`). The new `page_source` fields go to the management app only and must never populate that forward's attribution or any Meta payload. Existing Meta consent enforcement stays as it is.
- **Privacy notice (D12, R08).** In the same PR, add a line to the website privacy notice (`app/privacy-policy/page.tsx`) saying that when someone books a table on the website, the pub records which of its web pages and adverts they came from, taken from the web address rather than from cookies, and keeps it with their booking. Wording follows `docs/SSOT.md` and the notice's existing voice; Peter sees it in the PR. Because the notice ships in the same deploy as W5, and M1 stores nothing until the website sends the fields, no label is stored before the notice says so.
- Tests:
  - Form or payload: with `?source=lunch_dinner_lp&utm_campaign=weekday_lunch_a_cod_and_chips&short_code=jbozdk`, the payload carries those values; `fbclid`, `gclid` and extra parameters are absent; nothing is written to `document.cookie`, `localStorage` or `sessionStorage` (spy on the setters).
  - Consent cases, with mocked outbound calls, for consent absent, declined, accepted and withdrawn: the new labels reach the management app fetch in every case; they never appear in the CheersAI forward body, its attribution object or any Meta payload; the CheersAI forward body and its consent flags are unchanged from today (snapshot of the existing tests); consented behaviour is unchanged.
  - Server route leniency: a `page_source` that is not an object, fields that are null, numbers, objects or arrays, blank strings and a 500-character `utm_content` all leave an otherwise valid booking proceeding, with bad values dropped and long ones truncated; extra keys are not forwarded.
  - The privacy notice renders the new line.

### W6. Remove the developer note (F6)

- Delete `FOOTER_NOTE` and its render from `components/WeekHours.tsx`. It shows on 5 pages (`/`, `/find-us`, `/heathrow-hotels-pub`, `/restaurants-near-heathrow`, `/lunch-and-dinner`); removing it everywhere is intended, since it is developer text copied from the redesign spec (`docs/redesign-spec.md:599`).
- Tests: `WeekHours` no longer renders "/api/business/hours" (add to `tests/unit/WeekHours.after-midnight.test.tsx` or a new test); the rest of `WeekHours` output is unchanged for its consumers.

### W7. Website verification

- Before merge: `npm run lint:next`, `npm test`, `npm run build` all pass, including the existing tests for other booking routes, deposits, the Christmas path, error states and confirmation messages, which must keep their behaviour.
- On the Vercel preview, follow the runbook's browser rules (`docs/runbooks/paid-meta-ads.md` section 1): a fresh browser with Google, Meta, Clarity and LinkedIn blocked, and a made-up `qa_` value in `utm_source`. On a 375 x 812 viewport, open the page directly (never through an `l.the-anchor.pub` link, which would count as an ad click) with each of the four `utm_campaign` values, and confirm: the right hero and first dish; the walk-in line with regular times; no Christmas pop-up after 15 seconds; hero, footer and sticky "Book a table" each land on the form with the form visible in the first screen; the W4 acceptance checks.
- Booking body check (R07). The form builds the request body during submit (`ManagementTableBookingForm.tsx:2018`) and sends it at `:2054`, so there is nothing to inspect before submit. Install a browser interception for the booking POST (for example a Playwright route on `/api/table-bookings`) before submitting, submit, capture the body, and fulfil the request locally with a stub response without forwarding it. Assert the captured body carries `page_source` and that zero booking requests reached the server. Never submit a real booking: it creates a real booking and a real SMS that cancelling cannot undo. If Turnstile stops an automated submit on the preview, nobody bypasses it: the payload check then rests on the unit and route tests, and the gap is recorded in the PR.
- An available-slots response is not proof that booking works.
- Repeat the page checks on production after merge and record the deployment id. Confirmation that a real booking stores the label is the organic check in section 6, never a test booking (D11).

---

## 5. Management app change (`OJ-AnchorManagementTools`)

### M1. Store the page source on website table bookings (D4, D12)

One PR, branch `feat/table-booking-page-source`. No migration.

- `CreateTableBookingSchema` (`src/app/api/table-bookings/route.ts:68-139`): add optional `booking_source`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `short_code`. **A bad tag must never reject a booking (R05).** `z.string().trim()` rejects nulls, numbers, arrays and objects before any transform runs, and schema failures return 400 (`route.ts:352-359`). So each label is preprocessed first: keep only strings, trim, truncate to its cap (80, 80, 80, 160, 160, 32), and map blank or wrong-type values to undefined, for example `z.preprocess((v) => (typeof v === 'string' ? v.trim().slice(0, cap) || undefined : undefined), z.string().optional())`. Validation of the actual booking details does not loosen.
- Mirror the event-bookings pattern (`src/app/api/event-bookings/route.ts:88-118`): collect only the values actually sent into an `attribution` object, **after** the idempotency hash is built, and keep all six fields out of `computeTableBookingRequestHash`, so a retry with different tags does not get a 409.
- First success wins: a replay with the same `Idempotency-Key` already returns the original booking early (`route.ts:444-450`). It keeps the original booking's attribution; the retry's tags are ignored and no second analytics event is written. The PR documents this.
- Write the labels into the `table_booking_created` analytics event metadata (`route.ts:762-779`) both as a nested `attribution` object and as flat keys (`booking_source`, `utm_campaign`, `utm_content`, `short_code`, ...), exactly as `src/services/event-bookings.ts:795-822` does for event bookings.
- Christmas path (`create_table_booking_christmas_v01`, `route.ts:482`): strip the six fields from the `...payload` spread into `p_request`. The function ignores unknown keys today, but the request should carry only what the function reads.
- `table_bookings.source` stays `'brand_site'`. Changing it would drop bookings from the reports' allow-list (`src/lib/analytics/table-booking-reports.ts:22-29`) and break the walk-in split (`src/lib/insights/sections/table-bookings.ts:106-108`).
- The analytics write stays non-blocking (`recordTableBookingAnalyticsSafe`, `route.ts:265-280`): if it fails, the booking still succeeds and a warning is logged. The booking is the customer's write and must not fail because of measurement. `src/lib/analytics/events.ts:29-39` catches its own insert errors, so a throwing mock only tests the outer wrapper; the tests inject both. The warning carries no raw tags and no personal data. A lost label is a documented limitation, not a repair queue.
- **Data (D12, R08).** The labels sit in `analytics_events` rows that carry `customer_id` and `table_booking_id` (`src/lib/analytics/events.ts:20-26`), so they are personal data about a named booking, not anonymous campaign totals. Only the six allowed fields persist, each a bounded string; `fbclid`, `gclid` and any other key never enter this path. The labels are untrusted reporting hints: never a permission, and never proof that someone saw an ad. Rejected or raw input is never logged. The PR records, from the code, how existing customer access and deletion requests treat that customer's `analytics_events` rows. The website privacy notice line (W5) covers the new label.
- Tests (Vitest, `tests/api/`):
  - A booking with all six fields writes them into `table_booking_created` metadata (flat and nested).
  - A booking without them behaves exactly as today (metadata unchanged).
  - An oversized `utm_content` (500 characters) is truncated to 160 and the booking succeeds.
  - Fields that are null, numbers, objects, arrays or blank strings are dropped and the booking succeeds; the same holds for a booking with all six malformed at once.
  - Two requests with the same `Idempotency-Key` and identical booking details but different `utm_campaign` values: the second returns the original booking, not a 409, with the original attribution and no second analytics event.
  - Injected failures: `recordAnalyticsEvent` throws, and separately the Supabase insert returns an error; in both the booking still returns success and a warning without tags or personal data is logged.
  - Christmas path: the six fields are absent from the `p_request` passed to the RPC.
- Commands: `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:tests`, `npm test`, `npm run build`.

---

## 6. Deploy order and safety

Each numbered step needs Peter's explicit go-ahead at the time (launch gates, top of this spec).

1. **M1 first** (management app). The website does not send the fields yet, so production behaviour is unchanged. Verify: the deployment is Ready (record its id), the booking route's tests passed in CI, and a read-only `select` on `analytics_events` shows the next organic `table_booking_created` row still written normally.
2. **Website second**, including the privacy notice line. Zod drops unknown keys (the schema is not `.strict()`), so even if the website went first, bookings would still succeed and the fields would simply be lost until M1 deployed. Neither order can break booking. Record the deployment id and its time in London: page-source reporting starts there (D10).
3. **Organic check (D11, R12).** The next real booking made from `/lunch-and-dinner` must show `booking_source = 'lunch_dinner_lp'` in `analytics_events.metadata` (read only). No staff test booking, no automatic test booking and no bypass. This is a real release condition for challenger activation, so same-day activation is not promised. Until it clears, the daily check reports that the gate is still open.
4. **CheersAI last** (section 7). Merge C1. Then `--dry-run`; then, with Peter's go-ahead, `--apply`, which creates the challengers paused (no delivery, no spend) and may run before step 3 clears. `--activate` runs only after step 3 has cleared, every read-back check passes, and Peter gives his go-ahead at the time, so the challengers' clicks land on the improved page.

No database migration in any repo. No `supabase db push` is needed or allowed for this work.

---

## 7. CheersAI changes (`OJ-CheersAI2.0`)

### C1. Creative enhancements opt-out and launch read-back (R03)

The 12 original ads were read back as opted out of every Meta automatic creative change (`tasks/RUNBOOK-weekday-food-campaign.md:22`), but the code never sends that setting (no `degrees_of_freedom_spec` anywhere in `src/`). A new ad could therefore be created with Meta's defaults.

- **Establish the fields first.** Before the request body and its test fixture are fixed, read `creative{degrees_of_freedom_spec}` from one original ad on the configured `META_GRAPH_VERSION` (`src/env.ts`), read only, as `docs/runbooks/paid-meta-ads.md` section 10 step 1 already does, and check Meta's documentation for that version. The C1 PR records which `creative_features_spec` keys the API returns and accepts. Do not assume the `standard_enhancements` bundle alone covers every feature.
- Add an optional `optOutCreativeEnhancements?: boolean` to `CreateAdCreativeParams` (`src/lib/meta/marketing.ts:87-98`). When true, `createMetaAdCreative` sends `degrees_of_freedom_spec.creative_features_spec` with each recorded feature set to `enroll_status: 'OPT_OUT'`. Default false, so existing publish behaviour does not change.
- Add `readMetaAdForLaunch(adId, token)`, which reads both the ad and its creative: the ad's `configured_status`, `effective_status` and `ad_review_feedback`, and the creative's `object_story_spec` and `degrees_of_freedom_spec`.
- Add pure checks for C2 to use:
  - Enhancements: `pass` only when every recorded feature is present and `OPT_OUT`; `fail` when any is `OPT_IN` or an unknown value; `unverified` when the spec is missing or empty or a recorded feature is absent. `unverified` never counts as a pass.
  - Call to action: the app sends `BOOK_NOW` as `BOOK_TRAVEL` (`normaliseMetaCallToActionType`, `src/lib/meta/marketing.ts:356-359`), so comparisons normalise both sides with that function.
  - Review: `pending` while Meta has not finished review (no feedback yet is not approval); `fail` on any review feedback or rejection; `pass` only when the ad is approved and its effective status matches what was set.
- Tests (`tests/lib/meta/marketing.test.ts`): the request body contains the spec when the flag is true and not when false or omitted; read-back fixtures cover missing, empty, `OPT_IN` and unknown feature states, CTA normalisation, a mismatched link, pending review, rejected review and an expired token.

### C2. Recoverable ops script to add the four challengers (R01, R03, R11, R12)

There is no safe existing path: the optimiser's apply path refuses campaigns flagged `controlled_test` (`src/app/(app)/campaigns/actions.ts:1822`) and only rewrites an existing ad; publish only creates whole campaigns. So: `scripts/ops/add-weekday-challenger-ads.ts`, run with `tsx` through a new `npm run ops:add-weekday-challengers`, following `scripts/ops/link-auth-user.ts`. The orchestration lives in `src/lib/campaigns/challenger-ads.ts` and takes its Supabase, Meta, management-app and lock clients as parameters, so a whole run can be tested with mocks; the script file only parses arguments and wires the real clients.

**Modes:** `--dry-run` (default: prints everything it would do, writes nothing), `--apply` (creates the ads **paused**), `--activate` (switches on ads that passed every check), `--pause` (rollback), `--status` (read only: each challenger's stage, local and remote status and review state).

**Runner and lock.** The script is run only from the owner's Mac, from a checkout of `main` after C1 is merged, using the repo's `.env.local`. Every mode except `--dry-run` and `--status` first takes a single-run lock with Upstash Redis `SET <key> <run id> NX EX 1800` through `@upstash/redis`, the client `src/lib/auth/rate-limit.ts` already uses, and releases it at the end only if it still holds its own run id. If the Upstash Redis variables are missing or the lock is held, the script stops before any write. A held lock never blocks the existing emergency pause through the CheersAI app or the Graph API (runbook section 6; `docs/runbooks/paid-meta-ads.md` section 9).

**Stable identity.** Each campaign has exactly one challenger: the ad in that campaign's one ad set named `Evergreen Test | Walk in | Var 4`. The local `ads` row, the Meta creative and the Meta ad all carry that name, so a run can find them by listing the ad set's ads (every status) and the ad account's creatives. More than one match, locally or remotely, stops that campaign and is reported for manual reconciliation; the script never guesses. The UTM key is chosen once, saved on the `ads` row before any external write, and reused by every later run; it is never regenerated.

**Checkpoints in existing records (no new table).** A run works out where each campaign got to from its `ads` row and snapshot:

| Stage | Evidence |
|---|---|
| S1 row | `ads` row exists with the challenger name, copy, `creative_variant_key`, `utm_content_key`, `status 'DRAFT'`, no Meta ids |
| S2 link | `source_snapshot.managementMetaAdVariants` holds an entry with that `utmContent` and its own `shortCode` |
| S3 creative | `ads.meta_creative_id` is set |
| S4 ad | `ads.meta_ad_id` is set; `status` and `meta_status` `PAUSED` |
| S5 checked | every read-back check passed in this run |
| S6 live | `status` and `meta_status` `ACTIVE`, confirmed by a remote read after the switch |

Each run also writes a JSON manifest, saved outside git and never committed, listing per campaign the stage reached, the local row id, short code, creative id, Meta ad id, each check's result and the run id. It holds no tokens. The ids go into the runbook change log (C3).

**Restart rules.**
- A run resumes from the evidence above and recovers a known object by its stored id (a GET), never by creating it again.
- After an ambiguous external response (a timeout, network error or server error, or a remote success whose local save then failed), the script stops that campaign and reconciles before creating anything else: it lists the remote objects by the challenger name. Exactly one match: save its id and continue. None: the next run may create. More than one: stop and report; Peter decides what to pause.
- Snapshot updates re-read the latest `source_snapshot` immediately before writing and add only the one new variant, keyed by `utmContent`, leaving every existing entry untouched. With the lock held, no other writer touches these snapshots: the only app writers are `publishCampaign` (`src/app/(app)/campaigns/[id]/actions.ts:861`) and `applyOptimisationRecommendation` (`src/app/(app)/campaigns/actions.ts:2036`), which refuses `controlled_test` campaigns.

**Per campaign, in order** (app ids in the runbook):

1. **Preflight, read only.** With the service-role client, scoped by `account_id = '91fda684-2801-4abb-980e-f42cec017cef'`, load the `meta_campaigns` row (including `source_snapshot`, `destination_url`, `campaign_kind`, `controlled_test`), its `ad_sets` rows, all its `ads` rows, the ad account token and the Facebook Page id. Stop before any write if: the campaign is not `ACTIVE`, is not `evergreen` or not `controlled_test`; it has more than one ad set; the ad account is not `act_1640006396819878` or the Page is not `628953850871830` (`tasks/ADS-PLAYBOOK-the-anchor.md` section 1); the flight has ended; the token is missing or a cheap read fails; or the existing ads do not match the runbook's ids (three originals each, plus Lunch A's paused rewrite `120246219010320609`).
2. **Copy.** Run `findRewriteCopyProblems` (`src/lib/campaigns/rewrite-copy.ts:73`) with the campaign name. Stop on any problem. Re-check every price against the live management-app menu on the day of `--apply`.
3. **Key and row (S1).** If the challenger row exists, reuse its key. Otherwise build the key with `buildCreativeVariantKey`, then `uniqueAdUtmContentKey(buildAdUtmContentKey(parts), takenKeys)` (`src/lib/campaigns/ad-attribution.ts`), where `takenKeys` holds **every** Weekday campaign's keys, not just this campaign's, so the new keys cannot collide across Lunch A and Lunch B (the existing clash, READOUT 3c). Insert the `ads` row: same `media_asset_id`, `creative_format` and `cta` (`BOOK_NOW`) as the campaign's three original ads, so **copy is the only difference** (D7); name `Evergreen Test | Walk in | Var 4`; `status 'DRAFT'`.
4. **Short link (S2).** The management-app connection config comes from `management_app_connections` (the in-app helper needs a signed-in request). Call `createManagementMetaAdsLink` (`src/lib/management-app/client.ts:376`) with the campaign's parent short code and one variant carrying the saved key. The response holds the parent link's fields plus a `variants` array, so never read the top-level `shortCode`. Select exactly one entry from `variants` whose `utmContent` equals the saved key, and check: its `parentShortCode` is the campaign's code; `shortUrl` is https on `l.the-anchor.pub`; `utmDestinationUrl` is `https://www.the-anchor.pub/lunch-and-dinner` with the campaign's `utm_campaign` and the saved `utm_content`. `alreadyExists: true` on a retry is success and must return the same code. A parent-only response, no matching entry or more than one matching entry fails safely.
5. **Snapshot.** Merge the variant into `source_snapshot.managementMetaAdVariants` (all of `utmContent, shortUrl, shortCode, destinationUrl, utmDestinationUrl, parentShortCode, alreadyExists`) as the restart rules describe.
6. **Creative (S3).** Upload the same image (`uploadMetaImage`) and create the creative named as the challenger, with `optOutCreativeEnhancements: true` and `linkUrl` from `resolveAdLinkUrl` (`src/lib/campaigns/ad-link.ts`). Assert the link is the new `l.the-anchor.pub/<code>`, not the campaign-level code. Save `meta_creative_id` straight away.
7. **Ad (S4).** `createMetaAd` in the existing Meta ad set with status `PAUSED`. Save `meta_ad_id`, `status` and `meta_status` `PAUSED` straight away.
8. **Read back (S5).** With `readMetaAdForLaunch`: both the creative's link and its call-to-action link equal the new short link, not the campaign-level code; headline, text and description equal the spec; the CTA matches after normalisation; the enhancements check is `pass` (`unverified` or `fail` blocks activation). Then carry forward the runbook's pre-launch checks (`docs/runbooks/paid-meta-ads.md` section 10) rather than replacing them: settings read back from Meta (1), the new codes in `short_links` with no early expiry (3), account status and spending-limit headroom above what will still run, with the limit unchanged (4, D13), placement previews for each new ad (6), public hours (7), the booking system for an ad day and an excluded day (9), every claim against the menu and hours (10), and no automation able to change the campaign (12). Print pass, fail or pending per check.

**`--activate`** needs every campaign at S5 with every check passing, the organic check of section 6 cleared, and Peter's go-ahead at the time. For each challenger it repeats the read-back, calls `setMetaObjectStatus(adId, 'ACTIVE')`, reads the remote status back, and only then sets `status` and `meta_status` to `ACTIVE`. If the remote switch succeeded but the local save failed, it reports the mismatch and the next run reconciles from Meta's state. Meta review after activation shows as `pending`, never as a pass: run `--status` every 15 minutes for up to 2 hours (approvals took 10 to 35 minutes in September 2026); anything still pending or rejected after that goes to Peter. Activation never touches the 12 originals, the paused rewrite, the ad sets, budgets or schedules.

**`--pause`** pauses every identified challenger, by stored `meta_ad_id` or else by name reconciliation, even if the campaign is no longer `ACTIVE`; creation-only prerequisites (campaign state, copy, flight, object counts) never block it. It reports success for an ad only after a remote read shows it paused, then updates the local row; a remote pause with a failed local save is reported separately. Its output lists any challenger ids still active. It keeps the short links and history for reporting.

The script prints no tokens, keys or connection secrets. It writes only: 4 short links (management app, via its API), 4 `ads` rows and 4 snapshot updates (CheersAI), 4 creatives and 4 ads (Meta), and the manifest.

**Challenger copy** (identical in the A and B campaign of each service, as with the originals; prices checked against the live management-app menu on 25 September; re-check on the day of `--apply`):

| | Lunch A and Lunch B | Dinner A and Dinner B |
|---|---|---|
| Name | Evergreen Test \| Walk in \| Var 4 | Evergreen Test \| Walk in \| Var 4 |
| Headline (limit 40) | Lunch, no booking needed, Tue to Fri (36) | Dinner tonight, just walk in, from 4pm (38) |
| Primary text (limit 300) | Just turn up. We serve lunch Tuesday to Friday, 12pm to 3pm, with snack pots at £9 and wraps at £10. Free on-site parking and dogs welcome, in Stanwell Moor. (157) | No need to book. We serve dinner 4pm to 9pm, Tuesday to Friday: stone-baked pizzas from £13 and our beef and ale pie with mash at £16. Free on-site parking and dogs welcome. (173) |
| Description (limit 25) | Walk in 12pm to 3pm (19) | Kitchen open 4pm to 9pm (23) |
| Button | Book now (as the originals, D7) | Book now (as the originals, D7) |

Price sources (management app `menu_dishes`, active, 25 September): snack pots £9 (all three); Chicken Goujon Wrap and Fish Finger Wrap £10; Margherita £13 (cheapest pizza); Beef & Ale Pie £16. In the dinner headline, "tonight" is ad copy only: dinner ads deliver only Tuesday to Friday, 14:00 to 20:00, and the pre-authorised emergency pause covers a day the kitchen is closed (runbook section 6). The landing page itself uses no "tonight" wording (D9). Neither text matches the app's `WALK_IN_PATTERN` ("walk-ins welcome/available", `src/lib/campaigns/generate.ts:87`), but both deliberately go against the app's booking-first stance ("walk-ins welcome weakens the reason to reserve", `src/lib/campaigns/optimisation.ts:1326`); testing that stance is the point of the challenger (D3).

Known effect: adding an ad to a live ad set counts as a significant edit to Meta, and on 22 September a new ad took all of Lunch A's delivery within hours. Expect the challengers to take a large share of spend at first. That is accepted (D3); budgets are lifetime and unchanged, so total spend does not rise.

Tests:
- Pure parts, in `tests/lib/campaigns/challenger-ads.test.ts`: building the four ad specs; the key collision check across all four campaigns (a key that would collide with a Lunch B key is suffixed); a saved key is reused, never regenerated; variant selection from the short-link response (parent-only, missing, multiple, `alreadyExists`, wrong host, path, `utm_campaign` or `utm_content` all handled as described); the read-back comparison (any `OPT_IN` fails; missing, empty or unknown is `unverified`; a campaign-level link fails; the CTA is normalised); stage detection from the row and snapshot; the reconciliation decision for zero, one and several remote matches; the snapshot merge keeps every existing variant.
- Whole runs with mocked clients, in `tests/ops/add-weekday-challenger-ads.test.ts` (next to the existing `tests/ops/` tests):
  - A failure injected after every external success and before each local save; a retry ends with exactly one challenger per campaign.
  - A second invocation is refused while the lock is held; a missing Upstash configuration stops before any write.
  - An interrupted activation is reconciled from Meta's state.
  - `--pause` works on a campaign that is no longer `ACTIVE`, reports remote and local mismatches, and lists ids still active after a partial failure.
  - `--dry-run` makes no short-link POST, image upload, database write, creative or ad creation, or status call, and its output contains no token or connection secret.
  - Missing or expired credentials, an unsupported campaign kind, an ended flight or an unexpected object count stop before any write.
  - The originals, the paused rewrite and the existing snapshot variants are unchanged after every scenario.

### C3. Readout, runbook and daily check (R04, R09, R13)

- `tasks/READOUT-weekday-food-queries.md`:
  - Add the four new short codes to queries 3a, 3b and 5a, and note Var 4 in 4a.
  - Add query 5e, website table bookings from the landing page. Source: management-app `analytics_events` where `event_type = 'table_booking_created'` and `metadata->>'booking_source' = 'lunch_dinner_lp'`, joined to `table_bookings` on `analytics_events.table_booking_id`. Count distinct booking ids. Count bookings whose current status is confirmed or later; show bookings still awaiting a deposit payment in their own column (the deposit timeout can still cancel them); leave out cancelled and no-show. Take the exact status values from the management app when writing the query. Figures are "as at" the readout time, and a later readout that revises an earlier week marks the revision.
  - Report 5e by booking creation week (London) for attributed bookings and by service date for covers, as runbook section 5 already does. Show all landing-page bookings separately from Tuesday to Friday food-service bookings and covers; weekend and drinks bookings stay out of the food figures. Break it down by `utm_campaign` and `short_code`. Leave out any row whose `utm_source` starts with `qa`.
  - 5e starts at the website deployment time recorded in section 6. Earlier weeks show "not measured", never 0 and never an improvement figure. A rate with zero clicks shows "n/a". Counts sit beside every rate, and each rate states its numerator and denominator dates in London time. 5e is never added to CheersAI or Meta conversion totals.
  - Before first use, run 5e over a sampled week and check by hand that it handles: a duplicate event for one booking, a booking awaiting payment that later expires, a cancellation, a booking whose dining date was changed, a weekend or drinks booking, and a service logged with zero walk-ins versus a service nobody logged. Reconcile the sampled totals against the management app's existing booking reports.
  - Optional (R13): define the four challengers once, by Meta ad id with their activation time, and reuse that list in 3a, 3b, 4a, 5a and 5e rather than repeating it by hand. Check that it holds exactly four ids and leaves out the paused rewrite.
- `tasks/RUNBOOK-weekday-food-campaign.md`: the Var 4 ad ids and codes in section 2; change-log rows for W, M1 and C2 with deployment ids and the manifest's ids; D1 to D14 in section 3.
- `docs/runbooks/paid-meta-ads.md`: the lesson that new ads need the creative-enhancements opt-out sent explicitly and read back (C1); correct the stale text at `:231-236` about the rewrite path (fixed by PR #79 on 23 September).
- Scheduled tasks on the owner's Mac (`anchor-weekday-food-daily-check`, the readouts): add the four Var 4 ads and codes to their checks, and the section 6 organic-check status until it clears. After changing them, confirm each task's next scheduled run before relying on it.

### C4. CheersAI verification

`npm run ci:verify` passes. Then, each step with Peter's go-ahead where section 6 requires it: `--dry-run` output reviewed; `--apply`; every read-back check passes (`unverified` counts as a fail); `--activate`; `--status` until all four are approved. Readout query 4a then returns **17 rows**: 12 originals, Lunch A's paused rewrite and 4 challengers. 16 are meant to be active (the 12 originals and the 4 challengers) and the rewrite stays paused. Confirm this against a fresh read from Meta, match the four challengers by their Meta ad ids (counts supplement the identity check, never replace it), and check each challenger has its own short code. The originals keep their codes. The next morning's sync fills their metrics (the sync reads each ad by its stored `meta_ad_id`, `src/lib/campaigns/performance-sync.ts:112`).

---

## 8. Rollback (R12)

| Part | Rollback | Effect |
|---|---|---|
| Website | Revert the PR and redeploy (or promote the previous Vercel deployment) | Page returns to today's version; bookings unaffected. Live challengers would then land on the old, mismatched page: assess and pause only the affected challengers. That needs Peter's yes unless the emergency-pause conditions apply (runbook section 6) |
| M1 | Revert the PR | New labels stop being stored; existing records stay and are not erased; bookings unaffected |
| Challengers | `add-weekday-challenger-ads.ts --pause`: success is reported only after Meta shows each ad paused; the local rows are reconciled separately; the output lists any id still active | Delivery returns to the 12 originals; short links and history stay for reporting |
| C1 | Revert the PR | The flag defaults to false, so nothing else depends on it |

What no rollback can restore: money already spent, impressions, Meta's delivery allocation and learning, and any booking confirmation message already sent. The existing emergency pause authority (runbook section 6) is unchanged.

## 9. Operations (no code)

- Staff log every walk-in on the front-of-house screen, every Tuesday to Friday, both services.
- Staff tick "logging complete" for each lunch and dinner service on the existing tally process, including services with zero walk-ins, so a quiet service and an unlogged one can be told apart (R09).
- Staff ask walk-ins "How did you hear about us?" and mark it on the tally sheet.
- Weekly readouts report walk-ins per logged service, using the tick, with the number of unlogged services shown beside the average, so a missed day does not look like a drop.

## 10. How success is judged (read-outs from 29 September)

Directional, as with the rest of the test. The website change and Meta's unequal split of spend between ads rule out any causal claim about the copy.

- Landing-page bookings (query 5e) per 100 short-link clicks, **from the verified website deployment onwards only** (D10). There is no before figure: earlier weeks show "not measured", and there is no before-and-after claim. Overall bookings, walk-ins and food takings from earlier weeks are rough context only. The figure covers bookings that start from the page's three booking buttons (W4).
- Challenger ads against the originals in each campaign, **over the same period from the challengers' activation**, never challenger-to-date against originals since 11 September: link click-through rate and cost per link click (from `metrics_clicks`), and page-source bookings by `short_code`, with counts beside each rate.
- Walk-in covers per logged service, lunch and dinner, and food takings, against the 1 to 10 September baseline as directional context (runbook section 5).
- First-party page-source bookings and CheersAI or Meta conversions are reported separately and never added together.
- The owner's bar is still £1 per extra cover; the spec does not change that judgement.
- The test runs to 16 October (D14). Readouts recommend optimisations within D1 and the rules above and never recommend stopping.

## 11. Assumptions

- A1. Staff will seat walk-ins throughout both kitchen windows, Tuesday to Friday (owner, D5).
- A2. The snack pots section keeps the name "Snack Pots" in the live menu; if it is renamed, the card disappears (safe).
- A3. Reading `searchParams` makes the landing page render per request on the website's Next 14; the added cost is small at this traffic, and the menu (300 seconds) and hours (up to 3,600 seconds) data caches still apply. W2 verifies this on the built server.
- A4. `withCarriedAttributionParams` carries `utm_*` and `short_code` from the landing page into the `/book-table` address, as `BookTableButton` does today; W4 wires the sticky link through it too, and W4 and W5 tests prove it.
- A5. Recording campaign labels from the page address, without cookies or storage, is within the owner's consent decision of 10 September (owner, D4). The label is personal data and the privacy notice says so from the day it ships (D12).
- A6. A new ad in each ad set may reset Meta's learning and shift delivery towards it; accepted (D3).
- A7. An ad created paused does not deliver or spend, so `--apply` can run before the organic check clears.
- A8. Asking the management app again for the same `utmContent` under the same parent returns the existing child link with `alreadyExists: true` (the client parses that field, `src/lib/management-app/client.ts:723` and `:752`). `--dry-run` and the C2 tests prove the script's handling of it.

## 12. Review findings and where they are handled

| Finding | Where | Change |
|---|---|---|
| R01 restart and reconciliation | C2 | Single runner and Upstash lock; stable identity by name per ad set; saved UTM key; stage checkpoints in the `ads` row and snapshot; manifest; reconcile before re-creating after an ambiguous response; snapshot merge; `--pause` independent of creation checks; failure-injection tests |
| R02 consent and CheersAI | D8, section 3, W5 | Existing CheersAI forward and consent flags unchanged; labels go to the management app only; four consent-state tests |
| R03 creative and activation checks | C1, C2, C4 | Opt-out fields established on the configured API version first; ad and creative read back together; `unverified` and `pending` never pass; CTA normalised; runbook section 10 checks carried forward; remote re-read after activate and pause |
| R04 no comparable baseline | D10, C3, section 10 | Page-source reporting from the deployment only; "not measured" before; same-period challenger comparison; no adding of first-party and Meta totals |
| R05 validator rejects bad tags | M1, W5 | Preprocess to strings or undefined; website route equally lenient; first-success idempotency documented and tested |
| R06 current-service wording | D9, W2, W3 | "Dinner, Tuesday to Friday"; regular times only; weekday qualifier kept in every fallback; clock-fixed tests |
| R07 network check before submit | W7 | Browser interception of the booking POST, fulfilled locally; zero upstream requests asserted; runbook browser rules |
| R08 labels are personal data | D12, W5, M1 | Described as personal data; privacy notice line ships with W5; six bounded fields only; access and deletion treatment recorded |
| R09 query 5e eligibility | C3, section 9 | Distinct ids joined on `table_booking_id`; awaiting-payment separate; creation week versus service date; logging-complete tick; hand-checked cases |
| R10 navigation contract | W4 | Existing anchor reused; real navigation tested for hero, footer and sticky; sticky link through the carrier; accessibility and in-app browser checks |
| R11 short-link selection and count | C2, C4 | One variant selected by saved `utmContent` with full validation; `alreadyExists` accepted; 17 rows, not 16 |
| R12 rollback and sequencing | D11, section 6, section 8 | Organic check is a real gate for activation only; no staff test; what rollback cannot restore; website revert assesses challengers; emergency pause unchanged |
| R13 group challengers (optional) | C3 | One reusable list of the four ids, checked to exclude the rewrite |
| Extra coverage checks | W2, W5, W6, W7, M1, C2 | Page-variant edge cases, cache freshness on Next 14, shared regressions, real Supabase insert error, account and identity assertions, dry-run and redaction tests, final evidence with deployment ids |
