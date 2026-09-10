# Runbook: Paid Meta ads

**Last updated:** 2026-09-10 (after the weekday food campaign)
**Applies to:** every paid Facebook and Instagram campaign for The Anchor
**Read with:** `tasks/ADS-PLAYBOOK-the-anchor.md` (account facts, benchmarks, copy rules, brief
template). Each campaign also gets its own `tasks/RUNBOOK-<slug>.md`, which wins for that campaign.

This is how we take a paid campaign from idea to final review, and everything we learned doing it
the hard way. Follow it in order. Each section says why a step exists, so nobody re-learns it.

## 1. Ground rules

- **Publish through the CheersAI app, never by hand in Ads Manager.** Otherwise the dashboard, the
  daily performance sync and the optimiser cannot see the campaign. The only exceptions are
  settings the app cannot change after publishing (section 9).
- **Nothing goes live without Peter's explicit yes.** Save & Publish builds everything paused and
  then switches it live at once. There is no "save as paused" button.
- **Peter decides; Claude builds, checks and reports.** Put open questions in chat, numbered, each
  with a recommendation. Show everything that needs approval on one page, once.
- **Facts come from sources, never memory.** Prices, dishes and hours come from the management app;
  venue facts from `docs/SSOT.md` in the website repo. Re-check on the day of the build.
- **Never open the ads' tracking links** (`l.the-anchor.pub/<code>`). Every visit logs a click and
  pollutes the results: the four set-up clicks of 10 September 2026 are still in the data.
  Check links in the database instead (section 10).
- **Never submit a test booking.** It creates a real booking and a real SMS.
- **Browser tests** use made-up `qa_` tags, a fresh browser, and Google, Meta, Clarity and
  LinkedIn blocked, so no test visit reaches anyone's analytics.
- Live database writes, live Meta changes, deploys and pauses each need a yes, except the narrow
  emergency pause Peter pre-authorises for a campaign (section 11).

## 2. The flow

1. Discovery (section 3)
2. Up to five questions for Peter, each with a recommendation
3. Brief: `tasks/ADS-<slug>.md` (section 4)
4. Creative (section 5)
5. Approval page, approved in one go (section 6)
6. Prerequisites on the website, tracking and ad account (section 7)
7. Build in the app and publish (section 8)
8. Read back from Meta and run the pre-launch checks (section 10)
9. For bigger spends, an independent review (section 12)
10. Daily check, weekly readouts, final review and round two (section 11)

## 3. Discovery

Pull the numbers before proposing anything. Read-only SQL through the Supabase MCP.

| What | Where |
|---|---|
| Covers by service | Management app `tfcasgxopxegwrabvwat`, `table_bookings`: `party_size`, `booking_date`, `booking_time` (London local values), `status` (exclude `cancelled`, `no_show`), `booking_purpose` (`food` or `drinks`), `source` (`brand_site`, `admin`, `walk-in`) |
| Opening and kitchen hours | `business_hours` joined to `business_hours_versions` (effective-dated, `status = 'published'`), plus `special_hours` for dated overrides |
| Food takings | `cashup_sessions` and `cashup_sales_breakdowns` where `sales_category = 'food_sales'`; count submitted, approved and locked sessions (every 2026 session is "submitted") |
| Prices and dishes | `menu_dishes_with_costs` (`menu_code` `website_food`, `kids`) |
| Past ad performance | CheersAI `nbkjciurhvkfpcpatbnt`: `meta_campaigns`, `ad_sets`, `ads` (`metrics_*`), `ad_metrics_history` |
| Tagged bookings | CheersAI `booking_conversion_events`; party size and date come from the management app by `booking_id` = `booking_reference` |

Count carefully:
- **Food covers are not all tables.** On 10 September 2026 the brief said dinner averaged "about 25
  booked covers a week"; it was 21 food covers (14 booked ahead, 7 walk-ins). The 25 included drinks
  tables. State exactly what you counted.
- **Walk-ins are logged by staff and incomplete.** Treat them as a floor; use food takings as the
  cross-check.
