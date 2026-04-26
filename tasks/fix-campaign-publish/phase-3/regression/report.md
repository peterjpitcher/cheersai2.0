# Regression Report — Campaign Publish Fix

**Status: REGRESSIONS FOUND (1 confirmed bug, 1 advisory)**

---

## Check 1 — `pauseMetaObject` unchanged

**Status: CLEAN**

`pauseMetaObject` is intact at the end of `marketing.ts`. It calls `metaPost` with `{ status: 'PAUSED' }` on the object ID path — unchanged from expected behaviour. No modifications detected.

---

## Check 2 — `fetchCampaignInsights` unchanged

**Status: CLEAN**

`fetchCampaignInsights` is present and unmodified. It uses `metaGet` with the standard insights fields. No modifications detected.

---

## Check 3 — `pauseCampaign` in `actions.ts` unchanged

**Status: CLEAN**

`pauseCampaign` is fully intact as the last exported function in `actions.ts`. It fetches campaign ownership, retrieves the access token, calls `pauseMetaObject`, updates local DB status, revalidates paths, and returns `{ success: true }`. No modifications detected.

---

## Check 4 — `createMetaCampaign`: non-NONE `specialAdCategory` encoding

**Status: CLEAN**

The new logic is:
```typescript
const body: Record<string, unknown> = { name, objective, status };
if (specialAdCategory !== 'NONE') {
  body.special_ad_categories = JSON.stringify([specialAdCategory]);
}
```

When `specialAdCategory` is e.g. `'HOUSING'`, the body will include `special_ad_categories: '["HOUSING"]'`. This value then passes through `metaPost`'s `URLSearchParams` serialisation which calls `String(value)` on it — since it is already a string, it is passed as-is. The array is correctly JSON-encoded and sent to Meta. Behaviour is correct for non-NONE categories.

---

## Check 5 — `createMetaAdSet` resume path: `successfulAdSets` counter

**STATUS: BUG CONFIRMED**

The resume path (already-published ad set) is:

```typescript
if (adSet.meta_adset_id) {
  // Already published — skip creation, reuse existing ID.
  metaAdSetId = adSet.meta_adset_id;
} else {
  // ... create ad set ...
  successfulAdSets++; // Only incremented inside the else branch
}
```

`successfulAdSets` is **only incremented when a new ad set is created** (`else` branch). On a retry where all ad sets already have `meta_adset_id` set (resume path), `successfulAdSets` remains `0`.

After the loop, the guard check is:
```typescript
if (adSets.length > 0 && successfulAdSets === 0) {
  // ... return error: 'No ad sets published'
}
```

**Impact:** On a valid retry of a campaign where the ad sets were already created in a prior attempt, this guard will fire with `"No ad sets published"` and the publish will be aborted — even though the ad sets exist on Meta. The retry/resume feature is broken for this scenario.

**Fix required:** Increment `successfulAdSets` in the resume branch too:
```typescript
if (adSet.meta_adset_id) {
  metaAdSetId = adSet.meta_adset_id;
  successfulAdSets++; // Count already-published ad sets as successful
}
```

---

## Check 6 — `hasNoCreatives` edge cases in `page.tsx`

**Status: ADVISORY (empty ads array)**

The computation:
```typescript
const hasNoCreatives =
  campaign.status === 'DRAFT' &&
  campaign.adSets != null &&
  campaign.adSets.length > 0 &&
  campaign.adSets.every((adSet) =>
    (adSet.ads ?? []).every((ad) => !ad.mediaAssetId && !adSet.adsetMediaAssetId)
  );
```

**Null/undefined `adSets`:** Guarded correctly — `campaign.adSets != null` short-circuits before `.every()` is called.

**Empty `ads` array edge case (advisory):** If an ad set has no ads (`adSet.ads` is `[]`), then `(adSet.ads ?? []).every(...)` returns `true` (vacuous truth). This means an ad set with zero ads would satisfy "no creative", contributing to `hasNoCreatives = true`. Whether this is correct depends on intent:
- If an empty-ads ad set means "no creative has been set", this behaviour is arguably correct — the warning is appropriate.
- However, the `adSet.adsetMediaAssetId` check is also evaluated per-ad in the inner `.every()`. If `adsetMediaAssetId` is set but there are no ads, the inner `.every([])` returns `true` without ever evaluating the condition — so the ad-set-level creative is ignored when the ads array is empty. This means an ad set with a shared image but no individual ads would be **incorrectly flagged as having no creative**.

**Severity:** Low — this is an edge case (ad set configured with a shared image but zero individual ads is an unusual state). The warning panel is informational only and does not block publish. No crash risk.

---

## Check 7 — TypeScript / type issues

**Status: CLEAN**

No new `any` types observed in the modified functions. All new fields (`billing_event`, `successfulAdSets`, `hasNoCreatives`) are correctly typed. The `body: Record<string, unknown>` pattern is consistent with existing code. No obvious type regressions.

---

## Summary

| Check | Status |
|---|---|
| `pauseMetaObject` unchanged | CLEAN |
| `fetchCampaignInsights` unchanged | CLEAN |
| `pauseCampaign` unchanged | CLEAN |
| `createMetaCampaign` non-NONE encoding | CLEAN |
| Resume path `successfulAdSets` counter | **BUG — retry with pre-existing ad sets always aborts** |
| `hasNoCreatives` null/undefined safety | CLEAN |
| `hasNoCreatives` empty-ads array edge case | ADVISORY — ad-set creative ignored when ads array is empty |
| TypeScript / new type errors | CLEAN |

**Action required:** Fix `successfulAdSets` increment in the resume branch of the ad-set loop (Check 5). This is a blocking bug for the retry flow.
