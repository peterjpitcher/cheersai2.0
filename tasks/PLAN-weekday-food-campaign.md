# PLAN: Weekday lunch and dinner campaign, The Anchor

Status: approved 10 September 2026; test design, £500 and 15 September to 16 October approved the
same day (brief, sections 2 and 3). All four campaigns published 10 September; first delivery
Tuesday 15 September; nothing spent yet.

**Progress, 10 September 2026**
- A done: cheersai2.0 #59 to #62 merged and live (last deploy of main `90cacfd0`). Migration
  `20260910103048_meta_campaigns_delivery_schedule` applied to production as history version
  `20260910113202` (SHA-256 `82d2dcde...`), verified, rollback ready. #60 gained a fix so a Meta
  read-back without `timezone_type` no longer blocks publishing. #63 raises the evergreen cap from
  30 to 45 days (the flight is 32 days).
- B done: Tag Manager version 8 (Peter published); verified in fresh browsers on all three paths.
- C done: the-anchor.pub #155, #157, #158, #159 (with the owner's pizza card) and #161 merged and
  live (main `0aa80c31`); 25 of 25 live page checks passed. The site now deploys automatically on
  merge to main.
- D done: four ad images uploaded to the CheersAI library (cod `5a6cd1a9`, stack `3ec300f8`, pizza
  `d9e02820`, pie `b837b99d`).
- E published: each review screen matched the approved page before publishing, and Meta approved
  all 12 ads on 10 September (the last at 13:40). Read back from Meta the same day: every ad set is lifetime, day-parted Tue to Fri (lunch 09:00 to 14:00,
  dinner 14:00 to 20:00, advertiser time), 15 September 00:00 to 17 October 00:00 UK time, 5 mile
  radius, ages 18 to 65+, traffic optimised for link clicks. Buttons are stored as `BOOK_TRAVEL`,
  which is how the app sends "Book now" (`src/lib/meta/marketing.ts`).

  | Campaign | App id | Meta campaign | Meta ad set | Budget |
  |---|---|---|---|---|
  | Weekday Lunch A (cod and chips) | `f80e55db` | `120246019241610609` | `120246019242330609` | £150 |
  | Weekday Lunch B (spicy chicken stack) | `52bd9d01` | `120246019309520609` | `120246019310340609` | £150 |
  | Weekday Dinner A (pizza) | `ed08ddeb` | `120246019370140609` | `120246019370370609` | £100 |
  | Weekday Dinner B (beef and ale pie) | `86400ca6` | `120246019422320609` | `120246019422650609` | £100 |

  Each ad has its own tracking link to `/lunch-and-dinner`; `utm_campaign` names the campaign and
  `utm_content` names the ad. Read results by Var number, which is the same message in both
  campaigns of a pair (lunch: Var 1 "Now serving lunch", Var 2 "Lunch from £9", Var 3 "Proper pub
  lunch"; dinner: Var 1 "No cooking tonight", Var 2 "Midweek dinner and a pint", Var 3 "Proper pub
  dinner"). The app's angle labels in ad names and `utm_content` are AI leftovers (Lunch B Var 3
  says "Performer or theme"); ignore them.
Brief: `tasks/ADS-weekday-food.md`. Standing reference: `tasks/ADS-PLAYBOOK-the-anchor.md`.

---

## Summary

Five workstreams. A to D must be finished before the ads start, targeted for Tuesday 15 September
2026.

| # | Workstream | Where | Why | Who |
|---|---|---|---|---|
| A | Delivery schedule (no Mondays) | CheersAI app: 4 PRs, 1 additive migration | The app cannot keep ads off Mondays today | Claude |
| B | Cookie consent fix | Google Tag Manager `GTM-WWFQTQS` | Meta's pixel fires before visitors accept cookies (seen 10 Sep) | Peter approves; Claude or Peter publishes |
| C | Website fixes and landing page | the-anchor.pub: 5 PRs, 1 manual production deploy | Wrong prices and hours on pages the ads lead to; no landing page | Claude |
| D | Creative | Photos to six square ads | New images, none of the existing ones | Peter (photos), Claude (design) |
| E | Build, launch, measure | CheersAI app in Peter's signed-in Chrome | Publish through the app so the dashboard and sync see it | Claude, publish on Peter's yes |

