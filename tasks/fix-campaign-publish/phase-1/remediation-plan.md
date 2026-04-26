# Remediation Plan — Campaign Publish Pipeline

## Critical (actively breaking publishing NOW)

### Fix 1 — D2: Fix `special_ad_categories` encoding
- **File**: `src/lib/meta/marketing.ts:createMetaCampaign`
- **Specialist**: Backend Engineer
- **Dependency**: None — fix first, this is the root cause of "Publishing Failed"
- **Action**: When `specialAdCategory === 'NONE'`, omit `special_ad_categories` from the request body entirely. For non-NONE values, pass as the string `JSON.stringify([specialAdCategory])`.

### Fix 2 — D1: Add `billing_event` to `createMetaAdSet`
- **File**: `src/lib/meta/marketing.ts:createMetaAdSet`
- **Specialist**: Backend Engineer
- **Dependency**: None — can be done in parallel with Fix 1
- **Action**: Add `billing_event: 'IMPRESSIONS'` to the request body. Add optional `billingEvent` field to `CreateAdSetParams` in `src/types/campaigns.ts` with `'IMPRESSIONS'` as the default.

### Fix 3 — D4: Fix `message` placement in `createMetaAdCreative`
- **File**: `src/lib/meta/marketing.ts:createMetaAdCreative`
- **Specialist**: Backend Engineer
- **Dependency**: None — can be done in parallel
- **Action**: Remove `message` from `linkData`. The `message` (primary text) should be passed at the `object_story_spec` level if supported, or removed from `link_data` entirely. Research Meta v24.0 spec for correct placement.

## High (campaign marks ACTIVE with zero live objects)

### Fix 4 — D5: Guard against marking ACTIVE with zero Meta ad sets
- **File**: `src/app/(app)/campaigns/[id]/actions.ts:publishCampaign`
- **Specialist**: Backend Engineer
- **Dependency**: Fix 1 (once campaign creation works, ad sets may start succeeding — but guard is still needed for partial failures)
- **Action**: Add `let successfulAdSets = 0;` before the ad set loop. Increment on each successful `createMetaAdSet`. After the loop, if `successfulAdSets === 0`, call `setPublishError('Campaign created but no ad sets could be published. Check ad set configuration.')` and return `{ error }` instead of marking ACTIVE.

### Fix 5 — D6: Add preflight warning for missing creatives
- **File**: `src/app/(app)/campaigns/[id]/page.tsx`
- **Specialist**: Frontend Engineer
- **Dependency**: None — UI-only change
- **Action**: After the existing publish error panel, add a new warning panel: if `status === 'DRAFT'` and all ads across all ad sets have no effective creative (neither `mediaAssetId` nor `adsetMediaAssetId`), show an amber warning box: "No images assigned — ads will be skipped during publishing. Add images in the campaign editor before publishing."

## Medium (UX polish — implement after critical/high)

### Fix 6 — D7: Map Meta error messages to human-readable text
- **File**: `src/app/(app)/campaigns/[id]/actions.ts:setPublishError` (or a new `mapMetaError` utility)
- **Specialist**: Backend Engineer
- **Dependency**: None
- **Action**: Before writing `publish_error` to DB, pass the error message through a simple mapper:
  - "Invalid parameter" → "Meta rejected the campaign configuration. Check ad account settings and try again."
  - "Error validating access token" → "Your Meta Ads token has expired. Please reconnect in Connections."
  - Otherwise: pass through as-is with a "Meta error: " prefix.

## Specialist assignments

| Specialist | Fixes | Notes |
|---|---|---|
| Backend Engineer | 1, 2, 3, 4, 6 | Can work on 1, 2, 3 in parallel; 4 after |
| Frontend Engineer | 5 | Independent, can work in parallel with backend |

## Order of execution

1. Backend: Fix 1 (D2) + Fix 2 (D1) + Fix 3 (D4) in parallel
2. Backend: Fix 4 (D5) — depends only on awareness of Fix 1 behaviour
3. Frontend: Fix 5 (D6) — fully independent, can run in parallel with all above
4. Backend: Fix 6 (D7) — lowest priority, can be done last
