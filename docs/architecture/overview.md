---
generated: true
last_updated: 2026-05-21
source: session-setup
project: cheersai-2.0
---

# CheersAI 2.0 -- Architecture Overview

AI-powered social media management platform for hospitality venues. Owners create content once, AI adapts it per platform (Facebook, Instagram, Google Business Profile), and a publishing pipeline handles scheduling, preflight checks, and delivery.

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.1, React 19.2, TypeScript strict |
| Styling | Tailwind CSS 4, Radix UI, Framer Motion |
| Database | Supabase PostgreSQL + RLS |
| Auth | Supabase Auth (JWT + HTTP-only cookies) |
| AI | OpenAI (content generation, review replies) |
| Email | Resend (transactional + notification) |
| Queues | QStash (publish pipeline reliability) |
| Rate limiting | Upstash Redis |
| Image gen | Satori + Sharp (banner overlays) |
| Dates | Luxon (Europe/London default) |
| Observability | Axiom (structured logging) |
| Deploy | Vercel |

## Route Groups

| Group | Auth | Purpose |
|-------|------|---------|
| `(app)/*` | Session (layout-level `getCurrentUser`) | Authenticated app pages |
| `(auth)/*` | Redirect if logged in | Login, signup |
| `(public)/*` | None | Link-in-bio pages, privacy policy |
| `api/cron/*` | CRON_SECRET header | Scheduled background jobs |
| `api/webhooks/*` | QStash signature | Publish pipeline callbacks |
| `api/oauth/*` | OAuth state | Social platform callbacks |
| `api/auth/*` | Supabase session | Login, magic link |
| `api/*` (other) | Mixed (session / secret) | Content, planner, feeds |

## Database Tables (27)

See [[data-model]] for full schema reference. Tables span: accounts, content pipeline (content_items, content_variants, publish_jobs, publish_attempts), campaigns (campaigns, meta_campaigns, ad_sets, ads), tournaments (tournaments, tournament_fixtures), social (social_connections, token_vault), analytics (analytics_snapshots, gbp_daily_metrics, booking_conversion_events), media (media_assets, content_media_attachments), link-in-bio (link_in_bio_profiles, link_in_bio_clicks, link_in_bio_page_views), admin (audit_log, notifications, profiles, posting_defaults, provider_rate_limits).

## Key Integrations

See [[relationships]] for cross-reference map.

| Service | Client Location | Used By |
|---------|----------------|---------|
| OpenAI | `src/lib/ai/client.ts` | Content generation, review replies |
| Resend | `src/lib/email/resend.ts` | Failure notifications, expiring connections, token health |
| QStash | `src/lib/qstash/client.ts` | Publish dispatch + webhook verification |
| Upstash Redis | `src/lib/auth/rate-limit.ts` | Rate limiting |
| Sharp | `src/lib/banner/render-server.ts` | Banner image processing |
| Satori | `src/lib/banner/render-server.ts` | HTML-to-image rendering |
| Meta Graph API | `src/lib/meta/` | Facebook/Instagram publishing + campaigns |
| Google Business Profile | `src/lib/gbp/` | GBP publishing, reviews, metrics |
| Luxon | Throughout codebase | Timezone-aware date handling |

## Related Docs

- [[routes]] -- Full route table
- [[server-actions]] -- All server actions
- [[data-model]] -- Database schema
- [[relationships]] -- Cross-reference map
