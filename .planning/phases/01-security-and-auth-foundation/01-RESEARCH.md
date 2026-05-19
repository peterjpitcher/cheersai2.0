# Phase 1: Security and Auth Foundation - Research

**Researched:** 2026-05-19
**Domain:** Security, Authentication, Database Schema, CI/CD, Structured Logging
**Confidence:** HIGH

## Summary

Phase 1 establishes the security and infrastructure foundation for CheersAI 2.0. This is a greenfield rebuild -- all 58 v1 migration files are deleted and replaced with a clean schema baseline. The phase covers five domains: (1) Supabase magic link authentication with proxy.ts auth guard, (2) AES-256-GCM token vault for encrypting social OAuth tokens at rest, (3) security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy) and endpoint signing, (4) greenfield PostgreSQL schema with RLS on all tables, and (5) GitHub Actions CI pipeline with Axiom structured logging.

The existing codebase has reusable patterns: `requireAuthContext()`, Supabase client factories (`server.ts`, `service.ts`), `env.ts` for validated environment variables, and a basic CI workflow. These patterns carry forward but are rebuilt to v2 standards. Next.js 16 renames `middleware.ts` to `proxy.ts` -- this is a key migration the planner must account for.

**Primary recommendation:** Build the token vault module (`src/lib/token-vault/`) first as it blocks nothing but is blocked by nothing. Then schema migrations, then auth flow, then security headers and CI -- this order minimises rework.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** App-level crypto module using Node.js `crypto` -- AES-256-GCM with envelope encryption. Encryption key stored as env var (`TOKEN_VAULT_KEY`).
- **D-02:** Standalone module at `src/lib/token-vault/` with `encrypt()`, `decrypt()`, `rotate()` exports. Clean separation from Supabase client for testability and auditability.
- **D-03:** Encrypt both access and refresh tokens -- no plain-text tokens stored anywhere.
- **D-04:** Magic link is the only visible auth method on the login page. Small "Use password instead" link below the form for fallback. Password auth exists but is not advertised.
- **D-05:** After clicking magic link, user redirects straight to the dashboard (returning users) or dashboard (new users). No intermediate onboarding page in Phase 1.
- **D-06:** Session duration: 7 days. Supabase refresh token extends silently if active within window.
- **D-07:** Middleware auth guard on all `(app)/*` routes -- unauthenticated requests get 302 to `/auth/login`.
- **D-08:** Single baseline migration with core tables (accounts, profiles, social_connections, token_vault), then separate numbered domain migrations (content, publishing, notifications, analytics, link_in_bio). Clear ownership per domain.
- **D-09:** Deploy ALL domain tables in Phase 1 -- content, publish_jobs, audit_log, notifications, analytics_snapshots, gbp_daily_metrics, link_in_bio_profiles, link_in_bio_tiles -- even though features come later. Avoids schema churn in subsequent phases.
- **D-10:** Delete all v1 migration files (58 files) and start fresh. Clean break matching the "greenfield rebuild" decision. V1 schema preserved in git history.
- **D-11:** RLS policy pattern: account-scoped with service bypass. Every table has `account_id` column. Policies enforce `WHERE account_id = auth.uid()'s account`. Service-role client bypasses for system operations.
- **D-12:** Feature flags via env vars (e.g., `ENABLE_MEDIA_ATTACHMENTS_TABLE`) -- toggled via Vercel dashboard. No external feature flag service.
- **D-13:** Full test coverage targets established from day one: scheduling >=90%, publishing >=85%, auth >=80%. Empty test suites created for future domains to enforce thresholds as code arrives.

