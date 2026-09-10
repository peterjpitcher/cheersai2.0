# RUNBOOK: weekday food ads, The Anchor

The one current source for this campaign (review finding F22). Where the brief
(`tasks/ADS-weekday-food.md`), the plan (`tasks/PLAN-weekday-food-campaign.md`) or the approval
page disagree with this file, this file wins. The approval page is the historical record of what
the owner approved before the build; do not execute from it.

State at 10 September 2026, evening: published, all four campaigns scheduled on Meta, first
delivery Friday 11 September 09:00. Nothing spent.

## 1. Scope

| Item | Current value |
|---|---|
| Campaigns | 4 (Lunch A cod and chips, Lunch B spicy chicken stack, Dinner A pizza, Dinner B beef and ale pie), one ad set and three ads each, 12 ads |
| Budget | £500 lifetime: £150, £150, £100, £100 |
| Flight | Friday 11 September to Friday 16 October 2026 (21 serving days); ad sets run 11 Sep 00:00 to 17 Oct 00:00 UK time |
| Days and hours | Tuesday to Friday only. Lunch ads 09:00 to 14:00, dinner ads 14:00 to 20:00, advertiser time (Europe/London) |
| Objective | Traffic, optimised for link clicks; no special ad category |
| Audience | 5 mile radius around the pub, people who live there or are often there (Meta location types `home`, `frequently_in`); ages 18 to 65+; no interests |
| Placements | Facebook, Instagram and Messenger (Audience Network excluded) |
| Creative | 1080 x 1080 image with label and logo; every Meta automatic creative change opted out on all 12 ads |
| Final review | Monday 19 October 2026 |

## 2. Ids

| Campaign | App id | Meta campaign | Meta ad set | Var 1 ad | Var 2 ad | Var 3 ad |
|---|---|---|---|---|---|---|
| Lunch A | `f80e55db-2b89-4672-809e-57d3253e15e4` | `120246019241610609` | `120246019242330609` | `120246019244520609` (jbozdk) | `120246019245440609` (qx97ww) | `120246019246560609` (56hzut) |
| Lunch B | `52bd9d01-41e0-4ba0-9442-e7f5224604b4` | `120246019309520609` | `120246019310340609` | `120246019312850609` (xicfnn) | `120246019314320609` (aw6zqu) | `120246019315690609` (ah4kcu) |
| Dinner A | `ed08ddeb-a1a9-4ad4-b7aa-704c64ab1f54` | `120246019370140609` | `120246019370370609` | `120246019371540609` (jse8x1) | `120246019372370609` (if7tg6) | `120246019373040609` (mrhx2v) |
| Dinner B | `86400ca6-ac67-4d05-a1cd-2c7cc7634bc9` | `120246019422320609` | `120246019422650609` | `120246019423840609` (z75yyn) | `120246019424560609` (i87o0t) | `120246019425710609` (f938i8) |

Short codes in brackets (`l.the-anchor.pub/<code>`). The four campaign-level codes (0ai0j0, eff8sa,
hrfowp, 9sie8u) are not used by any ad, which is why 16 codes exist for 12 ads (F10). Var numbers
mean the same message in both campaigns of a pair: lunch Var 1 "Now serving lunch", Var 2 "Lunch
from £9", Var 3 "Proper pub lunch"; dinner Var 1 "No cooking tonight", Var 2 "Midweek dinner and a
pint", Var 3 "Proper pub dinner". The canonical per-ad key is the Meta ad id or the short code; two
messages share a `utm_content` between Lunch A and Lunch B, so never join on `utm_content` alone.
`utm_campaign` values: `weekday_lunch_a_cod_and_chips`, `weekday_lunch_b_spicy_chicken_stack`,
`weekday_dinner_a_pizza`, `weekday_dinner_b_beef_and_ale_pie`.

## 3. Owner decisions after the independent review (10 September 2026)

Review: `tasks/REVIEW-weekday-food-campaign-2026-09-10.md`.

| Finding | Decision |
|---|---|
| F01 consent | Fix now. Done: the-anchor.pub #169, live and verified in fresh browsers (no choice and reject store nothing; accept saves; withdraw deletes) |
| Start | Launch Friday 11 September, not 15 September; do not hold launch for any fix |
| F06 pizza image | Owner confirmed the pictured pizza (mushrooms, rocket, cherry tomatoes) is one the pub sells. The management app menu does not describe it yet: owner to add it |
| F06 pie image | The kitchen serves the beef and ale pie with crispy onions, so the image is accurate. Owner to add them to the menu description |
| F06 less healthy food rules | The advertiser is the pub's own business (10 employees, under the 250-employee small business exemption), recorded on the owner's word |
| F03 audience | "Recently in" dropped on all four ad sets (done 10 September) |
| F07 placements | Audience Network excluded (done 10 September); Meta's own previews for 12 placements show the image uncropped with label and logo |
| F08 alcohol | Keep "and a pint". Check recorded below |
| F02 learning claim | Results are directional, not proof |
| F15 mid-test rule | The 70% pause rule is dropped. No pausing for learning |
| F17, F18, F23 | Daily 08:30 check with alerts; emergency pause only (section 6) |
| F14 success | The owner's bar is £1 per extra cover, because he can buy covers from other vendors at that price |
| F19 tally | New sheet recording people per table and "don't know" (sent 10 September) |

