---
title: Component Index
created: 2026-03-14
last_updated: 2026-03-14
status: current
tags:
  - type/reference
  - section/components
related:
  - "[[_Features MOC]]"
---

← [[_Index]] / [[_Components MOC]]

# Component Index

## Create Feature (`src/features/create/`)

| Component | Description |
|-----------|-------------|
| `CreateWizard` | Root wizard container — tabs between campaign types |
| `InstantPostForm` | Single post form with platform selection, media, and advanced options |
| `EventCampaignForm` | Event campaign form with date picker and schedule offsets |
| `PromotionCampaignForm` | Promotion campaign with date range |
| `WeeklyCampaignForm` | Weekly recurring campaign form |
| `StorySeriesForm` | Story series with per-slot date/time and image |
| `GeneratedContentReviewList` | Post-generation review screen showing AI-generated copy per platform |
| `GenerationProgress` | Loading/streaming indicator during AI generation |
| `MediaAttachmentSelector` | Media picker from library for attachment to content |
| `StageAccordion` | Collapsible accordion for wizard stages |
| `ScheduleCalendar` | Calendar for selecting schedule date/time |
| `SuggestionUtils` | Logic for suggesting optimal posting times |

## Planner Feature (`src/features/planner/`)

| Component | Description |
|-----------|-------------|
| `PlannerCalendar` | Calendar grid showing scheduled content |
| `PlannerContentComposer` | Content editing form (body, media, schedule) |
| `PlannerStatusFilters` | Filter buttons for content status |
| `PlannerViewToggle` | Toggle between calendar and list view |
| `PlannerSkeleton` | Loading skeleton for planner |
| `PlannerInteractionComponents` | Shared interaction primitives |
| `ActivityFeed` | Notification/activity list |
| `ApproveDraftButton` | One-click approve (draft → scheduled) |
| `DeleteContentButton` | Soft-delete with confirmation |
| `RestoreContentButton` | Restore from trash |
| `DismissNotificationButton` | Mark notification as read |
| `ContentBodyForm` | Inline body text editor |
| `ContentScheduleForm` | Reschedule date/time picker |
| `ContentMediaEditor` | Swap/remove media from a content item |
| `CreatePostButton` | Quick-create shortcut |

## Library Feature (`src/features/library/`)

| Component | Description |
|-----------|-------------|
| `MediaAssetGrid` | Server-rendered grid of media assets |
| `MediaAssetGridClient` | Client-side grid with multi-select |
| `MediaAssetEditor` | Asset metadata editor (tags, rename) |
| `UploadPanel` | File upload dropzone with progress |
| `ReprocessButton` | Trigger derived variant re-generation |

## Settings Feature (`src/features/settings/`)

| Component | Description |
|-----------|-------------|
| `BrandVoiceForm` | Tone sliders, key phrases, banned topics |
| `PostingDefaultsForm` | Notification prefs, GBP CTA defaults |
| `ManagementConnectionForm` | Link to management app |
| `LinkInBioProfileForm` | Profile settings for link-in-bio page |
| `LinkInBioSettingsSection` | Section container with profile + tiles |
| `LinkInBioTileManager` | Add/reorder/activate tiles |

## Reviews Feature (`src/features/reviews/`)

| Component | Description |
|-----------|-------------|
| `ReviewsList` | Paginated list of Google reviews |
| `ReviewCard` | Individual review with star rating and reply form |

## Link in Bio (`src/features/link-in-bio/public/`)

| Component | Description |
|-----------|-------------|
| `LinkInBioPublicPage` | Public profile page rendered at `/l/{slug}` |

## Hooks (`src/hooks/`)

| Hook | Description |
|------|-------------|
| `useMobile` | Returns `true` on mobile viewport — used for responsive behaviour |
