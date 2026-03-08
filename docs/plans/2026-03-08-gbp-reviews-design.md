# Google Business Profile Reviews Design

**Date:** 2026-03-08

## Goal

Add a Reviews section to CheersAI that fetches Google Business Profile reviews, surfaces them in a dedicated UI, and lets users generate AI-drafted responses (for The Anchor pub) which they can edit and post back to Google.

## Approach

Approach A: DB-backed with hourly cron sync. Reviews are fetched from the Google Business Profile API on a schedule and stored locally in a `gbp_reviews` table. The Reviews page reads from the database for instant loads. A manual "Refresh" button triggers on-demand sync. AI draft generation is on-demand per review. Users edit the draft before posting.

## Data Model

### New table: `gbp_reviews`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `business_profile_id` | uuid FK | links to the user's business |
| `google_review_id` | text UNIQUE | Google's own review ID |
| `reviewer_name` | text | |
| `star_rating` | integer | 1–5 |
| `comment` | text nullable | reviewer's text |
| `create_time` | timestamptz | when Google says review was posted |
| `update_time` | timestamptz | for detecting edits |
| `reply_comment` | text nullable | the posted reply text |
| `reply_update_time` | timestamptz nullable | when reply was posted |
| `ai_draft` | text nullable | AI-generated draft, editable before posting |
| `status` | text | `pending` \| `draft_ready` \| `replied` |
| `synced_at` | timestamptz | last time this row was refreshed from Google |

## Sync & Cron

- `syncGbpReviews(businessProfileId)` server action calls `locations/{locationId}/reviews` on the Google Business Profile API
- Upserts rows by `google_review_id`, updates `synced_at`
- Reviews already replied to on Google have `status` set to `replied` on sync
- New cron route: `POST /api/cron/sync-gbp-reviews` — protected by `CRON_SECRET`, runs hourly via Vercel cron
- "Refresh" button on Reviews page calls the same sync action on demand for the current user

## UI

Route: `/dashboard/reviews` — new "Reviews" item in main navigation.

**Summary bar:**
- Average star rating, total reviews, unresponded count
- Last synced time + "Refresh" button

**Review list:**
- Sorted newest first
- Filterable by status (All / Needs reply / Replied) and star rating
- Each review card shows: reviewer name, star rating (visual stars), date, review text, status badge

**Per-review actions:**
- `pending` → "Generate response" button → calls OpenAI → populates editable textarea → status becomes `draft_ready`
- `draft_ready` → editable textarea with AI draft + "Post reply" button (posts to Google, marks `replied`) + "Regenerate" button
- `replied` → posted reply shown in collapsed/muted style

## AI Response Generation

- Model: `gpt-4o`
- System prompt:
  > "You are responding to Google reviews on behalf of The Anchor, a pub. Always be positive, warm, encouraging, supportive, and inclusive. Responses should feel genuine and personal — not templated. Keep replies concise (2–4 sentences). If the review is negative, acknowledge the experience with empathy, apologise sincerely, and invite the reviewer to get in touch directly. If the review is positive, thank them warmly and express that you look forward to seeing them again."
- User message: review text + star rating
- Response stored as `ai_draft`, status updated to `draft_ready`
- No streaming — draft appears when ready

## Error Handling

| Scenario | Behaviour |
|---|---|
| GBP connection not active | Reviews page shows prompt to connect GBP in Settings |
| Google API rate limit / error | Sync fails gracefully, shows last synced time, inline error message |
| Review has no comment text | "Generate response" still available — AI acknowledges the star rating only |
| Post reply fails | Inline error on the card, draft preserved for retry |
| Token expired | Existing token refresh logic handles this; if refresh fails, prompt reconnect |

## Files to Create / Modify

| File | Change |
|---|---|
| `supabase/migrations/*_add_gbp_reviews.sql` | New `gbp_reviews` table |
| `src/types/reviews.ts` | TypeScript types for GbpReview |
| `src/lib/gbp/reviews.ts` | Google API fetch + upsert logic |
| `src/app/actions/gbp-reviews.ts` | Server actions: sync, generate draft, post reply |
| `src/app/api/cron/sync-gbp-reviews/route.ts` | Cron endpoint |
| `src/app/(app)/reviews/page.tsx` | Reviews page (server component) |
| `src/features/reviews/ReviewsList.tsx` | Client component: list, filter, cards |
| `src/features/reviews/ReviewCard.tsx` | Individual review card with actions |
| `vercel.json` | Add hourly cron schedule |
| Nav component | Add "Reviews" link |

## Out of Scope

- Review analytics / sentiment trends dashboard
- Automated posting without user review
- Multi-location GBP support (single location per connection)
- Push notifications for new reviews
- Bulk response generation
