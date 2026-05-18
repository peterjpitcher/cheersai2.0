# Project Research Summary

**Project:** CheersAI 2.0
**Domain:** AI-powered social media management platform for hospitality venues
**Researched:** 2026-05-18
**Confidence:** HIGH

## Executive Summary

CheersAI 2.0 is a hospitality-specific social media management platform combining AI content generation with multi-platform publishing (Facebook, Instagram, Google Business Profile). The existing v1 stack is sound — Next.js 16, React 19, TypeScript, Tailwind v4, Supabase, Vercel, OpenAI — with three additive gaps to fill: shadcn/ui for the component system, react-email for transactional templates, and migration from `framer-motion` to the `motion` package. The architecture must evolve from v1's loosely coupled modules into six discrete components: Presentation, Auth & Identity, Content Engine, Provider Registry, Publishing Pipeline, and Token Vault, each with strict boundary rules.

The recommended approach is a six-phase build ordered by hard architectural dependencies. Foundation first (auth + schema + token vault), then content engine (AI + scheduling), then provider integrations (platform adapters), then publishing pipeline (preflight + QStash + retry), then realtime and notifications, and finally analytics and advanced features. This order is non-negotiable: the token vault must exist before provider adapters can store credentials, and the publishing pipeline is the highest-risk component that benefits from all dependencies being stable before it is built. The five hospitality-specific differentiators (content types, GBP Event/Offer post types, conflict detection, weekly recurring, link-in-bio) all layer on top of this foundation.

The single greatest risk is silent token death — OAuth tokens expire or get revoked without detection, posts fail silently for days, and venue owners discover the problem too late. This was confirmed as a v1 gap and must be solved in Phase 1 before any publishing work begins. Three other risks require design-time decisions: publish idempotency to prevent duplicate posts from QStash retries, AES-256-GCM token encryption at rest (v1 stores tokens in plaintext — confirmed critical issue C-3), and Instagram's 200-call/hour rate limit which can be exhausted by carousel publishing alone. The Provider Registry pattern (strategy + registry) is the primary architectural mitigation, isolating all platform-specific complexity behind a uniform interface.

---

## Key Findings

### Recommended Stack

The v1 stack is production-ready. Three gaps need filling before v2 work begins: `npx shadcn@latest init` for a component system that owns source code with no runtime dependency, `npm install react-email @react-email/components` for typed transactional email templates paired with Resend, and `npm install motion && npm uninstall framer-motion` for the renamed package. Key constraints: React Hook Form stays on v7 (v8 is beta as of May 2026), Tailwind v4 is CSS-first with no `tailwind.config.ts`, and Supabase Realtime should use `worker: true` for the activity feed to prevent browser tab throttling from dropping the WebSocket connection.

**Core technologies:**
- Next.js 16.1 + React 19.2: full-stack framework, Turbopack stable, React Compiler auto-memoization
- Supabase (PostgreSQL + RLS + Auth + Realtime + Storage): single platform for database, auth, realtime
- OpenAI SDK 6.15+ with Structured Outputs: Zod schemas with `response_format` for 100% schema-compliant AI responses
- QStash (Upstash): HTTP message queue with retry, signed delivery, idempotency — replaces unreliable Vercel Cron
- Node.js built-in `crypto`: AES-256-GCM for OAuth token encryption — no external library needed
- Axiom + next-axiom: structured logging, Vercel-native, zero-config via `withAxiom` wrapper

### Expected Features

**Must have (table stakes for launch — P1):**
- Auth (magic link + password) and social OAuth (FB, IG, GBP) with token health monitoring
- AI content generation from brief with platform-specific copy per variant
- Five hospitality content types: Instant Post, Story, Event, Promotion, Weekly Recurring
- Content calendar (week + month view) with post status tracking
- Scheduling + publish pipeline with composed preflight checks
- Platform-specific previews enforcing aspect ratios and character limits
- Media upload and Supabase Storage
- Mobile-responsive design (bottom nav, 44px touch targets, 320px minimum)
- Publish failure handling with plain-English errors and one-tap retry
- Basic per-post analytics (engagement rate, reach, impressions)
- GBP Event and Offer post types (genuine differentiator — no competitor supports this)

