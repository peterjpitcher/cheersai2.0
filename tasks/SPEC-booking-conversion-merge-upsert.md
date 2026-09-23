# SPEC: booking conversion ingest must not blank fields a previous post filled

Status: implemented
Date: 2026-09-10
Repos touched: `cheersai2.0` (this repo), `the-anchor.pub` (the website)

## Problem

Read-only checks on 10 September 2026 against The Anchor
(`account_id = 91fda684-2801-4abb-980e-f42cec017cef`,
`public.booking_conversion_events`, `booking_type = 'table'`):

| Month | Rows | Rows with `value = 0` | Rows with a party size |
|---|---|---|---|
| July | 62 | 61 | 1 |
| August | 83 | 78 | 5 |
| September (to the 10th) | 24 | 21 | 3 |

57 of the 58 August rows forwarded to Meta CAPI carried `value = 0`, as did all 13
September rows. `event_date` was empty on every table row.

The website is meant to report a table booking as party size x GBP 25
(`lib/booking-conversion-value.ts` on the-anchor.pub) together with the party size.

## Cause

Each confirmed table booking is posted to `/api/booking-conversions` **twice**, under
the same booking reference:

1. Server-side, from `app/api/table-bookings/route.ts` (and the PayPal deposit route),
   with the real party size and party size x GBP 25. This post is awaited before the
   booking response reaches the browser, so it lands **first**.
2. From the browser, `lib/meta-pixel.ts` -> `/api/tracking/booking-conversion` ->
   this endpoint, triggered by `trackMetaBookingPurchase`. The table-booking caller in
   `lib/gtm-events.ts` never passed the party size, the booking date or a value, so the
   payload carried `tickets: null`, `value: 0` and `eventDate: null`. This post lands
   **second**.

The ingest upsert is idempotent on `(account_id, booking_id)` and wrote every column
on every post. PostgREST only puts the columns present in the payload into
`ON CONFLICT DO UPDATE SET`, so the second post overwrote party size, covers value and
booking date with its placeholders. `event_date` was empty for a second reason as well:
neither server-side table path ever sent it.

## Change

### This repo (`src/app/api/booking-conversions/route.ts`)

A column is written only when the post actually carries information for it. Absent,
`null`, empty-string and (for `value`) zero all mean "this sender does not know", so
those keys are dropped from the upsert payload and PostgREST leaves the stored value
untouched. The route already relies on this exact semantic for the advanced-matching
columns (`email_sha256` and friends are omitted until supplied), so the mechanism is
unchanged, only its reach is widened.

Zero is treated as "unknown" for `value` because that is what the senders emit when
they cannot work a value out: `estimateTableBookingValue` returns `0` for a missing
party size. Reporting already maps a null value to 0, so nothing downstream shifts.

Always written, never merged:

- `account_id`, `booking_id`, `source_site`, `meta_event_id`, `booking_type`,
  `occurred_at`: identity and classification, always known to both senders.
- `meta_consent_granted`, `fbp`, `fbc`, `client_user_agent`: **consent gating is
  unchanged**. Consent is a property of the post rather than a fact about the booking,
  so a post without consent still clears the browser identifiers, exactly as before.

Merged (written only when known): `event_id`, `event_slug`, `event_name`,
`event_category_name`, `event_category_slug`, `event_date`, `tickets`, `value`,
`currency`, `food_intent`, `source_url`, `landing_path`, the five `utm_*` columns,
`fbclid`, `gclid`, `short_code`, `attribution_captured_at`, `attribution_updated_at`.

`currency` is omitted rather than defaulted to `'GBP'` in the route, so a later post
cannot overwrite a real currency with the fallback. The column is
`not null default 'GBP'`, so a first post without a currency still inserts `GBP`.

The fix is a single `insert ... on conflict do update` with a shorter `set` list. It
stays atomic, so two posts racing each other cannot lose either sender's fields, and it
needs no migration and no schema change, which keeps the pre-migration compatibility
the route already has.

### The website (`the-anchor.pub`, separate PR)

1. `lib/gtm-events.ts`: the table-booking success path now passes `numItems`
   (party size), `eventDate` (booking date) and party size x GBP 25 into
   `trackMetaBookingPurchase`, matching what the server forwards for the same booking
   reference. On the deposit path this replaces the deposit amount, which was never the
   booking's worth.
2. `lib/meta-pixel.ts`: the forwarded payload omits `tickets` and `value` when they are
   not known, instead of sending `null` and `0`. The `fbq` Purchase event is untouched,
   so the pixel still reports a numeric value.
3. `app/api/table-bookings/route.ts` and
   `app/api/table-bookings/paypal/capture-order/route.ts`: send `eventDate` (the
   booking date), which neither did.

Pixel and CAPI deduplication is unchanged: both senders still key `bookingId` and
`metaEventId` on the booking reference, and the browser pixel still fires with
`eventID` set to that same reference.

## Not in scope

No existing row is backfilled or rewritten. The July to September rows keep their
zeroes until Peter explicitly asks for a backfill.

## Rollback

Revert the commit in each repo. There is no migration, no schema change and no
configuration change, so a revert restores the previous behaviour immediately. The two
repos are independent: reverting one does not require reverting the other.
