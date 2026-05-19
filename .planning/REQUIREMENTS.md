# Requirements: CheersAI 2.0

**Defined:** 2026-05-19
**Core Value:** An owner can create content once, have AI generate platform-specific copy, and reliably publish to Facebook, Instagram, and GBP without manual intervention after approval.

## v1 Requirements

### Security & Auth

- [x] **AUTH-01**: Owner can sign in via magic link (primary) or password (hidden fallback)
- [x] **AUTH-02**: Middleware auth guard on all `(app)/*` routes — unauthenticated → 302 to login
- [x] **AUTH-03**: OAuth callback validates session via cookie-bound HMAC state
- [x] **AUTH-04**: Social OAuth tokens encrypted at rest with AES-256-GCM
- [x] **AUTH-05**: Security headers on all responses (CSP, HSTS, X-Frame-Options, Referrer-Policy)
- [x] **AUTH-06**: Cron/webhook endpoints validate signed secrets (timing-safe comparison)
- [x] **AUTH-07**: Server actions re-verify auth server-side (never trust client-provided accountId)
- [x] **AUTH-08**: Rate limiting on auth endpoints (login, magic link, password reset)

### Database & Schema

- [x] **DATA-01**: Consolidated greenfield schema baseline migration (no replay of 26 v1 migrations)
- [x] **DATA-02**: RLS enabled on all tables with correct policies
- [x] **DATA-03**: `content_media_attachments` junction table replacing `media_ids uuid[]`
- [x] **DATA-04**: `publish_jobs` with UNIQUE `idempotency_key` and EXCLUDE constraint for concurrent jobs
- [x] **DATA-05**: `content_item_versions` for snapshot at publish time
- [x] **DATA-06**: `audit_log` table for all mutations
- [x] **DATA-07**: `notifications` table with `urgency` enum (urgent/standard)
- [x] **DATA-08**: `analytics_snapshots` table for post performance metrics
- [x] **DATA-09**: `gbp_daily_metrics` table for location-level metrics
- [x] **DATA-10**: `link_in_bio_profiles` and `link_in_bio_tiles` tables
- [x] **DATA-11**: Forward-only migrations; data migrations separate from schema migrations

### Content Creation

- [x] **CONT-01**: Owner can create an Instant Post (single post, immediate or scheduled)
- [x] **CONT-02**: Owner can create a Story (Instagram/Facebook story format)
- [x] **CONT-03**: Owner can create an Event Campaign (maps to GBP Event post type)
- [x] **CONT-04**: Owner can create a Promotion Campaign (maps to GBP Offer post type with coupon code)
- [x] **CONT-05**: Owner can create a Weekly Recurring Campaign (auto-publish after first approval)
- [x] **CONT-06**: Platform-specific editor with per-tab previews (Facebook, Instagram, GBP)
- [x] **CONT-07**: Media library with search, tagging, and campaign filters
- [x] **CONT-08**: `next/image` replacing all bare `<img>` tags
- [x] **CONT-09**: Bulk approve: select individually + approve all
- [x] **CONT-10**: Pre-flight errors in plain English with actionable CTAs (specific lint codes)

### AI Generation

- [x] **AI-01**: AI generates platform-specific copy from a single content brief
- [x] **AI-02**: Fine-tune toggle with progressive disclosure (tone, length, CTA style, proof-points)
- [x] **AI-03**: Regenerate-with-modifier after initial generation
- [x] **AI-04**: Per-campaign-type and per-platform temperature settings
- [x] **AI-05**: Structured output schema with Zod validation of AI responses
- [x] **AI-06**: Content post-processing: banned phrases, emoji/hashtag clamping, word limits
- [x] **AI-07**: Brand voice model: tone sliders, per-platform signatures (appended post-processing)
- [x] **AI-08**: GBP CTA lint rule: warn when GBP CTA is null and no brand default
- [x] **AI-09**: 30-second timeout on OpenAI calls with graceful error (not hanging spinner)

### Platform Integrations

- [x] **PLAT-01**: Provider abstraction layer: `PublishingAdapter` interface with registry pattern
- [x] **PLAT-02**: Facebook adapter: posts, stories, events via Graph API
- [x] **PLAT-03**: Instagram adapter: posts, stories, carousels via Content Publishing API
- [x] **PLAT-04**: GBP adapter: Standard, Event, and Offer post types
- [x] **PLAT-05**: GBP access token auto-refresh (1h TTL, just-in-time before publish)
- [x] **PLAT-06**: Facebook/Instagram token health: alert 7 days before expiry
- [x] **PLAT-07**: Per-provider error classification: auth errors, rate limits (429), content rejection, transient 5xx
- [x] **PLAT-08**: API rate limit counters per provider (Facebook BUC, Instagram 200/hr, GBP daily)
- [x] **PLAT-09**: OAuth state session-bound via cookie (prevent state fixation)
- [x] **PLAT-10**: Nightly cron for proactive token refresh/alert