**Should have (add once core publish loop is validated — P2):**
- Conflict detection in scheduling UI
- Weekly recurring auto-publish (after pipeline is proven reliable)
- Bulk approve workflow
- AI fine-tune controls (tone, length, CTA, proof-points)
- Activity feed via Supabase Realtime
- Media library with search and campaign filters
- Email alerts for failures and token expiry (react-email + Resend)
- Instagram carousel support

**Defer (v2+):**
- Link-in-bio page (independent of publish loop — build when core is stable)
- Advanced analytics (needs weeks of published content to be meaningful)
- Video post support (explicitly deferred — storage, transcoding, API complexity)
- Additional platforms — TikTok, X (only if user demand data justifies)
- Drag-and-drop calendar reschedule (owners can delete and re-create initially)

### Architecture Approach

Six components with strict boundary rules formalise what v1 has as loosely coupled modules. The Provider Registry (strategy pattern) consolidates Facebook, Instagram, and GBP logic currently scattered across `src/lib/meta/`, `src/lib/gbp/`, and `src/lib/connections/` behind a common `ProviderAdapter` interface. The Content Engine implements an explicit state machine (draft → review → approved → scheduled → queued → publishing → published/failed) enforced at the database level, preventing invalid transitions. The Publishing Pipeline is stateless — all state lives in the `publish_jobs` table — with idempotency via QStash message IDs stored in a `publish_attempts` table.

**Major components:**
1. **Token Vault** — AES-256-GCM encryption/decryption, proactive refresh cron, health monitoring, expiry alerts. Only module that holds encryption keys.
2. **Provider Registry** — Facebook, Instagram, GBP adapters implementing `ProviderAdapter` interface. Each adapter owns token refresh, rate limiting, content formatting, error mapping. No cross-provider imports.
3. **Content Engine** — AI generation with Zod Structured Outputs, five content types, state machine, conflict detection, media library, content versioning.
4. **Publishing Pipeline** — composed preflight checkers (connection, media, content lint, token health), QStash enqueue, idempotency, 5m/15m/45m retry backoff, status tracking, failure alerts.
5. **Presentation** — React Query client fetching, server actions for mutations, Supabase Realtime subscriptions with `worker: true` for activity feed.
6. **Data Layer** — Supabase PostgreSQL with RLS, audit log, typed query helpers with `fromDb<T>()` conversion.

### Critical Pitfalls

1. **Silent Token Death** — tokens expire/revoke without detection; posts silently fail for days. Prevent with: pre-publish health check (lightweight Graph API call), daily proactive refresh cron for tokens expiring within 7 days, in-app connection health dashboard (amber at 7 days, red at 3 days), deauthorization webhook registration for Facebook and GBP.

2. **Duplicate Publishes from QStash Retries** — serverless timeout causes QStash to retry a publish that already succeeded. Prevent with: handler-side idempotency using QStash message ID as key in `publish_attempts` table; record platform post ID immediately after successful API call; check for existing post ID on retry before re-publishing. QStash deduplication header is a first line, not sufficient alone.

3. **Unencrypted OAuth Tokens at Rest** — v1 confirmed to store tokens in plaintext (critical issue C-3). Must be Phase 1. AES-256-GCM with key in Vercel env, key ID stored alongside ciphertext to enable zero-downtime key rotation.

4. **Instagram 200-Call/Hour Rate Limit Exhaustion** — reduced 96% in 2025; a carousel publish alone consumes 15-20 calls. Prevent with: per-account call budget tracker from `X-App-Usage` response headers, max 3-4 publishes/hour per account, exponential backoff on container status polling (start at 30s), circuit breaker on 429.

5. **Meta Policy Violations Leading to App Suspension** — automated enforcement affects all app users, not just the offending account. Prevent with: max 3-5 posts/day per account, 30-minute minimum gaps, genuinely different copy per platform (not reformatted), scope minimisation (`pages_manage_posts`, `instagram_content_publish`, `instagram_basic` only), 2-4 week app review preparation budget starting during Phase 3.

6. **AI Content Hallucinations** — GPT-4o hallucinates at ~1.5%; for hospitality this means wrong hours, prices, or allergen claims with legal consequences. Prevent with: mandatory human approval gate before every publish, structured venue data grounded in every prompt, post-generation validation against confirmed venue facts.

---

## Implications for Roadmap

