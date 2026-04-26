# QA Validation Report — Campaign Publish Defect Fixes

**Date:** 2026-03-15
**Validator:** QA Agent
**Files examined:**
- `src/lib/meta/marketing.ts`
- `src/app/(app)/campaigns/[id]/actions.ts`
- `src/app/(app)/campaigns/[id]/page.tsx`

---

## D2 — `special_ad_categories` encoding

**Result: PASS**

**Evidence (`marketing.ts:152–155`):**
```typescript
const body: Record<string, unknown> = { name, objective, status };
if (specialAdCategory !== 'NONE') {
  body.special_ad_categories = JSON.stringify([specialAdCategory]);
}
```

- When `specialAdCategory === 'NONE'`: field is absent from `body` entirely. ✓
- When non-NONE: field is `JSON.stringify([value])` (e.g. `'["HOUSING"]'`). ✓
- Comment at line 150–151 confirms intent: "For NONE, omit special_ad_categories entirely — Meta v24.0 rejects '[]' string."

---

## D1 — `billing_event` missing

**Result: PASS**

**Evidence (`marketing.ts:187`):**
```typescript
billing_event: 'IMPRESSIONS', // Fix D1: required by Meta API v24.0
```

Field is present in the `createMetaAdSet` body object at line 187, immediately after `optimization_goal`.

---

## D4 — `message` in `link_data`

**Result: PASS**

**Evidence (`marketing.ts:246–257`):**
```typescript
// Fix D4: Remove `message` from link_data — deprecated in Meta API v24.0.
const linkData: Record<string, unknown> = {
  link: linkUrl,
  image_hash: imageHash,
};

if (headline) linkData.name = headline;
if (description) linkData.description = description;
if (callToActionType) {
  linkData.call_to_action = { type: callToActionType };
}
```

`message` is **not** assigned to `linkData` at any point. The `message` param is destructured from `params` (line 240) but is only used outside `linkData` — it is passed as a top-level field in `object_story_spec` is not present either (the `message` field is simply unused in `linkData`). The `link_data` object contains only `link`, `image_hash`, and optionally `name`, `description`, `call_to_action`.

---

## D5 — Campaign marked ACTIVE with zero ad sets

**Result: PASS**

**Evidence (`actions.ts:232`, `actions.ts:376–381`):**

Counter initialisation:
```typescript
let successfulAdSets = 0; // Fix D5: track how many ad sets were successfully created
```
(line 232, before the `for` loop)

Increment on success:
```typescript
successfulAdSets++; // Fix D5: increment on successful ad set creation
```
(line 274, after `metaAdSet.id` is assigned and pushed to `createdMetaObjects`)

Guard block:
```typescript
if (adSets.length > 0 && successfulAdSets === 0) {
  const noAdSetsMsg =
    'Campaign created on Meta but no ad sets could be published. This may be a configuration issue — please retry or contact support.';
  await setPublishError(noAdSetsMsg);
  return { error: 'No ad sets published' };
}
```
(lines 376–381, before the ACTIVE update at line 384)

- Guard fires only when ad sets were expected (`adSets.length > 0`) but none succeeded. ✓
- Returns `{ error }` instead of proceeding to mark ACTIVE. ✓
- Calls `setPublishError` to persist the error for the UI. ✓

---

## D6 — No preflight warning for missing creatives

**Result: PASS**

**Evidence (`page.tsx:37–43`):**
```typescript
const hasNoCreatives =
  campaign.status === 'DRAFT' &&
  campaign.adSets != null &&
  campaign.adSets.length > 0 &&
  campaign.adSets.every((adSet) =>
    (adSet.ads ?? []).every((ad) => !ad.mediaAssetId && !adSet.adsetMediaAssetId)
  );
```

- Scoped to DRAFT campaigns only. ✓
- Checks both ad-level (`ad.mediaAssetId`) and adset-level fallback (`adSet.adsetMediaAssetId`). ✓
- Requires at least one ad set to exist (`adSets.length > 0`). ✓

Amber warning panel render (`page.tsx:88–97`):
```tsx
{hasNoCreatives && (
  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
    <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">
      No images assigned
    </p>
    <p className="text-sm text-amber-800">
      All ads in this campaign are missing images. ...
    </p>
  </div>
)}
```

Panel renders conditionally on `hasNoCreatives`. ✓

---

## D7 — Raw error messages

**Result: PASS**

**Evidence (`actions.ts:86–97`, `actions.ts:395–399`):**

Function definition:
```typescript
// Fix D7: Map raw Meta error messages to human-readable text.
function mapMetaErrorToUserMessage(message: string): string {
  if (message.includes('Invalid parameter')) { return '...'; }
  if (message.includes('Error validating access token') || ...) { return '...'; }
  if (message.includes('permission')) { return '...'; }
  return message;
}
```

Call site in outer catch:
```typescript
const rawMessage = err instanceof Error ? err.message : 'Failed to publish campaign.';
const message = mapMetaErrorToUserMessage(rawMessage); // Fix D7: map to user-friendly text
await setPublishError(message);
```
(lines 395–399)

- `mapMetaErrorToUserMessage` is called before `setPublishError`. ✓
- The mapped (user-friendly) `message` is what gets persisted to DB and surfaced in UI. ✓
- Raw `rawMessage` is never passed to `setPublishError`. ✓

---

## Summary

| Defect | Result | File:Line |
|--------|--------|-----------|
| D1 — `billing_event` missing | **PASS** | `marketing.ts:187` |
| D2 — `special_ad_categories` encoding | **PASS** | `marketing.ts:152–155` |
| D4 — `message` in `link_data` | **PASS** | `marketing.ts:246–257` |
| D5 — ACTIVE with zero ad sets | **PASS** | `actions.ts:232, 274, 376–381` |
| D6 — No preflight warning | **PASS** | `page.tsx:37–43, 88–97` |
| D7 — Raw error messages | **PASS** | `actions.ts:86–97, 395–399` |

**All 6 defects: PASS. No failures detected.**
