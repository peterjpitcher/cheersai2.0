# Phase 1: Security and Auth Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-19
**Phase:** 01-security-and-auth-foundation
**Areas discussed:** Token vault design, Auth flow behaviour, Schema baseline, Logging and CI

---

## Token Vault Design

| Option | Description | Selected |
|--------|-------------|----------|
| App-level crypto module | Custom TypeScript module using Node.js crypto. AES-256-GCM with envelope encryption. Key in env var, rotate via re-encrypt script. Full control, no vendor lock-in. | ✓ |
| Supabase Vault extension | Use Supabase's built-in pgsodium Vault. Encryption at DB level, transparent to app code. Less control over rotation, tied to Supabase platform. | |
| You decide | Claude picks the best approach. | |

**User's choice:** App-level crypto module
**Notes:** User chose recommended option for full control and vendor independence.

### Key Rotation

| Option | Description | Selected |
|--------|-------------|----------|
| Versioned keys with lazy re-encrypt | Store key version alongside ciphertext. New tokens use latest key. Old tokens re-encrypted on next read. No downtime needed. | |
| Batch re-encrypt script | Ops script re-encrypts all tokens in one go when key rotates. Simpler code, but requires maintenance window. | |
| You decide | Claude picks based on operational simplicity. | ✓ |

**User's choice:** You decide (Claude's discretion)

### Token Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Both access + refresh | Encrypt everything. Consistent security posture — no plain-text tokens anywhere. | |
| Refresh tokens only | Only encrypt long-lived refresh tokens. Access tokens kept plain since they expire quickly. | |

**User's choice:** You decide (Claude's discretion)

### Module Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Standalone src/lib/token-vault/ | Dedicated module with encrypt/decrypt/rotate exports. Clean separation — easy to test, audit, and swap. | |
| Integrated into supabase service | Encryption woven into the existing service-role client wrapper. Fewer files but harder to test in isolation. | |

**User's choice:** You decide (Claude's discretion)

---

## Auth Flow Behaviour

### Post-Login Redirect

| Option | Description | Selected |
|--------|-------------|----------|
| Straight to dashboard | Magic link confirms + redirects directly to main dashboard. Fastest path. | |
| Welcome/onboarding page first | First-time users see brief onboarding. Returning users go straight to dashboard. | |
| You decide | Claude picks simplest approach for Phase 1. | ✓ |

**User's choice:** You decide (Claude's discretion)

### Login Page Layout

| Option | Description | Selected |
|--------|-------------|----------|
| Magic link only, password hidden | Email field + 'Send magic link' button. Small 'Use password instead' link below. | |
| Tabbed: Magic link / Password | Two tabs on login form. Both visible, magic link tab selected by default. | |
| You decide | Claude picks based on 'non-technical owner' user profile. | ✓ |

**User's choice:** You decide (Claude's discretion)

### Session Duration

| Option | Description | Selected |
|--------|-------------|----------|
| 7 days | Balance of security and convenience. Refresh token extends silently if active. | ✓ |
| 30 days | Long-lived session. More convenient but weaker security. | |
| 24 hours | Short session. More secure but frequent re-auth needed. | |

**User's choice:** 7 days
**Notes:** User chose recommended option balancing security and convenience for busy venue owners.

### Rate Limiting

| Option | Description | Selected |
|--------|-------------|----------|
| Upstash Redis rate limiter | 5 attempts per 15 minutes per email. Distributed, works on Vercel serverless. | |
| In-memory with sliding window | Simple Map-based. No external dependency but resets on cold start. | |
| You decide | Claude picks based on deployment target (Vercel serverless). | ✓ |

**User's choice:** You decide (Claude's discretion)

---

## Schema Baseline

### Migration Structure

| Option | Description | Selected |
|--------|-------------|----------|
| Single baseline + domain files | Core tables in 001_baseline, then separate numbered files per domain. Clear ownership. | ✓ |
| Single monolithic migration | Everything in one big file. Simpler ordering, harder to review. | |
| You decide | Claude structures based on domain dependencies. | |

**User's choice:** Single baseline + domain files
**Notes:** User chose recommended option for clear domain ownership and reviewability.

### Schema Scope

| Option | Description | Selected |
|--------|-------------|----------|
| All domain tables now | Deploy all tables from REQUIREMENTS even though features come later. Avoids schema churn. | ✓ |
| Only Phase 1 tables | Only auth/security tables. Add domain tables when their phase starts. | |
| You decide | Claude decides based on roadmap dependency graph. | |

**User's choice:** All domain tables now
**Notes:** User chose recommended option to front-load schema and avoid churn in later phases.

### V1 Migration Cleanup

| Option | Description | Selected |
|--------|-------------|----------|
| Delete and replace | Remove all v1 migration files. Start fresh. Clean break. V1 preserved in git. | ✓ |
| Archive in subfolder | Move to _v1_archive/. Keep for reference. | |
| You decide | Claude handles cleanup. | |

**User's choice:** Delete and replace
**Notes:** Clean break aligning with greenfield rebuild decision.

### RLS Policy Approach

| Option | Description | Selected |
|--------|-------------|----------|
| Account-scoped with service bypass | Every table has account_id. Policies enforce WHERE account_id matches auth user's account. Service-role bypasses. | ✓ |
| Role-based with granular policies | Different policies per role. More flexible but complex for single-user-per-account. | |
| You decide | Claude picks based on single-user constraint. | |

**User's choice:** Account-scoped with service bypass
**Notes:** Simple, consistent pattern matching the single-user-per-account constraint.

---

## Logging and CI

### Axiom Integration

| Option | Description | Selected |
|--------|-------------|----------|
| Axiom Next.js SDK | @axiomhq/nextjs package. Auto-instruments requests, adds correlation IDs. Vercel-native. | |
| Custom logger wrapping Axiom API | Thin logger module sending JSON to Axiom ingest API. More control, more code. | |
| You decide | Claude picks based on Vercel deployment target. | ✓ |

**User's choice:** You decide (Claude's discretion)

### CI Runner

| Option | Description | Selected |
|--------|-------------|----------|
| GitHub Actions | 6-job pipeline per INFRA-04. Industry standard, matches requirements. | |
| Vercel CI only | Built-in checks. Simpler but less granular. | |
| You decide | Claude picks based on INFRA-04 requirement. | ✓ |

**User's choice:** You decide (Claude's discretion)

### Feature Flags

| Option | Description | Selected |
|--------|-------------|----------|
| Env vars | Simple boolean env vars. Toggled via Vercel dashboard. No external dependency. | ✓ |
| LaunchDarkly or similar | Feature flag service with targeting. Overkill for this scale. | |
| You decide | Claude picks based on project scale. | |

**User's choice:** Env vars
**Notes:** Matches INFRA-03 requirement and project scale.

### Test Coverage

| Option | Description | Selected |
|--------|-------------|----------|
| Auth >=80% + token vault >=90% | Match requirements for Phase 1 scope only. Other domains have no logic yet. | |
| Full coverage targets from day one | Set all thresholds now. Empty test suites for future domains. | ✓ |
| You decide | Claude sets targets for Phase 1 scope. | |

**User's choice:** Full coverage targets from day one
**Notes:** User wants all thresholds established upfront even though some domains have no logic yet.

---

## Claude's Discretion

- Token vault key rotation strategy
- Token scope (access + refresh)
- Module shape (standalone vs integrated)
- Post-login redirect behaviour
- Login page layout
- Rate limiting implementation
- Axiom integration approach
- CI pipeline runner

## Deferred Ideas

None — discussion stayed within phase scope.