### Publishing Pipeline

- [x] **PUB-01**: QStash-based async publish queue (replaces Vercel Cron)
- [x] **PUB-02**: Publish job idempotency: duplicate fire → second is no-op
- [x] **PUB-03**: Retry/backoff: 5m/15m/45m, 4 attempts max, QStash-native retry
- [x] **PUB-04**: Handler-side idempotency with `publish_attempts` table (QStash 10-min window insufficient)
- [x] **PUB-05**: Publish failure recovery: retry button + plain-English root cause display
- [x] **PUB-06**: Content state machine: draft → review → approved → scheduled → queued → publishing → published/failed
- [x] **PUB-07**: Audit log entry for every publish attempt (success and failure)
- [x] **PUB-08**: Structured logging with Axiom: correlation IDs, job IDs, durations
- [x] **PUB-09**: Email alerts for publish failures (urgent) via Resend

### Scheduling

- [x] **SCHED-01**: Planner calendar: 6-week grid with status chips per platform and month navigation
- [x] **SCHED-02**: Conflict detection surfaced in scheduling UI with resolution suggestions
- [x] **SCHED-03**: Weekly recurring materialiser: expand recurring campaigns into individual publish slots
- [ ] **SCHED-04**: Auto-publish for approved recurring campaigns (`auto_confirm = true` at campaign level)
- [x] **SCHED-05**: Europe/London timezone hardcoded in all scheduling logic

### Notifications & Activity

- [ ] **NOTIF-01**: Activity feed with Supabase Realtime (status updates within 5s, no refresh)
- [ ] **NOTIF-02**: In-app notifications for non-urgent events (token expiring soon, weekly summary)
- [ ] **NOTIF-03**: Email notifications for urgent events (publish failure, token expired/disconnected)
- [ ] **NOTIF-04**: Token expiry: in-app notification + email sent when token expiring in ≤4 days
- [ ] **NOTIF-05**: Planner failure banner: "Attention Needed" count at top of view

### UX & Design System

- [x] **UX-01**: Design tokens: semantic colours, 4px spacing scale (14 named tokens), platform colours
- [x] **UX-02**: Responsive layout: bottom nav on mobile (64px), icon sidebar tablet (80px), expanded sidebar desktop (260px)
- [x] **UX-03**: Create flows: bottom sheet on mobile, slide-over on tablet, modal on desktop
- [x] **UX-04**: Status chips: draft/scheduled/queued/publishing/succeeded/failed with distinct colours
- [x] **UX-05**: Mobile touch targets ≥ 44×44px (WCAG minimum)
- [x] **UX-06**: WCAG 2.1 AA contrast ratios on all text
- [x] **UX-07**: Keyboard navigation for all interactive elements
- [x] **UX-08**: Modal dialogs trap focus and close on Escape
- [x] **UX-09**: Single Sidebar implementation (not 3 parallel nav files)
- [x] **UX-10**: Post detail on desktop: side drawer (not full navigation)

### Performance & Reliability

- [ ] **PERF-01**: Planner LCP ≤ 2.5s; skeleton paint ≤ 400ms
- [ ] **PERF-02**: INP < 200ms for all interactions
- [ ] **PERF-03**: Public link-in-bio LCP ≤ 2.0s (fully static after one Supabase read)
- [ ] **PERF-04**: Library first image row visible ≤ 2000ms; remaining rows lazy-loaded
- [ ] **PERF-05**: Lighthouse: Performance ≥ 85, Accessibility ≥ 95 on all primary routes
- [ ] **PERF-06**: Load test: 50 concurrent requests to Planner → p99 < 500ms

### Testing & CI

- [x] **TEST-01**: Vitest unit/integration tests with coverage thresholds (scheduling ≥90%, publishing ≥85%, auth ≥80%)
- [x] **TEST-02**: MSW integration tests for all provider API flows
- [x] **TEST-03**: Playwright E2E suite covering 6 critical journeys (with `@smoke` tag for CI)
- [x] **TEST-04**: CI pipeline: typecheck → lint → test → coverage → build → E2E smoke
- [x] **TEST-05**: Zero type errors, zero lint warnings enforced in CI
- [x] **TEST-06**: Migration dry-run generates TypeScript types as smoke check

