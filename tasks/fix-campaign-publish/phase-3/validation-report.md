# Validation Report — Campaign Publish Pipeline

## Overall: GO ✓

---

## QA Test Matrix — All PASS

| Defect | Fix | Result | Evidence |
|---|---|---|---|
| D1 `billing_event` missing | Added `billing_event: 'IMPRESSIONS'` | PASS | `marketing.ts:187` |
| D2 `special_ad_categories` encoding | Omit for NONE; JSON.stringify for non-NONE | PASS | `marketing.ts:152–155` |
| D4 `message` in `link_data` | Removed from `linkData` | PASS | `marketing.ts:248–257` |
| D5 Campaign marked ACTIVE with zero ad sets | `successfulAdSets` guard added | PASS | `actions.ts:232, 274, 376–381` |
| D6 No preflight warning | `hasNoCreatives` + amber panel added | PASS | `page.tsx:37–43, 88–97` |
| D7 Raw error messages | `mapMetaErrorToUserMessage` added | PASS | `actions.ts:86–97, 396` |

---

## Ripple Check — COMPLETE

All immediate integration surfaces confirmed updated. Deferred items (Publish button disable, cron sync) confirmed out of scope and untouched.

---

## Regression Check — CLEAN (after fixes)

Two issues found and fixed post-validation:

1. **`successfulAdSets` not incremented on retry resume path** — fixed: added `successfulAdSets++` inside the `if (adSet.meta_adset_id)` branch. Retry publish now correctly recognises already-created ad sets.

2. **`hasNoCreatives` vacuous truth on empty ads array + adsetMediaAssetId** — fixed: `hasNoCreatives` now returns `false` if an ad set has a shared image, and `false` if an ad set has no ads defined. Warning only fires when there are genuinely image-less ads.

3. **TypeScript**: `npx tsc --noEmit` — clean, zero errors.

---

## Out of Scope (confirmed deferred)

- D8 — Cron sync for ACTIVE campaigns with no Meta ad sets (`sync-meta-campaigns/route.ts`) — separate follow-on review recommended
- Publish button disable when no creatives assigned — UI enhancement, deferred