Not changed, with reasons: F21 (Google applies the more restrictive of conflicting robots rules,
so `noindex` holds); F26 (the build stays; results are read as directional).

### Alcohol check (CAP Code section 18), dinner Var 2
The ad is about food; the pint is incidental and moderate ("a pint at your local"). Minimum age 18
is a hard limit in the ad sets (Meta's Advantage+ audience cannot lower it), and the 5 mile adult
audience has no youth appeal. No link to social or sexual success, no strength or excess, no
under-25s in the image. Owner decision: keep.

## 4. Metrics (F09)

| Metric | Source | Notes |
|---|---|---|
| Impressions, reach, spend | Meta, synced daily at 07:00 UK to CheersAI `ads.metrics_*` | Campaign to date; `ad_metrics_history` holds daily snapshots |
| Link clicks, link CTR, cost per link click | Meta `inline_link_clicks` (`ads.metrics_clicks`) | Never `metrics_ctr` or `metrics_cpc`, which count all clicks |
| Short-link clicks | Management app `short_link_clicks`, bot-filtered | Server-side, no consent needed; slightly below Meta link clicks |
| Landing page visits | Google Analytics, `utm_medium=paid_social` | Consent-dependent; a floor |
| Tagged bookings | CheersAI `booking_conversion_events` by `utm_campaign` or `short_code`; party size and date from the management app by booking reference | Since 10 September only visitors who accepted marketing cookies carry tags: a floor |
| Covers | Management app `table_bookings`, food only, cancelled and no-show excluded, service by booking time (lunch 12:00 to 14:59, dinner 16:00 to 20:59) | Walk-ins logged by staff are incomplete: a floor |
| Food takings | Management app cash-up, `food_sales`, submitted sessions | Gross; the cross-check |
| Staff tally | Paper sheet, photo each Monday | L2 or D4 = lunch or dinner table and people |

Queries: `tasks/READOUT-weekday-food-queries.md` (use 2026-09-11 as the start date).

## 5. Attribution rules (F11)

- Website (tagged bookings): the latest tagged visit in the same browser within 90 days, and only
  with marketing consent. A booking on another device, by phone or as a walk-in carries no tag.
- Meta: reported separately, with Meta's own attribution window. The two are never added together.
- Bookings are counted by the date they were made. Tagged bookings made up to Friday 23 October
  are counted as late responses to the flight and reported separately.
- Baseline: Tuesday 1 to Thursday 10 September 2026 (7 serving days), fixed at the first readout.
  Lunch launched on 1 September, so there is no true lunch "before"; lunch results are a launch
  trend plus tagged demand, not a causal uplift.

## 6. Monitoring, pausing and who does what

- Daily check (scheduled task `anchor-weekday-food-daily-check`, Tuesday to Friday 08:30): ads and
  ad sets active and approved, spend against plan, account spending limit, other campaigns that
  could spend, landing page, today's booking times, menu prices against every ad claim, special
  hours. Silent when all is well; alerts Peter otherwise.
- Emergency pause, pre-authorised by the owner on 10 September: pause only (never edit, resume,
  delete or change budgets), and only if the kitchen is closed today, an advertised dish is off or
  its price has risen above an ad's claim, the landing page or booking system is broken, or Meta
  restricts the account. Restarting needs the owner's explicit yes, through the CheersAI app.
- Readouts (scheduled tasks, 09:00): 21 September, 28 September (mid-test review), 5 October,
  12 October, final review 19 October. Read only.
- Owner: all decisions. Claude: runs the checks and readouts, and makes approved changes.

## 7. Forecast scenarios (F25)

Planning figures, not commitments. £500 of spend:

| Case | Cost per link click | Link clicks | Visitors who book or come in | Tables | Extra covers (2.5 a table) | Cost per extra cover |
|---|---|---|---|---|---|---|
| Low | 25p | 2,000 | 0.5% | 10 | 25 | £20 |
| Central | 14p | 3,571 | 1% | 36 | 89 | £5.60 |
| High | 10p | 5,000 | 2% | 100 | 250 | £2 |

Even the high case is twice the owner's £1 bar, so the likely verdict is that paid Meta traffic
does not beat his other sources on cost per cover. The test still shows which message and photo
move locals, for any future spend.

## 8. Change log

| When (2026) | Change | Where |
|---|---|---|
| 10 Sep | Four campaigns published, review screens matched the approval page | CheersAI app |
| 10 Sep | "Next event" pop-up hidden on `/lunch-and-dinner` | the-anchor.pub #165 |
| 10 Sep | Audience `home` + `frequently_in` (was also `recent`); placements Facebook, Instagram, Messenger (was automatic) | Meta API on the four ad sets; CheersAI `ad_sets` records updated to match |
| 10 Sep | Start moved to 11 September 00:00 | Meta API on the four ad sets; CheersAI `meta_campaigns.start_date` and `ad_sets.phase_start` updated so the sync includes Friday |
| 10 Sep | Consent-gated attribution | the-anchor.pub #169 |
| 10 Sep | Daily check and readouts scheduled | Claude scheduled tasks on the owner's Mac |

Rollback: pause any campaign from the CheersAI app; revert the website PRs; restore the previous
audience (`home`, `recent`, `frequently_in`) or automatic placements through the Meta API.
