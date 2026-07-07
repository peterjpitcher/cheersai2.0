# Defect & Improvement Log — /campaigns (2026-07-07)

Severity: C=Critical H=High M=Medium L=Low. Confidence: H/M/L.
Buckets: SAFE (fix now) / RISKY (single approval batch) / OOS (out of scope).

## Cluster 1 — Booking-conversion tracking

### FF-001 · Bug (config) · C · Confidence H · RISKY
- **Evidence**: Live probe of https://www.cheersai.uk/api/booking-conversions → 500
  `BOOKING_CONVERSION_INGEST_SECRET is not configured`. `vercel env ls production` on both
  projects: cheersai2-0 missing `BOOKING_CONVERSION_INGEST_SECRET` + `BOOKING_CONVERSION_ACCOUNT_ID`;
  the-anchor-pub missing `NEXT_PUBLIC_META_PIXEL_ID` + `CHEERSAI_BOOKING_CONVERSIONS_SECRET`.
  `booking_conversion_events` has 0 rows.
- **Impact**: No booking conversion has ever been tracked. Meta ads cannot optimise for Purchase.
- **Root cause**: Code shipped; env vars never set in production on either side.
- **Sibling check**: all other env vars used by the campaigns path verified present
  (FACEBOOK_APP_SECRET, CHEERSAI_FEED_API_KEY, CRON_SECRET, GA4_API_SECRET on site).
- **Fix**: generate shared secret; set 4 env vars; redeploy both projects (rebuild required for
  NEXT_PUBLIC_ var). Prepared commands in todo.md.
- **Acceptance**: probe returns 401 for bad secret / 200 for signed test event; pixel loads on
  www.the-anchor.pub; new booking row appears in booking_conversion_events.
- **Status**: PREPARED — awaiting approval batch.

### FF-002 · Missing behaviour · H · Confidence H · SAFE
- **Evidence**: `route.ts:162-204` forwards CAPI once, synchronously; `capi_status='failed'`
  rows are never retried; no backfill for events stored while CAPI unconfigured.
  Meta CAPI accepts events up to 7 days old.
- **Impact**: transient Meta/API failures permanently lose conversions; weaker optimisation signal.
- **Fix**: new cron `/api/cron/retry-capi-conversions` (hourly) re-forwards consented rows with
  `capi_status in ('failed') or capi_status is null` and `occurred_at > now()-6.5 days`; register in vercel.json.
- **Acceptance**: unit test — failed row is retried and status transitions; cron auth enforced.
- **Status**: FIXED (route + vercel.json + tests) — verified via vitest.

### FF-003 · Observability · M · Confidence H · SAFE
- **Evidence**: `route.ts:118-155` — non-consented events insert with `capi_status` NULL.
- **Impact**: cannot distinguish "no consent" from "not yet forwarded"; retry cron would need this.
- **Fix**: set `capi_status='skipped'`, `capi_error='no_consent'` at insert when consent absent.
- **Status**: FIXED — covered by ingest route tests.

### FF-004 · Data quality (match keys) · H · Confidence H · code SAFE / activation RISKY
- **Evidence**: `conversions-api.ts:43-51` — user_data only fbp/fbc/client_user_agent; site
  collects email+phone at booking but never sends hashes; client IP never captured.
- **Impact**: poor CAPI match quality → Meta undercounts conversions, attribution weak.
- **Fix**: ingest accepts optional `emailSha256`/`phoneSha256`/`clientIpAddress`, stores (hashed
  only) and forwards as em/ph/client_ip_address; website hashes (SHA-256, normalised) and sends
  them only when marketing consent granted. New columns via migration (NOT applied — batch).
- **Status**: CODE READY both sides — inert until FF-001 batch approved (site not sending).

### FF-005 · Bug (website) · M · Confidence M · CLOSED (not a defect)
- **Verified**: PayPal capture fires client-side via the SDK approve callback with attribution in
  the POST body BEFORE any redirect; `payment-return` is only a cancel/legacy path. Attribution
  survives the normal deposit flow. The only loss case (finishing PayPal in a different browser)
  also breaks the booking flow itself — nothing to fix without redesigning deposits.

### FF-006 · Hardening · L · Confidence M · OOS (logged)
- No rate limiting on ingest; bearer-secret protected, single tenant. Deferred.

### FF-007 · Missing tests · M · Confidence H · SAFE
- No tests for ingest route or CAPI payload construction.
- **Fix**: tests for auth, validation, consent gating, capi_status writes, payload shape, retry cron.
- **Status**: FIXED.

### FF-008 · UX/ops · L · Confidence H · SAFE
- `sync-meta-campaigns` cron reports aggregate only; partial failures invisible.
- **Fix**: report synced/failed counts per run.
- **Status**: FIXED.

### FF-009 · Env registration · M · Confidence H · SAFE
- `BOOKING_CONVERSION_INGEST_SECRET`/`BOOKING_CONVERSION_ACCOUNT_ID` read via `process.env`
  directly, not registered in `src/env.ts` (project rule) nor `.env.example`.
- **Status**: FIXED (registered as optional server vars + documented).

## Cluster 2 — Paid media copy for booking conversion

### FF-020 · Functional gap · H · Confidence H · SAFE
- **Evidence**: `generate.ts` — objective/optimisation goal computed post-generation
  (`isBookableDestination`), never injected into the prompt.
- **Impact**: model writes without knowing it's a Purchase-conversion campaign.
- **Fix**: inject explicit conversion-vs-traffic context into user prompt.
- **Status**: FIXED + tests.

### FF-021 · Copy quality · M · Confidence H · SAFE
- No price-anchoring guidance, no social-proof extraction, urgency hardcoded per phase
  irrespective of truthfulness; offer must be inferred from free-text brief.
- **Fix**: system-prompt additions: extract offer/price/social proof from brief; price-anchor
  pattern when both regular+offer prices present; honest-urgency rule (only claim scarcity given
  evidence in brief); friction-reassurance guidance (free/instant/cancellable booking).
- **Status**: FIXED + tests.

### FF-023 · Copy integrity · L · Confidence H · SAFE
- `enforceAdSetConstraints` (`generate.ts:165-200`) hard-slices headline/description mid-word.
- **Fix**: word-boundary-aware trim.
- **Status**: FIXED + tests.

### FF-011 · Stale test (website, found in pass 2) · M · Confidence H · SAFE
- **Evidence**: `tests/api/event-bookings-policy-fallback.test.ts` failing on HEAD — paid-event
  attendee-name rule (commit c7e4fd78) was never reflected in the test payload.
- **Status**: FIXED (attendee_names added); full jest suite green.

## Adversarial review findings (pass 3) — all applied
- REAL BUG: event-bookings hashPhoneForMeta missed `default_country_code` → wrong hashes for
  non-UK numbers. FIXED + test.
- Hardening: hashPhoneForMeta validates country code (falls back to '44'); trimToLimit
  empty-string guard; retry cron NaN guard on numeric `value`; migration index predicate
  tightened to mirror the cron filter; retry test now locks the PostgREST `.or()` filter string.

## Closed / not defects
- Pixel↔CAPI dedup: correct (shared event id = booking reference) — earlier report wrong.
- GA4_API_SECRET: present in production (23d ago).
- BOOK_NOW→BOOK_TRAVEL mapping: intentional, documented in code.
- publishCampaign partial failure: resumable by design (`meta_adset_id` reuse) — acceptable.