### Phase 1: Security and Auth Foundation
**Rationale:** Token vault is a hard prerequisite for provider adapters. The v1's plaintext token storage is a critical security gap that cannot coexist with any new social connection work. Everything else depends on auth and schema existing.
**Delivers:** Supabase auth (magic link + password), middleware guards, AES-256-GCM Token Vault, encrypted `social_connections` schema, OAuth flows (FB, IG, GBP) with HMAC state validation, deauthorization webhooks, connection health dashboard with traffic-light indicators.
**Addresses:** Auth, social OAuth, token health monitoring (P1 features).
**Avoids:** Unencrypted tokens pitfall, CSRF OAuth attack, silent token death — all must be solved here.

### Phase 2: Content Engine and AI Generation
**Rationale:** Content Engine is independent of the publishing pipeline. AI generation, content types, and scheduling can be built and tested without live social connections. Building the content model before providers ensures it is stable when the pipeline is built against it.
**Delivers:** Content state machine enforced at DB level, AI generation with Zod Structured Outputs, five hospitality content types, content versioning, media upload and Supabase Storage, scheduling engine with conflict detection.
**Addresses:** AI content generation, five content types, media upload, scheduling, conflict detection (P1 + P2 features).
**Avoids:** AI hallucination pitfall — approval gate and prompt grounding established here, not retrofitted later.

### Phase 3: Provider Integration
**Rationale:** Provider Registry depends on Token Vault (Phase 1) and content types (Phase 2). Isolating platform adapters now makes the pipeline (Phase 4) platform-agnostic. Meta app review must start during this phase — a rejection delays Phase 4 by 2-4 weeks.
**Delivers:** Facebook, Instagram, GBP adapters behind `ProviderAdapter` interface; platform-specific content validation; GBP Event and Offer post type support; per-account rate limit budget tracking; platform-specific token refresh logic.
**Addresses:** Multi-platform publishing foundation, GBP Event/Offer types, rate limit compliance (P1 features).
**Avoids:** Instagram rate limit exhaustion, Meta policy violations, GBP API fragmentation — all isolated to adapter layer.

### Phase 4: Publishing Pipeline
**Rationale:** Highest-risk component, built when all dependencies are stable. Idempotency and retry logic must be designed in from day one. This is the most common failure point across social media tools.
**Delivers:** Composed preflight checkers (connection, media, content lint, token health), QStash job enqueue, idempotency via message ID in `publish_attempts` table, 5m/15m/45m retry backoff, post status tracking, plain-English failure messages with fix-it CTAs, retry UX.
**Addresses:** Scheduling + publish pipeline, preflight checks, failure handling, post status tracking (all P1 features).
**Avoids:** Duplicate publishes pitfall (idempotency designed in), opaque error UX pitfall.

### Phase 5: Realtime, Notifications, and UX Polish
**Rationale:** Activity feed and email alerts require a working publish pipeline. Post previews and the calendar are learnable from a working content + scheduling engine. This is the polish phase that makes the product feel complete.
**Delivers:** Activity feed via Supabase Realtime with `worker: true`, email alerts (token expiry + publish failures) via react-email + Resend, platform-specific post previews, content calendar (week + month view), mobile-responsive design, bulk approve workflow.
**Addresses:** Activity feed, email alerts, platform previews, content calendar, mobile design, bulk approve (P1 + P2 features).

### Phase 6: Analytics, Advanced Features, and Scale
**Rationale:** Analytics requires published content data. Weekly recurring auto-publish is deferred until the pipeline is proven reliable — auto-publishing without approval is risky if retry edge cases remain. This phase adds retention features.
**Delivers:** Per-post analytics (engagement rate, reach, impressions), weekly recurring auto-publish, media library with search/tags/campaign filters, AI fine-tune controls (tone, length, CTA, proof-points), Instagram carousel support.
**Addresses:** Basic analytics, weekly recurring, media library, fine-tune controls, carousels (P2 features).

### Phase Ordering Rationale

- Token Vault before Provider Registry is a hard architectural dependency — providers need encrypted credential storage to function.
- Content Engine before Publishing Pipeline ensures the content model (state machine, variants, types) is stable before the pipeline is built against it.
- Publishing Pipeline is intentionally last among core phases — it is the most complex and benefits from all prior dependencies being stable.
- Phases 5 and 6 are data consumers. They are meaningless before the pipeline that generates their data exists.
- The six-phase structure mirrors ARCHITECTURE.md's suggested build order exactly, which was derived from component dependency analysis.

### Research Flags