## Timeline

| Date (2026) | Step |
|---|---|
| Thu 10 Sep | Brief and plan approved; images supplied; ad designs made; A and C build started |
| Thu 10 to Fri 11 Sep | A and C reviewed and merged; migration applied; website deployed; B published |
| Fri 11 to Sat 12 Sep | Both campaigns built in the app; published on Peter's yes (Meta review has the weekend) |
| Mon 14 Sep | Final checks: all six ads approved, ad sets show Scheduled (no delivery on Mondays) |
| Tue 15 Sep, 09:00 | First lunch delivery |
| Mon 21 Sep, Mon 28 Sep, Mon 5 Oct, Mon 12 Oct | Weekly readouts; 28 Sep is the mid-test check |
| Fri 16 Oct | Last delivery (20 serving days; end date moved by Peter on 10 Sep) |
| Mon 19 Oct | Final review and proposal for a second round |

**Slip rule:** if A or C is not live in time to publish by Monday 14 September, the flight starts on
the next Tuesday and still runs 16 serving days. The Monday rule holds either way.

---

## A. App: delivery schedule

Complexity 4 (7+ files, the Meta integration, a new column), so it ships as four PRs, migration
first. Each PR is deployable on its own and changes nothing until a campaign carries a schedule.

**Meta rules** (Graph v24.0, the code default in `src/env.ts`; official docs checked 10 September):
`pacing_type: ["day_parting"]`; `adset_schedule` entries of `start_minute`, `end_minute`, `days`,
`timezone_type`; days run 0 to 6 with 0 as Sunday; whole hours only; lifetime budgets only, with an
end time. Evergreen does not use campaign budget optimisation, so the schedule sits on the ad set.

**Our two ad sets:** lunch `days [2,3,4,5]`, minutes 540 to 840 (09:00 to 14:00); dinner
`days [2,3,4,5]`, minutes 840 to 1200 (14:00 to 20:00); `timezone_type ADVERTISER`, because the ad
account runs on Europe/London.

- [ ] **A0 Spec:** `tasks/SPEC-evergreen-delivery-schedule.md` (what, why, rollback, deploy order).
- [ ] **A1 Migration:** add `meta_campaigns.delivery_schedule jsonb`, nullable, object-only check.
  Null means today's behaviour. Additive, no dependent views. Applied to production before A2 merges.
- [ ] **A2 Backend:** new `src/lib/campaigns/delivery-schedule.ts` (validate, map to Meta, describe
  in words). `marketing.ts` sends the schedule and refuses before sending if it comes with a daily
  budget, no lifetime budget, or campaign budget optimisation. Save writes the column; publish passes
  it, reads `pacing_type` and `adset_schedule` back from Meta before switching live, and rolls back
  to draft on a mismatch. Publish also refuses if the ad account is not on Europe/London. Tests with
  Meta mocked, including a flight that crosses the 25 October clock change.
- [ ] **A3 Copy:** the AI prompt is told the delivery days. A new `off_schedule_day` check flags
  Monday, weekend, "every day" and "daily", both in generation and on save, because hand-edited
  copy skips every check today.
- [ ] **A4 UI:** evergreen only, off by default: "Only deliver on chosen days and hours", seven day
  boxes, start and end hour. Turning it on forces a Total budget. Shown on the review screen.
- [ ] **Docs:** correct the ads playbook: publish goes live straight away (it says paused), the
  wizard's campaign kinds, the available buttons (no "See menu").

Every PR passes `npm run ci:verify` and `npm run test:utc`. Merging to main deploys to production;
the deployment id is recorded for each.

