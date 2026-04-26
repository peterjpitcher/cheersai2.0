# Consolidated Defect Log — Campaign Publish Pipeline

Cross-referenced across all five discovery agents. Confidence = how many agents independently identified it.

---

## CRITICAL

### D1 — `billing_event` missing from createMetaAdSet
- **Confidence**: 4/5 agents
- **Severity**: CRITICAL
- **Summary**: Meta Ads API v24.0 requires `billing_event` (e.g., `IMPRESSIONS`) on every ad set. The `createMetaAdSet` body in `marketing.ts` omits this field entirely.
- **Impact**: Every ad set creation call fails with a Meta API error. The inner try/catch catches it silently (`continue`), so ad sets are never created in Meta. Campaign still gets marked ACTIVE with zero live ad sets.
- **Root cause area**: Backend — `src/lib/meta/marketing.ts:createMetaAdSet`, body construction (~line 182)
- **Affected files**: `src/lib/meta/marketing.ts`, `src/types/campaigns.ts` (CreateAdSetParams interface)
- **Test cases**: TC-08
- **Fix approach**: Add `billing_event: 'IMPRESSIONS'` to the body in `createMetaAdSet`. Add `billingEvent` to `CreateAdSetParams` interface and pass it from `publishCampaign`.
- **Partial failure**: Ad set creation fails → inner catch → campaign continues, reaches step 8 → marked ACTIVE with no ad sets in Meta. NOTE: This alone does NOT cause "Publishing Failed" in the UI (it's caught).

---

### D2 — `special_ad_categories` encoding likely causing campaign creation to fail
- **Confidence**: 2/5 agents
- **Severity**: CRITICAL
- **Summary**: The string `'[]'` is passed as the value for `special_ad_categories` and sent via `URLSearchParams`. When URL-encoded, this becomes `special_ad_categories=%5B%5D`. Meta may not correctly parse this as an empty array, instead treating it as the string `"[]"` and returning "Invalid parameter".
- **Impact**: `createMetaCampaign` throws "Invalid parameter" → outer catch fires → `publish_error` set → campaign stays DRAFT. This is the most likely root cause of the user-visible "Publishing Failed" error.
- **Root cause area**: Backend — `src/lib/meta/marketing.ts:createMetaCampaign` + `metaPost` encoding
- **Affected files**: `src/lib/meta/marketing.ts`
- **Test cases**: TC-04
- **Fix approach**: When `special_ad_category === 'NONE'`, omit the field entirely from the request body (Meta's default is an empty list). For non-NONE categories, send as `JSON.stringify([specialAdCategory])`. Alternatively, ensure the parameter is sent as a proper JSON-encoded value that Meta can parse.
- **Partial failure**: Campaign never created in Meta. `meta_campaign_id` never saved. Every retry re-hits the same error.

---

### D3 — Campaign creation (`createMetaCampaign`) not protected by local try/catch
- **Confidence**: 3/5 agents
- **Severity**: CRITICAL
- **Summary**: `createMetaCampaign` is the only Meta API call in `publishCampaign` that has no local try/catch. Any error it throws bubbles directly to the outer catch, triggers rollback, resets campaign to DRAFT, and surfaces as "Publishing Failed". All inner error handling (ad sets, ads) is bypassed.
- **Impact**: A single campaign creation failure immediately aborts the entire publish pipeline with no per-step recovery.
- **Root cause area**: Backend — `src/app/(app)/campaigns/[id]/actions.ts` step 6 (~line 196)
- **Affected files**: `src/app/(app)/campaigns/[id]/actions.ts`
- **Test cases**: TC-04
- **Fix approach**: This is intentional design — the campaign must exist before ad sets. The real fix is D2 (fix the parameter that's causing campaign creation to fail). However, add explicit error message mapping so "Invalid parameter" surfaces as something human-readable.

---

## HIGH

### D4 — `message` field in `link_data` deprecated in Meta API v24.0
- **Confidence**: 3/5 agents
- **Severity**: HIGH
- **Summary**: In `createMetaAdCreative`, the primary text is placed inside `link_data.message`. Meta's v24.0 Marketing API documentation states that `message` inside `link_data` is deprecated. Primary text should NOT be in `link_data` — it is a field on `object_story_spec` itself or not needed at all in some placements.
- **Impact**: Ad creatives may be rejected by Meta with "Invalid parameter" or created with missing primary text. This causes ad creation to fail (caught silently).
- **Root cause area**: Backend — `src/lib/meta/marketing.ts:createMetaAdCreative` (~line 245)
- **Affected files**: `src/lib/meta/marketing.ts`
- **Test cases**: TC-09
- **Fix approach**: Remove `message` from `linkData`. If primary text is required, add it at the `object_story_spec` level (outside `link_data`). Test with Meta's API explorer.

---

### D5 — Ad set/ad failures are completely silent — campaign marked ACTIVE with zero live objects
- **Confidence**: 4/5 agents
- **Severity**: HIGH
- **Summary**: When ad set or ad creation fails, the inner try/catch logs to console and `continue`s. At step 8, the campaign is unconditionally marked ACTIVE regardless of how many ad sets/ads actually published. The user has no visibility that their campaign is live in Meta with zero active ad sets.
- **Impact**: Campaign appears ACTIVE in the UI but is broken in Meta. Spend never happens. User doesn't know to retry or investigate.
- **Root cause area**: Backend — `src/app/(app)/campaigns/[id]/actions.ts` step 7 inner catches
- **Affected files**: `src/app/(app)/campaigns/[id]/actions.ts`
- **Test cases**: TC-03, TC-08
- **Fix approach**: After the ad set loop, check if at least one ad set was successfully created in Meta. If zero succeeded, either (a) don't mark ACTIVE or (b) write a `publish_error` warning. Track failure counts across the loop.

---

### D6 — No preflight check for missing creatives before publishing
- **Confidence**: 4/5 agents
- **Severity**: HIGH
- **Summary**: The user can click Publish/Retry Publish with no images assigned to any ads. The pipeline silently skips all ads. There is no warning or block before this happens.
- **Impact**: User publishes a campaign that will have no running ads. No feedback that anything is wrong until they investigate the Meta dashboard.
- **Root cause area**: Frontend/UX — `src/app/(app)/campaigns/[id]/page.tsx`, `src/features/campaigns/CampaignActions.tsx`
- **Affected files**: `src/app/(app)/campaigns/[id]/page.tsx`
- **Test cases**: TC-15, TC-16
- **Fix approach**: On the campaign detail page, if `publishError` is null and status is DRAFT, check if any ad has an effective creative (ad-level OR adset-level). If none do, show an inline warning: "No ad images set — ads will be skipped during publishing. Add images in the campaign editor before publishing." Block the Publish/Retry button or show a confirmation.

---

## MEDIUM

### D7 — Error messages not human-readable
- **Confidence**: 2/5 agents
- **Severity**: MEDIUM
- **Summary**: Meta API errors (e.g., "Invalid parameter", "Error validating access token") are surfaced verbatim to the user. No field-level mapping exists.
- **Impact**: User cannot diagnose the issue from the UI error message.
- **Root cause area**: Backend — `src/lib/meta/marketing.ts:extractMetaError`, `src/app/(app)/campaigns/[id]/actions.ts:setPublishError`
- **Fix approach**: Add a `mapMetaErrorToUserMessage(error: MetaApiError): string` function that maps known error codes to friendly messages.

### D8 — Cron sync doesn't account for ACTIVE campaigns with no Meta ad sets
- **Confidence**: 1/5 agents
- **Severity**: MEDIUM
- **Summary**: The `sync-meta-campaigns` cron syncs ACTIVE campaigns, but campaigns can be marked ACTIVE with zero ad sets in Meta (due to D5). The cron would find zero spend and mark them as healthy.
- **Impact**: Silent data inconsistency in campaign reporting.
- **Root cause area**: `src/app/api/cron/sync-meta-campaigns/route.ts`
- **Fix approach**: Out of scope for this fix; recommend follow-on review.
