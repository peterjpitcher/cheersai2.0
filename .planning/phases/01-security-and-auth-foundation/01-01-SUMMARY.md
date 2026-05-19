---
phase: 01-security-and-auth-foundation
plan: 01
subsystem: auth
tags: [aes-256-gcm, crypto, security-headers, csp, hsts, timing-safe, token-vault, env-validation]

requires:
  - phase: none
    provides: greenfield project
provides:
  - Token vault module with encrypt/decrypt/rotate API
  - Security headers module for next.config.ts
  - Timing-safe secret validation utility
  - Extended env.ts with TOKEN_VAULT_KEY, AXIOM, UPSTASH, QSTASH vars
  - Feature flag pattern (ENABLE_MEDIA_ATTACHMENTS_TABLE)
affects: [01-02, 01-03, 01-04, 01-05, 03-provider-adapters]

tech-stack:
  added: []
  patterns: [AES-256-GCM envelope encryption, versioned key rotation, timing-safe comparison, security headers module]

key-files:
  created:
    - src/lib/token-vault/types.ts
    - src/lib/token-vault/crypto.ts
    - src/lib/token-vault/key-management.ts
    - src/lib/token-vault/index.ts
    - src/lib/token-vault/crypto.test.ts
    - src/lib/security/headers.ts
    - src/lib/security/signing.ts
    - src/lib/security/signing.test.ts
  modified:
    - src/env.ts
    - next.config.ts

key-decisions:
  - "Lazy re-encrypt strategy for key rotation -- decrypt with old key, re-encrypt with current key on access"
  - "Static CSP with unsafe-inline for styles (required by Tailwind CSS) -- nonce-based deferred to Phase 5"
  - "Security headers defined in standalone module imported by next.config.ts (not inline)"

patterns-established:
  - "Token vault: standalone crypto module at src/lib/token-vault/ with types, crypto, key-management, index layers"
  - "Security utilities: src/lib/security/ for cross-cutting security concerns"
  - "Env extension: add new vars to serverEnv object, add to requiredServerKeys for production enforcement"
  - "Feature flags: boolean getters in featureFlags export, read from env vars"

requirements-completed: [AUTH-04, AUTH-05, AUTH-06, INFRA-02, INFRA-03]

duration: 3min
completed: 2026-05-19
---

# Phase 1 Plan 1: Security Primitives and Environment Config Summary

**AES-256-GCM token vault with versioned key rotation, security headers (CSP/HSTS/X-Frame-Options), timing-safe signing, and extended env.ts for all Phase 1 services**

## Performance

- **Duration:** 3 min
- **Started:** 2026-05-19T06:46:45Z
- **Completed:** 2026-05-19T06:50:10Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Token vault module encrypts/decrypts OAuth tokens with AES-256-GCM, fresh IV per call, versioned keys for lazy rotation
- Security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, X-Robots-Tag) applied to all responses via next.config.ts
- Timing-safe secret comparison utility prevents timing attacks on webhook/cron secrets
- Environment config extended with TOKEN_VAULT_KEY, AXIOM, UPSTASH Redis, UPSTASH QStash variables
- Feature flag pattern established with ENABLE_MEDIA_ATTACHMENTS_TABLE

## Task Commits

Each task was committed atomically:

1. **Task 1: Token vault module with AES-256-GCM encryption** - `fe32f74` (feat)
2. **Task 2: Security utilities (headers + signing) and environment config** - `cb9a9f1` (feat)

## Files Created/Modified
- `src/lib/token-vault/types.ts` - EncryptedPayload and VaultConfig interfaces
- `src/lib/token-vault/crypto.ts` - AES-256-GCM encryptPayload/decryptPayload with fresh IV per call
- `src/lib/token-vault/key-management.ts` - Key reading from env, hex validation, version management
- `src/lib/token-vault/index.ts` - Public API: encrypt(), decrypt(), rotate()
- `src/lib/token-vault/crypto.test.ts` - 8 tests covering round-trip, unique IVs, wrong key, tampered data, key rotation
- `src/lib/security/headers.ts` - Security header definitions for next.config.ts
- `src/lib/security/signing.ts` - Timing-safe secret validation using crypto.timingSafeEqual
- `src/lib/security/signing.test.ts` - 4 tests covering match, mismatch, null/empty, length-diff
- `src/env.ts` - Extended with TOKEN_VAULT_KEY, AXIOM_*, UPSTASH_*, feature flag
- `next.config.ts` - Imports securityHeaders module, replaces inline headers

## Decisions Made
- Lazy re-encrypt strategy for key rotation (decrypt with old key, re-encrypt with current key on access)
- Static CSP with unsafe-inline for styles (required by Tailwind CSS) -- nonce-based CSP deferred to Phase 5
- Security headers defined in standalone module, not inline in next.config.ts

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. TOKEN_VAULT_KEY must be set before production deployment (enforced by validateProductionEnv in env.ts).

## Next Phase Readiness
- Token vault ready for social_connections table (Plan 01-03 schema baseline)
- Security headers active on all responses
- Signing utility ready for cron/webhook endpoints (Plans 01-04, 01-05)
- Environment vars ready for Axiom, Upstash, QStash integration (Plans 01-04, 01-05)

---
*Phase: 01-security-and-auth-foundation*
*Completed: 2026-05-19*
