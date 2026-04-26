# Ripple Report — Campaign Publish Pipeline

## Immediate (must be updated in this implementation)

### `src/lib/meta/marketing.ts`
- `createMetaAdSet`: add `billing_event: 'IMPRESSIONS'` to request body
- `createMetaCampaign`: fix `special_ad_categories` encoding — omit field entirely when `NONE`, or send as `JSON.stringify([category])` for non-NONE values
- `createMetaAdCreative`: remove `message` from `linkData`; place primary text at `object_story_spec` level if needed

### `src/types/campaigns.ts`
- `CreateAdSetParams` interface: add optional `billingEvent?: string` field

### `src/app/(app)/campaigns/[id]/actions.ts`
- After ad set loop: count successful Meta ad set creations; if zero succeeded, do NOT mark campaign ACTIVE — write a `publish_error` warning instead
- Track `successfulAdSets` counter across the loop

### `src/app/(app)/campaigns/[id]/page.tsx`
- Add preflight warning panel: if `status === 'DRAFT'` and all ads have no effective creative (neither `mediaAssetId` nor `adsetMediaAssetId`), show an inline warning before the Publish button

## Integration Surfaces (should be updated, will be flagged if missed)

### `src/features/campaigns/CampaignActions.tsx`
- Consider disabling the Publish/Retry button when no creatives are present (after preflight check)
- Currently passes data to the page; preflight state would need to flow down as a prop or be computed in the component

### Error mapping
- `src/app/(app)/campaigns/[id]/actions.ts:setPublishError` — map known Meta error strings ("Invalid parameter", "Error validating access token") to human-readable messages before writing to DB

## Journey Continuity
- The user sees "No creative" badges + "Publishing Failed" in the same view. After fixes: campaign creation will succeed (D2 fixed), ad sets will be created (D1 fixed), but ads will still be skipped if no images are assigned. The "No creative" badge is accurate and should remain — it is a legitimate UX signal to the user.
- After D6 fix (preflight warning): user will see a warning before they even try to publish, preventing the confusing "published but nothing is running" state.

## Recommended Follow-On Reviews
- `src/app/api/cron/sync-meta-campaigns/route.ts` — D8: cron currently treats ACTIVE campaigns with zero Meta ad sets as healthy. Separate review recommended.
- `src/features/campaigns/CampaignTree.tsx` — image assignment UX could be surfaced more prominently; currently requires user to expand the tree editor. Out of scope for this fix.
