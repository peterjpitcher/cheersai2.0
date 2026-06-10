# Food Booking Campaign Type - Design Handoff

**Date:** 2026-06-07
**Status:** Discussion-ready design
**Owner context:** UK pub/restaurant food bookings
**Primary goal:** Replace the current "evergreen promotion" idea with a food-specific paid Meta campaign type that promotes the right menu at the right decision window and optimises for table bookings.

---

## Executive Summary

The current evergreen paid campaign type is too broad for food bookings. It can create trackable Meta short links and a durable 30-day campaign, but it does not understand food service windows, booking decision cutoffs, Sunday roast urgency, weekday dinner timing, or table-booking intent.

The better product is a dedicated `food_booking` campaign type driven by a weekly food service calendar.

This campaign type should:

- Promote weekday food only during strategic decision windows.
- Push Sunday roast with Friday, Saturday, and Sunday-specific messaging.
- Promote Saturday food separately from weekday dinners and Sunday roast.
- Stop wasting budget after the point where most diners have already chosen what to do.
- Force `BOOK_NOW` and explicit table-booking language.
- Require table booking conversion tracking before publish.
- Segment reporting by food service, day, intent, and ad window.

The key change from the earlier plan is that weekday dinners should not be treated as always-on food ads. They need short, strategic same-day windows because dinner decisions are usually made by lunch, mid-afternoon, or the commute home. Ads after the useful decision point should either stop or become a very low-weight last-minute rescue window.

---

## Venue Food Schedule

Use these service products as the source of truth.

| Service key | Service name | Days | Service hours | Last orders | Menu position |
|---|---|---:|---:|---:|---|
| `weekday_dinner` | Weekday regular menu | Tuesday-Friday | 16:00-21:00 | TBD, assume before 21:00 | Regular menu |
| `saturday_food` | Saturday regular menu | Saturday | 12:00-19:00 | TBD, assume before 19:00 | Regular menu |
| `sunday_roast` | Sunday food and roast | Sunday | 13:00-18:00 | 17:30 | Regular menu plus hero Sunday roast |

The Sunday service should be treated as a hero product. It should not just be another regular menu ad because the roast creates a clearer, higher-intent hook.

---

## Strategic Timing View

### Core Principle

Food campaigns should be scheduled around when guests are still deciding.

For weekday dinners, the highest-value windows are likely:

- Late morning / lunch break: people are thinking about the evening.
- Mid-afternoon: people are finalising plans.
- Early commute / just before service: last practical nudge.

After that, most people have decided whether they are cooking, ordering in, going out, or already travelling. Ads can still produce walk-in style demand, but they are less efficient for table bookings.

### Recommended Decision Cutoffs

| Service | Main decision cutoff | Hard paid media cutoff | Reason |
|---|---:|---:|---|
| Weekday dinner | 17:30-18:00 | 18:30, optionally 19:00 on Friday | Most dinner plans are made before or around the commute home. |
| Saturday food | Lunch: 11:30, early dinner: 16:30 | 17:30 | Service ends at 19:00, so late ads have limited booking value. |
| Sunday roast | 11:30-13:00 for best tables, 15:30 for last useful demand | 16:00-16:30 | Last orders are 17:30, so late clicks are low-quality. |

These are defaults. The optimiser should later tune them from booking data.

---

## Proposed Campaign Kind

Add a new paid campaign kind:

```ts
export type PaidCampaignKind = 'event' | 'evergreen' | 'food_booking';
```

This should not replace event campaigns. It should sit alongside them.

`food_booking` means:

- The objective is table bookings.
- The destination is a table booking URL or a trackable short link that ultimately leads to booking.
- Meta objective should be `OUTCOME_SALES` when conversion setup is ready.
- Ad sets should use `OFFSITE_CONVERSIONS` with the venue's Purchase/table booking event.
- Copy must include booking/table/reserve language.
- CTA must be `BOOK_NOW`.

---

## Food Booking Campaign Structure

The parent campaign should represent a rolling food booking programme, but the ad sets should be scheduled as short windows.

Recommended parent campaign:

```text
Food Bookings - Regular Menu + Sunday Roast
```

Recommended child ad set groups:

- Weekday dinner windows
- Saturday food windows
- Sunday roast planning windows
- Sunday roast urgency windows
- Sunday roast day-of windows

