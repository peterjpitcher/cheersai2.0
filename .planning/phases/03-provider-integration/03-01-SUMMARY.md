---
phase: 03-provider-integration
plan: 01
subsystem: api
tags: [provider-adapter, registry-pattern, error-classification, token-vault, oauth, rate-limiting, postgresql]

requires:
  - phase: 01-security-foundation
    provides: token-vault encrypt/decrypt API, Supabase service client, baseline schema with social_connections and token_vault tables
provides:
  - PublishingAdapter interface with GbpExtensions type guard
  - Map-based adapter registry (registerAdapter/getAdapter/hasAdapter)
  - ErrorClassification enum with classifyMetaError/classifyGoogleError
  - ProviderError class with platform, classification, retryable fields
  - getDecryptedToken/storeEncryptedToken shared token helpers
  - getConnectionMetadata shared utility for all adapters
  - oauth_states table with RLS for session-bound OAuth
  - provider_rate_limits table with RLS and increment_rate_limit RPC
  - social_connections metadata, display_name, last_synced_at columns
affects: [03-02-facebook-adapter, 03-03-instagram-gbp-adapters, 03-04-oauth-rewrite, 03-05-health-rate-limits]

tech-stack:
  added: []
  patterns: [registry-pattern-for-adapters, error-classification-enum, provider-error-hierarchy, shared-connection-metadata]

key-files:
  created:
    - supabase/migrations/00000000000007_provider_integration.sql
    - src/types/providers.ts
    - src/lib/providers/types.ts
    - src/lib/providers/registry.ts
    - src/lib/providers/errors.ts
    - src/lib/providers/token-helpers.ts
    - src/lib/providers/shared.ts
    - src/lib/providers/types.test.ts
    - src/lib/providers/errors.test.ts
  modified: []

key-decisions:
  - "Registry pattern uses simple Map singleton -- no DI container overhead for 3 adapters"
  - "oauth_states uses created_by with auth.uid() default instead of account_id FK -- OAuth state is per-user not per-account"
  - "ContentPayload.contentType includes 'carousel' to support PLAT-03 Instagram carousel publishing"
  - "getConnectionMetadata in shared.ts uses service-role client -- adapters run in background job context without user session"

patterns-established:
  - "Registry pattern: adapters register at module load, pipeline calls getAdapter(platform)"
  - "Error classification: all API errors routed through classifyMetaError/classifyGoogleError before handling"
  - "Token helpers: getDecryptedToken/storeEncryptedToken wrap vault API with Supabase queries"
  - "Shared utilities: cross-adapter code lives in providers/shared.ts to prevent duplication"

requirements-completed: [PLAT-01, PLAT-07, PLAT-08, PLAT-09]

duration: 4min
completed: 2026-05-19
---

# Phase 03 Plan 01: Provider Integration Foundation Summary

**PublishingAdapter registry with error classification, token vault helpers, oauth_states/rate_limits tables, and shared getConnectionMetadata utility**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-19T12:12:00Z
- **Completed:** 2026-05-19T12:16:00Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Database migration with oauth_states, provider_rate_limits tables (both RLS-enabled), increment_rate_limit atomic RPC, and social_connections column additions
- PublishingAdapter interface with GbpExtensions type guard, Map-based registry, and 5-category error classification system
- Shared token helpers integrating with existing token vault, and getConnectionMetadata utility for all three adapters

## Task Commits

Each task was committed atomically:

1. **Task 1: Database migration** - `73f2538` (feat) + TDD RED in same commit (migration verified via grep)
2. **Task 2: Provider types, registry, errors, helpers** - `789c83d` (test: RED), `27a3d97` (feat: GREEN)

## Files Created/Modified
- `supabase/migrations/00000000000007_provider_integration.sql` - oauth_states, provider_rate_limits tables, increment_rate_limit RPC, social_connections additions
- `src/types/providers.ts` - ProviderPlatform, ContentPayload, PublishResult, ValidationResult, ConnectionHealth types
- `src/lib/providers/types.ts` - PublishingAdapter interface, GbpExtensions, isGbpAdapter type guard
- `src/lib/providers/registry.ts` - Map-based adapter registry with register/get/has/list
- `src/lib/providers/errors.ts` - ErrorClassification enum, ProviderError class, classifyMetaError, classifyGoogleError
- `src/lib/providers/token-helpers.ts` - getDecryptedToken, storeEncryptedToken wrapping token vault
- `src/lib/providers/shared.ts` - getConnectionMetadata for cross-adapter metadata retrieval
- `src/lib/providers/types.test.ts` - isGbpAdapter type guard tests (3 cases)
- `src/lib/providers/errors.test.ts` - Error classification tests (21 cases total)

## Decisions Made
- Registry uses simple Map singleton -- no DI container needed for 3 adapters
- oauth_states uses created_by with auth.uid() instead of account_id FK -- OAuth state is per-user
- ContentPayload.contentType includes 'carousel' for PLAT-03 Instagram carousel support
- getConnectionMetadata uses service-role client since adapters run in background job context

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing type error in `src/lib/ai/generate.test.ts` (missing `link_in_bio_line` property) -- not caused by this plan, out of scope.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All Wave 2 plans (02-05) can now proceed -- they depend on these types, tables, and utilities
- Facebook adapter (03-02), Instagram/GBP adapters (03-03), OAuth rewrite (03-04), and health/rate-limits (03-05) all have their shared foundation

---
*Phase: 03-provider-integration*
*Completed: 2026-05-19*
