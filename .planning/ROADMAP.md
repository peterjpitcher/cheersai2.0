# Roadmap: CheersAI 2.0

## Overview

CheersAI 2.0 is a ground-up rebuild replacing a v1 prototype that has 6 critical security issues, 28 high-severity problems, and structural debt that makes it unsafe to build on. The rebuild delivers a complete AI-powered social media management platform for hospitality venues in six phases: security foundation first (token vault, auth, schema), then the content engine (AI generation, content types, scheduling), then platform integrations (provider adapters behind a registry), then the publishing pipeline (QStash, preflight, retry), then realtime UX and notifications, and finally analytics and independent features (link-in-bio, advanced controls). This order follows hard architectural dependencies: the token vault must exist before providers can store credentials, the content model must be stable before the pipeline is built against it, and analytics requires published content data.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Security and Auth Foundation** - Auth, token vault, greenfield schema, security headers, structured logging
- [x] **Phase 2: Content Engine and AI Generation** - Five content types, AI generation, scheduling, media, design system baseline (completed 2026-05-19)
- [x] **Phase 3: Provider Integration** - Facebook, Instagram, GBP adapters behind provider registry with rate limiting and token health (completed 2026-05-19)
- [ ] **Phase 4: Publishing Pipeline** - QStash queue, preflight checks, idempotency, retry/backoff, failure recovery
- [ ] **Phase 5: Realtime UX and Notifications** - Activity feed, email alerts, calendar views, mobile polish, bulk approve
- [ ] **Phase 6: Analytics, Link-in-Bio, and Advanced Features** - Post analytics, GBP metrics, link-in-bio, carousel, recurring auto-publish

## Phase Details

### Phase 1: Security and Auth Foundation
**Goal**: Owner can securely sign in and the application has a hardened foundation — encrypted token storage, RLS-protected schema, structured logging, and security headers — so all subsequent feature work builds on safe ground.
**Depends on**: Nothing (first phase)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07, AUTH-08, DATA-01, DATA-02, DATA-03, DATA-04, DATA-05, DATA-06, DATA-07, DATA-08, DATA-09, DATA-10, DATA-11, INFRA-01, INFRA-02, INFRA-03, INFRA-04, TEST-04, TEST-05, TEST-06
**Success Criteria** (what must be TRUE):
  1. Owner can sign in via magic link, land on a protected dashboard, and be redirected to login if session expires
  2. Social OAuth tokens are encrypted at rest (AES-256-GCM) and the token vault can encrypt/decrypt/rotate without downtime
  3. All response headers include CSP, HSTS, X-Frame-Options, and Referrer-Policy; cron/webhook endpoints reject unsigned requests
  4. The greenfield schema is deployed with RLS on every table and all domain tables exist (content, publish_jobs, audit_log, notifications, analytics, link_in_bio)
  5. CI pipeline runs typecheck, lint, test, coverage, build, and migration-check; structured logging with correlation IDs is operational
**Plans**: 5 plans

Plans:
- [x] 01-01-PLAN.md — Token vault, security headers, signing utility, env config
- [x] 01-02-PLAN.md — Greenfield schema: baseline + 5 domain migrations with RLS
- [x] 01-03-PLAN.md — Auth flow: proxy.ts guard, magic link login, callback, rate limiting
- [x] 01-04-PLAN.md — Structured logging with Axiom, correlation IDs, QStash client
- [x] 01-05-PLAN.md — CI pipeline (6 jobs), coverage thresholds, auth test scaffolding

