# ADS brief: Weekday lunch and dinner test, The Anchor

Status: approved 10 September 2026 (test design, £500, 15 September to 16 October). All four
campaigns published through the app on 10 September and all 12 ads approved by Meta the same day;
first delivery Tuesday 15 September. Standing reference: `tasks/ADS-PLAYBOOK-the-anchor.md`. Build
steps, Meta ids and progress: `tasks/PLAN-weekday-food-campaign.md`.

---

## 1. The problem

The Anchor needs more Tuesday to Friday food trade. Lunch is 12pm to 3pm and dinner 4pm to 9pm,
Tuesday to Friday. The kitchen is closed on Mondays.

What discovery found (10 September 2026, sources in brackets):

- **Lunch is brand new.** Tuesday to Friday lunch started on 1 September 2026; before that the pub
  opened at 4pm on those days (management app `business_hours_versions`). 7 bookings in its first
  week. A launch problem: people do not know it exists.
- **Dinner has a base.** About 25 booked covers a week over the last 12 weeks, half between 6pm and
  8pm (management app `table_bookings`, 15 Jun to 6 Sep, cancelled and no-shows excluded).
- **Food takings are growing.** Tuesday to Friday food takings average about £167 a day against £81
  a year earlier (cash-up `cashup_sales_breakdowns`; this year's rows submitted, not approved).
- **No food campaign has ever run.** The August Cowboys & Queens ad that led with "Dinner 4pm" took
  173 of that campaign's 259 link clicks.
- **No food offer is live.** Pizza Tuesdays and over-65s Friday fish and chips ended 22 March 2026.

## 2. Decisions (Peter, 10 September 2026)

| Decision | Detail |
|---|---|
| Purpose | A proper test: learn which messages and which photos work, as well as sell |
| Lead message | Lunch first, dinner second |
| Target | 20 extra Tuesday to Friday covers a week |
| Offer | None. The normal menu at real prices |
| Audience | People who live or work within 5 miles, including Heathrow staff. Not travellers |
| Images | Six AI-made images supplied by Peter; four used in round one (pizza used by his choice, see section 6) |
| Budget | £500 in total: £300 lunch, £200 dinner |
| Dates | Tuesday 15 September to Friday 16 October 2026 (20 serving days) |
| Mondays | Never promote food on a Monday; no Saturday or Sunday delivery either |
| Structure | One ad set per image, three copy ads in each, built as separate campaigns (the app gives an evergreen campaign one ad set; Meta sees the same structure) |
| Route | Publish through the app (playbook decision, 9 August 2026) |
| Walk-ins | Staff tally new weekday tables by where they heard about us (printable sheet sent 10 September) |

## 3. Structure

Four evergreen (`source_type 'custom_promotion'`) campaigns, each one ad set with three ads.

| Campaign | Photo | Budget (lifetime) | Delivery |
|---|---|---|---|
| Weekday Lunch A | Beer battered cod and chips | £150 (£7.50 a serving day) | Tue to Fri, 09:00 to 14:00 |
| Weekday Lunch B | Spicy chicken stack | £150 (£7.50 a serving day) | Tue to Fri, 09:00 to 14:00 |
| Weekday Dinner A | Stone-baked pizza | £100 (£5 a serving day) | Tue to Fri, 14:00 to 20:00 |
| Weekday Dinner B | Beef and ale pie | £100 (£5 a serving day) | Tue to Fri, 14:00 to 20:00 |

Shared settings: objective Traffic, optimised for link clicks (14p a link click on traffic against
77p on sales, and no table booking has ever been attributed to a paid click); no special ad
category; 5 mile radius around the pub, people living there or recently there; ages 18 to 65+
(Meta's top band is 65 and over); no interest targeting; automatic placements; destination
https://www.the-anchor.pub/lunch-and-dinner through one tracking short link per ad; button Book now.
Delivery uses the app's delivery schedule (Meta day parting, account time Europe/London), added in
cheersai2.0 PRs #59 to #62.

Within each campaign the photo is fixed and the three ads differ only by message, so each campaign
is a message test. The same three messages run with both photos on equal budgets, so each pair of
campaigns is a photo test.

## 4. Budget and expected volume

£500: about 320,000 impressions and 3,500 link clicks at our real traffic rates (£1.56 per 1,000
impressions, 14p a link click, from three past traffic campaigns). **Assumption, unproven:** if 1 to
2 in 100 visitors come in, at about 2.5 people a table, that is roughly 17 to 35 extra covers a week.

## 5. Copy

Rules: first person plural; every headline states a concrete fact; no banned phrases; only Tuesday
to Friday named; no venue name in primary text (it also shows on Instagram). Limits: headline 40,
primary text 300, description 25; all checked. Prices and dish contents from the management app
menu on 10 September 2026; re-check on the day of the build. Each message's copy is identical in the
A and B campaign of its service.

### Lunch messages (campaigns Lunch A and Lunch B)

**1. News: we now do lunch**
- Headline: Now serving lunch, Tue to Fri, 12 to 3
- Primary text: We're now open for lunch Tuesday to Friday, 12pm to 3pm. Proper pub food in Stanwell
  Moor, from snack pots and wraps to fish and chips and burgers. Free on-site parking, and dogs are
  welcome. Book a table or come as you are.
- Description: Lunch served 12pm to 3pm

**2. Value: lunch from £9**
- Headline: Lunch from £9, Tuesday to Friday
- Primary text: Lunch break sorted. Snack pots are £9, a wrap with chips is £10 and burgers start at
  £11, served Tuesday to Friday from 12pm to 3pm. Free on-site parking makes it easy to pop over.
  Your local in Stanwell Moor.
- Description: Snack pots £9, wraps £10

**3. Proper pub food**
- Headline: Proper pub lunch, Tue to Fri, 12 to 3
- Primary text: Beer battered cod and chips, our beef and ale pie with mash, or a spicy chicken stack:
  proper pub food, served at lunch Tuesday to Friday, 12pm to 3pm. A proper village pub with free
  on-site parking, and dogs are welcome.
- Description: Mains from £12

### Dinner messages (campaigns Dinner A and Dinner B)

**1. No cooking tonight**
- Headline: No cooking tonight: dinner 4pm to 9pm
- Primary text: Give the kitchen the night off. We serve dinner from 4pm to 9pm, Tuesday to Friday:
  stone-baked pizzas from £13, burgers from £11 and proper pies, with kids' meals from £7. Free
  parking and dogs welcome. Book a table for tonight.
- Description: Kids' meals from £7

**2. Bring your mates**
- Headline: Midweek dinner and a pint, from 4pm
- Primary text: Bring your mates for a midweek dinner. Stone-baked pizzas from £13, bangers and mash
  at £14 or a beef and ale pie at £16, with a pint at your local in Stanwell Moor. We serve 4pm to
  9pm, Tuesday to Friday. Book a table for tonight.
- Description: Pizzas from £13

**3. Proper pub food**
- Headline: Proper pub dinner from 4pm, Tue to Fri
- Primary text: Midweek comfort food, done properly. Our beef and ale pie with mash and gravy is £16,
  beer battered cod and chips £16, and Cumberland sausages and mash £14. Served 4pm to 9pm, Tuesday
  to Friday, with free on-site parking in Stanwell Moor. Book a table for tonight.
- Description: Pies from £15

Button: Book now (sent as `BOOK_TRAVEL`, which Meta shows as "Book now"). For evergreen campaigns the
AI picks the button and the review screen cannot change it, so the brief text asks for Book now; if
the AI picks anything else, regenerate.

## 6. Creative

- AI-made images supplied by Peter (ChatGPT, 1254 x 1254), each checked against the dish's menu
  description. Cod and chips, spicy chicken stack and beef and ale pie match the menu (the pie adds
  crispy onions the menu does not list; minor). The pizza shows mushrooms, rocket and cherry
  tomatoes, which no pizza on the menu has; flagged, and Peter chose to use it, so its label names
  no pizza ("Stone-baked pizzas from £13"). The wrap and bangers images are kept for round two.
- Each ad image is 1080 x 1080 with a green and gold label (dish, price, service times) and the
  white Anchor logo bottom right. CheersAI library assets (10 September): cod and chips
  `5a6cd1a9`, spicy chicken stack `3ec300f8`, pizza `d9e02820`, pie `b837b99d`.

## 7. Measurement

**Baseline:** Tuesday 1 to Friday 11 September 2026, the two weeks since lunch launched.

**Per ad (the test):** link click-through rate and cost per link click, compared within each
campaign (messages) and across each pair (photos). Bookings carrying each ad's tracking tag are
counted but are too few to rank ads on.

**Business result:** Tuesday to Friday booked covers (lunch and dinner separately, excluding
cancelled and no-shows), staff-logged walk-ins, the staff tally sheet, and Tuesday to Friday food
takings from the cash-up, against the baseline. Also landing page visits tagged
`utm_medium=paid_social` in Google Analytics; Meta counts consenting visitors only (Tag Manager
consent fix, version 8), so its own numbers understate.

**Readouts:** Mondays 21 September, 28 September, 5 October and 12 October; final review Monday 19
October with the winning message and photo per service and a proposal for round two.

**Mid-test rule, Monday 28 September:** in each campaign, recommend pausing any message whose link
click-through rate is below 70% of the best message in that campaign, once each has at least 4,000
impressions. Live changes only on Peter's yes.

**Known limits:** lunch will also grow on its own; ad-attributed table bookings may stay at zero even
if the ads work.

## 8. Guardrails

- No delivery on Monday, Saturday or Sunday; no copy naming any other day.
- Do not use the app's "approve copy rewrite" feature during the flight: it adds a live ad with no
  tracking tag while the old one keeps running.
- Each campaign's review screen is compared with the approved page before Save & Publish (which makes
  it live at once); the ad sets start on 15 September and deliver only in their hours.
