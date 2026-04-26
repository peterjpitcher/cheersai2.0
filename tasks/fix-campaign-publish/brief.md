# Fix Brief — Campaign Publish Pipeline

## Change Type
**Fix broken behaviour** — Campaign publishing fails with "Invalid parameter" from Meta API. All ads display "No creative" badge. The user cannot get a campaign live.

## Ripple Priority
Dependency audit — what consumes the broken output and is also broken as a result?

## Known Symptoms
1. **"No creative" badges** on all ads in the campaign detail view — user has not assigned images
2. **"Publishing Failed: Invalid parameter"** — Meta API rejects the publish attempt
3. The campaign is saved as DRAFT with `publish_error` written to DB
4. Retry Publish also fails

## Codebase Entry Points

### Primary files (critical path)
| File | Role |
|---|---|
| `src/app/(app)/campaigns/[id]/actions.ts` | `publishCampaign` — the full publish pipeline |
| `src/lib/meta/marketing.ts` | All Meta Graph API calls (createMetaCampaign, createMetaAdSet, createMetaAdCreative, createMetaAd, uploadMetaImage) |
| `src/app/(app)/campaigns/actions.ts` | `saveAndPublishCampaign`, `getCampaignWithTree`, DB mappers |
| `src/app/(app)/campaigns/[id]/page.tsx` | Campaign detail page — renders "No creative" badge logic |
| `src/features/campaigns/CampaignActions.tsx` | Retry Publish button |
| `src/features/campaigns/CampaignTree.tsx` | Campaign editor — image picker, ad/adset management |
| `src/types/campaigns.ts` | Core TypeScript types |
| `src/lib/campaigns/time-utils.ts` | `toMidnightLondon` — converts dates for Meta API |

### Supporting files
| File | Role |
|---|---|
| `src/lib/meta/graph.ts` | Graph API base URL / version (v24.0) |
| `src/app/(app)/connections/actions-ads.ts` | `selectAdAccount` — stores `meta_account_id` with `act_` prefix |
| `supabase/migrations/20260308120000_add_meta_campaigns.sql` | Original schema (had FK bug) |
| `supabase/migrations/20260308150000_add_meta_campaigns_table.sql` | meta_campaigns table |
| `supabase/migrations/20260315000001_fix_ad_sets_campaign_fk.sql` | Fixed FK from campaigns → meta_campaigns |
| `supabase/migrations/20260315_add_publish_error.sql` | Added publish_error column |

## Business Rules (as understood)
1. A campaign draft is created from an AI-generated payload, then published to Meta Ads Manager
2. Publishing creates: Meta Campaign → Meta Ad Sets → Meta Ads (with image upload + creative)
3. Ads without creatives (no image) are silently SKIPPED — empty ad sets are acceptable
4. On any error, the pipeline should rollback created Meta objects and reset campaign to DRAFT
5. `publish_error` is stored in DB for display and to enable the Retry button
6. Retry resumes from last checkpoint (skips already-created Meta objects by checking IDs)

## Key Technical Observations from Manual Review

### The "Invalid parameter" error source
`createMetaCampaign` is the ONLY Meta API call in the outer `try` block that is NOT wrapped in a local inner `try/catch`. All other calls (`createMetaAdSet`, `createMetaAdCreative`, `createMetaAd`, `uploadMetaImage`) have inner try/catch handlers. Therefore "Invalid parameter" is almost certainly thrown by `createMetaCampaign` reaching the outer catch.

### Missing `billing_event` in createMetaAdSet
The `createMetaAdSet` function does not send `billing_event` to Meta. Meta's v24.0 API requires `billing_event` for most campaign objectives (e.g., `IMPRESSIONS` for `OUTCOME_LEADS`). This would cause all ad sets to silently fail in the inner catch.

### `message` field in link_data (createMetaAdCreative)
The primary text is passed inside `link_data.message`. Meta's Marketing API v24.0 may not accept `message` inside `link_data` — the spec shows it should be at the `object_story_spec` level or omitted from `link_data`.

### No preflight check for missing creatives
The user is allowed to hit Publish without any images assigned to ads. The code skips ad creation silently. There is no pre-publish warning.

### `special_ad_categories` encoding
Sent as the string `'[]'` via URLSearchParams. May or may not be parsed correctly by Meta as empty array.

## Scope
- Fix the "Invalid parameter" publishing error
- Fix missing `billing_event` in ad set creation
- Fix or validate the `message` placement in ad creatives
- Add preflight guard/warning for missing creatives
- NOT in scope: redesigning the campaign creation flow, adding new Meta API features
