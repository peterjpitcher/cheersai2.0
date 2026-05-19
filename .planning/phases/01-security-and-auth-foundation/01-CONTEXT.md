# Phase 1: Security and Auth Foundation - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Owner can securely sign in and the application has a hardened foundation — encrypted token storage, RLS-protected schema, structured logging, and security headers — so all subsequent feature work builds on safe ground. This phase resolves all 6 critical security issues (C-1 through C-6) from the v1 audit.

</domain>

<decisions>
## Implementation Decisions

### Token Vault Design
- **D-01:** App-level crypto module using Node.js `crypto` — AES-256-GCM with envelope encryption. Encryption key stored as env var (`TOKEN_VAULT_KEY`).
- **D-02:** Standalone module at `src/lib/token-vault/` with `encrypt()`, `decrypt()`, `rotate()` exports. Clean separation from Supabase client for testability and auditability.
- **D-03:** Encrypt both access and refresh tokens — no plain-text tokens stored anywhere.

### Auth Flow Behaviour
- **D-04:** Magic link is the only visible auth method on the login page. Small "Use password instead" link below the form for fallback. Password auth exists but is not advertised.
- **D-05:** After clicking magic link, user redirects straight to the dashboard (returning users) or dashboard (new users). No intermediate onboarding page in Phase 1.
- **D-06:** Session duration: 7 days. Supabase refresh token extends silently if active within window.
- **D-07:** Middleware auth guard on all `(app)/*` routes — unauthenticated requests get 302 to `/auth/login`.

### Schema Baseline
- **D-08:** Single baseline migration with core tables (accounts, profiles, social_connections, token_vault), then separate numbered domain migrations (content, publishing, notifications, analytics, link_in_bio). Clear ownership per domain.
- **D-09:** Deploy ALL domain tables in Phase 1 — content, publish_jobs, audit_log, notifications, analytics_snapshots, gbp_daily_metrics, link_in_bio_profiles, link_in_bio_tiles — even though features come later. Avoids schema churn in subsequent phases.
- **D-10:** Delete all 26 v1 migration files and start fresh. Clean break matching the "greenfield rebuild" decision. V1 schema preserved in git history.
- **D-11:** RLS policy pattern: account-scoped with service bypass. Every table has `account_id` column. Policies enforce `WHERE account_id = auth.uid()'s account`. Service-role client bypasses for system operations.

### Logging and CI
- **D-12:** Feature flags via env vars (e.g., `ENABLE_MEDIA_ATTACHMENTS_TABLE`) — toggled via Vercel dashboard. No external feature flag service.
- **D-13:** Full test coverage targets established from day one: scheduling >=90%, publishing >=85%, auth >=80%. Empty test suites created for future domains to enforce thresholds as code arrives.

### Claude's Discretion
- Token vault key rotation strategy (versioned keys with lazy re-encrypt vs batch script)
- Axiom integration approach (SDK vs custom wrapper)
- CI pipeline runner (GitHub Actions vs Vercel-native)
- Rate limiting implementation (Upstash Redis vs in-memory)
- Correlation ID propagation strategy

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Security & Auth Requirements
- `.planning/REQUIREMENTS.md` §Security & Auth — AUTH-01 through AUTH-08 define all auth requirements
- `.planning/REQUIREMENTS.md` §Database & Schema — DATA-01 through DATA-11 define schema requirements
- `.planning/REQUIREMENTS.md` §Infrastructure — INFRA-01 through INFRA-04 define logging, CI, feature flags
- `.planning/REQUIREMENTS.md` §Testing & CI — TEST-04 through TEST-06 define CI pipeline requirements

### Project Context
- `.planning/PROJECT.md` §Constraints — Tech stack, security-first mandate, Europe/London timezone
- `.planning/PROJECT.md` §Key Decisions — Greenfield rebuild rationale, QStash choice, magic link primary auth

### Codebase Patterns
- `.planning/codebase/ARCHITECTURE.md` — Layered server-client architecture, server actions pattern
- `.planning/codebase/CONVENTIONS.md` — Naming patterns, error handling, type conversion (fromDb)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/auth/` — v1 auth helpers exist; patterns can inform v2 but code is replaced
- `src/lib/supabase/` — Client factory patterns (server, service-role, browser) carry forward
- `src/env.ts` — Zod-validated environment variables; extend for new vault/Axiom vars
- `src/components/ui/` — Radix-based UI primitives (button, card, dialog, input) available for login page

### Established Patterns
- Server actions return `Promise<{ success?: boolean; error?: string }>`
- `fromDb<T>()` converts snake_case DB columns to camelCase TypeScript
- `requireAuthContext()` for server-side auth verification in actions
- Feature-first directory structure: `src/features/`, shared utilities in `src/lib/`

### Integration Points
- `src/app/(app)/layout.tsx` — App layout where auth guard lives
- `src/app/api/oauth/` — OAuth callback routes (Facebook, Instagram) to be rebuilt
- `src/app/api/cron/` — Cron endpoints that need signed secret validation
- `supabase/migrations/` — Migration directory (v1 files to be replaced)

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. The security requirements are well-defined in REQUIREMENTS.md; implementation follows industry best practices for Next.js + Supabase.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-security-and-auth-foundation*
*Context gathered: 2026-05-19*