**Rollback:** A3 and A4 revert cleanly. Revert A4 before A2, and only when no draft campaign holds a
schedule. A campaign already on Meta keeps its schedule there and can be paused from the app. The
column stays; dropping it needs Peter's yes.

## B. Cookie consent fix (Google Tag Manager)

Found 10 September: in a fresh browser, with the cookie banner showing and nothing clicked, the site
sent Meta's PageView (pixel `757659911002159`) and set the `_fbp` cookie. LinkedIn's tag fired too.
The pixel is a Custom HTML tag that fires on every page with no consent requirement; the site's
"denied" consent defaults only govern Google's own tags. That breaks what the banner promises.

Status 10 September: Claude was blocked from editing live Tag Manager by the automatic safety
check; Peter made the change and published container version 7. Fresh-browser tests after
publishing: nothing fires before consent (pass); returning visitors with consent are tracked
(pass); a visitor who accepts on the page is NOT tracked (fail), because "Once per page" spends
the tag's allowance on the consent-blocked page-load attempt. Proven fix, tested against a locally
rewritten copy of the container: set both tags to "Once per event". Peter republished as
version 8 the same day. Re-verified in fresh browsers: nothing before consent; Meta and LinkedIn
fire straight after "Accept all" (`_fbp`, `bcookie`, `li_gc`, `lidc` set only then); returning
visitors tracked on load. Workstream B done.
Re-verified the same day in a fresh browser: before consent, Meta's script loads and sets `_fbp`;
LinkedIn's script loads and sets `bcookie`, `li_gc` and `lidc`. Clarity sends data before consent
but sets no cookie until consent (out of scope here).

- [ ] Require `ad_storage` consent on the Meta Pixel and LinkedIn tags.
- [ ] Add a trigger on the `cookie_consent_update` event where `consent_marketing` is true, so a
  visitor who accepts on the landing page is still counted. Tag firing option "Once per event"
  (not "Once per page", see status above).
- [ ] Publish the container, then repeat the fresh-browser check: no `facebook.com/tr` request
  before consent, one after accepting.

Effect: Meta will count consenting visitors only, so traffic is also judged on Google Analytics
visits tagged `utm_medium=paid_social` (brief, section 8).

Parked until after launch: the site's own attribution storage is also written before consent.
Check the privacy policy first, because gating it loses booking attribution.

## C. Website (OJ-The-Anchor.pub)

Plans are against origin/main `ae37b618`. **Deploy from a clean checkout of main:** the local
folder is 3 commits behind and holds another session's uncommitted edits, and `vercel deploy`
uploads the folder as it is.

- [ ] **C1 Menu price labels:** "Pizzas from £10" stops counting garlic bread (becomes from £13,
  also on /pizza-menu); "Food £5 to £16" becomes "Mains £11 to £16"; "Mains from 16." gets its £;
  the /book-table description loses "Food from 1."; /pizza-menu's "from 10." is fixed. Unit test
  through the real `buildMenuPageData`.