- Services by booking time: lunch 12:00 to 14:59, dinner 16:00 to 20:59 (as of September 2026).

## 4. The brief

Use the playbook's template and return `tasks/ADS-<slug>.md` with: the problem and its sources,
Peter's decisions, structure, budget and forecast, full copy, creative, measurement, guardrails.

**Objective.** Traffic, optimised for link clicks, unless attribution has been proven. Past traffic
campaigns cost about 14p a link click against 77p on sales campaigns, and no table booking has ever
been attributed to a paid click. Objective and attribution window cannot be changed once an ad set
exists; getting them wrong means rebuilding.

**Structure for a test.** One campaign per image (the app gives an evergreen campaign one ad set),
three copy ads in each, the same messages in each campaign of a pair. It is not a randomised split:
the campaigns share one audience and Meta shifts delivery to early leaders. Report results as
directional, with click counts. Do not pause ads "for learning" at small budgets (the old 70% rule
was dropped). A causal answer needs Meta's A/B test tool, which the app does not support.

**Delivery hours.** Use the app's delivery schedule (Meta day parting): lifetime budget only,
whole hours, advertiser time (Europe/London), never with campaign budget optimisation. Deliver in
the hours before and during service; for weekday food that was lunch 09:00 to 14:00 and dinner
14:00 to 20:00, Tuesday to Friday. Evergreen campaigns run at most 45 days.

**Audience.** A 5 mile radius around the pub. Location types `home` and `frequently_in` (people who
live or regularly are there); leave out `recent`, which adds people only passing through
(about 16% more people in September 2026, Heathrow travellers among them). Minimum age 18, always
if the copy mentions alcohol. Advantage+ audience can stay on: with a fixed radius, a minimum age and
no interests it has nothing to widen.