Do not create one generic ad set called "Food". That loses the timing and intent information needed for good copy and budget allocation.

---

## Weekday Dinner Strategy

### Service

Tuesday-Friday, regular menu, 16:00-21:00.

### Recommended Ad Windows Per Service Day

| Window key | Runs | Suggested time | Weight | Intent | Example message |
|---|---|---:|---:|---|---|
| `weekday_lunch_decision` | Tue-Fri | 11:00-13:30 | 55% | Get dinner decided during lunch break | "Sort tonight's dinner from 4pm." |
| `weekday_afternoon_commit` | Tue-Fri | 15:00-17:15 | 35% | Finalise after-work plans | "Book a table before you head home." |
| `weekday_last_minute` | Tue-Fri | 17:15-18:30 | 10% | Low-weight rescue demand | "Still deciding dinner? Book for this evening." |

### Friday Adjustment

Friday may deserve a slightly longer final window because people are more likely to make last-minute weekend decisions. Suggested Friday hard stop: 19:00.

### Copy Rules

Weekday dinner ads should:

- Mention the regular menu.
- Mention "from 4pm" or "served 4pm-9pm".
- Use "tonight" only on the same day.
- Use after-work language where useful.
- Avoid Sunday roast language.
- Avoid generic claims like "delicious food" without a specific proof point.
- Push table booking, not browsing the menu.

Good copy intent examples:

- "Dinner is sorted from 4pm."
- "Book a table after work."
- "Regular menu served tonight."
- "Make the evening easy: reserve your table."

Bad copy intent examples:

- "Come and try our food."
- "View our menu."
- "Do not miss out."
- "Sunday roast served today" on Tuesday-Friday.

---

## Saturday Food Strategy

### Service

Saturday, regular menu, 12:00-19:00.

### Recommended Ad Windows

| Window key | Runs | Suggested time | Weight | Intent | Example message |
|---|---|---:|---:|---|---|
| `saturday_planning` | Friday | 16:00-20:00 | 25% | Weekend food planning | "Plan Saturday lunch or early dinner." |
| `saturday_lunch_commit` | Saturday | 08:30-11:30 | 35% | Lunch booking | "Book lunch from 12pm." |
| `saturday_afternoon_food` | Saturday | 12:30-16:30 | 30% | Afternoon or early dinner | "Tables for food until 7pm." |
| `saturday_final_nudge` | Saturday | 16:30-17:30 | 10% | Low-weight late demand | "Still time to book early dinner." |

### Copy Rules

Saturday ads should:

- Say "Saturday" or "today" only when accurate.
- Mention "12pm-7pm" or "food served until 7pm".
- Avoid Sunday roast unless intentionally cross-selling Sunday on Saturday.
- Prioritise lunch and early dinner language.

---

## Sunday Roast Strategy

### Service

Sunday, regular menu plus hero Sunday roast, 13:00-18:00, last orders at 17:30.

Sunday should be the hero food campaign. It should receive the strongest copy treatment and a larger share of budget unless business priorities change.

### Recommended Ad Windows

| Window key | Runs | Suggested time | Weight | Intent | Example message |
|---|---|---:|---:|---|---|
| `sunday_roast_planning` | Friday | 09:00-14:00 | 20% | Get Sunday plans made early | "Book Sunday roast before the weekend fills." |
| `sunday_roast_tomorrow` | Saturday | 09:00-18:00 | 35% | Tomorrow urgency | "Sunday roast tomorrow - reserve your table." |
| `sunday_roast_morning` | Sunday | 08:30-11:30 | 30% | Commit before lunch service | "Roasts served from 1pm today." |
| `sunday_roast_last_tables` | Sunday | 11:30-16:00 | 15% | Last useful demand | "Last orders 5:30pm - book while tables remain." |

### Sunday Hard Stop

Stop Sunday roast paid ads by 16:00-16:30.

Reason: last orders are 17:30. A paid click after 16:30 has limited time to become a useful booking, and late clicks can distort performance data.

### Copy Rules

Sunday roast ads should:

- Treat roast as the hero offer.
- Mention regular menu only as supporting detail.
- Mention last orders only on Sunday day-of.
- Use "tomorrow" only on Saturday.
- Use "today" only on Sunday.
- Avoid "tonight" because Sunday service is 1pm-6pm.
- Force `BOOK_NOW`.

---

## Budget Weighting

### Service-Level Starting Weights

