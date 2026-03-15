---
title: Server Actions
created: 2026-03-14
last_updated: 2026-03-14
status: current
tags:
  - type/reference
  - section/api
related:
  - "[[Route Handlers]]"
  - "[[Auth & Security]]"
---

← [[_Index]] / [[_API MOC]]

# Server Actions

All mutations in CheersAI are handled by Next.js Server Actions (`'use server'`). All server actions call `requireAuthContext()` first.

## Connections (`src/app/(app)/connections/actions.ts`)

| Action | Purpose |
|--------|---------|
| `updateConnectionMetadata(input)` | Save provider-specific metadata (pageId, igBusinessId, locationId). Validates format for GBP. Updates connection status. |
| `startConnectionOAuth(input)` | Create `oauth_states` record, return OAuth redirect URL |
| `completeConnectionOAuth(input)` | Read state, exchange auth code for tokens, update `social_connections` |

## Reviews (`src/app/(app)/reviews/actions.ts`)

| Action | Purpose |
|--------|---------|
| `fetchReviews()` | Load synced reviews from `gbp_reviews` table |
| `replyToReview(reviewId, comment)` | Call `postGbpReply()` then update `gbp_reviews.reply_comment` |
| `refreshReviews()` | Manually trigger a GBP reviews sync for the current account |

## Create (`src/app/(app)/create/actions.ts`)

| Action | Purpose |
|--------|---------|
| `createInstantPost(input)` | Generate AI content, insert content_items + variants, optionally enqueue publish job |
| `createCampaign(type, input)` | Delegate to campaign-type-specific generator in `src/lib/campaigns/generate.ts` |

## Campaigns (`src/app/(app)/campaigns/actions.ts` and `[id]/actions.ts`)

| Action | Purpose |
|--------|---------|
| `listCampaigns()` | Fetch all campaigns for the account |
| `getCampaignDetail(id)` | Fetch campaign + content items |
| `updateCampaignStatus(id, status)` | Update campaign status |
| `deleteCampaign(id)` | Delete campaign and cascade to content_items |

## Planner (`src/app/(app)/planner/actions.ts`)

| Action | Purpose |
|--------|---------|
| `getPlannerData(options)` | Thin wrapper over `getPlannerOverview()` |
| `updateContentBody(id, body)` | Update `content_variants.body` |
| `updateContentSchedule(id, scheduledFor)` | Reschedule content item |
| `approveContent(id)` | Set status to `scheduled`, enqueue publish job |
| `softDeleteContent(id)` | Set `deleted_at` on content item |
| `restoreContent(id)` | Clear `deleted_at`, set status to `draft` |
| `dismissNotification(id)` | Set `notifications.read_at` |

## Library (`src/app/(app)/library/actions.ts`)

| Action | Purpose |
|--------|---------|
| `uploadMediaAsset(formData)` | Upload file to Supabase Storage, insert `media_assets` row |
| `updateAssetTags(id, tags)` | Update `media_assets.tags` |
| `hideAsset(id)` | Set `media_assets.hidden_at` |
| `reprocessAsset(id)` | Trigger derived variant regeneration |

## Settings (`src/app/(app)/settings/actions.ts`)

| Action | Purpose |
|--------|---------|
| `saveBrandProfile(input)` | Upsert `brand_profile` row |
| `savePostingDefaults(input)` | Upsert `posting_defaults` row |

## Auth (`src/lib/auth/actions.ts`)

| Action | Purpose |
|--------|---------|
| `signOut()` | Call `supabase.auth.signOut()`, redirect to `/login` |