### Claude's Discretion
- Token vault key rotation strategy (versioned keys with lazy re-encrypt vs batch script)
- Axiom integration approach (SDK vs custom wrapper)
- CI pipeline runner (GitHub Actions vs Vercel-native)
- Rate limiting implementation (Upstash Redis vs in-memory)
- Correlation ID propagation strategy

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | Owner can sign in via magic link (primary) or password (hidden fallback) | Supabase `signInWithOtp()` via existing API route; v1 has working pattern at `src/app/api/auth/magic-link/route.ts` |
| AUTH-02 | Middleware auth guard on all `(app)/*` routes | Next.js 16 `proxy.ts` replaces `middleware.ts`; Supabase SSR cookie-based session check |
| AUTH-03 | OAuth callback validates session via cookie-bound HMAC state | Supabase SSR handles state binding; existing OAuth callback routes at `src/app/api/oauth/` |
| AUTH-04 | Social OAuth tokens encrypted at rest with AES-256-GCM | Node.js `crypto` module with `createCipheriv`/`createDecipheriv`; standalone module at `src/lib/token-vault/` |
| AUTH-05 | Security headers on all responses (CSP, HSTS, X-Frame-Options, Referrer-Policy) | `next.config.ts` `headers()` for static headers; `proxy.ts` for nonce-based CSP if needed |
| AUTH-06 | Cron/webhook endpoints validate signed secrets (timing-safe comparison) | `crypto.timingSafeEqual()` for CRON_SECRET / ALERTS_SECRET validation |
| AUTH-07 | Server actions re-verify auth server-side | Existing `requireAuthContext()` pattern carries forward; rebuild to v2 standards |
| AUTH-08 | Rate limiting on auth endpoints | Upstash Redis recommended (see Discretion section); v1 has in-memory fallback pattern |
| DATA-01 | Consolidated greenfield schema baseline migration | Delete 58 v1 files; single baseline + domain migrations |
| DATA-02 | RLS enabled on all tables with correct policies | Account-scoped policies with service bypass (D-11) |
| DATA-03 | `content_media_attachments` junction table | Replace `media_ids uuid[]` with proper join table |
| DATA-04 | `publish_jobs` with UNIQUE idempotency_key and EXCLUDE constraint | PostgreSQL EXCLUDE constraint for concurrent job prevention |
| DATA-05 | `content_item_versions` for snapshot at publish time | New table, schema-only in Phase 1 |
| DATA-06 | `audit_log` table for all mutations | Standard append-only audit table with RLS |
| DATA-07 | `notifications` table with urgency enum | `urgency` as PostgreSQL enum type (urgent/standard) |
| DATA-08 | `analytics_snapshots` table | Schema-only in Phase 1, populated in Phase 6 |
| DATA-09 | `gbp_daily_metrics` table | Schema-only in Phase 1, populated in Phase 6 |
| DATA-10 | `link_in_bio_profiles` and `link_in_bio_tiles` tables | Schema-only in Phase 1, built in Phase 6 |
| DATA-11 | Forward-only migrations; data migrations separate | Enforced by convention; CI migration-check validates |
| INFRA-01 | Axiom structured logging with correlation IDs | `@axiomhq/nextjs` 0.2.2 with `@axiomhq/js` 1.6.1 |
| INFRA-02 | QStash configuration with signed delivery and dead-letter queue | `@upstash/qstash` 2.11.0; configuration only in Phase 1, full usage in Phase 4 |
| INFRA-03 | Feature flags via env vars | Extend `src/env.ts` `featureFlags` object |
| INFRA-04 | GitHub Actions CI: 6-job pipeline | Existing single-job CI expanded to parallel jobs |
| TEST-04 | CI pipeline: typecheck, lint, test, coverage, build, migration-check | Existing `ci:verify` script; add coverage thresholds and migration-check |
| TEST-05 | Zero type errors, zero lint warnings in CI | Already enforced via `lint:ci` with `--max-warnings=0` |
| TEST-06 | Migration dry-run generates TypeScript types as smoke check | Supabase CLI `db push --dry-run` in CI |
</phase_requirements>

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @supabase/supabase-js | 2.106.0 | Database client with auth | Already in project; handles magic link, session management |
| @supabase/ssr | 0.10.3 | Server-side auth with cookies | Already in project; required for proxy.ts session refresh |
| next | 16.2.6 | Full-stack framework | Already in project at 16.1.0; minor update available |
| zod | 4.2.1 | Schema validation | Already in project; used for env validation and form schemas |
| vitest | 4.0.16 | Test runner | Already in project; configured with coverage |

