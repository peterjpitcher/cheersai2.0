# CheersAI 2.0 — Complete Redesign

## Current State

**v1.0 shipped — 2026-05-19**

The ground-up rebuild is complete. All 6 phases delivered: security foundation, content engine, provider integrations, publishing pipeline, realtime UX, and analytics/link-in-bio. 107 requirements fulfilled across 32 plans. The platform is functionally complete for production use.

**What's live:**
- AES-256-GCM token vault, RLS on all 16 tables, security headers, structured logging
- 5 content types with AI generation (OpenAI structured outputs), media library, 6-week planner
- Facebook, Instagram, GBP publishing via QStash with idempotent retry/backoff
- Supabase Realtime activity feed, email alerts, notification badge
- Analytics dashboard with engagement rates, platform comparison, best-time heatmap
- Link-in-bio editor with 4 templates, drag-reorder tiles, ISR public pages
- Recurring auto-publish, Instagram carousel support

**Next milestone:** Not yet planned. Run `/gsd:new-milestone` to begin.

## What This Is

CheersAI is an AI-powered social media management platform for hospitality venues (pubs, restaurants, bars). Owners create content once — the AI adapts it per platform (Facebook, Instagram, Google Business Profile) — and the publishing pipeline handles scheduling, preflight checks, and delivery.

## Core Value

An owner can create a single piece of content, have AI generate platform-specific copy, and reliably publish it to Facebook, Instagram, and Google Business Profile — without manual intervention after approval.

## Requirements

### v1.0 — All Validated

All 107 requirements validated. See [v1.0-REQUIREMENTS.md](milestones/v1.0-REQUIREMENTS.md) for the full checklist.

### Deferred to Next Milestone

- WCAG 2.1 AA compliance: human Lighthouse audit needed
- Test coverage thresholds: human CI verification needed
- Public page LCP measurement: human WebPageTest run needed

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

**Origin:** 8-agent parallel design review (2026-03-05) produced 12 specialist documents. Ground-up rebuild completed 2026-05-19 across 6 phases and 32 plans.

**Users:** Hospitality venue owners managing social media for their business. Single-user per account. Non-technical — UI must be self-explanatory.

**Integrations:** Facebook Graph API, Instagram Graph API, Google Business Profile API, OpenAI GPT-4o, Resend email, QStash (publish pipeline), Supabase (PostgreSQL + Auth + Storage + Realtime).

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
| Greenfield rebuild (not incremental fix) | 6 critical + 28 high issues make v1 unsafe to build on | Shipped v1.0 — all critical issues resolved |
| QStash over Vercel Cron | Built-in retry, signed delivery, message IDs as idempotency keys | Phase 4 — two-layer idempotency, 5m/15m/45m backoff |
| Magic link as primary auth | Simpler UX for non-technical owners; password as hidden fallback | Phase 1 — proxy.ts guard + magic link + rate limiting |
| No download ZIP fallback | Better to invest in retry UX and plain-English error messages | Phase 4 — plain-English errors + retry button |
| Europe/London only | Simplifies scheduling engine; all current users are UK-based | Phase 2 — Luxon throughout, no timezone UI |
| Analytics in v1 | Drives content improvement decisions; minimum viable: per-post outcomes + weekly summary | Phase 6 — Recharts dashboard + GBP cron |
| Supabase Realtime for activity feed | Eliminates polling; instant status updates in planner | Phase 5 — dual-channel hooks + attention banner |
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
*Last updated: 2026-05-19 — v1.0 milestone complete. All 6 phases shipped.*