### Phase 2: Content Engine and AI Generation
**Goal**: Owner can create all five content types, have AI generate platform-specific copy with fine-tune controls, upload media, and schedule content — all within a responsive design system.
**Depends on**: Phase 1
**Requirements**: CONT-01, CONT-02, CONT-03, CONT-04, CONT-05, CONT-06, CONT-07, CONT-08, AI-01, AI-02, AI-03, AI-04, AI-05, AI-06, AI-07, AI-08, AI-09, SCHED-01, SCHED-02, SCHED-03, SCHED-05, UX-01, UX-02, UX-03, UX-04, UX-05, UX-06, UX-07, UX-08, UX-09, UX-10
**Success Criteria** (what must be TRUE):
  1. Owner can create an Instant Post, Story, Event, Promotion, or Weekly Recurring campaign and see AI-generated platform-specific copy for each
  2. Owner can adjust AI output via tone, length, CTA, and proof-point controls, then regenerate with modifiers
  3. Owner can upload media, browse the media library with search/tags, and attach media to content
  4. Owner can schedule content on the planner calendar with conflict detection warnings, and the UI is responsive across mobile, tablet, and desktop
  5. Design tokens (colours, spacing), WCAG AA contrast, keyboard navigation, and focus management are working across all views
**Plans**: 8 plans

Plans:
- [x] 02-01-PLAN.md — Design tokens, dark mode, StatusChip, PlatformBadge, domain types
- [x] 02-02-PLAN.md — Responsive app shell: bottom nav, icon sidebar, expanded sidebar
- [x] 02-03-PLAN.md — Content schemas (5 types), server actions, auto-save draft hook
- [x] 02-04-PLAN.md — 4-step create wizard UI with type-specific forms
- [x] 02-05-PLAN.md — AI generation engine: structured outputs, prompts, post-processing
- [x] 02-06-PLAN.md — Media library: Supabase Storage, upload, search/tags, wizard picker
- [x] 02-07-PLAN.md — Planner calendar: 6-week grid, conflict detection, recurring materialiser
- [x] 02-08-PLAN.md — Integration wiring: AI into wizard, media into wizard, conflicts into schedule

### Phase 3: Provider Integration
**Goal**: Facebook, Instagram, and GBP are connected as live providers behind a uniform adapter interface, with token health monitoring, rate limit tracking, and proactive refresh.
**Depends on**: Phase 1 (token vault), Phase 2 (content types)
**Requirements**: PLAT-01, PLAT-02, PLAT-03, PLAT-04, PLAT-05, PLAT-06, PLAT-07, PLAT-08, PLAT-09, PLAT-10
**Success Criteria** (what must be TRUE):
  1. Owner can connect Facebook, Instagram, and GBP accounts via OAuth and see connection health status (green/amber/red)
  2. GBP adapter supports Standard, Event, and Offer post types; Facebook and Instagram adapters support posts and stories
  3. Token refresh happens automatically (GBP just-in-time, FB/IG proactive nightly cron) and expiry alerts appear 7 days before expiry
  4. Rate limit counters track per-provider API usage and platform-specific errors are classified (auth, rate limit, content rejection, transient)
**Plans**: 5 plans

Plans:
- [x] 03-01-PLAN.md — Schema migration, PublishingAdapter interface, registry, error classification, token helpers
- [x] 03-02-PLAN.md — Facebook and Instagram adapters with Graph API and Content Publishing API
- [x] 03-03-PLAN.md — GBP adapter with Standard/Event/Offer post types and just-in-time token refresh
- [x] 03-04-PLAN.md — OAuth actions rewrite (v2 schema + token vault) and connection health derivation
- [x] 03-05-PLAN.md — Rate limit tracking, nightly cron, sidebar health dots, login toast

### Phase 4: Publishing Pipeline
**Goal**: Content moves reliably from approved to published across all three platforms, with idempotent QStash delivery, composed preflight checks, retry/backoff, and plain-English failure recovery.
**Depends on**: Phase 3 (provider adapters)
**Requirements**: PUB-01, PUB-02, PUB-03, PUB-04, PUB-05, PUB-06, PUB-07, PUB-08, PUB-09, CONT-09 (DROPPED), CONT-10, TEST-01, TEST-02
**Success Criteria** (what must be TRUE):
  1. Owner approves content and it publishes to all selected platforms without manual intervention — state machine transitions are visible (draft to review to approved to scheduled to queued to publishing to published)
  2. QStash duplicate fires are no-ops (idempotency key in publish_attempts); retry follows 5m/15m/45m backoff with 4 attempts max
  3. Pre-flight errors display in plain English with actionable fix-it CTAs; owner approves individually in the create wizard (CONT-09 bulk approve DROPPED per D-03)
  4. Every publish attempt is audit-logged; failures trigger email alert; structured logs include correlation IDs and job durations
  5. Test coverage meets thresholds: scheduling >=90%, publishing >=85%, auth >=80%; MSW integration tests cover all provider API flows