### New Dependencies
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @axiomhq/nextjs | 0.2.2 | Next.js structured logging integration | Wrap route handlers, proxy, server actions with automatic logging |
| @axiomhq/js | 1.6.1 | Core Axiom client | Underlying transport for @axiomhq/nextjs |
| @upstash/ratelimit | 2.0.8 | Serverless rate limiting | Auth endpoints, magic link, password reset |
| @upstash/redis | 1.38.0 | Redis client for rate limiting | Required by @upstash/ratelimit |
| @upstash/qstash | 2.11.0 | Job queue with signed delivery | Configuration only in Phase 1; full usage in Phase 4 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @upstash/ratelimit | In-memory Map (v1 pattern) | In-memory resets on cold start; Upstash persists across instances. V1 has fallback pattern that can serve as backup. |
| @axiomhq/nextjs | Custom Pino wrapper | More control but more maintenance; @axiomhq/nextjs has proxy.ts integration built-in |
| Node.js crypto | iron-session or jose | Node.js crypto is zero-dependency and the team wants explicit control (D-01) |

**Installation:**
```bash
npm install @axiomhq/nextjs @axiomhq/js @upstash/ratelimit @upstash/redis @upstash/qstash
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── lib/
│   ├── auth/
│   │   ├── server.ts          # requireAuthContext(), getCurrentUser() -- rebuilt
│   │   ├── rate-limit.ts      # Upstash-based rate limiting
│   │   ├── types.ts           # AppUser, AuthContext types
│   │   └── actions.ts         # Auth server actions
│   ├── token-vault/
│   │   ├── index.ts           # Public API: encrypt(), decrypt(), rotate()
│   │   ├── crypto.ts          # AES-256-GCM implementation
│   │   ├── key-management.ts  # Key versioning, rotation logic
│   │   └── types.ts           # EncryptedPayload, VaultConfig types
│   ├── supabase/
│   │   ├── server.ts          # Cookie-based auth client (existing)
│   │   ├── service.ts         # Service-role admin client (existing)
│   │   ├── client.ts          # Browser client (existing)
│   │   └── errors.ts          # Error classification (existing)
│   ├── logging/
│   │   ├── index.ts           # Logger factory with correlation IDs
│   │   ├── axiom.ts           # Axiom transport configuration
│   │   └── correlation.ts     # AsyncLocalStorage-based correlation ID propagation
│   └── security/
│       ├── headers.ts         # Security header definitions
│       └── signing.ts         # Timing-safe secret comparison for webhooks/crons
├── app/
│   ├── proxy.ts               # Auth guard (replaces middleware.ts)
│   ├── (auth)/
│   │   ├── layout.tsx         # Public auth layout
│   │   └── login/
│   │       └── page.tsx       # Magic link + password fallback
│   ├── (app)/
│   │   ├── layout.tsx         # Protected layout with auth check
│   │   └── dashboard/
│   │       └── page.tsx       # Post-login landing
│   ├── auth/
│   │   ├── callback/
│   │   │   └── route.ts      # Supabase auth callback (magic link + OAuth)
│   │   └── confirm/
│   │       └── route.ts      # Email confirmation handler
│   └── api/
│       ├── auth/
│       │   ├── magic-link/route.ts  # Magic link sender
│       │   └── login/route.ts       # Password login
│       └── cron/
│           └── [...]/route.ts       # Cron endpoints with signed secret validation
└── env.ts                     # Extended with TOKEN_VAULT_KEY, AXIOM_*, UPSTASH_* vars
```

### Pattern 1: Token Vault (AES-256-GCM Envelope Encryption)
**What:** Standalone crypto module that encrypts/decrypts OAuth tokens using AES-256-GCM with a versioned key envelope. Each encrypted payload stores: ciphertext, IV, auth tag, key version.
**When to use:** Any time social OAuth tokens (access or refresh) are stored or retrieved from the database.
**Example:**
```typescript
// src/lib/token-vault/crypto.ts
import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const TAG_LENGTH = 16; // 128-bit auth tag

interface EncryptedPayload {
  ciphertext: string;  // base64
  iv: string;          // base64
  tag: string;         // base64
  keyVersion: number;
}

export function encrypt(plaintext: string, key: Buffer, keyVersion: number): EncryptedPayload {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    keyVersion,
  };
}

export function decrypt(payload: EncryptedPayload, key: Buffer): string {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(payload.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
```

