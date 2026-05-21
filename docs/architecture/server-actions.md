---
generated: true
last_updated: 2026-05-21
source: session-setup
project: cheersai-2.0
---

# Server Actions

All server actions use `'use server'` directive. Auth is verified server-side via `getUser()` or `requireAuthContext()`.

## Global Actions (`src/app/actions/`)

### AI Generation (`ai-generate.ts`)

| Action | Tables | Audit |
|--------|--------|-------|
| `generateContent` | profiles, content_items, media_assets | revalidatePath |
| `regenerateWithModifier` | profiles, content_items | revalidatePath |

### Content (`content.ts`)

| Action | Tables | Audit |
|--------|--------|-------|
| `createDraft` | content_items | revalidatePath(/dashboard/create) |
| `saveDraft` | content_items | revalidatePath(/dashboard/create) |
| `getDraft` | content_items | -- |
| `listDrafts` | content_items | -- |
| `deleteDraft` | content_items | revalidatePath(/dashboard/create) |
| `getScheduledContentAction` | content_items | -- |
| `scheduleContent` | content_items | revalidatePath(/planner, /dashboard/create) |
| `approveForQueue` | content_items | revalidatePath(/planner, /dashboard/create) |
| `getCalendarItemsAction` | content_items | -- |
| `createScheduledBatch` | content_items | revalidatePath |

### Publish (`publish.ts`)

| Action | Tables | Audit |
|--------|--------|-------|
| `retryPublishJob` | publish_jobs | -- |

### Tournament (`tournament.ts`)

| Action | Tables | Audit |
|--------|--------|-------|
| `createTournament` | tournaments, social_connections | revalidatePath(/tournaments) |
| `updateTournament` | tournaments | revalidatePath(/tournaments/*) |
| `updateTournamentStatus` | tournaments | revalidatePath(/tournaments/*) |
| `updateTournamentBaseImages` | tournaments, media_assets | revalidatePath(/tournaments/*) |
| `createFixture` | tournament_fixtures | revalidatePath(/tournaments/*) |
| `deleteFixture` | tournament_fixtures | revalidatePath(/tournaments/*) |
| `updateFixture` | tournament_fixtures | revalidatePath(/tournaments/*) |
| `saveAndGenerateFixture` | tournament_fixtures | revalidatePath(/tournaments/*) |
| `bulkGenerateAction` | tournament_fixtures | revalidatePath(/tournaments/*) |
| `publishNowFixture` | content_items, publish_jobs, tournament_fixtures | revalidatePath(/tournaments/*) |
| `toggleFixtureShowing` | tournament_fixtures, content_items | revalidatePath(/tournaments/*) |
| `getMediaAssetsForPicker` | media_assets | -- |
| `deleteTournament` | tournaments | revalidatePath(/tournaments) |
| `getFixturePreview` | content_items, content_variants | -- |
| `importFixtures` | tournament_fixtures | revalidatePath(/tournaments/*) |
| `regenerateFeedApiKey` | tournaments | revalidatePath(/tournaments/*) |
| `disableFeedApiKey` | tournaments | revalidatePath(/tournaments/*) |

### Campaigns (`campaigns.ts`)

| Action | Tables | Audit |
|--------|--------|-------|
| `pauseRecurringCampaign` | campaigns | revalidatePath |
| `resumeRecurringCampaign` | campaigns | revalidatePath |
| `stopRecurringCampaign` | campaigns | revalidatePath |

### Analytics (`analytics.ts`)

| Action | Tables | Audit |
|--------|--------|-------|
| `getAnalyticsData` | analytics_snapshots | -- |
| `getPlatformComparison` | analytics_snapshots | -- |
| `getContentTypeComparison` | analytics_snapshots | -- |
| `getBestTimes` | analytics_snapshots | -- |

### Media (`media.ts`)

| Action | Tables | Audit |
|--------|--------|-------|
| `uploadMediaAction` | media_assets | revalidatePath |
| `deleteMediaAction` | media_assets | revalidatePath |
| `updateMediaTags` | media_assets | revalidatePath |
| `attachMediaToContent` | content_media_attachments | revalidatePath |

### Link-in-Bio (`link-in-bio.ts`)

| Action | Tables | Audit |
|--------|--------|-------|
| `getProfileWithTiles` | link_in_bio_profiles | -- |
| `saveProfile` | link_in_bio_profiles | revalidatePath |
| `publishPage` | link_in_bio_profiles | revalidatePath |
| `unpublishPage` | link_in_bio_profiles | revalidatePath |
| `checkSlugAvailability` | link_in_bio_profiles | -- |
| `saveTile` | link_in_bio_profiles | revalidatePath |
| `deleteTile` | link_in_bio_profiles | revalidatePath |
| `reorderTiles` | link_in_bio_profiles | revalidatePath |

## Feature Actions (`src/app/(app)/*/actions.ts`)

### Campaigns (`campaigns/actions.ts`)

| Action | Purpose |
|--------|---------|
| `generateCampaignAction` | AI-generate campaign content |
| `saveCampaignDraft` | Save campaign as draft |
| `saveAndPublishCampaign` | Save and publish to Meta |
| `getCampaigns` | List all campaigns |
| `getCampaignWithTree` | Get campaign with full tree |
| `getCampaignOptimisationActions` | Get optimisation recommendations |
| `getCampaignDashboard` | Dashboard metrics |
| `syncCampaignDashboardPerformance` | Sync Meta performance data |
| `runCampaignDashboardOptimisation` | Run AI optimisation |
| `applyOptimisationRecommendation` | Apply a recommendation |
| `deleteCampaign` | Delete campaign |
| `syncPerformanceFormAction` | Form wrapper for sync |
| `runOptimiserFormAction` | Form wrapper for optimiser |
| `applyOptimisationRecommendationFormAction` | Form wrapper for apply |

### Connections (`connections/actions.ts`)

| Action | Purpose |
|--------|---------|
| `initiateOAuthConnect` | Start OAuth flow |
| `completeOAuthConnect` | Complete OAuth token exchange |
| `disconnectProvider` | Remove social connection |
| `updateConnectionMetadata` | Update connection settings |

### Create (`create/actions.ts`)

| Action | Purpose |
|--------|---------|
| `handleInstantPostSubmission` | Submit instant post |
| `handleEventCampaignSubmission` | Submit event campaign |

### Library (`library/actions.ts`)

Media management actions for the library page.

### Planner (`planner/actions.ts`)

Planner-specific data fetching and scheduling actions.

### Reviews (`reviews/actions.ts`)

GBP review management with AI-generated replies (uses OpenAI).

### Settings (`settings/actions.ts`)

Account settings and preferences management.

## Cross-References

- Actions -> [[routes]]: Server actions are called from page components
- Actions -> [[data-model]]: Tables referenced in queries
- Actions -> [[relationships]]: Integration dependencies
