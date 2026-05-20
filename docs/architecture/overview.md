---
generated: true
last_updated: 2026-05-20T00:00:00Z
source: session-setup
project: cheersai-app
---

# CheersAI 2.0 Architecture Overview

## System Summary

CheersAI is an AI-powered social media management platform for hospitality venues (pubs, restaurants, bars). Venue owners create content once; AI adapts it per platform (Facebook, Instagram, Google Business Profile); the publishing pipeline handles scheduling, preflight checks, and delivery via QStash.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.1 (App Router) |
| UI | React 19, Tailwind CSS 4, Radix UI, Framer Motion |
| Language | TypeScript 5 (strict) |
| Database | Supabase PostgreSQL + RLS |
| Auth | Supabase Auth (JWT + HTTP-only cookies) |
| AI | OpenAI (content generation, campaign copy) |
| Email | Resend (transactional notifications) |
| Background Jobs | Upstash QStash (publish pipeline) |
| Rate Limiting | Upstash Redis + @upstash/ratelimit |
| Image Generation | Satori + Sharp (banner overlays, tournament fixtures) |
| Date/Time | Luxon (Europe/London default) |
| Deployment | Vercel |

## Route Groups

The app uses Next.js App Router with three route groups:

| Group | Path | Auth | Purpose |
|-------|------|------|---------|
| `(app)` | `/dashboard`, `/planner`, `/create`, etc. | `getCurrentUser()` in layout | Authenticated workspace |
| `(auth)` | `/login` | `getUser()` redirect check | Auth flows |
| `(public)` | `/l/[slug]`, `/privacy` | None | Public-facing pages |

Plus 25 API routes under `/api/` (auth, cron, webhooks, OAuth, internal).

## Key Domains

- **Planner** -- Content calendar with scheduling, drag-drop, and conflict detection
- **Create** -- Multi-step content creation with AI generation (instant posts, events, promotions, weekly campaigns)
- **Library** -- Media asset management with upload, tagging, and bulk operations
- **Campaigns** -- Meta (Facebook/Instagram) ad campaign management with performance sync and optimisation
- **Connections** -- OAuth-based social platform connections (Facebook, Instagram, GBP)
- **Reviews** -- Google Business Profile review sync and AI-assisted reply drafting
- **Tournaments** -- Sports tournament fixture management with banner generation
- **Settings** -- Brand profile, posting defaults, connection management
- **Analytics** -- Cross-platform performance metrics and best-time analysis
- **Link-in-Bio** -- Public landing pages with tile management and click tracking

## Background Job Architecture

Publishing uses a QStash-based async pipeline:

1. `publish-scheduler` cron finds content where `scheduled_at` has arrived
2. `dispatchToQStash()` sends jobs with deduplication and delay
3. QStash delivers to `/api/webhooks/qstash-publish` webhook
4. On exhausted retries, QStash hits `/api/webhooks/qstash-publish/failure`
5. `notify-failures` cron emails admins about stuck jobs

## Auth Architecture

- **Middleware**: Domain redirect only (apex -> www), no auth enforcement in middleware
- **Layout-level auth**: `(app)/layout.tsx` calls `getCurrentUser()` -- redirects to login if unauthenticated
- **Server action auth**: Every mutation calls `requireAuthContext()` which returns `{ supabase, accountId }`
- **Rate limiting**: Upstash Redis sliding window (5 attempts per 60s on auth endpoints)
- **Token vault**: AES-256-GCM encrypted OAuth tokens (`TOKEN_VAULT_KEY` env)

## Database Tables (16 referenced in code)

`accounts`, `brand_profile`, `campaigns`, `content_items`, `content_templates`, `content_variants`, `link_in_bio_profiles`, `link_in_bio_tiles`, `management_app_connections`, `media_assets`, `meta_ad_accounts`, `notifications`, `oauth_states`, `posting_defaults`, `publish_jobs`, `social_connections`

## Cron Jobs (11)

| Cron | Purpose |
|------|---------|
| `publish-scheduler` | Dispatch due content to QStash |
| `publish` | Legacy publish trigger |
| `recurring-publish` | Materialise recurring content |
| `purge-trash` | Delete soft-deleted content after retention period |
| `sync-gbp-reviews` | Pull new Google Business Profile reviews |
| `sync-meta-campaigns` | Sync Meta campaign performance data |
| `gbp-metrics` | Collect GBP performance metrics |
| `optimise-meta-campaigns` | Run campaign budget/bid optimisation |
| `notify-failures` | Email alerts for failed publish jobs |
| `notify-expiring-connections` | Warn about expiring OAuth tokens |
| `token-health` | Check OAuth token validity across connections |