### Pattern 2: Proxy.ts Auth Guard (Next.js 16)
**What:** `proxy.ts` replaces `middleware.ts` in Next.js 16. Runs on Node.js runtime (not Edge). Guards all `(app)/*` routes by checking Supabase session cookies.
**When to use:** Every request to protected routes.
**Example:**
```typescript
// src/app/proxy.ts
import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Public routes that don't need auth
  const publicPaths = ['/auth/', '/api/auth/', '/l/', '/_next/'];
  if (publicPaths.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  
  // Create Supabase client with cookie access
  const response = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }
  
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
```

### Pattern 3: Timing-Safe Secret Validation
**What:** Webhook and cron endpoints must validate signed secrets using constant-time comparison to prevent timing attacks.
**When to use:** Every cron job endpoint and webhook handler.
**Example:**
```typescript
// src/lib/security/signing.ts
import crypto from 'node:crypto';

export function validateSecret(provided: string | null, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
```

### Pattern 4: Correlation ID Propagation
**What:** Use `AsyncLocalStorage` to propagate a unique correlation ID through the entire request lifecycle, from proxy through server actions and API handlers.
**When to use:** All server-side logging.
**Recommendation:** Lazy re-encrypt strategy for key rotation. When a token is read with an old key version, decrypt with the old key, re-encrypt with the current key, and write back. This avoids batch migrations and handles rotation gracefully.
```typescript
// src/lib/logging/correlation.ts
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';

interface RequestContext {
  correlationId: string;
  startTime: number;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function createCorrelationId(): string {
  return crypto.randomUUID();
}

export function getCorrelationId(): string {
  return requestContext.getStore()?.correlationId ?? 'no-context';
}
```

### Anti-Patterns to Avoid
- **Storing plain-text OAuth tokens:** Never store access_token or refresh_token as plain text in social_connections. Always encrypt through the token vault.
- **Using `getSession()` for access control:** Supabase's `getSession()` does not re-validate the JWT. Use `getUser()` (which calls the Supabase Auth server) for any access control check.
- **Edge runtime for proxy.ts:** Next.js 16 proxy.ts defaults to Node.js runtime. Do not force Edge runtime -- it breaks `node:crypto` and `AsyncLocalStorage`.
- **Dynamic Tailwind classes:** Never construct class names dynamically (e.g., `bg-${color}-500`). Tailwind purges them at build time.
- **Hardcoded security header values inline:** Define all header values in a single `security/headers.ts` module. Do not scatter CSP directives across config files.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rate limiting | Custom in-memory counter | @upstash/ratelimit + @upstash/redis | In-memory counters reset on cold start; Upstash persists across serverless instances and supports sliding window |
| Session management | Custom JWT verification | @supabase/ssr with cookie-based sessions | Handles token refresh, PKCE flow, cookie chunking for large JWTs |
| Structured logging | Custom JSON logger | @axiomhq/nextjs | Built-in proxy.ts integration, Web Vitals capture, automatic request tracing |
| HMAC state for OAuth | Manual crypto.createHmac | Supabase Auth PKCE flow | Supabase handles state binding automatically with PKCE |
| CI caching | Manual npm cache management | actions/setup-node with cache: 'npm' | Built-in, restores node_modules based on lockfile hash |

**Key insight:** Security primitives (encryption, rate limiting, session management) have subtle edge cases that custom implementations routinely get wrong. Use battle-tested libraries and spend engineering time on the domain-specific token vault where custom code is justified by the requirement for explicit control.

## Common Pitfalls

### Pitfall 1: middleware.ts vs proxy.ts (Next.js 16)
**What goes wrong:** Creating `middleware.ts` instead of `proxy.ts`, or exporting `middleware` instead of `proxy`.
**Why it happens:** Most tutorials and documentation still reference the old name. Next.js 16 deprecated `middleware.ts` and renamed it to `proxy.ts`.
**How to avoid:** Use `proxy.ts` at the app root. Export a function named `proxy`. Run `npx @next/codemod rename-middleware` if migrating.
**Warning signs:** "middleware is deprecated" warning in dev console.

