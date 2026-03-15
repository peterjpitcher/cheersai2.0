---
title: Route Handlers
created: 2026-03-14
last_updated: 2026-03-14
status: current
tags:
  - type/reference
  - section/api
related:
  - "[[Server Actions]]"
  - "[[External Integrations]]"
  - "[[Auth & Security]]"
---

← [[_Index]] / [[_API MOC]]

# Route Handlers

Next.js API Route Handlers in `src/app/api/`.

## Cron Endpoints

All cron endpoints authenticate via `CRON_SECRET`. The secret can be passed as:
- `x-cron-secret` header
- `Authorization: Bearer {secret}` header
- `?secret={secret}` query parameter

### `GET/POST /api/cron/publish`

Triggers the `publish-queue` Supabase Edge Function. This is the main publishing mechanism — it should be called frequently (e.g. every minute via Vercel Cron). The Edge Function processes all `publish_jobs` with `status=queued` and `next_attempt_at <= now()`.

### `GET/POST /api/cron/purge-trash`

Permanently deletes soft-deleted content items that have been in trash for longer than the configured retention period.

### `GET/POST /api/cron/sync-gbp-reviews`

Fetches fresh reviews from the Google Business Profile Reviews API for all accounts with active GBP connections. Handles token refresh, rate limiting, and canonical location ID normalisation.

### `GET/POST /api/cron/sync-meta-campaigns`

Syncs Meta (Facebook/Instagram) ad campaign data. Used for the Campaigns feature.

### `GET/POST /api/cron/notify-failures`

Polls `publish_jobs` for entries with `status = 'failed'` and `updated_at > now() - 2 hours`. For each failure:
1. Checks `posting_defaults.notifications.emailFailures` — skips accounts that have opted out
2. Queries `notifications` table for `category = 'publish_failed_email_sent'` with `metadata->>'job_id'` matching — skips already-emailed jobs (idempotency)
3. Sends a failure notification email via `src/lib/email/resend.ts`
4. Inserts an idempotency row into `notifications`

Returns `{ processed, emailed, skipped }`. Per-job errors are caught individually to avoid aborting the batch.

## OAuth Callbacks

### `GET /api/oauth/[provider]/callback`

Handles the OAuth redirect from Facebook, Instagram, or GBP. Validates the `state` parameter against `oauth_states` table, stores the `auth_code`, marks the state as used. Redirects the user back to the app where `completeConnectionOAuth()` completes the flow.

Provider values: `facebook`, `instagram`, `gbp`.

### `GET /api/oauth/facebook-ads/callback`

Separate callback for Facebook Ads OAuth (used by the campaigns/Meta Ads integration).

## Auth Endpoints

### `POST /api/auth/login`

Handles email+password login via Supabase Auth. Uses the `route.ts` Supabase client variant.

### `POST /api/auth/magic-link`

Handles magic link sign-in.

## Activity Endpoint

### `GET /api/planner/activity`

Returns the latest planner activity (notifications). Session-authenticated. Used for polling or initial load.
