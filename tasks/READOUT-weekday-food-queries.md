# READOUT: weekday food campaigns, weekly queries

For the test in `tasks/ADS-weekday-food.md` (ids and the Var key in `tasks/PLAN-weekday-food-campaign.md`). Read only: every query is a SELECT.

Tested read-only on Thursday 10 September 2026, about 14:00 London time. Nothing was written to either database. Every SQL block below was run as shown (or with only the date parameters changed, which is stated) and the result underneath is what it returned today.

| Project | Ref | Holds |
|---|---|---|
| Management app | `tfcasgxopxegwrabvwat` | table bookings, walk-ins, cash-up, short links and clicks |
| CheersAI | `nbkjciurhvkfpcpatbnt` | Meta campaigns, ad sets, ads, ad metrics history, booking conversion events |

The Anchor's CheersAI account id is `91fda684-2801-4abb-980e-f42cec017cef`. Every CheersAI query below is scoped to it.

---

## At a glance

### Baselines (Tuesday to Friday, food bookings only, cancelled and no-show excluded)

| Measure | Lunch | Dinner | Lunch + dinner |
|---|---|---|---|
| 1 to 11 Sep 2026, booked covers (walk-ins excluded) | 19 | 19 | 38 (19.0 a week) |
| 1 to 11 Sep 2026, walk-in covers | 12 | 21 | 33 |
| 1 to 11 Sep 2026, all food covers | 31 (15.5 a week) | 40 (20.0 a week) | 71 (35.5 a week) |
| 12 weeks, 15 Jun to 6 Sep 2026 (dinner only) | n/a | booked 13.8 a week (median 12, range 1 to 41); walk-in 7.1 a week; all 20.9 a week (median 18.5, range 10 to 48) | n/a |

The 1 to 11 Sep figures are incomplete: as of today they hold no Thursday 10 Sep dinner and nothing for Friday 11 Sep. Re-run query 1b on or after Saturday 12 Sep.

### Food takings (Tuesday to Friday, daily cash-up, gross)

| Period | Days found | Food takings | Per 4-day week |
|---|---|---|---|
| Tue 1 to Fri 11 Sep 2026 | 4 of 8 (1 to 4 Sep only; 8 to 11 Sep not cashed up yet) | £1,369.80 | £1,369.80 |
| Same ISO weeks 2025 (Tue 2 to Fri 12 Sep 2025) | 8 of 8 | £534.92 | £267.46 |
| Same calendar dates 2025 (1 to 11 Sep 2025) | 7 of 7 | £534.92 | £305.67 |
| 12 weeks 2026 (W25 to W36) | 48 | £7,688.80 | £640.73 |
| 12 weeks 2025 (same ISO weeks) | 48 | £3,880.58 | £323.38 |

### Problems found

1. **Short links: no problem.** All 16 codes exist, none has an expiry date, and the short links table has no active or disabled flag. Checked twice (section 3).
2. **Party size and booking date are mostly missing from CheersAI booking conversions.** For table bookings, `event_date` is empty on every row and `tickets` (party size) is filled on 9 of 169 rows since July. Take party size, date, time and status from the management app by booking reference (query 5d).
3. **Walk-in logging looks incomplete.** Some weeks have no walk-ins at all (W31), and Thu 3 and Fri 4 Sep show no lunch covers or walk-ins while the cash-up shows £214 and £539.80 of food. Treat walk-in covers as a floor and use food takings as the cross-check.
4. **Two Lunch A ads and two Lunch B ads share the same `utm_content` value.** Match per-ad results on short code, or on `utm_campaign` plus `utm_content`, never on `utm_content` alone (query 3c).
5. **CheersAI `metrics_ctr` and `metrics_cpc` are all-clicks figures, not link-click figures.** Compute link CTR and cost per link click from `metrics_clicks` (query 4a does this).
6. **2025 comparisons are weak.** There was no Tue to Fri lunch in 2025, and 2025 has several zero-food days (including the whole of 2025-W31 and 2 of the 8 comparison days), which look like missing splits rather than no food sold.

---

## Conventions used in every query

- Tuesday to Friday: `extract(isodow from <date>) between 2 and 5` (ISO numbering, Monday = 1).
- ISO week label: `to_char(<date>, 'IYYY-"W"IW')`; weeks start on Monday (`date_trunc('week', ...)`).
- Lunch: `booking_time >= '12:00' and booking_time < '15:00'` (12:00 to 14:59). Dinner: `booking_time >= '16:00' and booking_time < '21:00'` (16:00 to 20:59).
- Campaign weeks: 2026-W38 (Tue 15 Sep) to 2026-W42 (Fri 16 Oct). 12-week baseline: 2026-W25 to 2026-W36.
- Time zones:
  - Not converted, because they are plain local values: `table_bookings.booking_date` and `booking_time` (checked: 397 of 397 rows since June equal `start_datetime` converted to Europe/London), `cashup_sessions.session_date`, `ad_metrics_history.captured_on` (written as the London date by the sync, `performance-sync.ts` line 89), `booking_conversion_events.event_date`.
  - Converted with `AT TIME ZONE 'Europe/London'` (UTC timestamptz): `short_link_clicks.clicked_at`, `short_links.created_at` and `last_clicked_at`, `table_bookings.created_at`, `booking_conversion_events.occurred_at`, `ads.last_synced_at`, `meta_campaigns.last_synced_at`. Month boundaries in CheersAI use `timestamptz '2026-09-01 00:00 Europe/London'`.

---

## 1. Covers (management app, `tfcasgxopxegwrabvwat`)

### Table and columns

Table `public.table_bookings`:

| Need | Column | Notes |
|---|---|---|
| Party size | `party_size` (integer) | |
| Date and time | `booking_date` (date), `booking_time` (time) | London local values |
| Status | `status` (enum `table_booking_status`) | values: pending_payment, confirmed, cancelled, no_show, completed, pending_card_capture, visited_waiting_for_review, review_clicked. Excluded: cancelled, no_show. The two pending states had 0 rows in the period; query 1a counts them separately |
| Channel | `source` (varchar) | see below |
| Food or drinks | `booking_purpose` | 'food' or 'drinks' (check constraint, migration `20260420000003_bookings_v05_foundations.sql` line 280). The queries count food only and show drinks separately |

### Do bookings record how they were made?

Yes, in `source`. Values seen live:

| source | Meaning | Rows (all time) | In use |
|---|---|---|---|
| `brand_site` | website booking on the-anchor.pub | 355 | Feb 2026 onwards |
| `walk-in` | walk-in logged by staff at front of house | 250 | 11 Feb 2026 onwards |
| `admin` | booking entered by staff in the management app; phone and in-person are not told apart | 109 | Feb 2026 onwards |
| `sms_reply` | booked by replying to an SMS | 10 | Apr to Aug 2026 |
| `website`, `phone`, `website_wizard` | older 2025 values | 71, 20, 5 | Aug to Dec 2025 |
| `management` | one row | 1 | Mar 2026 |

Code: `src/app/api/foh/bookings/route.ts` line 1272 sets `'walk-in'` when the walk-in option is ticked, otherwise `'admin'`. Walk-ins can only be added for today (`src/lib/foh/walk-in.ts`).

**Walk-ins are logged** in the same table (`source = 'walk-in'`), so they can be counted (query 1d). Phone bookings cannot be separated from other staff-entered bookings.

### 1a. Weekly covers, lunch and dinner, by channel

Runs on `tfcasgxopxegwrabvwat`. Change the two dates in `params` only.

