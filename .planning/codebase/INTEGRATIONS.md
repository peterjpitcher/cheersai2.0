# External Integrations

**Analysis Date:** 2026-05-18

## APIs & External Services

**Content Generation:**
- OpenAI — Text generation and content creation
  - SDK/Client: `openai` v6.15.0
  - Auth: `OPENAI_API_KEY` (server-only)
  - Usage: `src/lib/ai/client.ts` provides singleton client
  - Server actions in `src/lib/create/service.ts` and `src/lib/campaigns/generate.ts`

**Email Delivery:**
- Resend — Transactional email service
  - SDK/Client: `resend` v6.6.0
  - Auth: `RESEND_API_KEY` (server-only), `RESEND_FROM` (sender address)
  - Usage: `src/lib/email/resend.ts` handles all email sends
  - Gracefully skips if credentials not configured (dev environments)

**Social Media Marketing — Meta (Facebook/Instagram):**
- Facebook Graph API v24.0 (configurable, default)
  - OAuth scopes: pages_show_list, pages_read_engagement, pages_manage_posts, pages_manage_metadata, instagram_basic, instagram_content_publish, instagram_manage_comments, business_management
  - Auth: `FACEBOOK_APP_ID` (public), `FACEBOOK_APP_SECRET` (server-only)
  - Graph version: `META_GRAPH_VERSION` or `NEXT_PUBLIC_META_GRAPH_VERSION` (env configurable)
  - Base URLs: `https://graph.facebook.com/{version}` and `https://www.facebook.com/{version}`
  - Usage: `src/lib/meta/graph.ts` (version management), `src/lib/meta/marketing.ts` (campaigns, posts)
  - Token refresh: `src/lib/connections/token-exchange.ts`

**Social Media — Instagram:**
- Instagram Graph API (via Facebook)
  - OAuth scopes: instagram_basic, instagram_content_publish, instagram_manage_comments
  - Auth: `INSTAGRAM_APP_ID` (public), `INSTAGRAM_APP_SECRET` (server-only), `INSTAGRAM_VERIFY_TOKEN` (webhook verification)
  - Webhook callbacks: `src/app/api/webhooks/instagram/route.ts`
  - Usage: Publishing, comment management via Meta Graph API

**Google Services:**

**Google My Business (GBP):**
- Google My Business API (businessprofile API)
  - OAuth scopes: `https://www.googleapis.com/auth/business.manage`
  - Auth: `GOOGLE_MY_BUSINESS_CLIENT_ID` (public), `GOOGLE_MY_BUSINESS_CLIENT_SECRET` (server-only)
  - Endpoints: `https://mybusinessbusinessinformation.googleapis.com/v1`, `https://mybusinessaccountmanagement.googleapis.com/v1`
  - Usage: Location management, reviews sync
  - Files: `src/lib/gbp/business-info.ts`, `src/lib/gbp/reviews.ts`, `src/lib/gbp/location-id.ts`
  - Rate limiting: Custom backoff with quota tracking

## Data Storage