Start with this until real booking data is available:

| Service | Suggested budget share | Rationale |
|---|---:|---|
| Sunday roast | 45%-55% | Hero product, clear booking intent, strongest offer. |
| Weekday dinner | 30%-40% | Needs consistent demand across four days. |
| Saturday food | 15%-25% | Useful weekend demand, but less distinctive than Sunday roast. |

### Weekday Internal Weights

If all weekdays need equal help:

| Day | Share of weekday budget |
|---|---:|
| Tuesday | 25% |
| Wednesday | 25% |
| Thursday | 25% |
| Friday | 25% |

If Tuesday and Wednesday are the weakest nights, use:

| Day | Share of weekday budget |
|---|---:|
| Tuesday | 32% |
| Wednesday | 28% |
| Thursday | 22% |
| Friday | 18% |

The app should eventually let the user choose "boost quieter days" versus "split evenly".

### Dynamic Needs Weighting

Future version should calculate weights from booking gaps:

```text
ad_set_weight =
  service_priority_weight
  x day_need_multiplier
  x phase_urgency_weight
  x booking_gap_multiplier
```

Where:

- `service_priority_weight` is Sunday roast, weekday, or Saturday priority.
- `day_need_multiplier` boosts quieter days.
- `phase_urgency_weight` reflects lunch decision, afternoon commit, tomorrow, day-of, etc.
- `booking_gap_multiplier` increases when current bookings are below target.

If live table availability is not available yet, use static defaults and optimise from historical conversion data.

---

## Scheduling Model

### Current Limitation

Current campaign phases are mostly date-based:

- `phase_start`
- `phase_end`
- optional `ads_stop_time`

That is enough for event campaigns, but not enough for weekday dinner because the start time matters. For example, a weekday dinner ad should often start around 11:00, not midnight.

### Required Model Extension

Add London-local scheduled windows to ad sets.

Recommended DB additions to `ad_sets`:

```sql
alter table public.ad_sets
  add column if not exists phase_start_at timestamptz,
  add column if not exists phase_end_at timestamptz,
  add column if not exists service_key text,
  add column if not exists decision_stage text,
  add column if not exists budget_weight numeric;
```

Recommended TypeScript model changes:

```ts
export type PaidCampaignKind = 'event' | 'evergreen' | 'food_booking';

export type FoodServiceKey =
  | 'weekday_dinner'
  | 'saturday_food'
  | 'sunday_roast';

export type FoodDecisionStage =
  | 'planning'
  | 'lunch_decision'
  | 'afternoon_commit'
  | 'tomorrow'
  | 'morning_commit'
  | 'last_tables'
  | 'last_minute';

export interface FoodAdWindow {
  serviceKey: FoodServiceKey;
  decisionStage: FoodDecisionStage;
  runDay: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
  startsAtLocal: string; // HH:mm
  endsAtLocal: string;   // HH:mm
  serviceDateOffsetDays: number;
  budgetWeight: number;
  copyIntent: string;
}
```

### Recommended Publishing Behaviour

When publishing, send Meta ad set `startTime` and `endTime` from `phase_start_at` / `phase_end_at` when present.

Fallback to existing date logic only for older campaign kinds.

Recommended implementation order:

1. Add new ad set fields.
2. Update campaign phase/ad set types.
3. Update publish action to prefer explicit timestamps.
4. Add `calculateFoodBookingPhases`.
5. Add `food_booking` generation prompt and validation.

---

## Rolling Execution Strategy

Avoid creating an endless always-on campaign.

Recommended v1:

- Generate 2 weeks of scheduled food ad windows at a time.
- Each ad set has a precise start/end timestamp.
- Campaign can be regenerated or extended weekly.
- A future cron can materialise the next week automatically.

Reason:

- Keeps ad set count manageable.
- Gives strong control over service-specific messaging.
- Avoids wasting spend outside useful decision windows.
- Makes reporting clearer by service and decision stage.

Future v2:

- Account-level recurring food schedule.
- Cron materialises the next 7-14 days of ad sets.
- Optimiser adjusts weights based on bookings and cost per booking.

---

## AI Generation Rules

Create a new prompt branch for `food_booking`.

Mandatory rules:

- `objective` must be `OUTCOME_SALES` when table booking conversion setup is ready.
- `optimisation_goal` must be `OFFSITE_CONVERSIONS` when conversion setup is ready.
- CTA must be `BOOK_NOW`.
- Every ad must contain table booking intent: book, reserve, table, booking, or similar.
- Copy must respect service day and service hours.
- Copy must not mention Sunday roast outside Friday-Sunday roast windows.
- Copy must not mention last orders except Sunday day-of.
- Copy must not mention "tonight" for Sunday roast.
- Copy must avoid raw URLs.
- Copy must avoid generic phrases such as "do not miss out", "amazing", "exciting", "join the fun".

Prompt context should include:

- Venue name and location.
- Service calendar.
- Menu/service type.
- Booking URL.
- Decision window.
- Service date and service hours.
- Last orders when relevant.
- Known food hooks, menu highlights, price points, dietary proof points, or hero dishes.
- Historical booking patterns if available.

---

## Tracking and Attribution

Food booking campaigns should rely on table booking events, not event booking events.

The existing booking conversion endpoint already supports:

```ts
bookingType: 'event' | 'table'
foodIntent?: string
```

For food campaigns, send:

```json
{
  "bookingType": "table",
  "foodIntent": "weekday_dinner"
}
```

or:

```json
{
  "bookingType": "table",
  "foodIntent": "sunday_roast"
}
```

Recommended attribution fields:

- `utm_campaign`: parent food campaign slug.
- `utm_content`: ad-level creative and window key.
- `short_code`: management short link code.
- `food_intent`: `weekday_dinner`, `saturday_food`, or `sunday_roast`.
- `booking_type`: `table`.

Dashboard should report:

- Bookings by service key.
- Bookings by decision stage.
- Cost per table booking.
- Best service-day window.
- Best creative format.
- Sunday roast booking volume and value separately from regular menu.

---

## UX Requirements

Add a new campaign type option:

```text
Food Booking
```

The form should collect:

- Campaign name.
- Booking URL.
- Budget and budget type.
- Date range or number of weeks.
- Services to include:
  - Weekday dinner
  - Saturday food
  - Sunday roast
- Menu hooks or food proof points.
- Optional quieter-day weighting preference:
  - Split evenly
  - Boost Tue/Wed
  - Manual weights
- Creative assets per service.

Review screen should show:

- Schedule preview table.
- Ad set windows with start/end times.
- Budget share per service and phase.
- Copy intent per ad set.
- Warnings when ads run too late for the service.
- Warnings if table conversion tracking is not ready.

---

## Example Generated Ad Set Plan

Example for one week:

| Ad set | Start | End | Service | Stage | Weight |
|---|---:|---:|---|---|---:|
| Tue Dinner - Lunch Decision | Tue 11:00 | Tue 13:30 | Weekday dinner | Lunch decision | 55 |
| Tue Dinner - Afternoon Commit | Tue 15:00 | Tue 17:15 | Weekday dinner | Afternoon commit | 35 |
| Tue Dinner - Last Minute | Tue 17:15 | Tue 18:30 | Weekday dinner | Last minute | 10 |
| Wed Dinner - Lunch Decision | Wed 11:00 | Wed 13:30 | Weekday dinner | Lunch decision | 55 |
| Thu Dinner - Lunch Decision | Thu 11:00 | Thu 13:30 | Weekday dinner | Lunch decision | 55 |
| Fri Dinner - Afternoon Commit | Fri 15:00 | Fri 17:30 | Weekday dinner | Afternoon commit | 35 |
| Saturday Planning | Fri 16:00 | Fri 20:00 | Saturday food | Planning | 25 |
| Saturday Lunch Commit | Sat 08:30 | Sat 11:30 | Saturday food | Lunch commit | 35 |
| Saturday Afternoon Food | Sat 12:30 | Sat 16:30 | Saturday food | Afternoon food | 30 |
| Sunday Roast Planning | Fri 09:00 | Fri 14:00 | Sunday roast | Planning | 20 |
| Sunday Roast Tomorrow | Sat 09:00 | Sat 18:00 | Sunday roast | Tomorrow | 35 |
| Sunday Roast Morning | Sun 08:30 | Sun 11:30 | Sunday roast | Morning commit | 30 |
| Sunday Roast Last Tables | Sun 11:30 | Sun 16:00 | Sunday roast | Last tables | 15 |

This table is intentionally verbose for the discussion. The implementation may consolidate some windows if ad set count becomes too high, but it should not lose service and decision-stage attribution.

---