- [ ] **C2 Booking time grid:** the Lunch and Evening headings split at the start of the day's second
  kitchen sitting (4pm Tuesday to Friday) instead of a fixed 5pm, with a 4pm fallback on single
  sitting days (so Monday's 4pm drinks times stop showing under Lunch). The management app has no
  such grouping and needs no change; the PR says so.
- [ ] **C3 Hours in page copy:** /heathrow-hotels-pub, /pubs-in-stanwell,
  /blog/things-to-do-near-heathrow-between-flights, `public/llms.txt` (also group deposit 15, not
  10), /live-sport/world-cup, /ashford-pub, /feltham-pub, and "All-Day" food headings on seven
  pages. Point to the live hours block rather than typing hours.
- [ ] **C4 Landing page `/lunch-and-dinner`:** copies the /pizza-menu pattern, refreshed hourly.
  Live hours; six dishes with live prices matched by name (a card is left out if its dish is
  missing; if the menu service fails the page shows the unavailable message and phone number);
  Book button to `/book-table?source=lunch_dinner_lp`; noindex and left out of the sitemap, so it
  does not compete with /food-menu. Nothing typed that the management app already knows.
  Owner decision 10 September: the pizza card uses his pizza image and becomes a generic
  "Stone-baked pizzas, from £X" card (lowest live pizza price, garlic bread excluded), never a
  named pizza, because the image's toppings match no single pizza. Applied on the C4 branch after
  the build agent finishes.
- [ ] **C5 Images:** the new photos on the landing page, and a new /food-menu share image and hero
  (the current hero shows a lamb shank that is not on the menu). New filenames only, because
  Cloudflare caches images for a year. Follows the photos; C5 does not block launch.
- [ ] **Deploy:** merges to main now deploy production automatically (verified 10 September from
  GitHub deployments by vercel[bot]; the old "manual deploy only" note was stale). C1 (#155), C2
  (#157), C3 (#158) and C5 (#161) merged 10 September; C4 (#159) merges when its re-run checks
  pass (it gained the owner's pizza card). Read the live pages back and record the deployment id.

## D. Creative

- [x] Images from Peter: six AI-made images, 10 September (checked against the menu; the pizza is
  not used, see the brief, section 7).
- [x] Six 1080 x 1080 JPEG ads, about 0.3 MB each (the app caps uploads at 5 MB), square, with a
  green and gold label giving dish, price and service times.
- [ ] Web versions for the landing page and a 1200 x 630 share image (workstream C, C4 and C5).
- [ ] Peter approves the designs before anything is uploaded.
- [ ] Upload to the CheersAI library.

## E. Build, launch and measure

**Pre-build checks (Friday 18 September):**
- [ ] Re-verify the account facts in Supabase, read-only: ad account, pixel, venue coordinates,
  Facebook and Instagram connections.
- [ ] Re-check the live menu prices and hours against the brief's copy.
- [ ] A and C live with deployment ids; B re-checked.

**Build**, in Peter's signed-in Chrome (no password is typed; if the session has expired, stop):
- [ ] /campaigns/new, choose Evergreen, name "Weekday Lunch". Brief text says the button is Book
  now, the service days and hours, and never Monday.
- [ ] Destination https://www.the-anchor.pub/lunch-and-dinner. Choose Local only after choosing
  Evergreen (Evergreen resets the audience to Local + interests). Radius 5 miles.
- [ ] Total budget £160, 15 September to 9 October, deliver Tuesday to Friday 09:00 to 14:00.
  Generate.
- [ ] Review screen: paste the brief's copy into all three ads, attach one dish image per ad, check
  the button reads Book now (regenerate if not).
- [ ] **Stop.** Send Peter the review. Save & Publish only on his yes: it makes the campaign live,
  but the ad set starts on 15 September and only delivers in its hours.
- [ ] Repeat for "Weekday Dinner": £80, 14:00 to 20:00, ads D1 to D3.

**Verify after publishing (read-only):**
- [ ] On Meta, each ad set shows `day_parting`, the Tuesday to Friday schedule, the lifetime budget,
  start and end, and the 5 mile radius; status Scheduled; all six ads approved.
- [ ] Each ad's short link opens the landing page with its tracking tag stored. Click once only;
  never submit a test booking, because it creates a real booking and sends a real SMS.

**Run:**
- [ ] Weekly readout each Monday (brief, section 8); mid-flight check Monday 28 September; final
  review Monday 12 October with a proposal for the second round.
- [ ] Any change to a live campaign (pause, budget move) only on Peter's yes.

---

## Risks

- Meta's ad review usually takes under a day; publishing by Saturday 12 September leaves Sunday and
  Monday as buffer.
- After B, Meta counts consenting visitors only, so Meta-reported results understate. Covers and
  takings are the real measure.
- The Graph version in production defaults to v24.0 in code; a production override was not checked.
- Lunch will grow on its own as word spreads, so not every extra cover is the ads.
