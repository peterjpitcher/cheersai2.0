# CheersAI 2.0 — Complete Redesign

## What This Is

CheersAI is an AI-powered social media management platform for hospitality venues (pubs, restaurants, bars). Owners create content once — the AI adapts it per platform (Facebook, Instagram, Google Business Profile) — and the publishing pipeline handles scheduling, preflight checks, and delivery. This is a ground-up rebuild of v1, driven by a comprehensive 12-document design audit that identified 6 critical security issues, 28 high-severity problems, and 30+ minor issues making v1 unsafe for production scale.

## Core Value

An owner can create a single piece of content, have AI generate platform-specific copy, and reliably publish it to Facebook, Instagram, and Google Business Profile — without manual intervention after approval.

## Requirements

### Validated

- [x] Middleware auth guard on all protected routes (Phase 1 — C-1)
- [x] AES-256-GCM encryption for social OAuth tokens at rest (Phase 1 — C-3)
- [x] OAuth callback session validation with HMAC state (Phase 1 — C-2)
- [x] Structured logging with correlation IDs (Phase 1 — C-6)
- [x] Consolidated schema baseline migration (Phase 1)
- [x] Security headers: CSP, HSTS, X-Frame-Options, Referrer-Policy (Phase 1)
- [x] QStash replacing Vercel Cron for background jobs (Phase 1 — client setup)
- [x] Five content creation flows: Instant Post, Stories, Event, Promotion, Weekly Recurring (Phase 2)
- [x] AI generation with exposed fine-tune controls: tone, length, CTA, proof-points (Phase 2)
- [x] Regenerate-with-modifier after initial generation (Phase 2)
- [x] Media library with search, tagging, campaign filters (Phase 2)
- [x] Design system: semantic colour tokens, 4px spacing scale, responsive layout (Phase 2)
- [x] Mobile bottom nav, 64px (Phase 2)
- [x] Conflict detection surfaced in scheduling UI (Phase 2)
- [x] GBP token refresh flow — auto-refresh before expiry (Phase 3 — C-5, just-in-time)
- [x] GBP Event and Offer post types (Phase 3 — PLAT-04)
- [x] Token health monitoring: proactive nightly cron + in-app alerts at 7 days (Phase 3 — PLAT-06/10)
- [x] Instagram carousel support (Phase 3 — PLAT-03)
- [x] Provider abstraction layer with registry pattern (Phase 3 — PLAT-01)
- [x] Publish job idempotency — deduplicate QStash double-fires (Phase 4 — C-4)
- [x] Full publish pipeline for all content types across all three platforms (Phase 4)
- [x] Retry/backoff (5m/15m/45m, 4 attempts max) via QStash (Phase 4)
- [x] Pre-flight errors in plain English with actionable CTAs (Phase 4)
- [x] Publish failure recovery: retry button + plain-English root cause (Phase 4)
- [x] Audit log for all publish operations (Phase 4)

### Active

- [ ] Activity feed with Supabase Realtime — no polling (Phase 5)
- [ ] Email alerts for failures and token expiry — Resend (Phase 5)
- [ ] WCAG 2.1 AA compliance: contrast, touch targets, keyboard nav, ARIA (Phase 5)
- [ ] Performance budgets: LCP <2.5s on Planner, INP <200ms (Phase 5)
- [ ] Playwright E2E suite for 6 critical journeys (Phase 5)
- [ ] Test coverage: scheduling ≥90%, publishing ≥85%, auth ≥80% (Phase 5)
- [ ] Analytics: engagement rate, platform comparison, content-type comparison, best-day/time (Phase 6)
- [ ] GBP daily location metrics via cron (Phase 6)
- [ ] Link-in-bio: profile page, contact links, up to 12 custom tiles with drag-reorder (Phase 6)
- [ ] CI pipeline: typecheck → lint → test → coverage → build → E2E smoke (Phase 5)

### Out of Scope

- Real-time chat — not core to social media management
- Video posts — storage/bandwidth costs deferred to future milestone
- OAuth login for owners (Google/GitHub) — magic link + password sufficient
- Native mobile app — web-first, responsive design covers mobile
- Download ZIP fallback for failed publishes — invest in better retry/root-cause UX instead (Decision #4)
- Bulk approve — dropped in Phase 4 (D-03): not needed given recurring auto-publish and in-flow approval
- Platform-specific editor with per-tab previews — deferred, not required for pipeline delivery
- Multi-timezone support — hardcoded Europe/London (Decision #8)
- Password auth advertised in UI — magic link is primary, password exists but hidden
- Third-party tracking on link-in-bio — server-side collection only

## Context

**Origin:** 8-agent parallel design review (2026-03-05) produced 12 specialist documents covering product workflow, architecture, backend/data, auth/security, platform integrations, UX/design system, performance/reliability, QA/testing, AI/content strategy, analytics/link-in-bio, and devops/schema.

**Existing codebase:** The current v1 is a working prototype with sound product vision but dangerous structural debt. No code is carried forward — the rebuild starts fresh. The v1 repo is reference and audit material only.

**Users:** Hospitality venue owners managing social media for their business. Single-user per account. Non-technical — UI must be self-explanatory.

**Current integrations:** Facebook Graph API, Instagram Graph API, Google Business Profile API, OpenAI GPT-4o, Resend email, Supabase (PostgreSQL + Auth + Storage).

**Key resolved decisions (from master delivery plan):**
1. Instagram stories: fully supported, first-class content type
2. Bulk approve: both "approve all" and "select individually" supported
3. Activity feed: live via Supabase Realtime, no polling
4. Publish failure fallback: no download ZIP — better retry UX instead
5. Weekly recurring: auto-publish once approved (permanent authorisation)
6. Analytics: included in v1 scope
7. Notifications: in-app for non-urgent, email for urgent
8. Timezone: Europe/London hardcoded, no UI

## Constraints

- **Tech stack**: Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, Supabase, deployed on Vercel
- **Replace in place**: v1 goes offline while v2 is built in the same repository
- **Ship complete**: entire redesign ships together, no partial releases
- **Security first**: all 6 critical issues (C-1 through C-6) must be resolved before any feature work
- **Europe/London timezone**: hardcoded, no multi-timezone support
- **Platform APIs**: Facebook, Instagram, GBP — each with different rate limits, token lifecycles, and content formats
- **Background jobs**: QStash (not Vercel Cron) for publish pipeline reliability
- **Observability**: Axiom for structured logging (new addition to stack)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Greenfield rebuild (not incremental fix) | 6 critical + 28 high issues make v1 unsafe to build on | — Pending |
| QStash over Vercel Cron | Built-in retry, signed delivery, message IDs as idempotency keys | — Pending |
| Magic link as primary auth | Simpler UX for non-technical owners; password as hidden fallback | — Pending |
| No download ZIP fallback | Better to invest in retry UX and plain-English error messages | — Pending |
| Europe/London only | Simplifies scheduling engine; all current users are UK-based | — Pending |
| Analytics in v1 | Drives content improvement decisions; minimum viable: per-post outcomes + weekly summary | — Pending |
| Supabase Realtime for activity feed | Eliminates polling; instant status updates in planner | — Pending |
| Provider abstraction layer | Registry pattern isolates platform-specific logic; easier to add future platforms | Phase 3 — PublishingAdapter + registry + 3 adapters |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-19 after Phase 04 completion — QStash publish pipeline with idempotent dispatch, 7-state machine, retry/backoff, preflight gating, plain-English errors, audit logging, failure email alerts, and MSW integration tests*
