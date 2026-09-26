# SPEC: weekday food ads, mid-flight optimisation

Status: draft for independent review, Friday 25 September 2026. Nothing in this spec has been built or deployed.
Owner: Peter Pitcher. Author: Claude.
Campaign: the four "Weekday Lunch/Dinner" Meta campaigns for The Anchor (current state and ids in
`tasks/RUNBOOK-weekday-food-campaign.md`, which wins on ids; queries in `tasks/READOUT-weekday-food-queries.md`).

Three repositories change:

| Repo | Part | What |
|---|---|---|
| `OJ-The-Anchor.pub` (website) | W1 to W7 | Landing page fixes, booking path, page-source on bookings |
| `OJ-AnchorManagementTools` (management app) | M1 | Store the page source and ad tags on each website table booking |
| `OJ-CheersAI2.0` (this repo) | C1 to C4 | One new "walk in" challenger ad per campaign, and the readout and runbook updates |

The website and the management app are one paired system (workspace rule). M1 and W5 are the paired change; they are safe to deploy in either order (section 6).

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

## 2. Owner decisions (25 September 2026)

| # | Decision |
|---|---|
| D1 | Keep all 12 original ads running; no pausing for learning (restates 10 September) |
| D2 | Build the landing page fixes now, not on Tuesday |
| D3 | Add one "walk in" challenger ad to each of the four campaigns now, keeping the originals |
| D4 | Record which page and ad a website table booking came from, taken from the page address, with no cookie or browser storage involved |
| D5 | "No need to book" is true: staff will always seat walk-ins at lunch (12pm to 3pm) and dinner (4pm to 9pm), Tuesday to Friday |
| D6 | The whole spec goes to an independent reviewer before any build |

## 3. Out of scope

- Budgets, schedules, audiences, placements and the 12 original ads (no edits).
- The consent-gated flow to CheersAI and Meta (CAPI). It stays exactly as it is; D4 adds a separate, first-party record in the management app only.
- The Facebook click id (`fbclid`). It is not recorded under D4.
- Moving the booking form onto the landing page. Rejected for now: the form is a 3,824-line client component that reads `useSearchParams()` with no internal Suspense, and `/book-table` picks its layout from a runtime flag fetched with `no-store`; embedding it would need a Suspense boundary and a flag decision, which is too much risk for a same-day change. W4 gets most of the benefit by jumping straight to the form.
- The staff tally sheet and walk-in logging (operational, section 9).

---

## 4. Website changes (`OJ-The-Anchor.pub`)

One PR, branch `feat/lunch-dinner-ad-match`. Test runner Jest 29 (`npm test`, which pins `TZ=Europe/London`); CI runs lint, tests and `next build`. Website rules that apply: copy follows `docs/SSOT.md`; prices are read live, never hard-coded, and shown bare except "from" prices, which keep the £ (`lib/lunch-and-dinner.ts:100-101`); no em dashes in customer text; the page stays `noindex` and out of the sitemap.

### W1. No Christmas pop-up on the landing page (F1)

- Add `'/lunch-and-dinner'` to `SUPPRESSED_ROUTE_PREFIXES` in `components/features/christmas/ChristmasLightbox.tsx`, with a comment saying it is the paid-ads landing page.
- Tests: add `/lunch-and-dinner` and `/lunch-and-dinner?utm_campaign=x` rows to the suppressed cases in `components/features/christmas/__tests__/lightbox-suppression.test.ts`; keep the existing allowed cases passing (`/`, `/sunday-roast`, `/food-menu` still show it).

### W2. Match the page to the ad (F2)

The short links already send `utm_campaign` to the page. The page reads it on the server and picks a variant from a fixed allow-list; anything else gets today's page unchanged.