### Pitfall 2: getSession() for Access Control
**What goes wrong:** Using `supabase.auth.getSession()` to check if a user is authenticated in server actions or API routes.
**Why it happens:** `getSession()` is faster because it reads from the local cookie without an API call. But it does NOT validate the JWT signature.
**How to avoid:** Always use `supabase.auth.getUser()` for access control. `getUser()` makes a network call to Supabase Auth to validate the token.
**Warning signs:** Auth checks that never fail even with expired/tampered tokens.

### Pitfall 3: AES-256-GCM IV Reuse
**What goes wrong:** Reusing the same initialization vector (IV) with the same key. This completely breaks GCM's security guarantees.
**Why it happens:** Using a fixed IV or counter instead of `crypto.randomBytes(12)` for each encryption operation.
**How to avoid:** Generate a fresh 12-byte random IV for every `encrypt()` call. Store it alongside the ciphertext.
**Warning signs:** Multiple encrypted payloads with identical `iv` fields.

### Pitfall 4: RLS Policies Missing on New Tables
**What goes wrong:** Creating tables without RLS policies, then using the anon-key client to query them -- returns all rows or no rows depending on Supabase's default.
**Why it happens:** Forgetting to add policies after `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`.
**How to avoid:** Every migration that creates a table must also create at least one RLS policy. Use a checklist in CI.
**Warning signs:** Queries returning empty results when data exists, or returning all rows regardless of user.

### Pitfall 5: Cookie Size Limits with Supabase Session
**What goes wrong:** Supabase JWT cookies exceed the 4KB browser cookie limit, causing silent auth failures.
**Why it happens:** Custom claims or large `app_metadata` inflating the JWT.
**How to avoid:** `@supabase/ssr` automatically chunks large cookies. But keep custom claims minimal. Don't store large objects in user metadata.
**Warning signs:** Intermittent auth failures, especially on mobile browsers with stricter cookie limits.

### Pitfall 6: Forgetting to Set Auth Tag in GCM Decryption
**What goes wrong:** Calling `decipher.update()` and `decipher.final()` without first calling `decipher.setAuthTag()`.
**Why it happens:** The auth tag is a separate output from encryption that must be explicitly provided during decryption.
**How to avoid:** Always call `decipher.setAuthTag(tag)` before `decipher.update()`. Store the tag alongside the ciphertext and IV.
**Warning signs:** "Unsupported state or unable to authenticate data" error from Node.js crypto.

### Pitfall 7: Timing Attack on Secret Comparison
**What goes wrong:** Using `===` to compare webhook/cron secrets, which is vulnerable to timing attacks.
**Why it happens:** JavaScript string comparison short-circuits on first differing byte, leaking information about the secret.
**How to avoid:** Always use `crypto.timingSafeEqual()` for secret comparison. Pad inputs to equal length first.
**Warning signs:** Using `if (secret === expected)` anywhere in security-critical code.

## Code Examples

### Security Headers Configuration
```typescript
// next.config.ts headers() method
async headers() {
  return [
    {
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        {
          key: 'Content-Security-Policy',
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-eval' 'unsafe-inline'",  // unsafe-eval needed for Next.js dev
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https:",
            "font-src 'self'",
            "connect-src 'self' https://*.supabase.co https://*.axiom.co",
            "frame-ancestors 'none'",
          ].join('; '),
        },
      ],
    },
  ];
},
```

### RLS Policy Pattern (Account-Scoped)
```sql
-- Standard pattern for every table
ALTER TABLE public.some_table ENABLE ROW LEVEL SECURITY;

-- Read: user can see own account's rows
CREATE POLICY "Users can view own account data"
  ON public.some_table FOR SELECT
  USING (account_id = (
    SELECT COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'account_id'),
      auth.uid()::text
    )::uuid
  ));

-- Write: user can insert/update own account's rows
CREATE POLICY "Users can modify own account data"
  ON public.some_table FOR INSERT
  WITH CHECK (account_id = (
    SELECT COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'account_id'),
      auth.uid()::text
    )::uuid
  ));

-- Service role bypass is automatic (service_role key bypasses RLS)
```