### Analytics

- [ ] **ANLY-01**: Per-post publish outcome tracking (success/failure, platform, timestamp)
- [ ] **ANLY-02**: Engagement rate paired with impressions (no raw vanity metrics)
- [ ] **ANLY-03**: Platform comparison and content-type comparison views
- [ ] **ANLY-04**: Best day/time identification from historical data
- [ ] **ANLY-05**: GBP daily location metrics via cron (02:00 UTC)
- [ ] **ANLY-06**: Empty/unavailable data shows explanation, not zeroes or empty charts

### Link-in-Bio

- [ ] **LIB-01**: Profile page: slug, bio, logo, hero image, brand colours
- [ ] **LIB-02**: Contact links section
- [ ] **LIB-03**: Up to 12 custom tiles with drag-reorder
- [ ] **LIB-04**: Slug availability check via debounced Server Action
- [ ] **LIB-05**: No third-party tracking scripts — server-side collection only
- [ ] **LIB-06**: Public route under `/l/[slug]` with ISR

### Infrastructure

- [x] **INFRA-01**: Axiom structured logging (correlation IDs, JSON format)
- [x] **INFRA-02**: QStash configuration with signed delivery and dead-letter queue
- [x] **INFRA-03**: Feature flags via env vars for safe rollback (e.g. `ENABLE_MEDIA_ATTACHMENTS_TABLE`)
- [x] **INFRA-04**: GitHub Actions CI: 6-job pipeline (install → typecheck → lint → test → build → migration-check)
- [x] **INFRA-05**: Staging environment with mock providers for full regression
- [x] **INFRA-06**: Runbooks: token reconnection, publish outage, credential rotation

## v2 Requirements

### Advanced Auth

- **AUTH-V2-01**: Passkey support (Supabase native, stretch goal)
- **AUTH-V2-02**: OAuth login for owners (Google/GitHub)

### Advanced Content

- **CONT-V2-01**: Video post support (storage/bandwidth deferred)
- **CONT-V2-02**: Multi-language content generation

### Advanced Integrations

- **PLAT-V2-01**: Webhook listeners for publish confirmation and reach events
- **PLAT-V2-02**: TikTok adapter
- **PLAT-V2-03**: X/Twitter adapter

### Advanced Features

- **ADV-V2-01**: Multi-timezone support
- **ADV-V2-02**: Multi-user per account with roles
- **ADV-V2-03**: Native mobile app
- **ADV-V2-04**: Competitor content monitoring

## Out of Scope