**Plans**: 3 plans

Plans:
- [x] 04-01-PLAN.md — Core pipeline: state machine, audit log, QStash dispatch, webhook handler, error messages
- [x] 04-02-PLAN.md — Approval flow, cron scheduler, failure email alerts, recovery UX components
- [x] 04-03-PLAN.md — MSW integration tests for all provider API flows, coverage thresholds

### Phase 5: Realtime UX and Notifications
**Goal**: The application feels alive — publish status updates appear in real time, urgent failures trigger email alerts, the planner calendar shows weekly and monthly views, and the mobile experience is polished.
**Depends on**: Phase 4 (publishing pipeline)
**Requirements**: NOTIF-01, NOTIF-02, NOTIF-03, NOTIF-04, NOTIF-05, PERF-01, PERF-02, PERF-04, PERF-05, PERF-06, TEST-03, INFRA-05, INFRA-06
**Success Criteria** (what must be TRUE):
  1. Publish status changes appear in the activity feed within 5 seconds without page refresh (Supabase Realtime)
  2. Publish failures trigger urgent email; token expiry triggers in-app notification + email at <=4 days; planner shows "Attention Needed" failure count
  3. Planner LCP <=2.5s with skeleton paint <=400ms; INP <200ms; Lighthouse Performance >=85 and Accessibility >=95 on primary routes
  4. Playwright E2E suite covers 6 critical journeys with @smoke tag for CI; staging environment uses mock providers for full regression
  5. Runbooks exist for token reconnection, publish outage, and credential rotation
**Plans**: 5 plans

Plans:
- [x] 05-01-PLAN.md — Supabase Realtime migration, useRealtimeFeed hook, activity feed rewrite, attention banner, notification badge
- [ ] 05-02-PLAN.md — Email notification routing: shared helpers, extend crons for token expiry and disconnection emails
- [x] 05-03-PLAN.md — Performance optimization: planner LCP/INP, library lazy loading, load test script
- [x] 05-04-PLAN.md — Playwright E2E setup, 6 critical journeys, MSW staging handlers, CI integration
- [x] 05-05-PLAN.md — Operational runbooks: token reconnection, publish outage, credential rotation

### Phase 6: Analytics, Link-in-Bio, and Advanced Features
**Goal**: Owner can see how their content performs, has a branded link-in-bio page for their venue, and the remaining advanced features (carousel, recurring auto-publish, fine-tune polish) round out the platform.
**Depends on**: Phase 4 (published content data)
**Requirements**: ANLY-01, ANLY-02, ANLY-03, ANLY-04, ANLY-05, ANLY-06, LIB-01, LIB-02, LIB-03, LIB-04, LIB-05, LIB-06, SCHED-04, PERF-03
**Success Criteria** (what must be TRUE):
  1. Owner can view per-post engagement rate with impressions, compare performance across platforms and content types, and see best day/time recommendations
  2. GBP daily location metrics are collected via nightly cron; empty/unavailable data shows explanations not zeroes
  3. Owner can create a branded link-in-bio page with slug, bio, logo, hero image, contact links, and up to 12 drag-reorderable tiles at a public `/l/[slug]` URL
  4. Link-in-bio public page loads with LCP <=2.0s (ISR); no third-party tracking scripts present
  5. Weekly recurring campaigns auto-publish after first approval; Instagram carousel publishing works end-to-end
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Security and Auth Foundation | 5/5 | Complete | 2026-05-19 |
| 2. Content Engine and AI Generation | 8/8 | Complete   | 2026-05-19 |
| 3. Provider Integration | 5/5 | Complete | 2026-05-19 |
| 4. Publishing Pipeline | 1/3 | In Progress|  |
| 5. Realtime UX and Notifications | 0/5 | Not started | - |
| 6. Analytics, Link-in-Bio, and Advanced Features | 0/2 | Not started | - |