```sql
-- 1a. Tue-Fri covers per ISO week. Change the two dates in params only.
with params as (
  select date '2026-06-15' as date_from, date '2026-10-16' as date_to
),
weeks as (
  select gs::date as week_start
  from params, generate_series(date_trunc('week', date_from), date_trunc('week', date_to), interval '7 days') gs
),
b as (
  select date_trunc('week', tb.booking_date)::date as week_start,
         tb.party_size, tb.source, tb.booking_purpose, tb.status::text as status,
         case when tb.booking_time >= time '12:00' and tb.booking_time < time '15:00' then 'lunch'
              when tb.booking_time >= time '16:00' and tb.booking_time < time '21:00' then 'dinner'
              else 'other' end as service
  from table_bookings tb
  cross join params p
  where tb.booking_date between p.date_from and p.date_to
    and extract(isodow from tb.booking_date) between 2 and 5      -- Tue..Fri
    and tb.status::text not in ('cancelled', 'no_show')
)
select to_char(w.week_start, 'IYYY-"W"IW') as iso_week,
       w.week_start as week_start_mon,
       coalesce(sum(b.party_size) filter (where b.booking_purpose = 'food' and b.source <> 'walk-in' and b.service = 'lunch'), 0)  as lunch_booked,
       coalesce(sum(b.party_size) filter (where b.booking_purpose = 'food' and b.source <> 'walk-in' and b.service = 'dinner'), 0) as dinner_booked,
       coalesce(sum(b.party_size) filter (where b.booking_purpose = 'food' and b.source = 'walk-in' and b.service = 'lunch'), 0)   as lunch_walkin,
       coalesce(sum(b.party_size) filter (where b.booking_purpose = 'food' and b.source = 'walk-in' and b.service = 'dinner'), 0)  as dinner_walkin,
       coalesce(sum(b.party_size) filter (where b.booking_purpose = 'food' and b.service in ('lunch','dinner')), 0)               as all_food_covers,
       coalesce(sum(b.party_size) filter (where b.booking_purpose = 'food' and b.source = 'brand_site'), 0) as website,
       coalesce(sum(b.party_size) filter (where b.booking_purpose = 'food' and b.source = 'admin'), 0)      as staff_entered,
       coalesce(sum(b.party_size) filter (where b.booking_purpose = 'food' and b.source not in ('brand_site','admin','walk-in')), 0) as other_channel,
       coalesce(sum(b.party_size) filter (where b.booking_purpose = 'drinks'), 0) as drinks_covers_excluded,
       coalesce(sum(b.party_size) filter (where b.service = 'other'), 0)          as outside_windows_excluded,
       count(b.status) filter (where b.status in ('pending_payment','pending_card_capture')) as pending_bookings
from weeks w
left join b on b.week_start = w.week_start
group by w.week_start
order by w.week_start;
```

Result today (`other_channel`, `outside_windows_excluded` and `pending_bookings` were 0 in every week, so they are left out of the table):

| ISO week | Mon | Lunch booked | Dinner booked | Lunch walk-in | Dinner walk-in | All food | Website | Staff | Drinks (excluded) |
|---|---|---|---|---|---|---|---|---|---|
| 2026-W25 | 15 Jun | 0 | 2 | 0 | 16 | 18 | 2 | 0 | 0 |
| 2026-W26 | 22 Jun | 0 | 9 | 0 | 2 | 11 | 9 | 0 | 0 |
| 2026-W27 | 29 Jun | 0 | 11 | 0 | 15 | 26 | 11 | 0 | 2 |
| 2026-W28 | 6 Jul | 0 | 13 | 0 | 5 | 18 | 13 | 0 | 0 |
| 2026-W29 | 13 Jul | 0 | 23 | 0 | 3 | 26 | 14 | 9 | 10 |
| 2026-W30 | 20 Jul | 0 | 1 | 0 | 11 | 12 | 1 | 0 | 14 |
| 2026-W31 | 27 Jul | 0 | 19 | 0 | 0 | 19 | 11 | 8 | 0 |
| 2026-W32 | 3 Aug | 0 | 10 | 0 | 8 | 18 | 10 | 0 | 0 |
| 2026-W33 | 10 Aug | 0 | 9 | 0 | 1 | 10 | 9 | 0 | 28 |
| 2026-W34 | 17 Aug | 0 | 41 | 0 | 7 | 48 | 41 | 0 | 0 |
| 2026-W35 | 24 Aug | 0 | 14 | 0 | 10 | 24 | 14 | 0 | 0 |
| 2026-W36 | 31 Aug | 9 | 14 | 8 | 7 | 38 | 20 | 3 | 0 |
| 2026-W37 | 7 Sep (partial) | 10 | 5 | 4 | 14 | 33 | 15 | 0 | 0 |
| 2026-W38 | 14 Sep | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2026-W39 | 21 Sep | 0 | 10 | 0 | 0 | 10 | 10 | 0 | 10 |
| 2026-W40 | 28 Sep | 0 | 2 | 0 | 0 | 2 | 2 | 0 | 0 |
| 2026-W41 | 5 Oct | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2026-W42 | 12 Oct | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

Campaign weeks (W38 onwards) currently show forward bookings already on the books, not results.

### 1b. Baseline, Tue 1 to Fri 11 Sep 2026

```sql
-- 1b. Baseline Tue 1 to Fri 11 Sep 2026 (8 service days = 2 Tue-Fri weeks), food covers only
with b as (
  select booking_date, party_size, source,
         case when booking_time >= time '12:00' and booking_time < time '15:00' then 'lunch'
              when booking_time >= time '16:00' and booking_time < time '21:00' then 'dinner'
              else 'other' end as service
  from table_bookings
  where booking_date between date '2026-09-01' and date '2026-09-11'
    and extract(isodow from booking_date) between 2 and 5
    and status::text not in ('cancelled', 'no_show')
    and booking_purpose = 'food'
)
select service,
       coalesce(sum(party_size) filter (where source <> 'walk-in'), 0) as booked_covers,
       coalesce(sum(party_size) filter (where source = 'walk-in'), 0)  as walkin_covers,
       coalesce(sum(party_size), 0) as all_food_covers,
       count(*) filter (where source <> 'walk-in') as booked_bookings,
       round(coalesce(sum(party_size) filter (where source <> 'walk-in'), 0) / 2.0, 1) as booked_covers_per_week,
       round(coalesce(sum(party_size), 0) / 2.0, 1) as all_food_covers_per_week,
       count(distinct booking_date) as days_with_covers,
       max(booking_date) as latest_date_with_covers
from b group by rollup(service) order by service nulls last;
```

Result today:

| Service | Booked covers | Walk-in covers | All food covers | Booked bookings | Booked per week | All per week | Days with covers |
|---|---|---|---|---|---|---|---|
| Dinner | 19 | 21 | 40 | 6 | 9.5 | 20.0 | 6 of 8 |
| Lunch | 19 | 12 | 31 | 4 | 9.5 | 15.5 | 4 of 8 |
| Total | 38 | 33 | 71 | 10 | 19.0 | 35.5 | 7 of 8 |

### 1c. 12-week dinner baseline, 15 Jun to 6 Sep 2026

