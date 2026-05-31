---
generated: true
last_updated: 2026-05-21
source: session-setup
project: cheersai-2.0
---

# Cross-Reference Map

## Integration Dependencies

### OpenAI

| Consumer | File | Purpose |
|----------|------|---------|
| AI content generation | `src/lib/ai/client.ts`, `src/lib/ai/generate.ts` | Core client + structured generation |
| Create wizard streaming | `src/app/api/create/generate-stream/route.ts` | SSE content stream |
| Review reply generation | `src/app/(app)/reviews/actions.ts` | AI-generated GBP review replies |
| Content service | `src/lib/create/service.ts` | Content creation pipeline |

### Resend (Email)

| Consumer | File | Purpose |
|----------|------|---------|
| Email client | `src/lib/email/resend.ts` | Shared `sendEmail()` function |
| Failure notifications | `src/app/api/cron/notify-failures/route.ts` | Alert on publish failures |
| Expiring connections | `src/app/api/cron/notify-expiring-connections/route.ts` | Token expiry warnings |
| Token health alerts | `src/app/api/cron/token-health/route.ts` | Unhealthy token alerts |
| QStash failure webhook | `src/app/api/webhooks/qstash-publish/failure/route.ts` | Publish failure alerts |

### QStash (Background Jobs)

| Consumer | File | Purpose |
|----------|------|---------|
| Publish dispatch | `src/lib/publishing/dispatch.ts` | Enqueue publish jobs |
| Webhook handler | `src/app/api/webhooks/qstash-publish/route.ts` | Process publish jobs |
| Failure handler | `src/app/api/webhooks/qstash-publish/failure/route.ts` | Handle failed jobs |
| Scheduler | `src/app/api/cron/publish-scheduler/route.ts` | Dispatch due jobs |
| Retry action | `src/app/actions/publish.ts` | Manual retry |

### Upstash Redis

| Consumer | File | Purpose |
|----------|------|---------|
| Rate limiting | `src/lib/auth/rate-limit.ts` | Per-user rate limits |

### Sharp + Satori (Image Generation)

| Consumer | File | Purpose |
|----------|------|---------|
| Banner rendering | `src/lib/banner/render-server.ts` | Tournament banner overlays |
| Internal render API | `src/app/api/internal/render-banner/route.ts` | Server-side render endpoint |

### Luxon (Dates)

Used across 20+ files for timezone-aware date handling. Key locations:
- Planner (calendar, scheduling, content detail)
- Create wizard
- Scheduling library (materialise, conflicts, spread)
- Analytics aggregations
- Campaign time utilities
- Cron jobs (purge-trash, publish scheduling)

### Axiom (Observability)

| Consumer | File | Purpose |
|----------|------|---------|
| Logging | `src/lib/axiom/` | Structured logging |

## Auth Flow

```
Request
  -> middleware.ts (apex redirect only, no auth)
  -> (app)/layout.tsx -> getCurrentUser() -> redirect to /login if no session
  -> page.tsx -> server component data fetching
  -> actions.ts -> getUser() / requireAuthContext() re-verification
```

### Auth Patterns by Route Type

| Route Type | Auth Method | Implementation |
|-----------|-------------|----------------|
| App pages | Session cookie | `(app)/layout.tsx` calls `getCurrentUser()` |
| Auth pages | Session check | `(auth)/layout.tsx` redirects if already logged in |
| Public pages | None | `(public)/layout.tsx` has no auth gate |
| Server actions | Session re-verify | `getUser()` or `requireAuthContext()` |
| Cron routes | CRON_SECRET | Bearer token or `x-cron-secret` header |
| QStash webhooks | QStash signature | `verifyQStashSignature()` |
| OAuth callbacks | OAuth state | Provider-specific state validation |
| Booking ingest | Shared secret | BOOKING_CONVERSION_INGEST_SECRET |
| Internal render | CRON_SECRET | Shared secret header |
| Feed API | Public (tournament ID) | No auth, public read |

