# Milestones

## v1.0 CheersAI 2.0 Complete Redesign (Shipped: 2026-05-19)

**Phases completed:** 6 phases, 32 plans, 67 tasks

**Key accomplishments:**

- AES-256-GCM token vault with versioned key rotation, security headers (CSP/HSTS/X-Frame-Options), timing-safe signing, and extended env.ts for all Phase 1 services
- 16-table PostgreSQL schema with RLS on every table, encrypted token vault, idempotent publish jobs, and junction-table media attachments replacing uuid[] columns
- Complete auth flow with proxy.ts guard using getUser(), magic link login with password fallback, Upstash rate limiting at 5 req/60s, and rebuilt requireAuthContext() for v2
- JSON-structured logging with AsyncLocalStorage correlation IDs, Axiom transport, and QStash signed delivery verification
- 6-job parallel CI pipeline with v8 coverage thresholds (auth >= 80%) and 5 passing auth server tests
- Design tokens for 6 status states, 3 platforms, 14 spacing values with dark mode toggle, plus content/media domain types and StatusChip/PlatformBadge components
- Responsive app shell with three-mode navigation: mobile bottom bar (64px), tablet icon sidebar (80px), desktop expanded sidebar (260px)
- Zod schemas for 5 content types with discriminated union, CRUD server actions with auth, RLS-scoped queries, and React Query autosave hook
- 4-step create wizard with responsive container, 5 content type forms, auto-save, and draft resume via React Hook Form + Zod + Framer Motion
- OpenAI structured outputs with Zod validation, multi-platform prompt building, brand voice system, and post-processing pipeline with 30s timeout
- Supabase Storage media library with account-scoped RLS, drag-drop upload, search/tag filtering, and inline wizard picker using next/image throughout
- 6-week planner calendar with 30-min conflict detection, recurring materialisation, status/platform filters, and right-side post detail drawer -- all timezone-aware via Europe/London
- End-to-end create wizard wiring: AI generation with modifier chips, media picker with attachment persistence, schedule step with conflict detection, and event import from management API
- PublishingAdapter registry with error classification, token vault helpers, oauth_states/rate_limits tables, and shared getConnectionMetadata utility
- Facebook and Instagram publishing adapters with Graph API integration, two-step Instagram publish flow, carousel support, and platform-specific content validation
- GBP publishing adapter with Standard/Event/Offer post types and just-in-time OAuth2 token refresh for 1-hour access token TTL
- V2 OAuth flow with session-bound state (PLAT-09), token vault storage, and connection health derivation with 7-day expiry alerting (PLAT-06)
- Rate limit tracking (PLAT-08), nightly cron (PLAT-10), sidebar health dots (D-01), and login toast (D-03)
- 7-state content lifecycle machine with QStash dispatch, idempotent webhook handler, audit logging, and plain-English error mapping
- Approve-and-schedule flow with preflight gating, cron scheduler, QStash failure email alerts, retry server action, and three publishing UI components
- MSW integration tests for all 3 provider adapters and pipeline handler with 85%/90% coverage thresholds
- Supabase Realtime subscriptions on publish_jobs and notifications tables with dual-channel hooks powering live activity feed, attention banner, and notification badge
- Centralised notification routing module with tiered email triggers: 4-day token expiry emails (NOTIF-04) and urgent expired/disconnected alerts (NOTIF-03)
- Planner Suspense isolation + startTransition INP optimization + library IntersectionObserver lazy loading + autocannon load test script
- Playwright E2E suite with 6 critical journey specs, page object model, MSW staging handlers, and CI smoke gating
- Three operational runbooks for token reconnection, publish outage recovery, and credential rotation with emergency leak procedures
- Analytics query functions with weighted engagement rates, best-day/time aggregation via Luxon, GBP Performance API client with nightly cron, and descriptive empty-reason strings
- Schema reconciliation migration adding 21 columns across profiles/tiles, click tracking tables with RLS, template registry with 4 layouts, Zod validation, and auto-save editor hook
- Recharts analytics dashboard with platform/content comparison charts, 7x24 best-time heatmap, GBP metrics line chart, and ANLY-06 empty state handling
- Side-by-side editor with live phone-frame preview, DnD tile management via @dnd-kit, 4 public page templates, click tracking, and ISR with 5-min revalidation
- Recurring auto-publish dispatch with QStash cron (every 15 min), carousel uploader with DnD reorder (2-10 images), and pause/resume/stop controls for recurring campaigns

---
