---
generated: true
last_updated: 2026-05-20T00:00:00Z
source: session-setup
project: cheersai-app
---

# Relationships & Integration Map

## Table Relationships (inferred from code)

```
accounts (tenant root)
  |-- brand_profile (1:1)
  |-- posting_defaults (1:1)
  |-- social_connections (1:many)
  |-- meta_ad_accounts (1:many)
  |-- management_app_connections (1:many)
  |-- content_items (1:many)
  |     |-- content_variants (1:many, per platform)
  |     |-- publish_jobs (1:many)
  |     |-- notifications (1:many)
  |-- media_assets (1:many)
  |-- content_templates (1:many)
  |-- campaigns (1:many)
  |-- link_in_bio_profiles (1:1)
  |     |-- link_in_bio_tiles (1:many)
  |-- oauth_states (1:many, transient)
```

## Domain Relationships

### Content Lifecycle

```
Create Form --> content_items (status: draft)
                    |
                    v
AI Generation --> content_variants (per platform)
                    |
                    v
Schedule/Approve --> publish_jobs (status: queued)
                    |
                    v
QStash dispatch --> publish_jobs (status: processing)
                    |
                    v
Platform API call --> publish_jobs (status: published | failed)
                    |
                    v
Failure? --> notifications + notify-failures cron --> Resend email
```

### OAuth Connection Flow

```
User clicks Connect --> initiateOAuthConnect()
                            |
                            v
                        oauth_states (store CSRF state)
                            |
                            v
                        Redirect to provider
                            |
                            v
/api/oauth/[provider]/callback --> completeOAuthConnect()
                            |
                            v
                        social_connections (store encrypted tokens)
                            |
                            v
                        token-health cron (periodic validation)
                            |
                            v
                        notify-expiring-connections cron --> Resend email
```

### Campaign Management Flow

```
Campaign Wizard --> generateCampaignAction() (OpenAI)
                        |
                        v
                    saveCampaignDraft() --> campaigns table
                        |
                        v
                    publishCampaign() --> Meta Marketing API
                        |
                        v
                    sync-meta-campaigns cron --> performance data sync
                        |
                        v
                    optimise-meta-campaigns cron --> budget/bid recommendations
```

## External Integration Map

### OpenAI

| File | Usage |
|------|-------|
| `src/lib/ai/client.ts` | Singleton OpenAI client |
| `src/lib/ai/generate.ts` | Content generation with Zod response format |
| `src/lib/campaigns/generate.ts` | Campaign copy generation |
| Env: `OPENAI_API_KEY` | API authentication |

### Resend (Email)

| File | Usage |
|------|-------|
| `src/lib/email/resend.ts` | Email client (`sendEmail` wrapper) |
| Used by: `notify-failures` | Failed publish alerts |
| Used by: `token-health` | Token expiry warnings |
| Used by: `notify-expiring-connections` | Connection expiry alerts |
| Used by: `qstash-publish/failure` | QStash exhaustion alerts |
| Env: `RESEND_API_KEY`, `RESEND_FROM` | API auth and sender address |

### Upstash QStash (Background Jobs)

| File | Usage |
|------|-------|
| `src/lib/qstash/client.ts` | QStash client + signature verifier |
| `src/lib/publishing/dispatch.ts` | `dispatchToQStash()` job dispatcher |
| Webhook: `/api/webhooks/qstash-publish` | Job execution endpoint |
| Webhook: `/api/webhooks/qstash-publish/failure` | Exhausted retries endpoint |
| Env: `UPSTASH_QSTASH_TOKEN` | QStash authentication |
| Env: `UPSTASH_QSTASH_CURRENT_SIGNING_KEY` | Signature verification |
| Env: `UPSTASH_QSTASH_NEXT_SIGNING_KEY` | Key rotation support |

### Upstash Redis (Rate Limiting)

| File | Usage |
|------|-------|
| `src/lib/auth/rate-limit.ts` | Auth endpoint rate limiting |
| Algorithm: sliding window (5 requests / 60s) | |
| Env: `UPSTASH_REDIS_REST_URL` | Redis connection |
| Env: `UPSTASH_REDIS_REST_TOKEN` | Redis authentication |

### Supabase

| File | Usage |
|------|-------|
| `src/lib/supabase/server.ts` | Server-side auth client (anon key + cookies) |
| `src/lib/supabase/client.ts` | Browser client |
| `src/lib/supabase/route.ts` | Route handler client |
| `src/app/proxy.ts` | Proxy client |
| Pattern: `createServiceSupabaseClient()` | Service role (bypasses RLS) |
| Pattern: `requireAuthContext()` | Auth + account scoping |

### Satori + Sharp (Image Generation)

| File | Usage |
|------|-------|
| `src/lib/tournament/overlay.ts` | Tournament fixture banner generation |
| `src/lib/banner/render-server.ts` | Content banner overlay rendering |
| Internal API: `/api/internal/render-banner` | Server-side render endpoint |

### Meta (Facebook/Instagram)

| Connection | OAuth via `social_connections` |
|------------|-------------------------------|
| Campaign management | `src/lib/meta/marketing.ts` |
| Ad accounts | `src/app/(app)/connections/actions-ads.ts` |
| Graph API version | `META_GRAPH_VERSION` env (default: v24.0) |
| Env: `FACEBOOK_APP_SECRET` | App authentication |
| Env: `NEXT_PUBLIC_FACEBOOK_APP_ID` | Client-side SDK |

### Google Business Profile

| Connection | OAuth via `social_connections` |
|------------|-------------------------------|
| Review sync | `sync-gbp-reviews` cron |
| Metrics | `gbp-metrics` cron |
| Env: `GOOGLE_MY_BUSINESS_CLIENT_ID` | OAuth client |
| Env: `GOOGLE_MY_BUSINESS_CLIENT_SECRET` | OAuth secret |

### Luxon (Date/Time)

Used extensively across the codebase (20+ files) for timezone-safe date handling. Default timezone: `Europe/London`.

Key usage areas: planner calendar, content scheduling, campaign events, cron job timing, trash purge calculations.

## Feature Flags

| Flag | Env Variable | Purpose |
|------|-------------|---------|
| Connection Diagnostics | `ENABLE_CONNECTION_DIAGNOSTICS` | Debug logging for integrations |
| Media Attachments Table | `ENABLE_MEDIA_ATTACHMENTS_TABLE` | D-12 migration: junction table for media |
