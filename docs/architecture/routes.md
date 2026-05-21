---
generated: true
last_updated: 2026-05-21
source: session-setup
project: cheersai-2.0
---

# Routes

## Pages (App Router)

### Authenticated `(app)` -- session auth via layout `getCurrentUser`

| URL | File | Purpose |
|-----|------|---------|
| `/analytics` | `src/app/(app)/analytics/page.tsx` | Analytics dashboard |
| `/campaigns` | `src/app/(app)/campaigns/page.tsx` | Campaign list |
| `/campaigns/new` | `src/app/(app)/campaigns/new/page.tsx` | Create new campaign |
| `/campaigns/[id]` | `src/app/(app)/campaigns/[id]/page.tsx` | Campaign detail |
| `/connections` | `src/app/(app)/connections/page.tsx` | Social platform connections |
| `/create` | `src/app/(app)/create/page.tsx` | Content creation wizard |
| `/dashboard` | `src/app/(app)/dashboard/page.tsx` | Main dashboard |
| `/dashboard/tournaments` | `src/app/(app)/dashboard/tournaments/page.tsx` | Tournament list (dashboard) |
| `/dashboard/tournaments/[id]` | `src/app/(app)/dashboard/tournaments/[id]/page.tsx` | Tournament detail (dashboard) |
| `/library` | `src/app/(app)/library/page.tsx` | Media library |
| `/link-in-bio` | `src/app/(app)/link-in-bio/page.tsx` | Link-in-bio editor |
| `/planner` | `src/app/(app)/planner/page.tsx` | Content planner/calendar |
| `/planner/[contentId]` | `src/app/(app)/planner/[contentId]/page.tsx` | Content detail |
| `/planner/notifications` | `src/app/(app)/planner/notifications/page.tsx` | Notification centre |
| `/reviews` | `src/app/(app)/reviews/page.tsx` | GBP review management |
| `/settings` | `src/app/(app)/settings/page.tsx` | Account settings |
| `/tournaments` | `src/app/(app)/tournaments/page.tsx` | Tournament list |
| `/tournaments/[id]` | `src/app/(app)/tournaments/[id]/page.tsx` | Tournament detail |

### Auth `(auth)` -- redirect if already logged in

| URL | File | Purpose |
|-----|------|---------|
| `/login` | `src/app/(auth)/login/page.tsx` | Sign in |

### Public `(public)` -- no auth

| URL | File | Purpose |
|-----|------|---------|
| `/l/[slug]` | `src/app/(public)/l/[slug]/page.tsx` | Public link-in-bio page |
| `/privacy` | `src/app/(public)/privacy/page.tsx` | Privacy policy |

### Root pages -- no auth

| URL | File | Purpose |
|-----|------|---------|
| `/` | `src/app/page.tsx` | Landing/home page |
| `/terms` | `src/app/terms/page.tsx` | Terms of service |
| `/help/[...slug]` | `src/app/help/[[...slug]]/page.tsx` | Help centre |
| `/auth/login` | `src/app/auth/login/page.tsx` | Alternate login |
| `/auth/signup` | `src/app/auth/signup/page.tsx` | Sign up |
| `/auth/forgot-password` | `src/app/auth/forgot-password/page.tsx` | Password reset |

## API Routes

### Auth

| Path | Method | Auth | File |
|------|--------|------|------|
| `/api/auth/login` | POST | Supabase session | `src/app/api/auth/login/route.ts` |
| `/api/auth/magic-link` | POST | Supabase session | `src/app/api/auth/magic-link/route.ts` |
| `/auth/callback` | GET | Supabase OAuth | `src/app/auth/callback/route.ts` |
| `/auth/confirm` | GET | Supabase token | `src/app/auth/confirm/route.ts` |

### OAuth Callbacks

| Path | Method | Auth | File |
|------|--------|------|------|
| `/api/oauth/[provider]/callback` | GET | OAuth state | `src/app/api/oauth/[provider]/callback/route.ts` |
| `/api/oauth/facebook-ads/callback` | GET | OAuth state | `src/app/api/oauth/facebook-ads/callback/route.ts` |

### Cron Jobs -- all use CRON_SECRET header auth

| Path | Method | File |
|------|--------|------|
| `/api/cron/gbp-metrics` | POST | `src/app/api/cron/gbp-metrics/route.ts` |
| `/api/cron/notify-expiring-connections` | GET/POST | `src/app/api/cron/notify-expiring-connections/route.ts` |
| `/api/cron/notify-failures` | GET, POST | `src/app/api/cron/notify-failures/route.ts` |
| `/api/cron/optimise-meta-campaigns` | POST | `src/app/api/cron/optimise-meta-campaigns/route.ts` |
| `/api/cron/publish` | POST | `src/app/api/cron/publish/route.ts` |
| `/api/cron/publish-scheduler` | GET, POST | `src/app/api/cron/publish-scheduler/route.ts` |
| `/api/cron/purge-trash` | POST | `src/app/api/cron/purge-trash/route.ts` |
| `/api/cron/recurring-publish` | POST | `src/app/api/cron/recurring-publish/route.ts` |
| `/api/cron/sync-gbp-reviews` | GET, POST | `src/app/api/cron/sync-gbp-reviews/route.ts` |
| `/api/cron/sync-meta-campaigns` | POST | `src/app/api/cron/sync-meta-campaigns/route.ts` |
| `/api/cron/token-health` | GET, POST | `src/app/api/cron/token-health/route.ts` |

### Webhooks

| Path | Method | Auth | File |
|------|--------|------|------|
| `/api/webhooks/qstash-publish` | POST | QStash signature | `src/app/api/webhooks/qstash-publish/route.ts` |
| `/api/webhooks/qstash-publish/failure` | POST | QStash signature | `src/app/api/webhooks/qstash-publish/failure/route.ts` |

### Content & Data

| Path | Method | Auth | File |
|------|--------|------|------|
| `/api/content/[id]` | GET | Session (getUser) | `src/app/api/content/[id]/route.ts` |
| `/api/create/generate-stream` | POST | Session (getUser) | `src/app/api/create/generate-stream/route.ts` |
| `/api/planner/activity` | GET | Session | `src/app/api/planner/activity/route.ts` |
| `/api/feed/[tournamentId]` | GET | API key (public feed) | `src/app/api/feed/[tournamentId]/route.ts` |
| `/api/booking-conversions` | POST | BOOKING_CONVERSION_INGEST_SECRET | `src/app/api/booking-conversions/route.ts` |

### Internal

| Path | Method | Auth | File |
|------|--------|------|------|
| `/api/internal/render-banner` | POST | CRON_SECRET | `src/app/api/internal/render-banner/route.ts` |
| `/manifest.json` | GET | None | `src/app/manifest.json/route.ts` |

## Middleware

File: `src/middleware.ts`

- Redirects apex domain (`cheersai.uk`) to `www.cheersai.uk` (308 permanent)
- Matches all routes except static assets
- No auth enforcement at middleware level -- auth is handled in layouts
