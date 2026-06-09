# Food Booking Campaign Type - Agent Handoff

**Date:** 2026-06-09  
**Repo:** OJ-CheersAI2.0  
**Purpose:** Continue the food/table-booking campaign discussion and implementation without needing the original conversation.

## 1. Plain-English Recommendation

The generic evergreen campaign type is not the right structure for food bookings. Food demand is time-sensitive: weekday dinner decisions happen around lunch, mid-afternoon, and before the commute home; Saturday food has lunch and early-dinner intent; Sunday roast needs its own Friday, Saturday, and Sunday messaging.

The right build is a dedicated `food_booking` campaign type:

- Parent campaign: one rolling food booking programme.
- Child ad sets: one ad set per scheduled decision window.
- Metadata: each ad set stores the service (`weekday_dinner`, `saturday_food`, `sunday_roast`), the decision stage, ad start/stop times, and budget weight.
- Ads: each ad has a unique `utm_content` key that keeps the window/date prefix so bookings can be attributed back to the right service and decision window.
- Publish: use `BOOK_NOW`; require conversion readiness; prefer campaign budget optimisation for food.
- Default booking URL: `https://www.the-anchor.pub/book-table`, editable before campaign creation.
- Sunday roast booking URL: defaults to the same URL, editable separately if a Sunday-specific landing page is preferred.
- Default food budget: £300 lifetime, editable before campaign creation.
- Reporting: show table bookings by service, decision stage, and ad window.

## 2. Venue Food Schedule

Known opening/service hours:

| Service key | Service | Days | Service hours | Last orders |
|---|---|---:|---:|---:|
| `weekday_dinner` | Regular menu | Tuesday-Friday | 16:00-21:00 | 20:30 |
| `saturday_food` | Regular menu | Saturday | 12:00-19:00 | 18:30 |
| `sunday_roast` | Regular menu plus Sunday roast | Sunday | 13:00-18:00 | 17:30 |

Sunday roast should be treated as the hero food offer, not as generic regular-menu food.

Weekday demand priority is all weekdays equally for now.

## 3. Recommended Ad Windows

### Weekday Dinner

Runs Tuesday-Friday for the same-day regular menu.

| Window key | Time | Weight | Intent |
|---|---:|---:|---|
| `weekday_lunch_decision` | 11:00-13:30 | 55 | Get dinner decided during lunch |
| `weekday_afternoon_commit` | 15:00-17:15 | 35 | Finalise after-work plans |
| `weekday_last_minute` | 17:15-18:30 | 10 | Low-weight rescue window; off by default |

Friday has a later hard stop of 19:00 because people can make later weekend decisions.

### Saturday Food

| Window key | Runs | Time | Weight | Intent |
|---|---|---:|---:|---|
| `saturday_planning` | Friday | 16:00-20:00 | 25 | Plan Saturday lunch or early dinner |
| `saturday_lunch_commit` | Saturday | 08:30-11:30 | 35 | Book lunch from 12pm |
| `saturday_afternoon_food` | Saturday | 12:30-16:30 | 30 | Afternoon food or early dinner |
| `saturday_final_nudge` | Saturday | 16:30-17:30 | 10 | Low-weight late demand; off by default |

### Sunday Roast

| Window key | Runs | Time | Weight | Intent |
|---|---|---:|---:|---|
| `sunday_roast_planning` | Friday | 09:00-14:00 | 20 | Get Sunday plans made early |
| `sunday_roast_tomorrow` | Saturday | 09:00-18:00 | 35 | Tomorrow urgency |
| `sunday_roast_morning` | Sunday | 08:30-11:30 | 30 | Commit before lunch service |
| `sunday_roast_last_tables` | Sunday | 11:30-16:00 | 15 | Last useful booking demand |

Sunday roast ads should stop by 16:00-16:30 because last orders are 17:30.

## 4. Implementation Status

Implemented in the app:

- `PaidCampaignKind` includes `food_booking`.
- Food service/window types exist in `src/types/campaigns.ts`.
- Food schedule defaults and timing rules live in `src/lib/campaigns/food-schedule.ts`.
- Food window generation lives in `src/lib/campaigns/food-booking-phases.ts`.
- Food booking draft creation lives in `src/app/(app)/campaigns/actions.ts` via `createFoodBookingCampaign`.
- Food ad sets persist:
  - `ads_start_time`
  - `ads_stop_time`
  - `service_key`
  - `decision_stage`
  - `budget_weight`
- Publishing supports food booking campaigns and forces `BOOK_NOW`.
- Food campaign UI exists behind `NEXT_PUBLIC_ENABLE_FOOD_BOOKING`.
- Dashboard now includes food/table-booking insights when the food feature flag is on.
- Food booking insights are calculated from `booking_conversion_events.booking_type = 'table'` and grouped back to service, decision stage, and ad window through `utm_content`.