## Implementation Files Likely To Change

Core types:

- `src/types/campaigns.ts`

Phase generation:

- `src/lib/campaigns/phases.ts`
- New file: `src/lib/campaigns/food-booking-phases.ts`

Generation and validation:

- `src/lib/campaigns/generate.ts`
- `src/app/(app)/campaigns/actions.ts`
- `src/lib/campaigns/quality-score.ts`

Publishing:

- `src/app/(app)/campaigns/[id]/actions.ts`

UI:

- `src/features/campaigns/CampaignBriefForm.tsx`
- `src/features/campaigns/CampaignTree.tsx`
- Potential new component: `src/features/campaigns/FoodBookingSchedulePreview.tsx`

Analytics and optimisation:

- `src/lib/campaigns/optimisation.ts`
- `src/lib/campaigns/dashboard.ts`
- `src/lib/campaigns/event-booking-insights.ts` should either be broadened or a new food/table insight module should be added.

Database:

- New Supabase migration for ad set timestamp fields and food metadata.

Tests:

- `tests/lib/campaigns/food-booking-phases.test.ts`
- `tests/lib/campaigns/generate.test.ts`
- `tests/lib/campaigns/quality-score.test.ts`
- `tests/lib/campaigns/publish.test.ts`
- `tests/lib/campaigns/optimisation.test.ts`

---

## Test Cases To Add

Phase generation:

- Generates Tue-Fri weekday dinner windows with correct London-local start/end times.
- Stops weekday dinner ads by default at 18:30, Friday optionally 19:00.
- Generates Saturday planning, lunch, afternoon, and final windows.
- Generates Sunday roast Friday/Saturday/Sunday windows.
- Stops Sunday roast ads before last orders.
- Handles UK daylight saving time correctly.

Copy validation:

- Fails `food_booking` ads without booking/table language.
- Fails `food_booking` ads with CTA other than `BOOK_NOW`.
- Fails Sunday roast copy that says "tonight".
- Fails Sunday roast last-orders copy outside Sunday day-of.
- Fails weekday ads that mention Sunday roast.

Publishing:

- Uses explicit `phase_start_at` and `phase_end_at` when present.
- Requires conversion setup for `food_booking`.
- Uses `OUTCOME_SALES` and `OFFSITE_CONVERSIONS`.
- Adds ad-level variant short links.

Analytics:

- Attributes `booking_type = table` events to food campaigns.
- Segments by `food_intent`.
- Reports weekday dinner, Saturday food, and Sunday roast separately.

---

## Open Questions For The Next Agent Or Product Discussion

1. What table booking system is used, and can it reliably send `bookingType: "table"` conversion events?
2. Is there one booking URL for all food, or separate URLs for general tables and Sunday roast?
3. Are weekday last orders available, or should the system assume service end minus 30 minutes?
4. Which weekday nights most need demand: Tuesday/Wednesday, all weekdays equally, or variable by season?
5. Should Friday dinner be treated as weekday regular menu, weekend food, or both?
6. What are the hero proof points for regular menu and Sunday roast?
7. Should Sunday roast ads mention limited availability only when availability data is real?
8. How many weeks should v1 generate at once: 1, 2, or 4?
9. Should the user be allowed to manually turn off individual windows before publishing?
10. What monthly budget will make this viable without fragmenting ad sets too much?

---

## Recommended Build Sequence

### Phase 1 - Spec-backed MVP

- Add `food_booking` campaign kind.
- Add service schedule config in code.
- Add food booking phase generator.
- Add explicit ad set timestamp fields.
- Update publish flow to use explicit timestamps.
- Add food booking copy validation.
- Add basic UI controls and schedule preview.
- Require conversion setup before publish.

### Phase 2 - Measurement

- Ensure table booking conversions are ingested.
- Add `food_intent` segmentation to dashboard.
- Add food-specific attribution tests.
- Add first-party table booking performance to optimiser.

### Phase 3 - Optimisation

- Add dynamic need weighting.
- Add automatic weekly materialisation.
- Add creative fatigue warnings.
- Tune decision cutoffs from real booking data.

---

## Final Product Position

This should not be called evergreen.

The better product language is:

```text
Food Booking Campaign
```

Sub-label:

```text
Recurring food ads scheduled around your service times and booking decision windows.
```

This matches the business need: get the right people to reserve tables before the food service decision has already been made.