### Upstash Rate Limiting for Auth
```typescript
// src/lib/auth/rate-limit.ts (v2)
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export const authRateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, '60 s'), // 5 requests per 60 seconds
  prefix: 'ratelimit:auth',
});

export async function checkAuthRateLimit(identifier: string) {
  const { success, limit, remaining, reset } = await authRateLimiter.limit(identifier);
  return { allowed: success, limit, remaining, resetAt: reset };
}
```

### GitHub Actions CI (6-job pipeline)
```yaml
# .github/workflows/ci.yml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  install:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - uses: actions/cache/save@v4
        with:
          path: node_modules
          key: modules-${{ hashFiles('package-lock.json') }}

  typecheck:
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - uses: actions/cache/restore@v4
        with:
          path: node_modules
          key: modules-${{ hashFiles('package-lock.json') }}
      - run: npm run typecheck

  lint:
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - uses: actions/cache/restore@v4
        with:
          path: node_modules
          key: modules-${{ hashFiles('package-lock.json') }}
      - run: npm run lint:ci

  test:
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - uses: actions/cache/restore@v4
        with:
          path: node_modules
          key: modules-${{ hashFiles('package-lock.json') }}
      - run: npm run test:ci -- --coverage

  build:
    needs: [typecheck, lint, test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - uses: actions/cache/restore@v4
        with:
          path: node_modules
          key: modules-${{ hashFiles('package-lock.json') }}
      - run: npm run build
        env:
          NEXT_PUBLIC_SUPABASE_URL: https://placeholder.supabase.co
          NEXT_PUBLIC_SUPABASE_ANON_KEY: placeholder

  migration-check:
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - uses: supabase/setup-cli@v1
      - run: supabase db lint --schema public
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `middleware.ts` | `proxy.ts` | Next.js 16 (2026) | Rename file and export; runs on Node.js by default |
| `getSession()` for auth | `getUser()` for auth | Supabase SSR 0.5+ | `getUser()` validates JWT server-side; `getSession()` is read-only from cookie |
| `@supabase/auth-helpers-nextjs` | `@supabase/ssr` | 2024 | Auth helpers deprecated; SSR package is the replacement |
| Anon/service-role keys | Publishable/secret keys | Supabase 2026 | Old keys work until end of 2026; new `sb_publishable_xxx` / `sb_secret_xxx` format available |
| `next-axiom` | `@axiomhq/nextjs` | 2025 | `next-axiom` is maintenance-only; `@axiomhq/nextjs` is actively developed |

**Deprecated/outdated:**
- `@supabase/auth-helpers-nextjs`: Fully deprecated. Use `@supabase/ssr` instead.
- `next-axiom`: No new features. Use `@axiomhq/nextjs` for new projects.
- `middleware.ts`: Deprecated in Next.js 16. Use `proxy.ts`.

## Discretion Recommendations

### Token Vault Key Rotation: Lazy Re-Encrypt
**Recommendation:** Versioned keys with lazy re-encryption. Store `keyVersion` with each encrypted payload. When reading a token encrypted with an old version, decrypt with the old key, re-encrypt with the current key, and update the row.
**Why:** Avoids downtime for batch migration. Rotation happens naturally as tokens are accessed. Add an `ops:rotate-vault-keys` script for manual batch rotation if needed.

### Axiom Integration: @axiomhq/nextjs SDK
**Recommendation:** Use `@axiomhq/nextjs` 0.2.2 with the `@axiomhq/js` 1.6.1 transport. It provides proxy.ts integration, route handler wrapping, and Web Vitals capture out of the box.
**Why:** Less custom code to maintain. Built-in support for Next.js 16 patterns.

### CI Pipeline: GitHub Actions
**Recommendation:** Keep GitHub Actions (existing `ci.yml`). Expand from 1 job to 6 parallel jobs: install, typecheck, lint, test, build, migration-check.
**Why:** Already configured. Vercel's CI is deployment-focused, not testing-focused. GitHub Actions has better caching and parallel job support.

### Rate Limiting: Upstash Redis
**Recommendation:** Use `@upstash/ratelimit` 2.0.8 with `@upstash/redis` 1.38.0. Keep the v1 in-memory fallback as a graceful degradation path when Upstash is unavailable.
**Why:** Upstash persists across serverless cold starts. Sliding window algorithm prevents burst-then-wait patterns. Free tier (10K requests/day) sufficient for auth rate limiting.
**New env vars:** `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`

### Correlation ID Propagation: AsyncLocalStorage
**Recommendation:** Use Node.js `AsyncLocalStorage` to propagate correlation IDs. Generate UUID in proxy.ts, set it in the store, read it in all logger calls. Pass via `x-correlation-id` response header for debugging.
**Why:** Zero-dependency. Works with Node.js runtime (which proxy.ts uses by default in Next.js 16). No need for request-header threading.

## Open Questions

1. **Supabase Key Migration Timeline**
   - What we know: Supabase introduced `sb_publishable_xxx` / `sb_secret_xxx` keys. Old keys work until end of 2026.
   - What's unclear: Whether to migrate keys now or after v2 launch.
   - Recommendation: Use existing keys for v2 launch; plan key migration as a post-launch task. No code changes needed -- just env var updates.

2. **Nonce-Based CSP**
   - What we know: Next.js supports nonce-based CSP via proxy.ts. Static CSP in next.config.ts requires `unsafe-inline` for styles.
   - What's unclear: Whether `unsafe-inline` for styles is acceptable given the app's threat model.
   - Recommendation: Start with static CSP (simpler). Move to nonce-based CSP in Phase 5 (hardening) if needed. `unsafe-inline` for styles is standard practice for Tailwind CSS applications.

3. **QStash Setup Scope in Phase 1**
   - What we know: INFRA-02 requires "QStash configuration with signed delivery and dead-letter queue." Full usage is Phase 4.
   - What's unclear: How much QStash infrastructure to build in Phase 1.
   - Recommendation: Install the package, add env vars to `env.ts`, create a `src/lib/qstash/client.ts` with signed verification helper. Defer queue creation and DLQ setup to Phase 4.

## Sources

### Primary (HIGH confidence)
- [Node.js v26.1.0 Crypto Documentation](https://nodejs.org/api/crypto.html) -- AES-256-GCM API, createCipheriv, createDecipheriv
- [Supabase Server-Side Auth for Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs) -- Official SSR setup guide
- [Next.js proxy.ts File Convention](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) -- Official proxy.ts documentation
- [Next.js Security Headers Guide](https://nextjs.org/docs/app/guides/content-security-policy) -- CSP with nonces
- npm registry -- verified all package versions via `npm view`

### Secondary (MEDIUM confidence)
- [Axiom Next.js Integration](https://axiom.co/docs/send-data/nextjs) -- @axiomhq/nextjs setup, WebVitals
- [@upstash/ratelimit GitHub](https://github.com/upstash/ratelimit-js) -- Sliding window algorithms, configuration
- [Next.js 16 Blog Post](https://nextjs.org/blog/next-16) -- proxy.ts migration details
- [Auth0: What's New in Next.js 16](https://auth0.com/blog/whats-new-nextjs-16/) -- Auth patterns with proxy.ts

### Tertiary (LOW confidence)
- Community guides on correlation ID patterns -- cross-verified with Node.js AsyncLocalStorage docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all packages verified via npm registry; existing codebase already uses core dependencies
- Architecture: HIGH -- patterns derived from official docs (Supabase, Next.js 16) and existing v1 codebase
- Token vault: HIGH -- Node.js crypto AES-256-GCM is well-documented; pattern is straightforward
- Pitfalls: HIGH -- based on official documentation warnings (getSession vs getUser, GCM IV reuse)
- CI pipeline: HIGH -- existing CI.yml provides baseline; expansion follows standard GitHub Actions patterns
- Axiom integration: MEDIUM -- @axiomhq/nextjs is newer; official docs verified but less community validation
- Rate limiting: MEDIUM -- Upstash is well-established but requires new external service dependency

**Research date:** 2026-05-19
**Valid until:** 2026-06-19 (30 days -- stable domain, frameworks not changing rapidly)
