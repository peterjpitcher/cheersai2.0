# Fix-Function Defect Log — Campaigns Section (2026-07-08)

Discovery: 7 parallel slices, every finding adversarially verified (high-effort refutation pass).
**27 raw findings → 23 survived verification (4 rejected as misreads) → 11 safe fixes applied, 12 risky items batched for approval.**

Verification pipeline (whole run): **lint ✓ · typecheck ✓ · test ✓ (1697 passed, 2 skipped) · build ✓**.

---

## Applied — safe fixes (verified)

| ID | Sev | File | Fix |
|----|-----|------|-----|
| FF-001 | — | campaigns/actions.ts, lib/campaigns/dashboard.ts | **Reported bug.** `getCampaignWithTree` now blends first-party bookings via `applyFirstPartyBookingCount`, so `/campaigns/[id]` bookings match `/campaigns`. |
| FF-002 | high | features/campaigns/CampaignDashboard.tsx | Sync / Optimise / Approve buttons swallowed server-action errors. Rewired to client handlers (`useTransition` + `useToast`) that surface errors + pending state (mirrors `CampaignActions`). Test mocks updated. |
| FF-003 | med | api/booking-conversions/route.ts | Ingest secret now uses constant-time `validateSecret` (was `!==`, timing-leak). |
| FF-004 | med | lib/campaigns/optimisation.ts | Nightly dedup: `tracking_issue` reasons (low_ctr/high_cpc) embed drifting metrics; normalise digits in the dedup key so the same issue no longer re-records every night. |
| FF-005 | med | lib/campaigns/dashboard.ts | (regression test) Added `dashboard.test.ts` asserting the blend maths (max, cost/booking, conv-rate, value flow, ad-set preservation). |
| FF-006 | low | lib/campaigns/dashboard.ts | Conversion rate clamped to 100% (first-party bookings can exceed clicks). |
| FF-007 | low | api/booking-conversions/route.ts | Post-CAPI status update guarded with `.or('capi_status.is.null,capi_status.neq.sent')` so a concurrent retry can't regress a `sent` row. |
| FF-008 | low | campaigns/actions.ts | `createFoodBookingCampaign` now validates `startDate` (real YYYY-MM-DD) before deriving windows — a malformed date silently persisted a broken DRAFT. |
| FF-009 | low | api/cron/optimise-meta-campaigns, sync-meta-campaigns | Cron routes now return HTTP 500 when there was work but every account/campaign failed (was always 200 → broken runs looked healthy). |
| FF-010 | low | campaigns/actions.ts | Removed phantom `campaign_type` / `auto_confirm` reads — **schema-confirmed those columns don't exist on `meta_campaigns`**; `campaignType` now explicitly mirrors `campaign_kind`, `autoConfirm` is `false`. |
| FF-011 | low | app/(app)/campaigns/error.tsx | Added an error boundary for `/campaigns` + `/campaigns/[id]` (both rethrow DB/Meta load failures). |

---

## Pending — risky, awaiting approval (external behaviour / money / metrics / feature removal)

Grouped by theme. None auto-applied per the workspace ethics gate.

### A. Publishing reliability (Meta publish/rollback)
- **R1 [high]** `campaigns/[id]/actions.ts:971` — on retry after `createMetaAd` fails, the already-created Meta **creative is orphaned and a new one is made every retry** (resume guard keys only on `meta_ad_id`; `meta_creative_id` is written but never selected back). Fix: select `meta_creative_id`, reuse it on resume.
- **R11 [low]** `campaigns/[id]/actions.ts:1133` — rollback *pauses* creatives, which Meta rejects; creatives are never cleaned up. Fix: DELETE creatives (or exclude from pause loop and rely on R1's reuse).

### B. Booking-attribution accuracy (affects the very numbers this ticket surfaced)
- **R9 [med]** `optimisation.ts:452` — one booking event is attributed to **every active campaign sharing an event**, inflating per-campaign first-party bookings. Fix: disambiguate by utm_content → short_code → utm_campaign before event_id; credit one campaign.
- **R8 [med]** `optimisation.ts:983` — management-app fallback bookings carry no utm_content/value → invisible to ad-level pause logic, always £0.
- **R5 [med]** `optimisation.ts:1059` — as a result the optimiser can **recommend pausing an ad that actually drove bookings**.

### C. Food budget weighting (only active under FOOD_OPTIMISATION flag)
- **R2 [high]** `food-budget-weighting.ts:187` — spend caps use raw un-normalised template weights; `computeFoodWindowWeights` (the normaliser) has **zero callers**, so enabling the flag hard-fails every multi-service food publish/materialise.
- **R7 [med]** `campaigns/actions.ts:1262` — `dayWeighting` / `manualDayWeights` are collected + stored but never affect allocation (dead user input). Same root as R2.
- **R6 [med]** `campaigns/[id]/actions.ts:555` — per-ad-set £1 floor can push the sum of ad-set budgets above the campaign budget.

### D. RecurringControls (dead/broken feature)
- **R3 / R4 [high]** `campaigns/[id]/page.tsx:105` — RecurringControls **never renders**: it gates on `campaignKind` values (`weekly`/`daily`/…) that `meta_campaigns.campaign_kind` never holds (only event/evergreen/food_booking).
- **R12 [low]** `recurring-controls.tsx:35` — its pause/resume/stop actions expect lowercase statuses and target the **legacy `campaigns` table** (schema-confirmed to exist, separate from `meta_campaigns`).
- **Recommendation:** remove the dead UI + actions unless recurring *paid* campaigns are on the roadmap.

### E. Ingest hygiene
- **R10 [low]** `booking-conversions/route.ts:44` — ingest accepts unbounded/future `occurredAt`; a stale value is silently undeliverable to Meta (7-day CAPI window). Fix: reject/clamp future + >~6.5-day-old timestamps.

---

## Rejected by verification (documented, no action)
- `dashboard.ts:174` blendedBookingValue "discards Meta value" — Meta per-booking value isn't tracked here; not a defect.
- `campaigns/[id]/actions.ts:1069` "No ad sets published early return skips rollback" — refuted; created campaign is intentionally left for resume.
- `optimisation.ts:477` blendedBookingValue £0 — same as above.
- `app/actions/campaigns.ts:42` recurring actions "status constraint rejects" — no status CHECK constraint exists (schema-confirmed); the wrong-table point is captured under R12.