| `utm_campaign` | Variant | Hero image (existing file in `public/images/food/weekday-2026/`) | Hero title | Dishes shown first |
|---|---|---|---|---|
| `weekday_lunch_a_cod_and_chips` | Lunch | `beer-battered-cod-and-chips.jpg` | "Lunch, Tuesday to Friday" | Snack pots card, wraps, then the current list |
| `weekday_lunch_b_spicy_chicken_stack` | Lunch | `spicy-chicken-stack.jpg` | "Lunch, Tuesday to Friday" | as above |
| `weekday_dinner_a_pizza` | Dinner | `stone-baked-pizza.jpg` | "Dinner tonight, Tuesday to Friday" | Pizzas card, pie, then the current list |
| `weekday_dinner_b_beef_and_ale_pie` | Dinner | `beef-and-ale-pie.jpg` | "Dinner tonight, Tuesday to Friday" | Pie, pizzas card, then the current list |
| anything else, or none | Default (today's page) | `beer-battered-cod-and-chips.jpg` | unchanged | unchanged |

Rules:

- The lunch variant shows the lunch time badge first and the dinner variant the dinner badge first; both badges stay, with times read live as today (`getWeekdayServiceTimes`).
- **Snack pots card:** a new card built like the existing pizza card: "Snack pots, from £X", where X is the cheapest live item in the menu section whose name matches `/^snack pots?$/i`. If the section or its prices are missing, the card is left out (same rule as every other dish). Use a text tile (the existing no-image card), because there is no snack pot photo. Live menu check on 25 September: the Snack Pots section has three items at £9 (Chicken Goujons & Chips, Fish Fingers & Chips, Salt & Chilli Squid & Chips).
- Matching is exact and case-insensitive after trimming; the value is never echoed into the page, so it cannot inject content.
- Rendering: reading `searchParams` makes the route render on demand instead of statically (it is currently prerendered with a 5-minute refresh). That is accepted: traffic is about 1,000 visits a week, and the menu and hours fetches keep their own data-cache revalidation (`revalidate: 300` in `lib/api/client.ts:839`), so each request adds no extra management-API calls beyond today's refresh pattern. Keep `export const revalidate` out of the page, or set `dynamic = 'force-dynamic'` explicitly, so the behaviour is stated rather than inferred.
- Metadata (title, description, `noindex`, canonical `./`) does not change with the variant.

Tests (`tests/unit/lunch-and-dinner-page.test.tsx`, extend):
- Each of the four `utm_campaign` values renders its hero image, title and first dish.
- An unknown value, an empty value, a mixed-case value (`Weekday_Lunch_A_Cod_And_Chips` maps to Lunch) and no value.
- The snack pots card: shows "from £9" from fixture data; is absent when the section is missing; is absent when prices are missing.
- A pure function (for example `resolveLunchDinnerVariant(utmCampaign)` in `lib/lunch-and-dinner.ts`) with its own unit tests, so the mapping is tested without rendering.

### W3. Say people can walk in (F4, D5)

- Under the hero buttons, one line in the page's voice, with live times: "No need to book. Just come in: lunch 12pm to 3pm, dinner 4pm to 9pm, Tuesday to Friday." The lunch variant may put lunch first and the dinner variant dinner first.
- Add a third hero action, "Get directions", linking to `/find-us` (existing page). Walk-in customers need the route more than the form.
- If the hours fetch fails (`times` is null), show "No need to book, just come in." with no times rather than stale ones.
- SSOT: add a line to `docs/SSOT.md` recording the owner decision of 25 September 2026: weekday lunch and dinner take walk-ins for the whole kitchen window, Tuesday to Friday. (SSOT currently records walk-ins only for Sunday roast.)
- Tests: the line renders with live times; renders without times when hours are missing; the directions link points to `/find-us`.

### W4. Take "Book a table" straight to the form (F3)

- Give the booking form's section on `/book-table` a stable anchor, `id="booking-form"`, with a `scroll-margin-top` that clears the sticky header.
- Change `BOOKING_HREF` in `app/lunch-and-dinner/page.tsx` to `/book-table?source=lunch_dinner_lp#booking-form`. `BookTableButton` must keep carrying the UTM tags (`withCarriedAttributionParams`, `components/BookTableButton.tsx:104`); the query must come before the `#` fragment.
- Sticky bar: on `/lunch-and-dinner`, `resolveBookingCta` (`lib/booking-cta.ts`) currently opens the generic quick-book sheet, whose bookings do not carry `lunch_dinner_lp`. Make it return a link to the same `BOOKING_HREF` (with carried UTM tags) on this path, so every booking from the page carries the source.
- Tests: the hero and footer buttons' hrefs contain `source=lunch_dinner_lp`, the carried `utm_campaign`, and end in `#booking-form`; `resolveBookingCta('/lunch-and-dinner')` returns the link; `/book-table` renders an element with `id="booking-form"`; other paths' sticky behaviour is unchanged (existing tests).

### W5. Send the page source with the booking (F5, D4)

Paired with M1.

- In `ManagementTableBookingForm`, build a `page_source` object **from the current page address only** (`useSearchParams`), never from cookies, `localStorage` or `sessionStorage`, and never stored:
  - `booking_source`: the existing `bookingSource` value (the `?source=` value, capped at 80 characters, default `'direct'`)
  - `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `short_code`: from the URL if present, each trimmed and capped (80, 80, 160, 160, 32 characters). `fbclid` and `gclid` are not included.
- `buildTableBookingPayload` (`lib/table-booking/submission.ts`) adds `page_source` to the body.
- `app/api/table-bookings/route.ts` validates `page_source` leniently (unknown or oversized values are truncated or dropped, never a reason to reject the booking) and forwards it to the management app as flat optional fields (`booking_source`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `short_code`) in the existing `POST ${API_BASE_URL}/table-bookings` body.
- The consent-gated attribution object and the CheersAI forward (`forwardConfirmedTableBookingConversion`) do not change. A booking without marketing consent still sends nothing to CheersAI or Meta.
- Tests:
  - Form or payload: with `?source=lunch_dinner_lp&utm_campaign=weekday_lunch_a_cod_and_chips&short_code=jbozdk`, the payload carries those values; with no marketing consent the payload still carries `page_source` and still carries no consent-gated attribution; nothing is written to `document.cookie`, `localStorage` or `sessionStorage` (spy on the setters).
  - Server route: `page_source` fields are forwarded to the management app fetch (mocked); an oversized `utm_content` is truncated and the booking still proceeds; a malformed `page_source` (not an object) is dropped and the booking still proceeds; the CheersAI forward body is unchanged (snapshot of the existing test).

### W6. Remove the developer note (F6)

- Delete `FOOTER_NOTE` and its render from `components/WeekHours.tsx`. It shows on 5 pages (`/`, `/find-us`, `/heathrow-hotels-pub`, `/restaurants-near-heathrow`, `/lunch-and-dinner`); removing it everywhere is intended, since it is developer text copied from the redesign spec (`docs/redesign-spec.md:599`).
- Tests: `WeekHours` no longer renders "/api/business/hours" (add to `tests/unit/WeekHours.after-midnight.test.tsx` or a new test).

### W7. Website verification

Before merge: `npm run lint:next`, `npm test`, `npm run build` all pass. On the Vercel preview, on a 375 x 812 viewport, open the page directly (never through an `l.the-anchor.pub` link, which would count as an ad click) with each of the four `utm_campaign` values plus `utm_source=qa`, and confirm: the right hero and first dish; the walk-in line with times; no Christmas pop-up after 15 seconds; "Book a table" lands on the form with the form visible in the first screen; the booking request body (network panel, stopping before submit) carries `page_source`. Repeat on production after merge and record the deployment id.

---

## 5. Management app change (`OJ-AnchorManagementTools`)

### M1. Store the page source on website table bookings (D4)

One PR, branch `feat/table-booking-page-source`. No migration.

- `CreateTableBookingSchema` (`src/app/api/table-bookings/route.ts:68-139`): add optional `booking_source`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `short_code`. Each is `z.string().trim()` then **truncated** with a transform to its cap (80, 80, 80, 160, 160, 32), and empty strings become undefined. A long or odd value must never fail validation: a rejected booking is worse than a lost tag.
- Mirror the event-bookings pattern (`src/app/api/event-bookings/route.ts:88-118`): collect only the values actually sent into an `attribution` object, **after** the idempotency hash is built, and keep all six fields out of `computeTableBookingRequestHash`, so a retry with different tags does not get a 409.
- Write them into the `table_booking_created` analytics event metadata (`route.ts:762-779`) both as a nested `attribution` object and as flat keys (`booking_source`, `utm_campaign`, `utm_content`, `short_code`, ...), exactly as `src/services/event-bookings.ts:795-822` does for event bookings.
- Christmas path (`create_table_booking_christmas_v01`, `route.ts:482`): strip the six fields from the `...payload` spread into `p_request`. The function ignores unknown keys today, but the request should carry only what the function reads.
- `table_bookings.source` stays `'brand_site'`. Changing it would drop bookings from the reports' allow-list (`src/lib/analytics/table-booking-reports.ts:22-29`) and break the walk-in split (`src/lib/insights/sections/table-bookings.ts:106-108`).
- The analytics write stays non-blocking (`recordTableBookingAnalyticsSafe`, `route.ts:265-280`): if it fails, the booking still succeeds and a warning is logged. This is the correct direction for this change: the booking is the customer's write and must not fail because of measurement.
- Data: the six fields are campaign labels, not personal data. No phone, email or name is added anywhere new.
- Tests (Vitest, `tests/api/`):
  - A booking with all six fields writes them into `table_booking_created` metadata (flat and nested).
  - A booking without them behaves exactly as today (metadata unchanged).
  - An oversized `utm_content` (500 characters) is truncated to 160 and the booking succeeds.
  - Two requests with the same `Idempotency-Key` and identical booking details but different `utm_campaign` values: the second is treated as the same request, not a 409 conflict.
  - Injected failure: `recordAnalyticsEvent` throws; the booking still returns success and a warning is logged.
  - Christmas path: the six fields are absent from the `p_request` passed to the RPC.
- Commands: `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:tests`, `npm test`, `npm run build`.

---

## 6. Deploy order and safety

1. **M1 first** (management app). The website does not send the fields yet, so production behaviour is unchanged. Verify: deployment is Ready, the booking route's existing tests passed in CI, and a `select` on `analytics_events` shows the next organic `table_booking_created` row still written normally.
2. **Website second.** Zod drops unknown keys (the schema is not `.strict()`), so even if the website went first, bookings would still succeed and the fields would simply be lost until M1 deployed. Neither order can break booking.
3. **CheersAI last** (section 7), after the website is live, so the challengers' clicks land on the improved page.

No database migration in any repo. No `supabase db push` is needed or allowed for this work.

Production check after step 2, before step 3: the next real booking made from `/lunch-and-dinner` (or, only with the owner's explicit yes, one test booking by staff that is then cancelled in the management app) shows `booking_source = 'lunch_dinner_lp'` in `analytics_events.metadata`.

---

## 7. CheersAI changes (`OJ-CheersAI2.0`)

### C1. Creative enhancements opt-out in code

The 12 original ads were read back as opted out of every Meta automatic creative change (`tasks/RUNBOOK-weekday-food-campaign.md:22`), but the code never sends that setting (no `degrees_of_freedom_spec` in `src/`). A new ad could therefore be created with Meta's defaults.

- Add an optional `optOutCreativeEnhancements?: boolean` to `CreateAdCreativeParams` (`src/lib/meta/marketing.ts:87-98`). When true, `createMetaAdCreative` sends `degrees_of_freedom_spec: { creative_features_spec: { standard_enhancements: { enroll_status: 'OPT_OUT' } } }`. Default false, so existing publish behaviour does not change.
- Add `readMetaAdCreative(creativeId, token)` returning `object_story_spec` and `degrees_of_freedom_spec`, used by C2 to read back.
- Tests (`tests/lib/meta/marketing.test.ts`): the request body contains the spec when the flag is true and not when false or omitted; the read-back parses a Meta response fixture.

### C2. One-off ops script to add the four challengers

There is no safe existing path: the optimiser's apply path refuses campaigns flagged `controlled_test` (`src/app/(app)/campaigns/actions.ts:1806`) and only rewrites an existing ad; publish only creates whole campaigns. So: `scripts/ops/add-weekday-challenger-ads.ts`, run with `tsx`, following `scripts/ops/link-auth-user.ts`.

Modes: `--dry-run` (default: prints everything it would do, writes nothing), `--apply` (creates ads **paused**), `--activate` (switches on ads that passed every check), `--pause` (rollback). Each mode is idempotent: it looks for an existing challenger by name in the ad set before creating one.

For each of the four campaigns (app ids in the runbook), in order:

1. Load, with the service-role client and scoped by `account_id = '91fda684-2801-4abb-980e-f42cec017cef'`: the `meta_campaigns` row (including `source_snapshot`, `destination_url`, `campaign_kind`, `controlled_test`), its one `ad_sets` row, all its `ads` rows, the ad account token and the Facebook Page id. Stop if the campaign is not `ACTIVE` or has more than one ad set.
2. Copy: run `findRewriteCopyProblems` (`src/lib/campaigns/rewrite-copy.ts:73-102`) with the campaign name. Stop on any problem.
3. Keys: `buildCreativeVariantKey`, then `uniqueAdUtmContentKey(buildAdUtmContentKey(parts), takenKeys)`, where `takenKeys` holds **every** Weekday campaign's keys, not just this campaign's, so the new keys cannot collide across Lunch A and Lunch B (the existing clash, READOUT 3c).
4. Short link: the management-app connection config comes from `management_app_connections` (the in-app helper needs a signed-in request). Call `createManagementMetaAdsLink` (`src/lib/management-app/client.ts:376-397`) with the campaign's parent short code and one variant. Assert the response has a new `shortCode` whose `utmDestinationUrl` is `https://www.the-anchor.pub/lunch-and-dinner` with the campaign's `utm_campaign` and the new `utm_content`.
5. Save the variant into `source_snapshot.managementMetaAdVariants` (all of `utmContent, shortUrl, shortCode, destinationUrl, utmDestinationUrl, parentShortCode, alreadyExists`).
6. Insert the `ads` row: same `media_asset_id`, `creative_format` and `cta` (`BOOK_NOW`) as the campaign's three existing ads, so **copy is the only difference**; name `Evergreen Test | Walk in | Var 4`; `utm_content_key` from step 3; `status 'DRAFT'`.
7. Upload the same image (`uploadMetaImage`) and create the creative with `optOutCreativeEnhancements: true` and `linkUrl` from `resolveAdLinkUrl`. Assert the link is the new `l.the-anchor.pub/<code>`, not the campaign-level code.
8. `createMetaAd` in the existing Meta ad set with status `PAUSED`. Update the row: `meta_creative_id`, `meta_ad_id`, `status` and `meta_status` `PAUSED`.
9. Read back from Meta: the creative's link, headline, text, description and CTA equal the spec; every `creative_features_spec` entry is `OPT_OUT`; the ad has no review feedback. Print a pass or fail line per check.

`--activate` repeats step 9 and only then calls `setMetaObjectStatus(adId, 'ACTIVE')` and sets `status` and `meta_status` to `ACTIVE`. It never touches the 12 original ads, the ad sets, budgets or schedules.

The script prints no tokens or keys. It writes only: 4 short links (management app, via its API), 4 `ads` rows and 4 snapshot updates (CheersAI), and 4 creatives and ads (Meta).

**Challenger copy** (identical in the A and B campaign of each service, as with the originals; prices checked against the live management-app menu on 25 September; re-check on the day of `--apply`):

| | Lunch A and Lunch B | Dinner A and Dinner B |
|---|---|---|
| Name | Evergreen Test \| Walk in \| Var 4 | Evergreen Test \| Walk in \| Var 4 |
| Headline (limit 40) | Lunch, no booking needed, Tue to Fri (36) | Dinner tonight, just walk in, from 4pm (38) |
| Primary text (limit 300) | Just turn up. We serve lunch Tuesday to Friday, 12pm to 3pm, with snack pots at £9 and wraps at £10. Free on-site parking and dogs welcome, in Stanwell Moor. (157) | No need to book. We serve dinner 4pm to 9pm, Tuesday to Friday: stone-baked pizzas from £13 and our beef and ale pie with mash at £16. Free on-site parking and dogs welcome. (173) |
| Description (limit 25) | Walk in 12pm to 3pm (19) | Kitchen open 4pm to 9pm (23) |
| Button | Book now (as the originals) | Book now (as the originals) |

Price sources (management app `menu_dishes`, active, 25 September): snack pots £9 (all three); Chicken Goujon Wrap and Fish Finger Wrap £10; Margherita £13 (cheapest pizza); Beef & Ale Pie £16. "Tonight" is always true because dinner ads deliver only Tuesday to Friday, 14:00 to 20:00. Neither text matches the app's `WALK_IN_PATTERN` ("walk-ins welcome/available"), but both deliberately go against the app's booking-first stance ("walk-ins welcome weakens the reason to reserve", `src/lib/campaigns/optimisation.ts:1317`); testing that stance is the point of the challenger (D3).

Known effect: adding an ad to a live ad set counts as a significant edit to Meta, and on 22 September a new ad took all of Lunch A's delivery within hours. Expect the challengers to take a large share of spend at first. That is accepted (D3); budgets are lifetime and unchanged, so total spend does not rise.

Tests: the script's pure parts (building the four ad specs, the key collision check across all four campaigns, the read-back comparison) move into `src/lib/campaigns/challenger-ads.ts` with Vitest tests in `tests/lib/campaigns/challenger-ads.test.ts`, including: a key that would collide with a Lunch B key is suffixed; a read-back with any `OPT_IN` fails; a read-back whose link is the campaign-level code fails.

### C3. Readout, runbook and daily check

- `tasks/READOUT-weekday-food-queries.md`: add the four new short codes to queries 3a, 3b and 5a; note Var 4 in 4a; add query 5e: website table bookings from the landing page, from management-app `analytics_events` where `event_type = 'table_booking_created'` and `metadata->>'booking_source' = 'lunch_dinner_lp'`, joined to `table_bookings` for date, time, party size and status (cancelled and no-show excluded), by week and by `utm_campaign` and `short_code`.
- `tasks/RUNBOOK-weekday-food-campaign.md`: the Var 4 ad ids and codes in section 2; change-log rows for W, M1 and C2 with deployment ids; D1 to D6 in section 3.
- `docs/runbooks/paid-meta-ads.md`: the lesson that new ads need the creative-enhancements opt-out sent explicitly (C1); correct the stale text at `:231-236` about the rewrite path (fixed by PR #79 on 23 September).
- Scheduled tasks on the owner's Mac (`anchor-weekday-food-daily-check`, the readouts): add the four Var 4 ads and codes to their checks.

### C4. CheersAI verification

`npm run ci:verify` passes. Then `--dry-run` output reviewed; `--apply`; read-back all pass; `--activate`; readout query 4a returns 16 rows (12 originals, the paused rewrite and 4 challengers) with each challenger's own short code; the next morning's sync fills their metrics.

---

## 8. Rollback

| Part | Rollback | Effect |
|---|---|---|
| Website | Revert the PR and redeploy (or promote the previous Vercel deployment) | Page returns to today's version; bookings unaffected |
| M1 | Revert the PR | New fields are dropped again; bookings unaffected |
| Challengers | `add-weekday-challenger-ads.ts --pause` (Meta API pause, mirrored in `ads.status` and `meta_status`) | Delivery returns to the 12 originals; short links stay (harmless) |
| C1 | Revert the PR | The flag defaults to false, so nothing else depends on it |

## 9. Operations (no code)

- Staff log every walk-in on the front-of-house screen, every Tuesday to Friday, both services.
- Staff ask walk-ins "How did you hear about us?" and mark it on the tally sheet.
- Weekly readouts report walk-ins per logged day, not per week, so a missed day does not look like a drop.

## 10. How success is judged (read-outs from 29 September)

Directional, as with the rest of the test:
- Landing page bookings (query 5e) per 100 short-link clicks, before and after the website change.
- Challenger ads against the originals in each campaign: link click-through rate, cost per link click, and page-source bookings by `short_code`.
- Walk-in covers per logged day, lunch and dinner, and food takings, against the 1 to 10 September baseline.
- The owner's bar is still £1 per extra cover; the spec does not change that judgement.

## 11. Assumptions

- A1. Staff will seat walk-ins throughout both kitchen windows, Tuesday to Friday (owner, D5).
- A2. The snack pots section keeps the name "Snack Pots" in the live menu; if it is renamed, the card disappears (safe).
- A3. Reading `searchParams` makes the landing page render per request; the added cost is small at this traffic (W2).
- A4. `withCarriedAttributionParams` carries `utm_*` and `short_code` from the landing page into the `/book-table` address, as `BookTableButton` does today; W5 depends on this and its test proves it.
- A5. Recording campaign labels from the page address, without cookies or storage, is within the owner's consent decision of 10 September (owner, D4).
- A6. A new ad in each ad set may reset Meta's learning and shift delivery towards it; accepted (D3).