| Feature | Reason |
|---------|--------|
| Real-time chat | Not core to social media management |
| Video posts | Storage/bandwidth costs; deferred to v2 |
| Download ZIP fallback for failed publishes | Better to invest in retry UX and root-cause messages (Decision #4) |
| Multi-timezone | All current users UK-based; Europe/London hardcoded (Decision #8) |
| Password auth advertised in UI | Magic link is primary; password exists as hidden fallback |
| Third-party tracking on link-in-bio | Privacy: server-side collection only |
| Native mobile app | Web-first responsive design covers mobile |
| OAuth login for owners | Magic link + password sufficient for v1 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 1 | Complete |
| AUTH-02 | Phase 1 | Complete |
| AUTH-03 | Phase 1 | Complete |
| AUTH-04 | Phase 1 | Complete |
| AUTH-05 | Phase 1 | Complete |
| AUTH-06 | Phase 1 | Complete |
| AUTH-07 | Phase 1 | Complete |
| AUTH-08 | Phase 1 | Complete |
| DATA-01 | Phase 1 | Complete |
| DATA-02 | Phase 1 | Complete |
| DATA-03 | Phase 1 | Complete |
| DATA-04 | Phase 1 | Complete |
| DATA-05 | Phase 1 | Complete |
| DATA-06 | Phase 1 | Complete |
| DATA-07 | Phase 1 | Complete |
| DATA-08 | Phase 1 | Complete |
| DATA-09 | Phase 1 | Complete |
| DATA-10 | Phase 1 | Complete |
| DATA-11 | Phase 1 | Complete |
| CONT-01 | Phase 2 | Complete |
| CONT-02 | Phase 2 | Complete |
| CONT-03 | Phase 2 | Complete |
| CONT-04 | Phase 2 | Complete |
| CONT-05 | Phase 2 | Complete |
| CONT-06 | Phase 2 | Complete |
| CONT-07 | Phase 2 | Complete |
| CONT-08 | Phase 2 | Complete |
| CONT-09 | Phase 4 | Complete |
| CONT-10 | Phase 4 | Complete |
| AI-01 | Phase 2 | Complete |
| AI-02 | Phase 2 | Complete |
| AI-03 | Phase 2 | Complete |
| AI-04 | Phase 2 | Complete |
| AI-05 | Phase 2 | Complete |
| AI-06 | Phase 2 | Complete |
| AI-07 | Phase 2 | Complete |
| AI-08 | Phase 2 | Complete |
| AI-09 | Phase 2 | Complete |
| PLAT-01 | Phase 3 | Complete |
| PLAT-02 | Phase 3 | Complete |
| PLAT-03 | Phase 3 | Complete |
| PLAT-04 | Phase 3 | Complete |
| PLAT-05 | Phase 3 | Complete |
| PLAT-06 | Phase 3 | Complete |
| PLAT-07 | Phase 3 | Complete |
| PLAT-08 | Phase 3 | Complete |
| PLAT-09 | Phase 3 | Complete |
| PLAT-10 | Phase 3 | Complete |
| PUB-01 | Phase 4 | Complete |
| PUB-02 | Phase 4 | Complete |
| PUB-03 | Phase 4 | Complete |
| PUB-04 | Phase 4 | Complete |
| PUB-05 | Phase 4 | Complete |
| PUB-06 | Phase 4 | Complete |
| PUB-07 | Phase 4 | Complete |
| PUB-08 | Phase 4 | Complete |
| PUB-09 | Phase 4 | Complete |
| SCHED-01 | Phase 2 | Complete |
| SCHED-02 | Phase 2 | Complete |
| SCHED-03 | Phase 2 | Complete |
| SCHED-04 | Phase 6 | Pending |
| SCHED-05 | Phase 2 | Complete |
| NOTIF-01 | Phase 5 | Pending |
| NOTIF-02 | Phase 5 | Pending |
| NOTIF-03 | Phase 5 | Pending |
| NOTIF-04 | Phase 5 | Pending |
| NOTIF-05 | Phase 5 | Pending |
| UX-01 | Phase 2 | Complete |
| UX-02 | Phase 2 | Complete |
| UX-03 | Phase 2 | Complete |
| UX-04 | Phase 2 | Complete |
| UX-05 | Phase 2 | Complete |
| UX-06 | Phase 2 | Complete |
| UX-07 | Phase 2 | Complete |
| UX-08 | Phase 2 | Complete |
| UX-09 | Phase 2 | Complete |
| UX-10 | Phase 2 | Complete |
| PERF-01 | Phase 5 | Pending |
| PERF-02 | Phase 5 | Pending |
| PERF-03 | Phase 6 | Pending |
| PERF-04 | Phase 5 | Pending |
| PERF-05 | Phase 5 | Pending |
| PERF-06 | Phase 5 | Pending |
| TEST-01 | Phase 4 | Complete |
| TEST-02 | Phase 4 | Complete |
| TEST-03 | Phase 5 | Complete |
| TEST-04 | Phase 1 | Complete |
| TEST-05 | Phase 1 | Complete |
| TEST-06 | Phase 1 | Complete |
| ANLY-01 | Phase 6 | Pending |
| ANLY-02 | Phase 6 | Pending |
| ANLY-03 | Phase 6 | Pending |
| ANLY-04 | Phase 6 | Pending |
| ANLY-05 | Phase 6 | Pending |
| ANLY-06 | Phase 6 | Pending |
| LIB-01 | Phase 6 | Pending |
| LIB-02 | Phase 6 | Pending |
| LIB-03 | Phase 6 | Pending |
| LIB-04 | Phase 6 | Pending |
| LIB-05 | Phase 6 | Pending |
| LIB-06 | Phase 6 | Pending |
| INFRA-01 | Phase 1 | Complete |
| INFRA-02 | Phase 1 | Complete |
| INFRA-03 | Phase 1 | Complete |
| INFRA-04 | Phase 1 | Complete |
| INFRA-05 | Phase 5 | Complete |
| INFRA-06 | Phase 5 | Complete |

**Coverage:**
- v1 requirements: 93 total
- Mapped to phases: 93
- Unmapped: 0

---
*Requirements defined: 2026-05-19*
*Last updated: 2026-05-19 after roadmap creation*