Important implementation fix made in this pass:

- Food ads now get unique ad-level `utm_content` keys while preserving the window/date prefix.
- This avoids publish-time duplicate UTM failures and keeps Phase 2 attribution usable.
- The food campaign form now defaults to `https://www.the-anchor.pub/book-table`, £300 lifetime budget, and Anchor menu hooks from the live site SSOT.
- The form now has a separate Sunday roast booking URL override.
- The form now separates service end time from last orders.
- Publish now routes Sunday roast ad sets to the Sunday-specific URL when one is stored; otherwise it uses the default booking URL.

Default food hooks seeded into the form:

- Stone-baked 12-inch pizzas from £12.
- Beer-battered fish and chips with chunky chips, mushy peas, tartare sauce and lemon.
- Golden pastry pies including beef and ale, chicken and wild mushroom, and vegetarian butternut squash.
- Classic beef burger with chips from £11.
- Sunday roast with beef topside, pork leg, turkey, pies, vegan wellington, herb-and-garlic roast potatoes and signature gravy.

## 5. Measurement Model

New insight module:

```text
src/lib/campaigns/food-booking-insights.ts
```

It reports:

- `totalBookings30d`
- `totalBookings90d`
- `totalValue90d`
- `costPerTableBooking`
- `sundayRoastBookings90d`
- `sundayRoastValue90d`
- `topServices90d`
- `topDecisionStages90d`
- `topWindows90d`

Attribution logic:

1. Read table bookings from `booking_conversion_events`.
2. Match `booking_conversion_events.utm_content` to `ads.utm_content_key`.
3. Use the matched ad's parent ad set to get `service_key` and `decision_stage`.
4. Infer the food window from the `utm_content` prefix.
5. If no ad match exists, use `food_intent` as a weak fallback.
6. If that still does not identify the service, show it as `unattributed`.

Anchor site repo check:

- Checked `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub`.
- Confirmed table bookings are forwarded to CheersAI from `app/api/table-bookings/route.ts`.
- Confirmed payload includes `bookingType: 'table'`, `foodIntent`, `utmContent`, UTM fields, click IDs, and no direct customer PII.
- Confirmed tests cover this behavior in `app/api/table-bookings/__tests__/route.test.ts`.

## 6. What Still Needs Product Decisions

The build can support food campaigns now. Remaining decisions:

- Whether last-minute rescue windows should stay off by default.
- Which exact food photos should be mapped to each creative format.
- Whether £300 should be treated as a 1-week, 2-week, or monthly operating budget in future automation.

Last-minute rescue windows explained:

These are short, late same-day ads after the main decision window has probably passed. They are not the core strategy. They are a low-weight safety net for people still deciding late, but they can waste spend because many diners have already chosen what they are doing. Current recommendation: keep them off by default, test them only when there is spare budget or weak same-day demand.

## 7. Recommended Next Steps

1. Switch `NEXT_PUBLIC_ENABLE_FOOD_BOOKING` on in the intended environment.
2. Run one food campaign in draft first and inspect:
   - window schedule,
   - ad start/stop times,
   - ad copy timing accuracy,
   - unique `utm_content` keys,
   - `BOOK_NOW` CTA,
   - conversion readiness.
3. Publish a low-budget test for 1-2 weeks.
4. Verify table booking conversions arrive in `booking_conversion_events` with `booking_type = 'table'` and `utm_content`.
5. Review the dashboard food booking panel after the first conversions.
6. Only after reliable attribution, move to Phase 3:
   - dynamic budget weighting,
   - weekly rolling materialisation,
   - creative fatigue warnings,
   - cutoff tuning recommendations.

## 8. Files Worth Reading Next

- `src/lib/campaigns/food-schedule.ts`
- `src/lib/campaigns/food-booking-phases.ts`
- `src/lib/campaigns/food-booking-insights.ts`
- `src/app/(app)/campaigns/actions.ts`
- `src/app/(app)/campaigns/[id]/actions.ts`
- `src/features/campaigns/CampaignBriefForm.tsx`
- `src/features/campaigns/FoodBookingSchedulePreview.tsx`
- `src/features/campaigns/CampaignDashboard.tsx`
- `tests/lib/campaigns/food-booking-create.test.ts`
- `tests/lib/campaigns/food-booking-insights.test.ts`

## 9. My Opinion

This should not be handled as a generic evergreen campaign. The dedicated food booking campaign type is the right direction because the value is not just "promote food"; it is "promote the right food service during the window when people are still deciding." The biggest risk is not the schedule logic now; it is conversion coverage. If table bookings do not reliably pass `utm_content` back into `booking_conversion_events`, the optimiser will not know which window actually worked.