**Databases:**
- Supabase PostgreSQL (remote)
  - Connection: `NEXT_PUBLIC_SUPABASE_URL` (public), `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public)
  - Service-role: `SUPABASE_SERVICE_ROLE_KEY` (server-only, for crons/system ops)
  - Client libraries: `@supabase/supabase-js` v2.89.0, `@supabase/ssr` v0.8.0
  - RLS: Enabled on all tables
  - Auth: Supabase Auth with JWT + HTTP-only cookies
  - Usage: All database queries via authenticated clients
  - Files: `src/lib/supabase/server.ts` (auth), `src/lib/supabase/service.ts` (admin), `src/lib/supabase/client.ts` (browser)

**File Storage:**
- Local filesystem only (no S3 or external blob storage)
- Image generation via `satori` and `sharp` libraries

**Caching:**
- React Query (in-memory, client-side)
- No Redis or external cache layer currently

## Authentication & Identity

**Auth Provider:**
- Supabase Auth (custom JWT + HTTP-only cookies)
  - Implementation: `src/lib/auth/server.ts` handles user context and account linking
  - OAuth callbacks: `src/app/api/oauth/[provider]/callback/route.ts`
  - Server actions: `src/lib/auth/actions.ts` (sign-up, sign-in, password reset)
  - Rate limiting: `src/lib/auth/rate-limit.ts` per-user and per-IP

**Permission Model:**
- Account-based (users belong to accounts)
- Account record in Supabase `accounts` table
- User context resolved from Supabase auth session + account lookup

## Monitoring & Observability

**Error Tracking:**
- Not detected (no Sentry, Rollbar, etc.)

**Logs:**
- Console logging (development)
- Optional debug flag: `ENABLE_CONNECTION_DIAGNOSTICS` enables connection diagnostics logs
- Files: `src/lib/connections/diagnostics.ts`

**Webhooks & Callbacks:**
- Instagram: Incoming webhooks at `/api/webhooks/instagram`
- Facebook: OAuth callbacks at `/api/oauth/facebook-ads/callback`
- Email: Resend bounce/delivery callbacks (not implemented in this codebase yet)

## CI/CD & Deployment

**Hosting:**
- Vercel (Next.js native)
- Edge functions supported

**CI Pipeline:**
- ESLint (zero warnings in CI mode)
- TypeScript type check
- Vitest unit tests
- Next.js production build
- Command: `npm run ci:verify`

**Cron Jobs:**
- Vercel Cron Triggers via `src/app/api/cron/` routes
- Secret validation: `CRON_SECRET` required
- Implemented jobs:
  - `/cron/publish` — Publish scheduled posts
  - `/cron/sync-meta-campaigns` — Sync Meta campaign data
  - `/cron/optimise-meta-campaigns` — Campaign optimization
  - `/cron/sync-gbp-reviews` — Sync Google My Business reviews
  - `/cron/notify-expiring-connections` — Alert on auth token expiration
  - `/cron/notify-failures` — Send failure notifications
  - `/cron/purge-trash` — Clean up deleted items

## Environment Configuration

**Required env vars (Production):**
- `CRON_SECRET` — Vercel Cron webhook secret
- `SUPABASE_SERVICE_ROLE_KEY` — Database admin access
- `FACEBOOK_APP_SECRET` — Facebook OAuth secret
- `GOOGLE_MY_BUSINESS_CLIENT_ID` — Google OAuth client ID
- `GOOGLE_MY_BUSINESS_CLIENT_SECRET` — Google OAuth secret
- `RESEND_API_KEY` — Email service key
- `RESEND_FROM` — Email sender address
- `OPENAI_API_KEY` — LLM API key

**Optional env vars:**
- `META_GRAPH_VERSION` — Facebook Graph version (default: v24.0)
- `ENABLE_CONNECTION_DIAGNOSTICS` — Debug logging (set to "1" or "true")
- `ALERTS_SECRET` — Internal alerts webhook secret

**Public env vars (in NEXT_PUBLIC_*):**
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Anonymous key
- `NEXT_PUBLIC_FACEBOOK_APP_ID` — Facebook app ID
- `NEXT_PUBLIC_SITE_URL` — App base URL (must be deployed domain in production)
- `NEXT_PUBLIC_META_GRAPH_VERSION` — Facebook Graph version (client-accessible)

**Secrets location:**
- `.env.local` (development, not committed)
- Vercel Environment Variables (production)
- Never committed to git

## Operational Scripts

Available via `npm run ops:*`:
- `ops:backfill-connections` — Sync social media connections
- `ops:backfill-link-in-bio-url` — Update profile link URLs
- `ops:link-auth-user` — Link Supabase auth to business profile
- `ops:regenerate-story-derivatives` — Rebuild cached story variants
- `ops:search-meta-interests` — Search Meta audience interests
- `ops:invoke` — Invoke custom database functions
- `ops:repair-gbp-location-ids` — Fix Google Business Profile location IDs
- `ops:seed-world-cup-2026` — Seed World Cup 2026 tournament data

All scripts use `tsx` for TypeScript execution with access to Supabase service-role client.

---

*Integration audit: 2026-05-18*