Phases likely needing `/gsd:research-phase` during planning:
- **Phase 3 (Provider Integration):** Instagram Stories API support is conflicted across sources (Meta docs say supported; developer community reports unreliability). GBP federated API endpoint mapping needs current verification. Meta app review scope requirements need confirmation against `instagram_content_publish` specifically.
- **Phase 4 (Publishing Pipeline):** QStash idempotency edge cases (exactly what the 10-minute dedup window covers vs. what requires handler-side checks) should be confirmed with a spike before full implementation.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Auth Foundation):** Supabase Auth + AES-256-GCM are well-documented with official patterns. Node.js `crypto` module is stable.
- **Phase 2 (Content Engine):** OpenAI Structured Outputs with Zod is fully documented. Content state machines are standard patterns.
- **Phase 5 (Realtime + Notifications):** Supabase Realtime + react-email + Resend all have official Next.js integration docs.
- **Phase 6 (Analytics):** Standard Supabase query patterns. No novel dependencies.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Cross-referenced official docs for all major packages. Version compatibility matrix validated. Three gaps are additive, not breaking. |
| Features | HIGH | Cross-referenced 8+ competitor platforms and official API docs. Instagram Stories is the one medium-confidence item. |
| Architecture | HIGH | Provider registry and token vault patterns are standard and well-proven. Build order derived from hard dependency graph in ARCHITECTURE.md. |
| Pitfalls | HIGH | Verified against v1 CONCERNS.md (direct evidence), OWASP guidance, official Meta/Google docs, and confirmed 2025 Instagram rate limit change. |

**Overall confidence:** HIGH

### Gaps to Address

- **Instagram Stories API reliability:** Default to notification-based fallback (send content to owner's phone for manual posting) during Phase 3. Test actual API behaviour before committing to auto-publish for Stories.
- **Meta app review timeline:** Begin `instagram_content_publish` scope submission during Phase 3 development, not after. A first-submission rejection is common and delays Phase 4 by 2-4 weeks.
- **GBP Q&A API removed November 2025:** Confirm no v1 code references this endpoint before Phase 3 migration begins. Check with `grep -r "questions" src/lib/gbp/`.
- **shadcn/ui + Tailwind v4 config compatibility:** Run `npx shadcn@latest init` on a branch first to verify it does not conflict with the existing `globals.css` `@theme` configuration before merging to main.

---

## Sources

### Primary (HIGH confidence)
- Next.js 16 Blog + Upgrade Guide — framework features, Turbopack, React Compiler
- Tailwind CSS v4 Release — CSS-first config, v4.2 webpack plugin for Next.js
- Zod v4 Changelog — breaking changes, top-level format validators, 14x parse speed
- OpenAI Structured Outputs docs — JSON schema strict mode, response_format API
- Meta Graph API Rate Limiting docs — per-app and per-page limits, X-App-Usage headers
- Instagram Content Publishing API docs — carousel flow, container status polling, rate limits
- Google OAuth2 + Business Profile API docs — token lifecycle, federated API suite endpoints
- QStash Upstash docs — deduplication, retry config, Next.js quickstart
- Supabase Realtime + Security docs — worker mode, RLS, encryption patterns
- v1 CONCERNS.md — direct evidence of token refresh gaps, connection pool exhaustion, generation latency
- OWASP OAuth2 Cheat Sheet — token storage, scope management, state parameter HMAC

### Secondary (MEDIUM confidence)
- Supabase Realtime in Practice 2026 (eastondev.com) — worker mode, reconnection patterns
- QStash at Scale case study (Upstash blog) — cost comparison ($40/mo vs $1,500/mo alternatives)
- shadcn/ui vs Radix vs Base UI 2026 (pkgpulse.com) — component ecosystem landscape
- Instagram Graph API Guide 2026 (elfsight.com) — API versioning, token flows
- Meta Automated Enforcement 2026 (thetinyfeed.com) — behavioral detection triggers, app-level restrictions
- Competitor feature analysis — Buffer, Later, Hootsuite, Sprout Social (8+ sources)
- GBP API Status 2026 (slashpost.ai) — federated suite, Q&A API removal November 2025

### Tertiary (LOW confidence — needs validation)
- Instagram Stories API support via Content Publishing API — Meta docs say supported; developer reports conflict
- Temporal API Node.js readiness — Stage 4 confirmed but no server-side Node.js support yet; Luxon remains correct

---
*Research completed: 2026-05-18*
*Ready for roadmap: yes*
