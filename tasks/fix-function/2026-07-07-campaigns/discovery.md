# Discovery — /campaigns remediation (2026-07-07)

Base commit: 4aa52d4b32dcc686d36bae3af16851559320184d

## Problem statement
Booking conversions from the-anchor.pub never reach Meta, so paid campaigns cannot
optimise for bookings. Also: paid ad copy should be optimised for booking conversion.

## Architecture (as built — verified)
The chain is fully coded on both sides:

1. **Website (OJ-The-Anchor.pub)** captures `fbclid`/`utm_*`/`gclid` on landing
   (`lib/booking-attribution.ts`, 90-day localStorage+cookie), fires Meta Pixel
   `Purchase` with `eventID = booking reference` (`lib/meta-pixel.ts:93`), and on every
   confirmed booking POSTs the full attribution payload server-side to CheersAI
   (`lib/booking-conversion-forwarding.ts`, called from `app/api/table-bookings/route.ts:352`,
   `app/api/event-bookings/route.ts:384`, both PayPal capture routes).
2. **CheersAI** `/api/booking-conversions` (Bearer `BOOKING_CONVERSION_INGEST_SECRET`)
   upserts into `booking_conversion_events` (idempotent on account_id+booking_id) and, when
   `metaConsentGranted === true`, forwards to Meta Conversions API
   (`src/lib/meta/conversions-api.ts`) with `event_id = metaEventId = bookingId`
   → pixel/CAPI dedup is correct by design.
3. **Campaign publish** (`campaigns/[id]/actions.ts:896-902`) sets
   `optimization_goal = OFFSITE_CONVERSIONS` with `promoted_object = {pixel_id, custom_event_type}`
   when conversion setup is ready.
4. **Feedback loop**: `food-booking-insights.ts`, `event-booking-insights.ts`,
   `optimisation.ts` all read `booking_conversion_events` (matched via `utm_content`)
   and feed campaign generation and optimisation.

## Root cause (confirmed live)
The whole chain is disabled by **four missing production env vars**:

| Vercel project | Missing | Effect |
|---|---|---|
| the-anchor-pub | `NEXT_PUBLIC_META_PIXEL_ID` | Pixel never loads (`lib/meta-pixel.ts:42` returns ''); no Purchase events, no _fbp/_fbc |
| the-anchor-pub | `CHEERSAI_BOOKING_CONVERSIONS_SECRET` | forwarding no-ops with `not_configured` |
| cheersai2-0 | `BOOKING_CONVERSION_INGEST_SECRET` | endpoint 500s — **confirmed by live probe**: `{"error":"BOOKING_CONVERSION_INGEST_SECRET is not configured"}` |
| cheersai2-0 | `BOOKING_CONVERSION_ACCOUNT_ID` | endpoint 500s |

Ground truth (live Supabase `nbkjciurhvkfpcpatbnt`):
- `booking_conversion_events`: **0 rows ever**.
- `meta_ad_accounts` (account 91fda684-2801-4abb-980e-f42cec017cef): pixel `757659911002159`
  (matches website), CAPI token present, `conversion_event_name='Purchase'`,
  `conversion_optimisation_enabled=true` → downstream is ready.
- GA4_API_SECRET **is** present in the-anchor-pub production (added ~23d ago) — the
  earlier `.env.local` observation does not apply to prod.

## Secondary weaknesses (evidence in defect-log.md)
- No CAPI retry/backfill; failed or pre-config conversions are lost (Meta accepts ≤7-day-old events).
- CAPI match quality limited to fbp/fbc/UA; site collects email+phone but never sends hashes; no client IP.
- `capi_status` left NULL for non-consented rows (undiagnosable table).
- Ingest route has no tests; CAPI payload builder has no tests.
- `BOOKING_CONVERSION_*` env vars not registered in `src/env.ts` (project rule violation).
- Paid-copy generation never told the campaign objective (computed post-generation).
- No structured offer/price-anchoring/social-proof guidance in prompt; phase urgency hardcoded.
- `enforceAdSetConstraints` hard-slices copy mid-word at field limits.
- Sync cron reports only aggregate success.

## Perimeter classification
- Critical path: `src/app/api/booking-conversions/route.ts`, `src/lib/meta/conversions-api.ts`,
  `src/lib/campaigns/generate.ts`, `campaigns/[id]/actions.ts` (publish), website booking API
  routes + `lib/meta-pixel.ts` + `lib/booking-conversion-forwarding.ts`.
- Supporting: conversion-readiness, insights modules, optimisation, cron routes, env.ts.
- Peripheral: dashboards, previews, naming, tests/fixtures.
