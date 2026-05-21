---
generated: true
last_updated: 2026-05-21
source: session-setup
project: cheersai-2.0
---

# Data Model

See session-context.md for full schema.

## Tables Found in Codebase (27)

### Core

| Table | Domain | Used By |
|-------|--------|---------|
| `accounts` | Multi-tenant account | Auth, all features |
| `profiles` | User profiles | AI generation, settings |
| `posting_defaults` | Default posting config | Settings, create |

### Content Pipeline

| Table | Domain | Used By |
|-------|--------|---------|
| `content_items` | Content posts | Create, planner, publish, tournaments |
| `content_variants` | Platform-specific variants | Publishing, preview |
| `publish_jobs` | Publish queue entries | Publishing pipeline |
| `publish_attempts` | Publish attempt history | Publishing audit |
| `media_assets` | Uploaded media files | Library, create, tournaments |
| `content_media_attachments` | Media-to-content links | Create, library |

### Campaigns (Meta Ads)

| Table | Domain | Used By |
|-------|--------|---------|
| `campaigns` | Campaign definitions | Campaigns feature |
| `meta_campaigns` | Meta platform campaigns | Meta sync, dashboard |
| `meta_ad_accounts` | Meta ad accounts | Campaign creation |
| `ad_sets` | Ad set config | Campaign detail |
| `ads` | Individual ads | Campaign detail |
| `meta_optimisation_actions` | AI optimisation actions | Campaign optimiser |
| `meta_optimisation_runs` | Optimisation run history | Campaign optimiser |

### Tournaments

| Table | Domain | Used By |
|-------|--------|---------|
| `tournaments` | Tournament definitions | Tournament feature |
| `tournament_fixtures` | Individual fixtures | Tournament detail |

### Social Connections

| Table | Domain | Used By |
|-------|--------|---------|
| `social_connections` | OAuth connections | Connections, publishing |
| `token_vault` | Encrypted tokens | Token refresh, health |
| `management_app_connections` | Management app links | Settings |

### Analytics

| Table | Domain | Used By |
|-------|--------|---------|
| `analytics_snapshots` | Performance snapshots | Analytics dashboard |
| `gbp_daily_metrics` | GBP daily metrics | GBP metrics cron |
| `booking_conversion_events` | Booking conversions | Conversion tracking |

### Link-in-Bio

| Table | Domain | Used By |
|-------|--------|---------|
| `link_in_bio_profiles` | Bio page config | Link-in-bio editor |
| `link_in_bio_clicks` | Click tracking | Analytics |
| `link_in_bio_page_views` | Page view tracking | Analytics |

### Admin

| Table | Domain | Used By |
|-------|--------|---------|
| `audit_log` | Mutation audit trail | Publishing, all mutations |
| `notifications` | User notifications | Planner, cron jobs |
| `provider_rate_limits` | API rate limit tracking | Publishing |

## Related Docs

- [[server-actions]] -- Which actions query which tables
- [[routes]] -- API routes that access data
- [[relationships]] -- Full dependency map
