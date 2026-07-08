# Fix-Function Discovery — Campaigns Section (2026-07-08)

Base commit: `ba87cd874ba62e0fe6dc03156eabcb784fdd38a5`

## Reported symptom

Bookings show on `/campaigns` (list) but not on `/campaigns/[id]` (detail).
- List "Music Bingo at The Anchor": **1 (1 first-party)**, £1.52 cost/booking.
- Detail performance matrix: **0** bookings on every row, £0.00 cost/booking.

## Root cause (FF-001 — confirmed, fixed)

Two different data paths compute the Bookings column:

- **List** (`getCampaignDashboard` → `loadDashboardFirstPartyBookingStats` → `buildCampaignDashboard` → `applyFirstPartyBookingCount`) queries `booking_conversion_events` and blends first-party bookings into `performance.conversions` as `blendedBookings = max(metaConversions, firstPartyBookings)`.
- **Detail** (`getCampaignWithTree` → `dbRowToPerformance`) read `conversions = metrics_conversions` (Meta-only = 0) and hardcoded `firstPartyBookings: 0`. It never queried `booking_conversion_events`, so the detail matrix showed Meta's zero.

The detail page's `PerformanceMatrix` renders `performance.conversions` for the Bookings column ([page.tsx:602](../../src/app/(app)/campaigns/[id]/page.tsx)). With no blend, that is always the Meta-reported number, which is 0 while pixel/CAPI attribution is broken (exactly what the on-page "Booking blocker" recommendation reports).

### Fix applied
- `src/lib/campaigns/dashboard.ts`: exported `applyFirstPartyBookingCount`.
- `src/app/(app)/campaigns/actions.ts`: `getCampaignWithTree` now loads first-party booking stats (reusing `loadDashboardFirstPartyBookingStats`) and applies the same campaign-level blend, preserving the nested ad-set tree. Ad-set/ad rows remain Meta-only (first-party events are attributed at campaign level only — consistent with the dashboard).

## Perimeter mapped

Critical path: `campaigns/actions.ts`, `campaigns/[id]/actions.ts`, `campaigns/[id]/page.tsx`, `campaigns/page.tsx`, `lib/campaigns/dashboard.ts`, `lib/campaigns/optimisation.ts`, `lib/campaigns/performance-sync.ts`.
Supporting: `lib/campaigns/*` (generate, food-*, attribution, conversion-readiness, performance-matrix), `lib/meta/conversions-api.ts`, `api/booking-conversions`, `api/cron/*`.
UI: `features/campaigns/*`.

## Discovery workflow

Run ID `wf_b1ef3422-a6c` — 7 parallel discovery slices, each finding adversarially verified. Results appended to `defect-log.md` on completion.
