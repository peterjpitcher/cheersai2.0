# Food Booking — Phase 2 (Measurement) Spec

**Date:** 2026-06-08
**Status:** Ready for review
**Owner:** Peter Pitcher
**Depends on:** Phase 1 ([spec](./2026-06-08-food-booking-campaign-spec.md), PR #14) merged + the migration applied + live `booking_type='table'` conversions flowing.
**Project:** CheersAI 2.0

---

## 1. Summary

### Plain English
Once food campaigns are live, owners need to see what's working: how many **tables** each service booked (weekday dinner vs Saturday vs Sunday roast), which decision window pulled them in, and what each booking cost. Phase 2 adds a **Food Booking** panel to the campaigns dashboard that reports table bookings segmented by service, decision stage, and window, with **cost per table booked** and **Sunday roast called out separately**.

### Technical
Add a read-only `fetchFoodBookingInsights(accountId)` that queries `booking_conversion_events` where `booking_type='table'`, resolves each booking's service/decision-stage by joining `utm_content → ads.utm_content_key → ads.adset_id → ad_sets.service_key/decision_stage` (data already fetched for the dashboard), and aggregates over 30/90-day windows — mirroring the existing `fetchEventBookingInsights`. Surface a `foodBookingInsights` block on `CampaignDashboardModel` and a `FoodBookingInsightsPanel` component, both error-safe and flag-gated. **No schema change.**

---

## 2. Goals / Non-goals

### Goals
- Report table bookings by **service** (`weekday_dinner` / `saturday_food` / `sunday_roast`), by **decision stage**, and by **window** (`windowKey`).
- Report **cost per table booking** (overall + per service, best-effort).
- Surface **Sunday roast separately** from regular-menu food.
- Reuse the existing insights pattern (error-safe optional block, server-fetched, no new caching).

### Non-goals (Phase 2)
- No budget reallocation or automated optimisation (that's Phase 3).
- No new DB tables/columns or migration.
- No dependency on the external booking site sending `food_intent` (we derive service from our own ad-set metadata; `food_intent` is a best-effort cross-check only).
- No per-date drill-down beyond `windowKey` aggregation.

---

## 3. Decisions (assumptions of record)

| # | Decision | Choice |
|---|----------|--------|
| P2-1 | Attribution source | Derive service/stage via `utm_content → ads → ad_sets` join (robust, app-side). `booking_conversion_events.food_intent` is a fallback/cross-check only. |
| P2-2 | Time windows | 30-day and 90-day, mirroring `event-booking-insights`. |
| P2-3 | Segments | `topServices`, `topDecisionStages`, `topWindows` (windowKey), each top-N by bookings; plus Sunday-roast totals broken out. |
| P2-4 | Cost per table booking | Overall = food spend ÷ table bookings; per-service best-effort using the same join. |
| P2-5 | Schema | None. Read-only over existing tables/columns. |
| P2-6 | Surfacing | New `foodBookingInsights` on `CampaignDashboardModel`; new `FoodBookingInsightsPanel`, gated by `featureFlags.foodBooking` and hidden when there are zero table bookings. |
| P2-7 | Join unit | Match on `ads.utm_content_key` via the existing `utmContentMatchesAd` helper; `utm_content` is unique per occurrence (`windowKey-runDate`) from Phase 1, so each booking maps to exactly one ad/ad set. |

---

## 4. Architecture

```
getCampaignDashboard(accountId)                              ← src/app/(app)/campaigns/actions.ts
  Promise.all([
    meta_campaigns (*, ad_sets(*, ads(*)))   ← already fetched
    fetchOptimisationActionSummaries()        ← existing
    fetchEventBookingInsights()               ← existing
    fetchFoodBookingInsights(accountId, {supabase, campaignTree})  ← NEW
  ])
        │
        ▼
buildCampaignDashboard(..., foodBookingInsights)             ← src/lib/campaigns/dashboard.ts
        │  CampaignDashboardModel.foodBookingInsights
        ▼
<CampaignDashboard> → <FoodBookingInsightsPanel>             ← src/features/campaigns/CampaignDashboard.tsx
```

`fetchFoodBookingInsights` builds a `utm_content_key → { serviceKey, decisionStage, windowKey }` map from the fetched campaign tree (food ad sets carry `service_key`/`decision_stage`; the ad carries `utm_content_key`), then folds `booking_type='table'` rows onto it.

---

## 5. The insights module

New `src/lib/campaigns/food-booking-insights.ts` (mirrors `event-booking-insights.ts`):

```ts
export interface FoodBookingInsightItem {
  key: string;        // serviceKey | decisionStage | windowKey
  name: string;       // display label
  bookings: number;
  value: number;      // sum of booking value
  costPerBooking: number | null;  // service spend ÷ bookings, null if spend unknown
}

export interface FoodBookingInsights {
  totalBookings30d: number;
  totalBookings90d: number;
  totalValue90d: number;
  costPerTableBooking: number | null;     // overall food spend ÷ table bookings (90d)
  sundayRoastBookings90d: number;          // roast broken out
  sundayRoastValue90d: number;
  topServices90d: FoodBookingInsightItem[];
  topDecisionStages90d: FoodBookingInsightItem[];
  topWindows90d: FoodBookingInsightItem[];
}

export const EMPTY_FOOD_BOOKING_INSIGHTS: FoodBookingInsights = { /* zeros + [] */ };

export async function fetchFoodBookingInsights(
  accountId: string,
  options: { supabase: SupabaseClient; campaignTree: CampaignWithAdSets[] },
): Promise<FoodBookingInsights>;
```

- Query: `booking_conversion_events` `select(booking_id, booking_type, utm_content, food_intent, value, currency, occurred_at)` `.eq('account_id', accountId).eq('booking_type','table').gte('occurred_at', since90d)`.
- Resolve each row's service/stage/window from the `utm_content_key` map (via `utmContentMatchesAd`); if no match, fall back to `food_intent` for the service; otherwise bucket as `unattributed`.
- Spend per service comes from the already-computed per-ad-set performance (sum spend of ad sets sharing a `service_key`).
- Pure aggregation given inputs → unit-testable with fixtures.

---

## 6. Dashboard model + UI

- `src/lib/campaigns/dashboard.ts`: add `foodBookingInsights: FoodBookingInsights` to `CampaignDashboardModel` (optional param defaulting to `EMPTY_FOOD_BOOKING_INSIGHTS`, exactly like `eventBookingInsights`).
- `src/app/(app)/campaigns/actions.ts`: add `fetchFoodBookingInsights` to the existing `Promise.all`, with the same catch-and-fallback to `EMPTY_FOOD_BOOKING_INSIGHTS`.
- `src/features/campaigns/CampaignDashboard.tsx`: new `FoodBookingInsightsPanel` (copy `EventBookingInsightsPanel`): summary tiles (table bookings, value, cost per booking, Sunday roast bookings) + three lists (services, decision stages, windows). **Empty state** when `totalBookings90d === 0`; render only when `featureFlags.foodBooking`. Semantic markup, design tokens, no colour-only signals (per `ui-patterns.md`).

---

## 7. Deployment safety

- **No migration, no schema change** — read-only over existing tables/columns.
- **RLS**: all reads scoped to `account_id` via the anon/server client (respects RLS), consistent with existing insights.
- **Cache**: dashboard is server-fetched per request; no new caching and no `revalidate` needed (read-only). The new query is one indexed scan (`booking_conversion_events_account_occurred_idx`).
- **Failure isolation**: `fetchFoodBookingInsights` is wrapped in catch→`EMPTY_FOOD_BOOKING_INSIGHTS`, so a reporting error never breaks the dashboard.
- **Flag**: panel hidden unless `featureFlags.foodBooking`; zero-data → empty state. Safe to ship before any food campaign exists.
- **Rollback**: remove the panel + the one `Promise.all` entry; no data migration to undo.

---

## 8. Testing (Vitest)

- `tests/lib/campaigns/food-booking-insights.test.ts`:
  - Attributes `booking_type='table'` rows to the correct service/stage/window via the `utm_content_key` map.
  - Ignores `booking_type='event'` rows.
  - Sunday roast totals broken out correctly.
  - Cost per table booking = spend ÷ bookings; `null` when spend unknown; no divide-by-zero.
  - Unmatched `utm_content` falls back to `food_intent`, then `unattributed`.
  - 30d vs 90d windowing.
  - Empty input → `EMPTY_FOOD_BOOKING_INSIGHTS`.
- Dashboard integration: `buildCampaignDashboard` passes `foodBookingInsights` through.
- UI: `FoodBookingInsightsPanel` renders populated + empty states; hidden when flag off.
- Each PR passes `npm run ci:verify`.

---

## 9. Build sequence (PRs)

| PR | Title | Complexity |
|----|-------|-----------:|
| 6 | `fetchFoodBookingInsights` + types + tests (logic only) | M (3) |
| 7 | Wire into dashboard model + `getCampaignDashboard` + `FoodBookingInsightsPanel` + tests | M (3) |

Both are additive and independently shippable behind the flag.

---

## 10. Risks & open items

- **Attribution coverage**: depends on Phase 1's unique `utm_content` (`windowKey-runDate`) reaching `booking_conversion_events.utm_content`. Verify the live booking flow propagates `utm_content` before trusting per-window numbers; the `unattributed` bucket makes gaps visible rather than silently mis-bucketing.
- **Spend-per-service granularity**: Meta spend is per ad set; summing by `service_key` is sound, but cost-per-booking is only as good as conversion coverage in the attribution window — label it "attributed" in the UI.

### Resolved defaults (overridable on review)
- **Horizons**: 30/90-day, matching `event-booking-insights` for one consistent pattern. (Alternative if you prefer food's weekly rhythm: 28/90.)
- **Window rows**: include `topWindows90d` as a secondary list under services + decision stages (not the headline).
- **Unattributed**: show an `unattributed` row in the panel when its count is > 0 (transparency); otherwise hide it.
