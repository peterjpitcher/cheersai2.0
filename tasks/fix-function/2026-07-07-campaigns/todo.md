# Remediation todo — /campaigns (2026-07-07)

## Cluster 1 — conversion tracking (CheersAI)
- [x] FF-003: capi_status='skipped'/no_consent at insert for non-consented events (guarded so a 'sent' row is never downgraded)
- [x] FF-002: retry/backfill cron `/api/cron/retry-capi-conversions` + vercel.json entry (hourly :20)
- [x] FF-004 (ingest side): accept emailSha256/phoneSha256/clientIpAddress; forward to CAPI;
      migration file `20260707120000_booking_conversion_match_keys.sql` written, NOT applied (approval batch)
- [x] FF-009: registered env vars in src/env.ts (.env.example already documented them)
- [x] FF-007: tests — ingest route (new suite + fixed pre-existing suite's mock), CAPI payload, retry cron
- [x] FF-008: sync cron partial-failure reporting

## Cluster 2 — paid copy (CheersAI)
- [x] FF-020: conversion objective context injected into generation prompt (computed pre-prompt)
- [x] FF-021: CONVERSION COPY PRINCIPLES added to system prompt (offer-first, price anchoring,
      social proof, honest urgency, friction removal)
- [x] FF-023: word-boundary trim (trimToLimit) replacing mid-word slices
- [x] tests: generate.conversion.test.ts (prompt contract + trimToLimit)

## Cluster 3 — website (OJ-The-Anchor.pub)
- [x] FF-004 (site side): lib/booking-conversion-signals.ts (SHA-256 email/phone, client IP),
      wired consent-gated into table-bookings, event-bookings, both PayPal capture routes
- [x] FF-005: VERIFIED — attribution survives PayPal (client-side capture with attribution in body);
      only lost if user completes PayPal in a different browser (booking flow itself breaks then too). No fix needed.
- [x] FF-011 (found in pass 2): stale test event-bookings-policy-fallback broken by paid-event
      attendee-name rule from c7e4fd78 — fixed (pre-existing failure on HEAD, not caused by this run)
- [x] .env.example — already documents all needed vars; no change required

## Verification
- [x] Targeted suites: CheersAI 44/44 + 13/13 ingest suites; Anchor 28/28 + fixed suite 5/5
- [ ] CheersAI: npm run ci:verify full pass (running)
- [ ] Anchor: full jest (running); lint + tsc passed earlier
- [ ] Adversarial review pass over full diff (2 agents running)
- [ ] Final discovery pass (Step 8)

## Approval batch (RISKY — needs Peter's go-ahead; I can execute on approval)
- [ ] FF-001: set 4 production env vars (shared secret generated at execution, never written to disk):
      cheersai2-0: BOOKING_CONVERSION_INGEST_SECRET, BOOKING_CONVERSION_ACCOUNT_ID=91fda684-2801-4abb-980e-f42cec017cef
      the-anchor-pub: CHEERSAI_BOOKING_CONVERSIONS_SECRET (same secret), NEXT_PUBLIC_META_PIXEL_ID=757659911002159
- [ ] Apply CheersAI migration (additive columns + index) to project nbkjciurhvkfpcpatbnt
- [ ] Commit + push both repos (fresh builds pick up env; NEXT_PUBLIC var needs a real rebuild)
- [ ] Post-deploy verification: endpoint 401 probe, pixel present on www.the-anchor.pub,
      synthetic signed test event → row in booking_conversion_events
- [ ] FF-004 activation note: consent-gated hashed email/phone + client IP start flowing to Meta
      CAPI once the site deploy lands (bundled in this same batch)
