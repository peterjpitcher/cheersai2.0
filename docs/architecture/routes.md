---
generated: true
last_updated: 2026-05-20T00:00:00Z
source: session-setup
project: cheersai-app
---

# Routes

## Pages (App Router)

### Authenticated -- `(app)` group

Auth enforced via `getCurrentUser()` in `src/app/(app)/layout.tsx`.

| URL | File | Notes |
|-----|------|-------|
| `/analytics` | `src/app/(app)/analytics/page.tsx` | Performance metrics |
| `/campaigns` | `src/app/(app)/campaigns/page.tsx` | Campaign list with Meta sync |
| `/campaigns/new` | `src/app/(app)/campaigns/new/page.tsx` | New campaign wizard |
| `/campaigns/[id]` | `src/app/(app)/campaigns/[id]/page.tsx` | Campaign detail + performance |
| `/connections` | `src/app/(app)/connections/page.tsx` | OAuth social connections |
| `/create` | `src/app/(app)/create/page.tsx` | Multi-step content creation |
| `/dashboard` | `src/app/(app)/dashboard/page.tsx` | Main dashboard |
| `/dashboard/tournaments` | `src/app/(app)/dashboard/tournaments/page.tsx` | Tournament list |
| `/dashboard/tournaments/[id]` | `src/app/(app)/dashboard/tournaments/[id]/page.tsx` | Tournament detail |
| `/library` | `src/app/(app)/library/page.tsx` | Media asset library |
| `/link-in-bio` | `src/app/(app)/link-in-bio/page.tsx` | Link-in-bio editor |
| `/planner` | `src/app/(app)/planner/page.tsx` | Content calendar |
| `/planner/[contentId]` | `src/app/(app)/planner/[contentId]/page.tsx` | Content detail |
| `/planner/notifications` | `src/app/(app)/planner/notifications/page.tsx` | Planner notifications |
| `/reviews` | `src/app/(app)/reviews/page.tsx` | GBP review management |
| `/settings` | `src/app/(app)/settings/page.tsx` | Account settings |

### Auth -- `(auth)` group

Auth check via `supabase.auth.getUser()` in `src/app/(auth)/layout.tsx` (redirects authenticated users away).

| URL | File | Notes |
|-----|------|-------|
| `/login` | `src/app/(auth)/login/page.tsx` | Sign in form |

### Public -- `(public)` group

No auth required.

| URL | File | Notes |
|-----|------|-------|
| `/l/[slug]` | `src/app/(public)/l/[slug]/page.tsx` | Link-in-bio public page |
| `/privacy` | `src/app/(public)/privacy/page.tsx` | Privacy policy |

### Top-level pages

| URL | File | Notes |
|-----|------|-------|
| `/` | `src/app/page.tsx` | Landing / redirect |
| `/terms` | `src/app/terms/page.tsx` | Terms of service |
| `/help/[...slug]` | `src/app/help/[[...slug]]/page.tsx` | Help centre (catch-all) |
| `/auth/login` | `src/app/auth/login/page.tsx` | Alt login page |
| `/auth/signup` | `src/app/auth/signup/page.tsx` | Sign up page |
| `/auth/forgot-password` | `src/app/auth/forgot-password/page.tsx` | Password reset |

## API Routes

### Auth

| Path | Method | Auth | File |
|------|--------|------|------|
| `/api/auth/login` | POST | None (public) | `src/app/api/auth/login/route.ts` |
| `/api/auth/magic-link` | POST | None (public) | `src/app/api/auth/magic-link/route.ts` |
| `/auth/callback` | GET | Supabase callback | `src/app/auth/callback/route.ts` |
| `/auth/confirm` | GET | Supabase confirm | `src/app/auth/confirm/route.ts` |

### OAuth

| Path | Method | Auth | File |
|------|--------|------|------|
| `/api/oauth/[provider]/callback` | GET | OAuth state | `src/app/api/oauth/[provider]/callback/route.ts` |
| `/api/oauth/facebook-ads/callback` | GET | OAuth state | `src/app/api/oauth/facebook-ads/callback/route.ts` |

### Content & Media

| Path | Method | Auth | File |
|------|--------|------|------|
| `/api/create/generate-stream` | POST | Session auth | `src/app/api/create/generate-stream/route.ts` |
| `/api/internal/render-banner` | POST | Internal secret | `src/app/api/internal/render-banner/route.ts` |
| `/api/planner/activity` | GET | Session auth | `src/app/api/planner/activity/route.ts` |
| `/api/feed/[tournamentId]` | GET | API key | `src/app/api/feed/[tournamentId]/route.ts` |
| `/api/booking-conversions` | POST | Ingest secret | `src/app/api/booking-conversions/route.ts` |

### Webhooks

| Path | Method | Auth | File |
|------|--------|------|------|
| `/api/webhooks/qstash-publish` | POST | QStash signature | `src/app/api/webhooks/qstash-publish/route.ts` |
| `/api/webhooks/qstash-publish/failure` | POST | QStash signature | `src/app/api/webhooks/qstash-publish/failure/route.ts` |

### Cron Jobs (CRON_SECRET auth)

| Path | Methods | File |
|------|---------|------|
| `/api/cron/publish-scheduler` | GET, POST | `src/app/api/cron/publish-scheduler/route.ts` |
| `/api/cron/publish` | GET, POST | `src/app/api/cron/publish/route.ts` |
| `/api/cron/recurring-publish` | POST | `src/app/api/cron/recurring-publish/route.ts` |
| `/api/cron/purge-trash` | GET, POST | `src/app/api/cron/purge-trash/route.ts` |
| `/api/cron/sync-gbp-reviews` | GET, POST | `src/app/api/cron/sync-gbp-reviews/route.ts` |
| `/api/cron/sync-meta-campaigns` | GET, POST | `src/app/api/cron/sync-meta-campaigns/route.ts` |
| `/api/cron/gbp-metrics` | POST | `src/app/api/cron/gbp-metrics/route.ts` |
| `/api/cron/optimise-meta-campaigns` | GET, POST | `src/app/api/cron/optimise-meta-campaigns/route.ts` |
| `/api/cron/notify-failures` | GET, POST | `src/app/api/cron/notify-failures/route.ts` |
| `/api/cron/notify-expiring-connections` | GET, POST | `src/app/api/cron/notify-expiring-connections/route.ts` |
| `/api/cron/token-health` | GET | `src/app/api/cron/token-health/route.ts` |

### Other

| Path | Method | Auth | File |
|------|--------|------|------|
| `/manifest.json` | GET | None | `src/app/manifest.json/route.ts` |

## Middleware

File: `src/middleware.ts`

The middleware only handles apex-to-www domain redirection (`cheersai.uk` -> `www.cheersai.uk` with 308 permanent redirect). It does **not** enforce authentication -- that is handled at the layout level.

Matcher excludes: `_next/static`, `_next/image`, `favicon.ico`, `robots.txt`, `manifest.webmanifest`, `sitemap.xml`.