```sql
-- 1c. 12-week Tue-Fri DINNER baseline, 15 Jun to 6 Sep 2026 (ISO weeks 2026-W25 to W36), food covers only
with weeks as (
  select generate_series(date '2026-06-15', date '2026-08-31', interval '7 days')::date as week_start
),
b as (
  select date_trunc('week', booking_date)::date as week_start, party_size, source
  from table_bookings
  where booking_date between date '2026-06-15' and date '2026-09-06'
    and extract(isodow from booking_date) between 2 and 5
    and status::text not in ('cancelled', 'no_show')
    and booking_purpose = 'food'
    and booking_time >= time '16:00' and booking_time < time '21:00'
),
per_week as (
  select w.week_start,
         coalesce(sum(b.party_size) filter (where b.source <> 'walk-in'), 0) as booked,
         coalesce(sum(b.party_size) filter (where b.source = 'walk-in'), 0)  as walkin,
         coalesce(sum(b.party_size), 0) as all_food
  from weeks w left join b on b.week_start = w.week_start
  group by w.week_start
)
select count(*) as weeks,
       sum(booked) as booked_total, round(avg(booked), 1) as booked_avg_per_week,
       percentile_cont(0.5) within group (order by booked) as booked_median, min(booked) as booked_min, max(booked) as booked_max,
       sum(walkin) as walkin_total, round(avg(walkin), 1) as walkin_avg_per_week,
       sum(all_food) as all_food_total, round(avg(all_food), 1) as all_food_avg_per_week,
       percentile_cont(0.5) within group (order by all_food) as all_food_median, min(all_food) as all_food_min, max(all_food) as all_food_max
from per_week;
```

Result today: 12 weeks. Booked 166 covers (13.8 a week, median 12, min 1, max 41). Walk-in 85 (7.1 a week). All food 251 (20.9 a week, median 18.5, min 10, max 48). A further 54 Tue to Fri dinner-window covers in these weeks were drinks bookings (mostly event nights) and are not counted.

### 1d. Walk-in covers per week

```sql
-- 1d. Tue-Fri walk-in covers per ISO week, with a week spine so weeks with none show 0
with params as (
  select date '2026-06-15' as date_from, date '2026-09-11' as date_to
),
weeks as (
  select gs::date as week_start
  from params, generate_series(date_trunc('week', date_from), date_trunc('week', date_to), interval '7 days') gs
),
w as (
  select date_trunc('week', tb.booking_date)::date as week_start, tb.party_size, tb.booking_purpose, tb.booking_time
  from table_bookings tb cross join params p
  where tb.source = 'walk-in'
    and tb.booking_date between p.date_from and p.date_to
    and extract(isodow from tb.booking_date) between 2 and 5
    and tb.status::text not in ('cancelled', 'no_show')
)
select to_char(k.week_start, 'IYYY-"W"IW') as iso_week, k.week_start as week_start_mon,
       coalesce(sum(w.party_size) filter (where w.booking_purpose = 'food' and w.booking_time >= time '12:00' and w.booking_time < time '15:00'), 0) as lunch_walkin_covers,
       coalesce(sum(w.party_size) filter (where w.booking_purpose = 'food' and w.booking_time >= time '16:00' and w.booking_time < time '21:00'), 0) as dinner_walkin_covers,
       coalesce(sum(w.party_size) filter (where w.booking_purpose = 'drinks'), 0) as drinks_walkin_covers,
       count(w.week_start) as walkin_parties
from weeks k left join w on w.week_start = k.week_start
group by k.week_start order by k.week_start;
```

Result today (lunch / dinner / drinks covers, parties): W25 0/16/0, 5; W26 0/2/0, 1; W27 0/15/2, 7; W28 0/5/0, 3; W29 0/3/0, 1; W30 0/11/0, 5; **W31 0/0/0, 0**; W32 0/8/0, 3; W33 0/1/0, 1; W34 0/7/0, 2; W35 0/10/0, 4; W36 8/7/0, 8; W37 (partial) 4/14/0, 6.

### 1e. Per-day check, 1 to 11 Sep 2026

```sql
-- 1e. Per-day Tue-Fri food covers, 1 - 11 Sep 2026 (day spine so empty days show as 0)
with days as (
  select d::date as day from generate_series(date '2026-09-01', date '2026-09-11', interval '1 day') d
  where extract(isodow from d) between 2 and 5
)
select d.day, to_char(d.day, 'Dy') as dow,
  coalesce(sum(tb.party_size) filter (where tb.booking_time >= '12:00' and tb.booking_time < '15:00' and tb.source <> 'walk-in'), 0) as lunch_booked,
  coalesce(sum(tb.party_size) filter (where tb.booking_time >= '12:00' and tb.booking_time < '15:00' and tb.source = 'walk-in'), 0) as lunch_walkin,
  coalesce(sum(tb.party_size) filter (where tb.booking_time >= '16:00' and tb.booking_time < '21:00' and tb.source <> 'walk-in'), 0) as dinner_booked,
  coalesce(sum(tb.party_size) filter (where tb.booking_time >= '16:00' and tb.booking_time < '21:00' and tb.source = 'walk-in'), 0) as dinner_walkin
from days d
left join table_bookings tb on tb.booking_date = d.day
  and tb.status::text not in ('cancelled', 'no_show') and tb.booking_purpose = 'food'
group by d.day order by d.day;
```

Result today:

| Day | Lunch booked | Lunch walk-in | Dinner booked | Dinner walk-in | Cash-up food takings |
|---|---|---|---|---|---|
| Tue 1 Sep | 5 | 2 | 2 | 5 | £308.00 |
| Wed 2 Sep | 4 | 6 | 0 | 2 | £308.00 |
| Thu 3 Sep | 0 | 0 | 5 | 0 | £214.00 |
| Fri 4 Sep | 0 | 0 | 7 | 0 | £539.80 |
| Tue 8 Sep | 0 | 4 | 5 | 10 | not cashed up yet |
| Wed 9 Sep | 0 | 0 | 0 | 4 | not cashed up yet |
| Thu 10 Sep | 10 | 0 | 0 | 0 | today, in progress |
| Fri 11 Sep | 0 | 0 | 0 | 0 | future |

### Caveats for covers

- "Booked" means website, staff-entered and SMS bookings. Walk-ins are reported separately and also included in "all food".
- Food only. Drop `booking_purpose = 'food'` from a query to include drinks bookings.
- Walk-in logging depends on staff using the front-of-house screen and looks incomplete (no walk-ins in W31; Fri 4 Sep shows 7 logged covers against £539.80 of food). Treat walk-ins as a floor.
- Past bookings left at `confirmed` (not marked completed or no-show) are counted as having happened.
- Future weeks show bookings on the books at the time of running, so always run the readout after the week has finished (Saturday or later).
- Lunch only started on 1 Sep 2026, so there is no lunch history before W36.

---

## 2. Food takings (management app, `tfcasgxopxegwrabvwat`)

### Which rows count as food

- `public.cashup_sessions`: one row per site per trading day (unique index on `site_id, session_date`; one site today). `session_date` is a plain date.
- `public.cashup_sales_breakdowns`: one row per session per category, joined on `cashup_session_id`. The categories are `drinks_sales`, `food_sales` and `other_sales` (`src/types/cashing-up.ts` line 4; `src/services/cashing-up.service.ts` line 13). **Food = `sales_category = 'food_sales'`.**
- The figure is typed in by hand at cash-up ("Food sales" field, `src/app/(authenticated)/cashing-up/daily/_components/DailyClient.tsx` line 155 and the form) as a split of total takings (cash counted plus card plus Stripe, lines 253 to 255), so it is gross money taken, including VAT. The form shows a "split difference" but does not force the split to balance.
- Till CSV imports (`pnl_sales_imports`, net sales) stop on 25 May 2026, so they cannot be used for September.