### Auth Helper Files

| File | Purpose |
|------|---------|
| `src/lib/auth/server.ts` | `getCurrentUser()`, `requireAuthContext()` |
| `src/lib/auth/actions.ts` | Auth-related server actions |
| `src/lib/auth/rate-limit.ts` | Upstash rate limiting |
| `src/lib/auth/types.ts` | Auth type definitions |

## Feature -> Table -> Integration Map

| Feature | Tables | Integrations |
|---------|--------|-------------|
| Create | content_items, content_variants, media_assets | OpenAI, QStash |
| Planner | content_items, content_variants, publish_jobs | Luxon |
| Campaigns | campaigns, meta_campaigns, ad_sets, ads, meta_optimisation_* | Meta Graph API, OpenAI |
| Tournaments | tournaments, tournament_fixtures, content_items | Sharp, Satori |
| Publishing | publish_jobs, publish_attempts, content_items | QStash, Meta API, GBP API |
| Connections | social_connections, token_vault | OAuth (Meta, GBP) |
| Reviews | gbp_reviews | OpenAI, GBP API |
| Analytics | analytics_snapshots, gbp_daily_metrics | Meta API, GBP API |
| Library | media_assets, content_media_attachments | Supabase Storage |
| Link-in-Bio | link_in_bio_profiles, link_in_bio_clicks, link_in_bio_page_views | -- |
| Notifications | notifications | Resend |
| Settings | profiles, posting_defaults, accounts | -- |

## Environment Variable -> Consumer Map

### Server-Only

| Variable | Used By |
|----------|---------|
| CRON_SECRET | All cron routes, internal render |
| SUPABASE_SERVICE_ROLE_KEY | Service client (system operations) |
| OPENAI_API_KEY | AI content generation |
| RESEND_API_KEY / RESEND_FROM | Email notifications |
| FACEBOOK_APP_SECRET | Meta OAuth |
| INSTAGRAM_APP_SECRET / INSTAGRAM_APP_ID | Instagram OAuth |
| INSTAGRAM_VERIFY_TOKEN | Instagram webhook verification |
| GOOGLE_MY_BUSINESS_CLIENT_ID / SECRET | GBP OAuth |
| ALERTS_SECRET | Internal alerts |
| BOOKING_CONVERSION_INGEST_SECRET | Booking API |
| UPSTASH_QSTASH_TOKEN | QStash dispatch |
| UPSTASH_QSTASH_CURRENT/NEXT_SIGNING_KEY | QStash webhook verification |
| UPSTASH_REDIS_REST_URL / TOKEN | Rate limiting |
| AXIOM_DATASET / AXIOM_TOKEN | Structured logging |
| TOKEN_VAULT_KEY | Token encryption; must match Vercel and Supabase Edge Function secrets |
| TOKEN_VAULT_KEY_VERSION | Token encryption |

### Client (NEXT_PUBLIC_)

| Variable | Used By |
|----------|---------|
| NEXT_PUBLIC_SUPABASE_URL | Supabase client |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Supabase client |
| NEXT_PUBLIC_META_GRAPH_VERSION | Meta API version |

### Feature Flags

| Variable | Purpose |
|----------|---------|
| ENABLE_CONNECTION_DIAGNOSTICS | Debug logging for integrations |
| ENABLE_MEDIA_ATTACHMENTS_TABLE | Feature flag for media attachments |
| BANNER_OVERLAY_DISABLED | Disable banner overlays |
| DEBUG_CONTENT_GENERATION | Debug AI generation |
| TOURNAMENT_DEBUG | Debug tournament operations |
| OPENAI_MODEL | Override default AI model |

## Related Docs

- [[overview]] -- Project summary
- [[routes]] -- Full route table
- [[server-actions]] -- Action details
- [[data-model]] -- Table reference
