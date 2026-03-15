---
title: Tech Debt
created: 2026-03-14
last_updated: 2026-03-14
status: current
tags:
  - type/reference
  - section/health
related:
  - "[[Optimization Opportunities]]"
---

← [[_Index]] / [[_Health MOC]]

# Tech Debt

Tracked technical debt items from the initial codebase audit.

---

## TD-001 — `brand_profile` Missing `banned_phrases` Column in Initial Migration

**Severity**: MEDIUM
**Location**: `supabase/migrations/20250203120000_initial.sql`

✅ RESOLVED — migration 20260228120000_add_banned_phrases.sql adds the column. Initial audit missed this migration.

The initial schema does not include `banned_phrases text[]` on `brand_profile`, but `src/lib/settings/data.ts` reads and writes it (`banned_phrases: brandRow?.banned_phrases ?? []`). This column must have been added in a subsequent migration (not visible in migration file list — may be in the content of an existing migration or added manually).

**Risk**: Fresh database installs from the initial migration alone will not have this column, causing silent data loss on save.

**Fix**: Verify a migration adds `banned_phrases` and add it explicitly if missing. Document in `Migrations.md`.

---

## TD-002 — No CSRF Protection on Server Actions

**Severity**: HIGH
**Location**: All `'use server'` actions

The workspace auth standard requires CSRF protection on all mutations. CheersAI uses Next.js Server Actions which have built-in same-origin enforcement, but there is no explicit CSRF token implementation. This may be acceptable given Next.js's SameSite cookie handling, but deviates from the stated standard.

**Risk**: Low in practice (Next.js Server Actions require same-origin fetch), but non-compliant with the workspace auth standard.

**Fix**: Document the rationale for relying on Next.js's built-in protection, or implement the double-submit cookie pattern for full compliance.

---

## TD-003 — No Custom App Session Layer

**Severity**: MEDIUM
**Location**: `src/lib/auth/server.ts`

The workspace auth standard (`auth-standard.md`) requires a dual-layer session system with a custom `app_sessions` table for idle timeout and server-side revocation. CheersAI relies solely on the Supabase JWT with no app-level session management.

**Impact**: No idle timeout enforcement (users stay logged in indefinitely), no server-side session revocation on password change.

**Fix**: Implement app session layer per the auth standard, or document an approved deviation if the target user base (single-venue pub staff) makes this acceptable.

---

## TD-004 — Missing Test Coverage

**Severity**: MEDIUM
**Location**: `tests/` directory

Only a small number of tests exist (`tests/tokenExchange.test.ts`, `tests/lib/gbp/`, `tests/updateConnectionMetadata.test.ts`). Core business logic in `src/lib/create/service.ts`, `src/lib/ai/prompts.ts`, `src/lib/planner/data.ts`, and `src/lib/publishing/queue.ts` has no test coverage.

**Fix**: Add test coverage for at minimum:
- Content generation service (mock OpenAI)
- Prompt construction (unit tests for `buildInstantPostPrompt`)
- Publish job creation and status transitions
- Planner data loading with mock Supabase

---

## TD-005 — `resolveAccountId` Dual Metadata Key Support

**Location**: `src/lib/auth/server.ts:64`

✅ DOCUMENTED — backward-compat comment added to readAccountId() in auth/server.ts. Migration of existing accounts deferred indefinitely; dual-key lookup has zero runtime cost.

`readAccountId()` checks both `account_id` and `accountId` in metadata (camelCase and snake_case). This dual-key lookup indicates a historical inconsistency in how account IDs were stored in Supabase Auth metadata.

**Fix**: Standardise on one key (preferably `account_id` for snake_case consistency with DB conventions) and migrate any existing accounts that use `accountId`.

---

## TD-006 — Email Notifications Partially Implemented ⚠️ UPDATED 2026-03-14

**Severity**: LOW
**Location**: `src/lib/email/resend.ts`, `src/app/api/cron/notify-failures/route.ts`

`emailFailures` notifications are now implemented end-to-end via a new cron endpoint. `emailTokenExpiring` notifications remain unimplemented.

**What was done (2026-03-14)**:
- Created `src/lib/email/resend.ts` — a shared `sendEmail()` utility backed by the Resend SDK
- Created `src/app/api/cron/notify-failures/route.ts` — polls `publish_jobs` for failures in the last 2 hours, checks `posting_defaults.notifications.emailFailures` per account, uses the `notifications` table for idempotency (prevents duplicate emails per job), sends via Resend

**Remaining**:
- `emailTokenExpiring` — no email is sent when a social connection token is expiring. Users see an in-app warning but receive no proactive email. Implement a similar cron that checks connection expiry dates.

---

## TD-007 — `isSchemaMissingError` Silent Fallbacks Mask Migrations Issues

**Severity**: LOW
**Location**: All data functions

✅ PARTIALLY ADDRESSED — isSchemaMissingErrorWithWarning() added to errors.ts; logs a critical error in production when a schema gap is silently swallowed. Callers can opt in over time.

Every data function catches `isSchemaMissingError` and returns empty data. While this is useful in development, it means a missing column or table in production will silently return empty data instead of surfacing as an error.

**Fix**: Consider disabling the schema-missing fallback in production environments (via `NODE_ENV` check) so real migration gaps are caught before they affect users.
