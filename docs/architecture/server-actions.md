---
generated: true
last_updated: 2026-05-20T00:00:00Z
source: session-setup
project: cheersai-app
---

# Server Actions

All server actions use `'use server'` directive. Auth is enforced via `requireAuthContext()` unless noted otherwise. Audit logging was not detected in the current codebase (no `logAuditEvent` calls found).

## Auth (`src/lib/auth/actions.ts`)

| Action | Auth | Tables |
|--------|------|--------|
| `sendMagicLink` | None (public) | -- |
| `signInWithPassword` | None (public) | -- |
| `signOut` | Session | -- |

## Planner (`src/app/(app)/planner/actions.ts`)

| Action | Auth | Tables |
|--------|------|--------|
| `approveDraftContent` | requireAuthContext | content_items, publish_jobs, content_variants, notifications |
| `dismissPlannerNotification` | requireAuthContext | notifications |
| `deletePlannerContent` | requireAuthContext | content_items, publish_jobs, notifications |
| `updatePlannerContentMedia` | requireAuthContext | content_items, media_assets, content_variants |
| `restorePlannerContent` | requireAuthContext | content_items, publish_jobs, content_variants, notifications |
| `permanentlyDeletePlannerContent` | requireAuthContext | content_items, publish_jobs |
| `permanentlyDeleteAllTrashedPlannerContent` | requireAuthContext | content_items, publish_jobs |
| `updatePlannerContentBody` | requireAuthContext | content_items, content_variants |
| `updatePlannerContentSchedule` | requireAuthContext | content_items, publish_jobs |
| `createPlannerContent` | requireAuthContext | content_items |
| `updatePlannerBannerConfig` | requireAuthContext | content_items |

## Library (`src/app/(app)/library/actions.ts`)

| Action | Auth | Tables |
|--------|------|--------|
| `requestMediaUpload` | requireAuthContext | media_assets |
| `finaliseMediaUpload` | requireAuthContext | media_assets |
| `updateMediaAsset` | requireAuthContext | media_assets |
| `deleteMediaAsset` | requireAuthContext | media_assets |
| `bulkDeleteMediaAssets` | requireAuthContext | media_assets |
| `hideMediaAssets` | requireAuthContext | media_assets |
| `hideMediaAssetsByTag` | requireAuthContext | media_assets |
| `fetchMediaAssetPreviewUrl` | requireAuthContext | media_assets |
| `fetchMediaAssetOriginalUrl` | requireAuthContext | media_assets |

## Campaigns (`src/app/(app)/campaigns/actions.ts`)

| Action | Auth | Tables |
|--------|------|--------|
| `generateCampaignAction` | requireAuthContext | campaigns |
| `saveCampaignDraft` | requireAuthContext | campaigns |
| `saveAndPublishCampaign` | requireAuthContext | campaigns |
| `getCampaigns` | requireAuthContext | campaigns |
| `getCampaignWithTree` | requireAuthContext | campaigns |
| `getCampaignOptimisationActions` | requireAuthContext | campaigns |
| `getCampaignDashboard` | requireAuthContext | campaigns |
| `syncCampaignDashboardPerformance` | requireAuthContext | campaigns |
| `runCampaignDashboardOptimisation` | requireAuthContext | campaigns |
| `applyOptimisationRecommendation` | requireAuthContext | campaigns |
| `deleteCampaign` | requireAuthContext | campaigns |

## Campaign Detail (`src/app/(app)/campaigns/[id]/actions.ts`)

| Action | Auth | Tables |
|--------|------|--------|
| `publishCampaign` | requireAuthContext | campaigns |
| `pauseCampaign` | requireAuthContext | campaigns |
| `syncCampaignPerformance` | requireAuthContext | campaigns |

## Connections (`src/app/(app)/connections/actions.ts`)

| Action | Auth | Tables |
|--------|------|--------|
| `initiateOAuthConnect` | requireAuthContext | oauth_states, social_connections |
| `completeOAuthConnect` | requireAuthContext | social_connections |
| `disconnectProvider` | requireAuthContext | social_connections |
| `updateConnectionMetadata` | requireAuthContext | social_connections |

## Connections -- Ads (`src/app/(app)/connections/actions-ads.ts`)

| Action | Auth | Tables |
|--------|------|--------|
| `startAdsOAuth` | requireAuthContext | meta_ad_accounts |
| `fetchAdAccounts` | requireAuthContext | meta_ad_accounts |
| `selectAdAccount` | requireAuthContext | meta_ad_accounts |
| `getAdAccountSetupStatus` | requireAuthContext | meta_ad_accounts |

## Reviews (`src/app/(app)/reviews/actions.ts`)

| Action | Auth | Tables |
|--------|------|--------|
| `syncGbpReviews` | requireAuthContext | -- (external API) |
| `generateAiDraft` | requireAuthContext | -- (OpenAI) |
| `postReply` | requireAuthContext | -- (external API) |
| `saveAiDraft` | requireAuthContext | -- |

## Settings (`src/app/(app)/settings/actions.ts`)

| Action | Auth | Tables |
|--------|------|--------|
| `updateBrandProfile` | requireAuthContext | brand_profile |
| `updateLinkInBioProfileSettings` | requireAuthContext | -- |
| `upsertLinkInBioTileSettings` | requireAuthContext | -- |
| `removeLinkInBioTile` | requireAuthContext | -- |
| `reorderLinkInBioTilesSettings` | requireAuthContext | -- |
| `updatePostingDefaults` | requireAuthContext | accounts, posting_defaults |
| `updateManagementConnectionSettings` | requireAuthContext | management_app_connections |

## Create (`src/app/(app)/create/actions.ts`)