### Do rows need to be approved or submitted?

Statuses run draft, submitted, approved, locked (`cashing-up.service.ts` lines 451, 473, 492, 510). The P&L dashboard counts submitted, approved and locked and skips drafts (`src/services/financials.ts` lines 286 and 403 to 405). The queries do the same and also exclude voided sessions (`voided_at is not null`, none today). **Do not require "approved"**: every session since 12 Feb 2026 is "submitted" (none approved), so an approved-only filter would return no 2026 data.

### 2a. Weekly Tue to Fri food takings

Runs on `tfcasgxopxegwrabvwat`. Change the two dates in `params` only.

```sql
-- 2a. Tue-Fri food takings per ISO week from the daily cash-up. Change the two dates in params only.
with params as (
  select date '2026-06-15' as date_from, date '2026-10-16' as date_to
),
days as (
  select d::date as day
  from params, generate_series(date_from, date_to, interval '1 day') d
  where extract(isodow from d) between 2 and 5
),
cash as (
  select s.session_date, s.status, s.total_counted_amount, b.amount as food
  from cashup_sessions s
  left join cashup_sales_breakdowns b on b.cashup_session_id = s.id and b.sales_category = 'food_sales'
  where s.voided_at is null
    and s.status in ('submitted', 'approved', 'locked')        -- drafts excluded, as the P&L dashboard does
)
select to_char(date_trunc('week', d.day), 'IYYY-"W"IW') as iso_week,
       date_trunc('week', d.day)::date as week_start_mon,
       count(*) as tue_fri_days,
       count(c.session_date) as days_cashed_up,
       count(c.session_date) filter (where coalesce(c.food, 0) = 0) as days_with_zero_food,
       round(coalesce(sum(c.food), 0), 2) as food_takings_gbp,
       round(coalesce(sum(c.total_counted_amount), 0), 2) as total_takings_gbp,
       string_agg(distinct c.status, ',') as statuses
from days d
left join cash c on c.session_date = d.day
group by 1, 2
order by 2;
```

Result today, 2026 (params 2026-06-15 to 2026-10-16):

| ISO week | Days cashed up | Zero-food days | Food £ | Total £ |
|---|---|---|---|---|
| 2026-W25 | 4 | 1 | 438.00 | 2,850.30 |
| 2026-W26 | 4 | 2 | 164.00 | 2,746.85 |
| 2026-W27 | 4 | 0 | 483.00 | 4,019.60 |
| 2026-W28 | 4 | 0 | 477.00 | 2,844.61 |
| 2026-W29 | 4 | 0 | 694.00 | 3,794.95 |
| 2026-W30 | 4 | 0 | 607.00 | 3,344.50 |
| 2026-W31 | 4 | 0 | 572.00 | 3,259.59 |
| 2026-W32 | 4 | 0 | 742.00 | 3,135.85 |
| 2026-W33 | 4 | 0 | 362.00 | 2,693.01 |
| 2026-W34 | 4 | 0 | 1,158.00 | 4,340.35 |
| 2026-W35 | 4 | 0 | 622.00 | 2,776.77 |
| 2026-W36 | 4 | 0 | 1,369.80 | 3,603.75 |
| 2026-W37 | 0 | 0 | 0.00 | 0.00 |
| 2026-W38 to W42 | 0 | 0 | 0.00 | 0.00 |

Same query with params 2025-06-16 to 2025-10-17 (food £ by ISO week, zero-food days in brackets): W25 431.77; W26 228.78; W27 693.12 (1); W28 280.84; W29 369.57; W30 273.86; **W31 0.00 (4)**; W32 91.14 (1); W33 394.60; W34 325.20; W35 405.66 (1); W36 386.04; W37 148.88 (2); W38 530.70; W39 268.08; W40 472.88; W41 94.62; W42 387.04. All 2025 sessions are "approved".

### 2b. Baselines, Tue to Fri

```sql
-- 2b. Baseline food takings, Tue-Fri only
with periods(label, date_from, date_to) as (values
  ('2026 baseline: Tue 1 - Fri 11 Sep 2026', date '2026-09-01', date '2026-09-11'),
  ('2025 same dates: 1 - 11 Sep 2025',        date '2025-09-01', date '2025-09-11'),
  ('2025 same ISO weeks: Tue 2 - Fri 12 Sep 2025', date '2025-09-02', date '2025-09-12'),
  ('2025 campaign weeks: Tue 16 Sep - Fri 17 Oct 2025', date '2025-09-16', date '2025-10-17')
)
select p.label,
       (select count(*) from generate_series(p.date_from, p.date_to, interval '1 day') d where extract(isodow from d) between 2 and 5) as tue_fri_days_in_period,
       count(s.id) as tue_fri_sessions_found,
       round(coalesce(sum(b.amount), 0), 2) as food_takings_gbp,
       round(coalesce(sum(b.amount), 0) / nullif(count(s.id), 0), 2) as food_per_trading_day_gbp,
       round(4 * coalesce(sum(b.amount), 0) / nullif(count(s.id), 0), 2) as food_per_4_day_week_gbp,
       max(s.session_date) as latest_session_date
from periods p
left join cashup_sessions s
  on s.session_date between p.date_from and p.date_to
 and extract(isodow from s.session_date) between 2 and 5
 and s.voided_at is null
 and s.status in ('submitted', 'approved', 'locked')
left join cashup_sales_breakdowns b on b.cashup_session_id = s.id and b.sales_category = 'food_sales'
group by p.label, p.date_from, p.date_to
order by p.date_from desc;
```

Result today:

| Period | Tue-Fri days | Sessions found | Food £ | £ per day | £ per 4-day week | Latest session |
|---|---|---|---|---|---|---|
| 2026: Tue 1 to Fri 11 Sep | 8 | 4 | 1,369.80 | 342.45 | 1,369.80 | 4 Sep 2026 |
| 2025 campaign weeks: 16 Sep to 17 Oct | 20 | 20 | 1,753.32 | 87.67 | 350.66 | 17 Oct 2025 |
| 2025 same ISO weeks: 2 to 12 Sep | 8 | 8 | 534.92 | 66.87 | 267.46 | 12 Sep 2025 |
| 2025 same dates: 1 to 11 Sep | 7 | 7 | 534.92 | 76.42 | 305.67 | 11 Sep 2025 |

The two 2025 rows match because Fri 12 Sep 2025 recorded £0 food. Tue 9 Sep 2025 also recorded £0.

### 2c. 12-week context

```sql
-- 2c. Context: 12-week Tue-Fri food takings, 15 Jun - 6 Sep 2026 and the same ISO weeks in 2025 (16 Jun - 7 Sep 2025)
select case when s.session_date >= date '2026-01-01' then '2026 W25-W36' else '2025 W25-W36' end as period,
       count(*) as tue_fri_sessions,
       round(sum(coalesce(b.amount, 0)), 2) as food_total_gbp,
       round(sum(coalesce(b.amount, 0)) / 12.0, 2) as food_avg_per_week_gbp,
       count(*) filter (where coalesce(b.amount, 0) = 0) as days_with_zero_food
from cashup_sessions s
left join cashup_sales_breakdowns b on b.cashup_session_id = s.id and b.sales_category = 'food_sales'
where s.voided_at is null and s.status in ('submitted','approved','locked')
  and extract(isodow from s.session_date) between 2 and 5
  and (s.session_date between date '2026-06-15' and date '2026-09-06' or s.session_date between date '2025-06-16' and date '2025-09-07')
group by 1 order by 1;
```