**Placements.** Facebook, Instagram and Messenger. Exclude Audience Network: third-party apps bring
accidental clicks that inflate click rates. A square image works in every placement when Meta's
automatic creative changes are off (checked on Meta's own previews for 12 placements); Instagram
Explore will not run a square image, which is harmless.

**Budget and forecast.** Give low, central and high cases, not one number. For £500 in September
2026: 25p, 14p and 10p a link click; 0.5%, 1% and 2% of visitors booking; 2.5 people a table; so
about £20, £5.60 and £2 per extra cover. Peter's bar is **£1 per extra cover**, because he can buy
covers from other suppliers at that price; say plainly when a campaign cannot reach it.

**Copy.** Limits: headline 40, primary text 300 (Meta shows about the first 125 before "more"),
description 25. Every headline states a concrete fact. First person plural. Only name the days the
ads promise. No venue name in the primary text. The playbook's banned phrases are enforced only in
organic copy, not ad generation, so check ad copy by hand.

**Measurement.** Fix a baseline period before launch. Primary: extra covers against the baseline
and cost per extra cover. Secondary: link click-through rate and cost per link click. Guardrails:
food takings, cancellations, no-shows, frequency, complaints, kitchen capacity. Write down the
attribution rule (section 11) and the stop rule before the first penny is spent.

## 5. Creative

- Peter supplies the images. AI images are fine if they show what we actually serve.
- **Check every image against the dish's menu description**: toppings, sides, garnish. ASA guidance
  says food pictures must show what customers will get, and naming no dish in the label does not
  fix a wrong picture. **Menu descriptions can lag the kitchen:** ask Peter before calling an image
  wrong, then get the menu description updated so the ad, the menu and the website agree
  (10 September 2026: the pizza with mushrooms, rocket and cherry tomatoes is sold but was not on
  the menu).
- Each ad image: 1080 x 1080, a label with the dish, the price and the service times, and the white
  Anchor logo bottom right.
- **Less healthy food rules (since 5 January 2026):** paid online ads for identifiable less healthy
  food are banned unless the advertiser is a small business (fewer than 250 employees). The Anchor's
  business has 10 employees (Peter, 10 September 2026), so it is exempt. Re-confirm if that changes.
- **Alcohol in the copy** brings CAP Code section 18 in: minimum age 18 as a hard limit, food as the
  subject, moderate wording, nothing appealing to under-18s, nobody under 25 pictured. Record the
  check in the campaign runbook.
- **Uploading to the CheersAI library:** wait until the grid's dates show as dd/mm/yyyy, then upload
  one file per page load. Earlier, a date mismatch between server and browser re-rendered the grid
  and silently dropped files (fix in cheersai2.0 PR #64, open for review on 10 September 2026).

## 6. The approval page

Publish one private artifact that shows everything Peter is approving: each campaign's settings,
every ad as it will appear with the final image, the test logic, the budget and the measurement.
He approves it in one go. It then stays as the historical record; never edit it after approval.
Record later changes in the campaign runbook instead.

Useful standing instruction from Peter: "compare each review screen with the approved page; if it
matches, publish without asking again". Only use it when he has said it for that campaign.

## 7. Prerequisites

**Landing page** (website repo):
- A dedicated page, `noindex` and out of the sitemap, with live prices and hours from the
  management app and Book buttons in the first screen, on a bar that appears on scroll, and at the
  end, plus the phone number.
- No pop-up over a Book button on a phone. The event countdown card is hidden per page through
  `HIDDEN_PATH_PREFIXES` in `components/EventCountdownBanner.tsx`; add the landing page there.
- Check it at phone size before launch (section 10).

**Tracking:**
- The app creates one short link per ad, with `utm_source=facebook`, `utm_medium=paid_social`, a
  `utm_campaign` per campaign and a `utm_content` per ad. It also creates one link per campaign,
  which no ad uses (so 16 links exist for 12 ads). Two messages can share a `utm_content` between
  paired campaigns: key results on the Meta ad id or the short code.
- **Tag Manager consent:** tags that wait for consent and also fire on the consent-update event must
  use "Once per event", never "Once per page", or visitors who accept on the page are never tracked.
- **The site's own attribution waits for consent** (the-anchor.pub #169): without marketing consent
  nothing is stored and bookings carry no ad tags. The Book a table button carries the tags in the
  booking URL so accepting on the booking page still counts (#172, open for Peter's yes on
  10 September 2026). Tagged bookings are a floor.
- Bookings flow to CheersAI `booking_conversion_events` and, with consent, to Meta's Conversions
  API. Meta still reports zero conversions on every campaign, and most table bookings reached Meta
  at £0 in 2026 (under investigation). Never claim attribution works end to end.

**Ad account:**
- The **account spending limit** must sit above everything that will run, not equal the test
  budget. On 10 September 2026 it was exactly £500 for a £500 test, so any other ad would have
  stopped the test early.
- Card on file, account status active, no other campaign that could spend.
- **Meta data access** for the app's connection expires 90 days after the last login (check
  `debug_token` `data_access_expires_at`). Reconnect Meta Ads in CheersAI before it lapses; the ads
  keep running, but the sync and the readouts stop.

**App:** the delivery schedule column and code are live (cheersai2.0 #59 to #63, migration
`20260910103048_meta_campaigns_delivery_schedule`).

## 8. Build and publish in the app

In Peter's signed-in Chrome, at `cheers.orangejelly.co.uk/campaigns/new`. Never type a password; if
the session has expired, stop and ask Peter to sign in.

1. Choose **Evergreen**. The first click after the page loads is sometimes lost; click again.
2. Set radius, audience mode (local only), **Total** budget, start and end dates, and delivery days
   and hours. A delivery schedule forces a Total budget.
3. Generate, then read the **Campaign checks** panel: dates, radius, audience, the delivery
   sentence ("Tuesday to Friday, 14:00 to 20:00, UK time (20 delivery days...)"), the paid link,
   and "All ads have images".
4. Set the campaign name, and the image for all variations.
5. Replace the AI's copy on every ad with the approved copy: click the field, select all, type.
   Then zoom in and read each field back; edits have not always stuck.
6. Check every ad's button reads "Book Now". The app sends it to Meta as `BOOK_TRAVEL`, which Meta
   shows as "Book now".
7. Compare everything with the approval page. Only then press **Save & Publish**. The app builds the
   campaign paused, reads the delivery schedule back from Meta, rolls back on any mismatch, and
   otherwise switches it live.
8. Check the campaign page: Active, the budget, the dates, the radius, and the number of ads.

Known quirks: renaming an ad set does not persist (cosmetic); ad names and `utm_content` carry the
AI's angle labels (for example "Performer or theme" on a lunch ad), so read results by the Var
number, which is the same message in each campaign of a pair.

## 9. Changing a campaign after publishing

- The app cannot change targeting, placements or dates after publishing. With Peter's yes, change
  the ad set through the Graph API: send the **whole** targeting object with only the intended
  change, then read it back and check that budget, dates, schedule, radius and ages are unchanged.
  Dry-run first.
- **Then mirror the change in CheersAI**, or the app drifts: `meta_campaigns.start_date` (the daily
  sync asks Meta for figures from this date, so a wrong one silently drops days),
  `ad_sets.phase_start`, `ad_sets.targeting`, `ad_sets.placements`.
- Any edit sends the ads back to Meta's review. In September 2026 approval took 10 to 35 minutes;
  plan edits well before the first delivery.
- Never use the app's "approve replacement" copy suggestions during a flight: approving one adds a
  new live ad without a tracking tag while the old one keeps running.
- Pause and resume through the app. Changing the objective or optimisation goal means a rebuild.

## 10. Read back and pre-launch checks

All read-only. The Meta access token is `meta_ad_accounts.access_token` (read it with the service
role key from the repo's `.env.local`); use GET requests only and never print the token.

1. **Read every setting back from Meta:** campaign status, objective, special ad categories; ad set
   `lifetime_budget`, `start_time`, `end_time`, `pacing_type`, `adset_schedule`,
   `targeting{geo_locations,age_min,age_max,publisher_platforms,targeting_automation}`; each ad's
   `effective_status`, `ad_review_feedback` and `creative{object_story_spec,degrees_of_freedom_spec}`.
   All of `degrees_of_freedom_spec.creative_features_spec` should be `OPT_OUT`, so Meta cannot
   rewrite the copy or edit the images.
2. **Meta review:** every ad `ACTIVE` with no review feedback.
3. **Links:** in the management app's `short_links`, every code exists, points to the landing page,
   and has no `expires_at` before the end of the flight.
4. **Account:** `account_status` 1, `spend_cap` minus `amount_spent` (both in pence) above what will
   run, and no other campaign that could spend.
5. **Audience size:** `GET act_<id>/delivery_estimate` with a targeting spec of only the location
   (latitude, longitude, radius, unit, location types) and ages. The ad set's full targeting object
   returns "Invalid parameter".
6. **Placements:** `GET <ad_id>/previews?ad_format=<format>` returns an iframe; render it in a
   throwaway browser (decline Facebook's optional cookies there) for feed, Stories, Reels,
   Marketplace, right column, Messenger and Audience Network formats.
7. **Public hours:** the Facebook Page's `hours` against the management app; Peter checks Google
   Business Profile. On 10 September 2026 the Page still said 4pm opening while the ads sold lunch.
8. **Landing page on a phone:** the pop-up is gone; hit-test only the visible Book button (a hidden
   duplicate of zero size gave a false alarm); the bar that appears on scroll opens the quick booking
   panel; no choice and reject store nothing, accept saves, withdraw deletes.
9. **Booking system:** `/api/table-bookings/availability?date=<day>&party_size=2&purpose=food` for an
   ad day and an excluded day: `kitchen_open` and `bookable_purpose` must match what the ads promise.
10. **Claims:** every price, dish and time in the copy and on the images against
    `menu_dishes_with_costs` and the hours.
11. **Organic posts:** nothing scheduled in CheersAI that promotes food on a day the kitchen is shut.
12. **Automation:** no cron can change the campaign (September 2026: the optimiser only writes
    suggestions and the food materialiser is off in production).

## 11. Running the campaign

**Daily check** (a scheduled Claude task, Tuesday to Friday 08:30, before the first delivery):
ads and ad sets active and approved, spend against plan, spending limit, other campaigns, the
landing page, today's booking times, menu prices against every ad claim, and special hours. It
stays quiet when all is well and alerts Peter otherwise. The weekday food version, with its script,
is scheduled task `anchor-weekday-food-daily-check`; copy it and change the ids and claims. Press
"Run now" once when creating one, and approve the tools it asks for, or its first real run stalls.

**Emergency pause**, only if Peter pre-authorises it for the campaign: pause, never edit, resume,
delete or change budgets, and only when the kitchen is closed, an advertised dish is off or its
price has risen above the ad, the landing page or booking system is broken, or Meta restricts the
account. Restarting needs Peter's yes.

**Weekly readouts** (one-time scheduled tasks, Mondays 09:00, after the 07:00 sync): per-ad
impressions, reach, link clicks, link click-through rate, cost per link click and spend, with the
click counts behind every rate; messages and photos compared with a plain word on how strong the
signal is; reach and frequency; covers against the baseline; tagged bookings; food takings; cost per
extra cover against Peter's bar; and the staff tally photo. Queries to copy:
`tasks/READOUT-weekday-food-queries.md`.

Metric rules:
- Link clicks are Meta's `inline_link_clicks` (`ads.metrics_clicks`). Never use `clicks`, which
  counts likes and profile taps, and never the stored `metrics_ctr` or `metrics_cpc`, which are
  based on all clicks.
- Meta's own figures, short-link clicks, Google Analytics visits and tagged bookings measure
  different things. Report them side by side, never added together.
- Tagged bookings: the latest tagged visit in the same browser within 90 days, and only with
  marketing consent. Count by the date the booking was made; report late responses (up to a week
  after the flight) separately.

**Staff tally:** a printed sheet by the till. For each new table, staff write L or D and the number
of people (for example L2 or D4) under how the guests heard of the pub, with "Don't know" and "Not
asked today" options. A photo goes to Peter each Monday.

**Final review:** best message and photo per service (directional), the business result against the
baseline, cost per extra cover against the bar, and options for round two with a recommendation.

## 12. Independent review

For a material spend, publish a private brief for an outside reviewer: what to review, the settings
as live on Meta, a source for every claim, tracking, the checks already done, known risks, and a
link to the approval page. When the review comes back, verify every finding against the live
systems before accepting it, fix what is real, push back with evidence where it is wrong, record
each decision in the campaign runbook, and add a "what changed after the review" section to the
brief.

## 13. Lessons log

| Date (2026) | Lesson | Where it was fixed |
|---|---|---|
| 9 Aug | Conversion optimisation cost 77p a link click against 14p on traffic; objective cannot change after an ad set exists | Playbook; event ads back on traffic |
| 10 Sep | "Once per page" on consent-gated Tag Manager tags never fires after same-page consent | GTM version 8 |
| 10 Sep | The app could not keep ads off Mondays | cheersai2.0 #59 to #62 (delivery schedule) |
| 10 Sep | Evergreen campaigns were capped at 30 days | cheersai2.0 #63 (45 days) |
| 10 Sep | Library uploads vanished when the grid re-rendered | cheersai2.0 #64 (open) |
| 10 Sep | The event pop-up covered the landing page's Book button on phones | the-anchor.pub #165 |
| 10 Sep | The site stored ad clicks before consent | the-anchor.pub #169 |
| 10 Sep | Accepting on the booking page lost the ad tags after a full page load | the-anchor.pub #172 (open) |
| 10 Sep | Most table bookings reached Meta at £0 | Under investigation |
| 10 Sep | The account spending limit equalled the test budget | Check before every launch (section 7) |
| 10 Sep | The Facebook Page still showed 4pm opening while the ads sold lunch | Check before every launch (section 10) |
| 10 Sep | A dinner baseline counted drinks tables as covers | Section 3 |
| 10 Sep | Menu descriptions lag what the kitchen serves | Section 5 |
| 10 Sep | Changing a campaign's start date on Meta without changing it in CheersAI would have dropped a day from the sync | Section 9 |