| Action | Auth | Tables |
|--------|------|--------|
| `handleInstantPostSubmission` | requireAuthContext | content_items |
| `handleEventCampaignSubmission` | requireAuthContext | content_items |
| `handlePromotionCampaignSubmission` | requireAuthContext | content_items |
| `handleWeeklyCampaignSubmission` | requireAuthContext | content_items |
| `fetchGeneratedContentDetails` | requireAuthContext | content_items |
| `listManagementEventOptions` | requireAuthContext | -- |
| `getManagementEventPrefill` | requireAuthContext | -- |
| `listManagementPromotionOptions` | requireAuthContext | -- |
| `getManagementPromotionPrefill` | requireAuthContext | -- |

## Create -- Templates (`src/app/(app)/create/template-actions.ts`)

| Action | Auth | Tables |
|--------|------|--------|
| `listTemplates` | requireAuthContext | content_templates |
| `saveTemplate` | requireAuthContext | content_templates |
| `deleteTemplate` | requireAuthContext | content_templates |
| `incrementTemplateUseCount` | requireAuthContext | content_templates |

## Tournament (`src/app/actions/tournament.ts`)

| Action | Auth | Tables |
|--------|------|--------|
| `createTournament` | requireAuthContext | -- |
| `updateTournament` | requireAuthContext | -- |
| `updateTournamentStatus` | requireAuthContext | -- |
| `updateTournamentBaseImages` | requireAuthContext | -- |
| `createFixture` | requireAuthContext | -- |
| `deleteFixture` | requireAuthContext | -- |
| `updateFixture` | requireAuthContext | -- |
| `saveAndGenerateFixture` | requireAuthContext | -- |
| `bulkGenerateAction` | requireAuthContext | -- |
| `publishNowFixture` | requireAuthContext | -- |
| `toggleFixtureShowing` | requireAuthContext | -- |
| `getMediaAssetsForPicker` | requireAuthContext | media_assets |
| `deleteTournament` | requireAuthContext | -- |
| `getFixturePreview` | requireAuthContext | -- |
| `importFixtures` | requireAuthContext | -- |
| `regenerateFeedApiKey` | requireAuthContext | -- |
| `disableFeedApiKey` | requireAuthContext | -- |

## AI Generate (`src/app/actions/ai-generate.ts`)

| Action | Auth | Tables |
|--------|------|--------|
| `generateContent` | requireAuthContext | -- (OpenAI) |
| `regenerateWithModifier` | requireAuthContext | -- (OpenAI) |

## Content (`src/app/actions/content.ts`)

| Action | Auth | Tables |
|--------|------|--------|
| `createDraft` | requireAuthContext | content_items |
| `saveDraft` | requireAuthContext | content_items |
| `getDraft` | requireAuthContext | content_items |
| `listDrafts` | requireAuthContext | content_items |
| `deleteDraft` | requireAuthContext | content_items |
| `getScheduledContentAction` | requireAuthContext | content_items |
| `scheduleContent` | requireAuthContext | content_items, publish_jobs |
| `approveForQueue` | requireAuthContext | content_items, publish_jobs |

## Media (`src/app/actions/media.ts`)

| Action | Auth | Tables |
|--------|------|--------|
| `uploadMediaAction` | requireAuthContext | media_assets |
| `deleteMediaAction` | requireAuthContext | media_assets |
| `updateMediaTags` | requireAuthContext | media_assets |
| `attachMediaToContent` | requireAuthContext | content_items |

## Publish (`src/app/actions/publish.ts`)

| Action | Auth | Tables |
|--------|------|--------|
| `retryPublishJob` | requireAuthContext | publish_jobs (via QStash) |

## Analytics (`src/app/actions/analytics.ts`)

| Action | Auth | Tables |
|--------|------|--------|
| `getAnalyticsData` | requireAuthContext | -- |
| `getPlatformComparison` | requireAuthContext | -- |
| `getContentTypeComparison` | requireAuthContext | -- |
| `getBestTimes` | requireAuthContext | -- |

## Link-in-Bio (`src/app/actions/link-in-bio.ts`)

| Action | Auth | Tables |
|--------|------|--------|
| `getProfileWithTiles` | requireAuthContext | link_in_bio_profiles, link_in_bio_tiles |
| `saveProfile` | requireAuthContext | link_in_bio_profiles |
| `publishPage` | requireAuthContext | link_in_bio_profiles |
| `unpublishPage` | requireAuthContext | link_in_bio_profiles |
| `checkSlugAvailability` | requireAuthContext | link_in_bio_profiles |
| `saveTile` | requireAuthContext | link_in_bio_tiles |
| `deleteTile` | requireAuthContext | link_in_bio_tiles |
| `reorderTiles` | requireAuthContext | link_in_bio_tiles |

## Campaigns (recurring) (`src/app/actions/campaigns.ts`)

| Action | Auth | Tables |
|--------|------|--------|
| `pauseRecurringCampaign` | requireAuthContext | campaigns |
| `resumeRecurringCampaign` | requireAuthContext | campaigns |
| `stopRecurringCampaign` | requireAuthContext | campaigns |

## Link-in-Bio Click Tracking (`src/lib/link-in-bio/click-tracking.ts`)

| Action | Auth | Tables |
|--------|------|--------|
| `trackTileClick` | None (public) | -- |
| `trackPageView` | None (public) | -- |

## Create Modal (`src/features/create/create-modal-actions.ts`)

| Action | Auth | Tables |
|--------|------|--------|
| `getCreateModalData` | requireAuthContext | -- |

## Summary

- **Total server action files**: 24
- **Total exported actions**: ~100
- **Auth pattern**: `requireAuthContext()` (returns `{ supabase, accountId }`)
- **Audit logging**: Not currently implemented (no `logAuditEvent` calls detected)