Result today: 2026 W25 to W36: 48 sessions, £7,688.80, £640.73 a week, 3 zero-food days. 2025 same weeks: 48 sessions, £3,880.58, £323.38 a week, 7 zero-food days.

### Caveats for takings

- 8 to 11 Sep 2026 are not cashed up yet (latest session is Sun 6 Sep), so the 2026 baseline is half a period until those are submitted.
- A "zero-food day" is usually a day with no split entered (three June 2026 sessions have no breakdown rows at all), not a day with no food sold. Check `days_with_zero_food` before comparing weeks.
- 2025 had no Tue to Fri lunch, and 2026 food takings were already about double 2025 over the summer, so year-on-year changes cannot be put down to the campaign.
- Food takings include any food not tied to a table booking (bar snacks, food for drinkers), so do not divide takings by logged covers to get spend per head.

---

## 3. Short links (management app, `tfcasgxopxegwrabvwat`)

### Where they live

- Links: `public.short_links` (`short_code`, `destination_url`, `expires_at`, `click_count`, `last_clicked_at`, `parent_link_id`, `metadata`, `name`, `link_type`, `created_at`, `updated_at`, `created_by`). Alias codes: `public.short_link_aliases` (0 rows).
- Clicks: `public.short_link_clicks`, one row per redirect: `short_link_id`, `clicked_at` (UTC), `device_type`, `user_agent`, `referrer`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `request_host`, `country`, `city`, `browser`, `os`, `metadata`.
- Redirect handler: `src/app/api/redirect/[code]/route.ts`. It looks the code up in `short_links`, then in aliases; the only block is `expires_at` in the past (line 389, sends the visitor to the home page). It appends `short_code=<code>` to the destination (line 99) and passes `fbclid` and UTM parameters through, so the website can attribute the booking. Clicks are written after the redirect (line 502). `click_count` only counts non-bot clicks (line 518), and the database function `public.short_link_is_known_bot(user_agent, device_type)` classifies bots (Meta's link checker included).

### Expiry and on/off switch: verified twice

1. Live schema: `short_links` has **no** active, enabled, disabled or archived column. The only thing that can stop a code working is `expires_at`, or someone deleting or repointing it in the Short Links screen.
2. Live data (query 3a): all 16 codes exist, `expires_at` is empty on all 16, `expires_before_17_oct` is false on all 16, no aliases. No database cron job touches short links. Automatic code paths only change a link's destination, name or metadata (event links, table-payment links, or CheersAI re-creating its ad links); setting an expiry date or deleting a link is only possible by hand in the Short Links screen (`src/services/short-links.ts`, update around line 585, delete around line 615).
3. The landing page `https://www.the-anchor.pub/lunch-and-dinner` returned HTTP 200 today (checked directly, not through a short link, so no click was logged).

### 3a. Health check of the 16 codes

```sql
-- 3a. Health check of the 16 campaign codes: exists, expiry, destination, parent, clicks so far
with codes(code, campaign, level) as (values
  ('0ai0j0','Lunch A','campaign'),('jbozdk','Lunch A','ad'),('56hzut','Lunch A','ad'),('qx97ww','Lunch A','ad'),
  ('eff8sa','Lunch B','campaign'),('aw6zqu','Lunch B','ad'),('xicfnn','Lunch B','ad'),('ah4kcu','Lunch B','ad'),
  ('hrfowp','Dinner A','campaign'),('mrhx2v','Dinner A','ad'),('jse8x1','Dinner A','ad'),('if7tg6','Dinner A','ad'),
  ('9sie8u','Dinner B','campaign'),('z75yyn','Dinner B','ad'),('f938i8','Dinner B','ad'),('i87o0t','Dinner B','ad'))
select c.campaign, c.level, c.code,
       sl.id is not null as exists_in_short_links,
       sl.expires_at,
       (sl.expires_at is not null and sl.expires_at < timestamptz '2026-10-17 00:00 Europe/London') as expires_before_17_oct,
       split_part(sl.destination_url, '?', 1) as destination_page,
       substring(sl.destination_url from 'utm_campaign=([^&]+)') as utm_campaign,
       left(substring(sl.destination_url from 'utm_content=([^&]+)'), 4) as utm_content_prefix,
       p.short_code as parent_code,
       (select count(*) from short_link_aliases a where a.short_link_id = sl.id) as aliases,
       sl.click_count as human_click_count,
       (sl.last_clicked_at at time zone 'Europe/London') as last_clicked_london
from codes c
left join short_links sl on sl.short_code = c.code
left join short_links p on p.id = sl.parent_link_id
order by c.campaign, c.level desc, c.code;
```

Result today: all 16 rows `exists_in_short_links = true`, `expires_at = null`, `expires_before_17_oct = false`, `aliases = 0`, destination page `https://www.the-anchor.pub/lunch-and-dinner`.

| Campaign | Campaign code (utm_content `meta_ads_main`) | Ad codes (utm_content `ad__...`, parent = campaign code) | utm_campaign |
|---|---|---|---|
| Lunch A | 0ai0j0 (1 click, 13:08 today) | jbozdk, 56hzut, qx97ww (0 clicks) | weekday_lunch_a_cod_and_chips |
| Lunch B | eff8sa (1 click, 13:13 today) | aw6zqu, xicfnn, ah4kcu (0 clicks) | weekday_lunch_b_spicy_chicken_stack |
| Dinner A | hrfowp (1 click, 13:20 today) | mrhx2v, jse8x1, if7tg6 (0 clicks) | weekday_dinner_a_pizza |
| Dinner B | 9sie8u (1 click, 13:27 today) | z75yyn, f938i8, i87o0t (0 clicks) | weekday_dinner_b_beef_and_ale_pie |

All codes were created today between 13:05 and 13:23 London. The four clicks are single desktop clicks a few minutes after each campaign code was created, so they look like set-up checks, not customers.

### 3b. Clicks per code per week

```sql
-- 3b. Clicks per code per ISO week (clicked_at converted to Europe/London). Humans only in the main columns.
with params as (
  select date '2026-09-07' as first_week_start, date '2026-10-12' as last_week_start
),
codes(code, campaign, level) as (values
  ('0ai0j0','Lunch A','campaign'),('jbozdk','Lunch A','ad'),('56hzut','Lunch A','ad'),('qx97ww','Lunch A','ad'),
  ('eff8sa','Lunch B','campaign'),('aw6zqu','Lunch B','ad'),('xicfnn','Lunch B','ad'),('ah4kcu','Lunch B','ad'),
  ('hrfowp','Dinner A','campaign'),('mrhx2v','Dinner A','ad'),('jse8x1','Dinner A','ad'),('if7tg6','Dinner A','ad'),
  ('9sie8u','Dinner B','campaign'),('z75yyn','Dinner B','ad'),('f938i8','Dinner B','ad'),('i87o0t','Dinner B','ad')),
weeks as (
  select gs::date as week_start from params, generate_series(first_week_start, last_week_start, interval '7 days') gs
),
clicks as (
  select sl.short_code,
         date_trunc('week', c.clicked_at at time zone 'Europe/London')::date as week_start,
         extract(isodow from c.clicked_at at time zone 'Europe/London') as isodow,
         public.short_link_is_known_bot(c.user_agent, c.device_type) as is_bot
  from short_link_clicks c
  join short_links sl on sl.id = c.short_link_id
  where sl.short_code in (select code from codes)
)
select k.campaign, k.level, k.code, to_char(w.week_start, 'IYYY-"W"IW') as iso_week, w.week_start as week_start_mon,
       count(cl.short_code) filter (where not cl.is_bot) as human_clicks,
       count(cl.short_code) filter (where not cl.is_bot and cl.isodow between 2 and 5) as human_clicks_tue_fri,
       count(cl.short_code) filter (where cl.is_bot) as bot_clicks
from codes k
cross join weeks w
left join clicks cl on cl.short_code = k.code and cl.week_start = w.week_start
group by k.campaign, k.level, k.code, w.week_start
order by k.campaign, k.level desc, k.code, w.week_start;
```

Result today: 96 rows (16 codes by 6 weeks, W37 to W42). 4 human clicks in total, all in 2026-W37, one each on 0ai0j0, eff8sa, hrfowp and 9sie8u. Every ad-level code: 0. Bot clicks: 0.

### 3c. utm_content shared between campaigns

```sql
-- 3c. Ad-level utm_content values used by more than one of the 12 ad codes
select substring(destination_url from 'utm_content=([^&]+)') as utm_content,
       string_agg(short_code || ' (' || substring(destination_url from 'utm_campaign=([^&]+)') || ')', ', ' order by short_code) as codes
from short_links
where short_code in ('jbozdk','56hzut','qx97ww','aw6zqu','xicfnn','ah4kcu','mrhx2v','jse8x1','if7tg6','z75yyn','f938i8','i87o0t')
group by 1 having count(*) > 1;
```

Result today: 2 collisions.
- `...offer_graphic__value_for_money__evergreen_test_value_for_money_var_2` is used by aw6zqu (Lunch B) and qx97ww (Lunch A).
- `...venue_photo__booking_urgency__evergreen_test_booking_urgency_var_1` is used by jbozdk (Lunch A) and xicfnn (Lunch B).

### Caveats for short links

- Each ad's Meta link is its own ad-level code: the publish step uses the per-ad variant link from `meta_campaigns.source_snapshot -> managementMetaAdVariants` (CheersAI `src/app/(app)/campaigns/[id]/actions.ts` lines 1170 to 1173), and those variants map one-to-one to the 12 ad codes (query 4a). Ad clicks should therefore land on the ad codes. Clicks on a campaign code during the campaign mean the link was used somewhere else.
- Short-link human clicks will normally be a little below Meta's link clicks (people who leave before the redirect finishes).
- Some ad-level utm_content values were cut at 160 characters by CheersAI (`src/lib/campaigns/ad-attribution.ts` line 3), for example `...proper_pub_food_var` with the number missing. They are still unique within each campaign.

---

## 4. CheersAI ad metrics (`nbkjciurhvkfpcpatbnt`)

### What fills the metrics columns

- `ads.metrics_clicks` is set from `insights.clicks` (`src/lib/campaigns/performance-sync.ts` line 193), which is Meta's **`inline_link_clicks`** (link clicks), falling back to all `clicks` only if Meta omits `inline_link_clicks` (`src/lib/meta/marketing.ts` lines 665 to 670; fields requested on line 646).
- `ads.metrics_ctr` and `ads.metrics_cpc` are Meta's `ctr` and `cpc` fields (`marketing.ts` lines 687 to 688), which are based on **all clicks**. Do not report them as link CTR or cost per link click.
- Window: **a date range, not a fixed lifetime preset, but it adds up to campaign-to-date.** Each sync asks Meta for `time_range` from the campaign `start_date` to the earlier of `end_date` and today (`performance-sync.ts` line 86 and `buildInsightsDateRange`, lines 203 to 211; `marketing.ts` lines 648 to 652). The ads columns are therefore cumulative totals since 15 Sep, frozen after 16 Oct. "Today" is taken as the UTC date (line 204); harmless here because the sync runs at 06:00 UTC.
- Weekly figures: each sync also upserts one cumulative snapshot per ad per London day into `ad_metrics_history` (`performance-sync.ts` lines 89 and 157 to 185). Weekly numbers are the difference between snapshots (query 4b).

### How often it syncs

- `vercel.json` lines 16 to 17: `/api/cron/sync-meta-campaigns` at `0 6 * * *` (06:00 UTC, 07:00 London during BST; the campaign ends before the clocks change on 25 Oct). The route (`src/app/api/cron/sync-meta-campaigns/route.ts` lines 17 to 21) syncs every campaign with a Meta id and status ACTIVE or PAUSED.
- `vercel.json` lines 24 to 25: `/api/cron/optimise-meta-campaigns` at `30 6 * * *` re-syncs the same campaigns (route lines 84 to 108) and then runs the optimiser in "recommend" mode, which records suggestions only (`src/lib/campaigns/optimisation.ts` line 181, `appliedActions = 0` at line 246). It does not pause ads.
- A manual sync is also possible from the campaign page.
- Evidence it is running: other campaigns were last synced today at 07:31 London. The four Weekday campaigns show `last_synced_at` empty because they were created after this morning's run; the first sync is expected at 07:00 on Fri 11 Sep.

### 4a. Per ad, campaign to date, with each ad's short code

```sql
-- 4a. Per-ad campaign-to-date metrics for the four Weekday campaigns, with each ad's l.the-anchor.pub code
select mc.name as campaign,
       a.name as ad,
       v.short_code,
       a.meta_ad_id,
       a.meta_status,
       coalesce(a.metrics_impressions, 0) as impressions,
       coalesce(a.metrics_clicks, 0) as link_clicks,                          -- Meta inline_link_clicks
       round(coalesce(a.metrics_spend, 0), 2) as spend_gbp,
       round(100.0 * a.metrics_clicks / nullif(a.metrics_impressions, 0), 2) as link_ctr_pct,
       round(a.metrics_spend / nullif(a.metrics_clicks, 0), 2) as cost_per_link_click_gbp,
       a.metrics_ctr as meta_ctr_all_clicks,                                  -- Meta 'ctr' (ALL clicks), reference only
       a.metrics_cpc as meta_cpc_all_clicks,                                  -- Meta 'cpc' (ALL clicks), reference only
       (a.last_synced_at at time zone 'Europe/London') as last_synced_london  -- UTC timestamptz converted
from meta_campaigns mc
join ad_sets s on s.campaign_id = mc.id
join ads a on a.adset_id = s.id
left join lateral (
  select x->>'shortCode' as short_code
  from jsonb_array_elements(case when jsonb_typeof(mc.source_snapshot->'managementMetaAdVariants') = 'array'
                                 then mc.source_snapshot->'managementMetaAdVariants' else '[]'::jsonb end) x
  where lower(x->>'utmContent') = lower(a.utm_content_key)
  limit 1
) v on true
where mc.account_id = '91fda684-2801-4abb-980e-f42cec017cef'
  and mc.name like 'Weekday %'
order by mc.name, a.name;
```

Result today: 12 rows, all ACTIVE, every metric 0, `last_synced_london` empty. Mapping returned:

| Campaign | Ad | Code | Meta ad id |
|---|---|---|---|
| Dinner A (pizza) | No cooking tonight, Var 1 | jse8x1 | 120246019371540609 |
| Dinner A (pizza) | Proper pub food, Var 3 | mrhx2v | 120246019373040609 |
| Dinner A (pizza) | Social group plan, Var 2 | if7tg6 | 120246019372370609 |
| Dinner B (beef and ale pie) | Booking urgency, Var 1 | z75yyn | 120246019423840609 |
| Dinner B (beef and ale pie) | Social group plan, Var 2 | i87o0t | 120246019424560609 |
| Dinner B (beef and ale pie) | Value for money, Var 3 | f938i8 | 120246019425710609 |
| Lunch A (cod and chips) | Booking urgency, Var 1 | jbozdk | 120246019244520609 |
| Lunch A (cod and chips) | Proper pub food, Var 3 | 56hzut | 120246019246560609 |
| Lunch A (cod and chips) | Value for money, Var 2 | qx97ww | 120246019245440609 |
| Lunch B (spicy chicken stack) | Booking urgency, Var 1 | xicfnn | 120246019312850609 |
| Lunch B (spicy chicken stack) | Performer or theme, Var 3 | ah4kcu | 120246019315690609 |
| Lunch B (spicy chicken stack) | Value for money, Var 2 | aw6zqu | 120246019314320609 |

### 4b. Per ad, per week (from daily snapshots)

```sql
-- 4b. Weekly per-ad figures: difference between cumulative snapshots.
-- For each week it uses the latest snapshot captured on or before the following Monday
-- (the campaigns only deliver Tue-Fri, so that snapshot holds the whole week).
with params as (
  select date '2026-09-14' as first_week_start, date '2026-10-12' as last_week_start
),
ads_in_scope as (
  select a.id as ad_id, mc.name as campaign, a.name as ad
  from meta_campaigns mc join ad_sets s on s.campaign_id = mc.id join ads a on a.adset_id = s.id
  where mc.account_id = '91fda684-2801-4abb-980e-f42cec017cef' and mc.name like 'Weekday %'
),
weeks as (
  select gs::date as week_start from params, generate_series(first_week_start, last_week_start, interval '7 days') gs
),
snap as (
  select w.week_start, a.ad_id, a.campaign, a.ad, h.captured_on, h.impressions, h.clicks, h.spend
  from weeks w cross join ads_in_scope a
  left join lateral (
    select captured_on, impressions, clicks, spend from ad_metrics_history h
    where h.ad_id = a.ad_id and h.captured_on <= w.week_start + 7
    order by captured_on desc limit 1
  ) h on true
),
deltas as (
  select campaign, ad, week_start, captured_on,
         coalesce(impressions, 0) - coalesce(lag(impressions) over w, 0) as impressions,
         coalesce(clicks, 0)      - coalesce(lag(clicks)      over w, 0) as link_clicks,
         coalesce(spend, 0)       - coalesce(lag(spend)       over w, 0) as spend
  from snap window w as (partition by ad_id order by week_start)
)
select campaign, ad, to_char(week_start, 'IYYY-"W"IW') as iso_week, captured_on as snapshot_used,
       impressions, link_clicks, round(spend, 2) as spend_gbp,
       round(100.0 * link_clicks / nullif(impressions, 0), 2) as link_ctr_pct,
       round(spend / nullif(link_clicks, 0), 2) as cost_per_link_click_gbp
from deltas
order by campaign, ad, week_start;
```

Result today: 60 rows (12 ads by 5 weeks, W38 to W42), no snapshots yet, all zero. The same logic was also run against a past campaign with data (Cowboys & Queens Country Music Bingo 2026 (Traffic), weeks from 3 Aug) and gave sensible weekly splits, for example one ad: W32 19 link clicks for £2.31, W33 154 for £24.62, W34 0.

### 4c. Campaign roll-up

```sql
-- 4c. Campaign roll-up (campaign-level row as synced from Meta, plus the sum of its ads as a cross-check)
select mc.name as campaign, mc.budget_type, mc.budget_amount, mc.start_date, mc.end_date, mc.meta_status,
       coalesce(mc.metrics_impressions, 0) as impressions,
       coalesce(mc.metrics_clicks, 0) as link_clicks,
       round(coalesce(mc.metrics_spend, 0), 2) as spend_gbp,
       round(100.0 * mc.metrics_clicks / nullif(mc.metrics_impressions, 0), 2) as link_ctr_pct,
       round(mc.metrics_spend / nullif(mc.metrics_clicks, 0), 2) as cost_per_link_click_gbp,
       sum(coalesce(a.metrics_clicks, 0)) as sum_of_ad_link_clicks,
       round(sum(coalesce(a.metrics_spend, 0)), 2) as sum_of_ad_spend_gbp,
       (mc.last_synced_at at time zone 'Europe/London') as last_synced_london
from meta_campaigns mc
join ad_sets s on s.campaign_id = mc.id
join ads a on a.adset_id = s.id
where mc.account_id = '91fda684-2801-4abb-980e-f42cec017cef'
  and mc.name like 'Weekday %'
group by mc.id
order by mc.name;
```

Result today: 4 rows, all zero, never synced. Lifetime budgets: Lunch A £150, Lunch B £150, Dinner A £100, Dinner B £100 (£500 in total), 15 Sep to 16 Oct, objective OUTCOME_TRAFFIC, ad sets optimise for LINK_CLICKS. Stored delivery windows: lunch Tue to Fri 09:00 to 14:00, dinner Tue to Fri 14:00 to 20:00.

### Caveats for ad metrics

- If a daily sync fails, the week's snapshot may be from before Friday; `snapshot_used` in 4b shows which day was used, and any missed days fall into the next week.
- Meta can revise recent figures for a day or two, so a readout run on Monday may move slightly by Wednesday.

---

## 5. Booking conversions (CheersAI, `nbkjciurhvkfpcpatbnt`)

### Columns available

`booking_conversion_events`: `booking_id` (for table bookings this is the management app's `table_bookings.booking_reference`, checked 24 of 24 in September), `booking_type` ('table' or 'event'), `occurred_at` (UTC, when the booking was made), `event_date` (events only), `tickets` (party size as sent), `value`, `currency`, `food_intent`, `landing_path`, `source_url`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `short_code`, `fbclid`, `gclid`, `meta_consent_granted`, `capi_status` ('sent', 'skipped', 'failed'), `capi_error`, `capi_sent_at`, plus hashed contact and browser fields that the queries below never select.

### Do website table bookings land here with UTM data?

Yes. Every website table booking since 1 Sep reached CheersAI: the management app has 25 website bookings created since then; 24 match CheersAI 'table' rows by reference, and the 25th is an event-linked table booking created 2 seconds before a CheersAI 'event' row (so it arrived as the event booking). UTM, `short_code` and `fbclid` are stored whenever the visitor arrived with them, whatever their cookie choice (since July: 46 of 169 table rows had UTM, such as google/organic/gbp, menu_insert/print, marketing_email/email). The paid event ads in July came through with `facebook / paid_social`, an `ad__` utm_content, the short code and fbclid, so the full chain has worked for paid clicks before.

How the website attributes a booking: the **latest tagged visit in the same browser within 90 days** (the-anchor.pub `lib/booking-attribution.ts` line 5 and `storedToPayload` line 359; landing page = first visit). A booking made on another device, by phone or as a walk-in will not carry campaign UTM.

### 5a. Bookings attributed to the four campaigns

```sql
-- 5a. Bookings attributed to the four Weekday campaigns (occurred_at is UTC timestamptz, converted to Europe/London)
with codes(code, campaign) as (values
  ('0ai0j0','Lunch A'),('jbozdk','Lunch A'),('56hzut','Lunch A'),('qx97ww','Lunch A'),
  ('eff8sa','Lunch B'),('aw6zqu','Lunch B'),('xicfnn','Lunch B'),('ah4kcu','Lunch B'),
  ('hrfowp','Dinner A'),('mrhx2v','Dinner A'),('jse8x1','Dinner A'),('if7tg6','Dinner A'),
  ('9sie8u','Dinner B'),('z75yyn','Dinner B'),('f938i8','Dinner B'),('i87o0t','Dinner B')),
utms(utm_campaign, campaign) as (values
  ('weekday_lunch_a_cod_and_chips','Lunch A'),('weekday_lunch_b_spicy_chicken_stack','Lunch B'),
  ('weekday_dinner_a_pizza','Dinner A'),('weekday_dinner_b_beef_and_ale_pie','Dinner B'))
select coalesce(u.campaign, c.campaign) as campaign,
       case when u.campaign is not null and c.campaign is not null then 'utm_campaign + short_code'
            when u.campaign is not null then 'utm_campaign only'
            else 'short_code only' end as matched_on,
       (e.occurred_at at time zone 'Europe/London') as booked_at_london,
       e.booking_type,
       e.booking_id,                        -- = management app table_bookings.booking_reference
       e.short_code,
       e.utm_content,
       (e.fbclid is not null) as has_fbclid,
       e.tickets as party_size_as_sent,     -- unreliable for table bookings, see caveat
       e.value, e.currency,
       e.event_date,                        -- null for table bookings
       e.meta_consent_granted,
       e.capi_status, e.capi_error
from booking_conversion_events e
left join utms u on u.utm_campaign = lower(e.utm_campaign)
left join codes c on c.code = lower(e.short_code)
where e.account_id = '91fda684-2801-4abb-980e-f42cec017cef'
  and (u.campaign is not null or c.campaign is not null)
order by e.occurred_at;
```

Result today: 0 rows (campaigns start 15 Sep). The matching logic was checked by swapping in a past paid campaign (`event-pub-quiz-quiz-night-2026-07-22`): it returned the 2 expected rows (facebook / paid_social, `ad__` utm_content, short code and fbclid present).

### 5b. Rows in September 2026 so far

```sql
-- 5b. booking_conversion_events rows in September 2026 so far (occurred_at converted to Europe/London)
select booking_type,
       count(*) as rows,
       count(*) filter (where utm_source is not null) as with_utm,
       count(*) filter (where utm_source = 'facebook' and utm_medium = 'paid_social') as facebook_paid_social,
       count(*) filter (where fbclid is not null) as with_fbclid,
       count(*) filter (where short_code is not null) as with_short_code,
       count(*) filter (where meta_consent_granted) as consent_granted,
       count(*) filter (where capi_status = 'sent') as capi_sent,
       count(*) filter (where capi_status = 'skipped') as capi_skipped,
       count(*) filter (where capi_status = 'failed') as capi_failed,
       count(*) filter (where capi_status is null) as capi_null,
       count(*) filter (where tickets is not null) as with_party_size
from booking_conversion_events
where account_id = '91fda684-2801-4abb-980e-f42cec017cef'
  and occurred_at >= timestamptz '2026-09-01 00:00 Europe/London'
  and occurred_at <  timestamptz '2026-10-01 00:00 Europe/London'
group by rollup(booking_type)
order by booking_type nulls last;
```

Result today:

| Type | Rows | With UTM | facebook/paid_social | fbclid | short_code | Consent | CAPI sent | CAPI skipped | CAPI failed | Party size filled |
|---|---|---|---|---|---|---|---|---|---|---|
| event | 2 | 2 | 0 | 2 | 2 | 0 | 0 | 2 | 0 | 2 |
| table | 24 | 1 | 0 | 0 | 0 | 13 | 13 | 11 | 0 | 3 |
| total | 26 | 3 | 0 | 2 | 2 | 13 | 13 | 13 | 0 | 5 |

Every skipped row is `no_consent`. No failures.

### 5c. Three recent website table bookings with UTM data (no personal data)

```sql
-- 5c. Three most recent website TABLE bookings that arrived with UTM data (no personal data selected)
select (occurred_at at time zone 'Europe/London') as booked_at_london,
       booking_type,
       left(booking_id, 3) || '********' as booking_ref_masked,
       landing_path, utm_source, utm_medium, utm_campaign, left(utm_content, 30) as utm_content_start,
       short_code, (fbclid is not null) as has_fbclid,
       tickets as party_size_as_sent, value, food_intent,
       meta_consent_granted, capi_status, capi_error
from booking_conversion_events
where account_id = '91fda684-2801-4abb-980e-f42cec017cef'
  and booking_type = 'table'
  and (utm_source is not null or short_code is not null)
order by occurred_at desc
limit 3;
```

Result today:

| Booked (London) | Ref | Landing path | utm_source / medium / campaign | utm_content | short_code | fbclid | Party size sent | Value | Consent | CAPI |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 Sep 2026 09:26 | TB-******** | / | google / organic / gbp | none | none | no | none | 0 | yes | sent |
| 30 Aug 2026 17:21 | TB-******** | /dog-friendly-pub-heathrow | google / organic / gbp | none | none | no | none | 0 | yes | sent |
| 30 Aug 2026 12:53 | TB-******** | /blog/heathrow-plane-spotting-locations | google / organic / gbp | none | none | no | none | 0 | yes | sent |

The most recent table bookings (6 to 9 Sep) carry no UTM because those visitors arrived without tags.

### 5d. Step two: party size, date and status from the management app

Runs on `tfcasgxopxegwrabvwat`. Paste the `booking_id` values from 5a.

```sql
-- 5d. Step 2: look up campaign-attributed booking references (booking_id from 5a) in the management app
with refs(booking_reference) as (
  select unnest(array['TB-XXXXXXXX'])   -- paste booking_id values from 5a here
)
select left(tb.booking_reference, 3) || '********' as booking_ref_masked,   -- show the full value in real use
       tb.booking_date, to_char(tb.booking_date, 'Dy') as dow, tb.booking_time,
       case when tb.booking_time >= time '12:00' and tb.booking_time < time '15:00' then 'lunch'
            when tb.booking_time >= time '16:00' and tb.booking_time < time '21:00' then 'dinner'
            else 'other' end as service,
       extract(isodow from tb.booking_date) between 2 and 5 as is_tue_fri,
       tb.party_size, tb.status::text as status, tb.source, tb.booking_purpose,
       (tb.created_at at time zone 'Europe/London') as created_london
from refs r
left join table_bookings tb on tb.booking_reference = r.booking_reference
order by tb.booking_date, tb.booking_time;
```

Result today, tested with three September references: all three matched (two Saturday 12 Sep 17:00 dinner bookings for 6 and 4, confirmed; one Sunday 13 Sep 14:00 booking for 3, cancelled). A separate check matched all 24 September table references (all `brand_site`, 102 covers in total; 7 of the 24 bookings are for Tue to Fri dates).

### Caveats for booking conversions

- **Party size and booking date:** `event_date` is empty for every table row, and `tickets` is filled on only 9 of 169 table rows since July (3 of 24 in September), so do not use them. Always take party size, date, time and status from step two. Likely cause (not confirmed): the website sends each table booking twice, once from the server with party size and once from the browser without it, and the CheersAI ingest upsert (`src/app/api/booking-conversions/route.ts` lines 142 to 185) overwrites every column on the second post. The local copy of the website repo is 39 commits behind, so this is unverified.
- `value` for table bookings is an estimate the website sends, not money taken. Use the cash-up for money.
- Match on `utm_campaign` or `short_code`; per ad use `short_code` or `utm_campaign` plus `utm_content` (see 3c).
- Only bookers who accept marketing cookies are sent to Meta (13 of 26 in September), so Meta's own conversion count will stay below CheersAI's row count.

---
