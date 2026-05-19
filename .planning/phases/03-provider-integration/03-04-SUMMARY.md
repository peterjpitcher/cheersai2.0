---
phase: 03-provider-integration
plan: 04
subsystem: auth
tags: [oauth, token-vault, connection-health, supabase, security]

requires:
  - phase: 03-provider-integration/01
    provides: "v2 schema (oauth_states, token_vault, social_connections columns), token-helpers, provider types"
provides:
  - "v2 OAuth connect flow with session-bound state and token vault storage"
  - "Connection health derivation (green/amber/red) with 7-day expiry alerting"
  - "v2-compatible connection data queries (no plaintext tokens)"
affects: [connections-ui, dashboard-sidebar, publish-pipeline, settings]

tech-stack:
  added: []
  patterns: ["oauth_states for CSRF prevention", "token vault for all token storage", "health derivation pure function"]

key-files:
  created:
    - src/lib/connections/health.ts
    - src/lib/connections/health.test.ts
    - src/app/(app)/connections/actions.test.ts
  modified:
    - src/app/(app)/connections/actions.ts
    - src/app/api/oauth/[provider]/callback/route.ts
    - src/lib/connections/data.ts
    - src/features/connections/connection-oauth-button.tsx
    - src/features/connections/connection-oauth-handler.tsx

key-decisions:
  - "Used 'disconnected' status instead of 'revoked' -- matches the connection_status enum in baseline migration"
  - "Facebook page tokens treated as non-expiring (null token_expires_at = green, not amber)"
  - "v1 test files deprecated and skipped rather than deleted -- preserves history"

patterns-established:
  - "OAuth state validation: insert state -> validate unused+unexpired -> mark used -> exchange"
  - "Token storage: always via storeEncryptedToken, never as plaintext columns"
  - "Health derivation: pure function taking (status, tokenExpiresAt, platform) -> ConnectionHealth"

requirements-completed: [PLAT-09, PLAT-06]

duration: 7min
completed: 2026-05-19
---

# Phase 03 Plan 04: Connection Actions & Health Summary

**V2 OAuth flow with session-bound state (PLAT-09), token vault storage, and connection health derivation with 7-day expiry alerting (PLAT-06)**

## Performance

- **Duration:** 7 min
- **Started:** 2026-05-19T12:16:32Z
- **Completed:** 2026-05-19T12:23:25Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- OAuth connect flow rewritten to use oauth_states table for CSRF prevention with 10-minute expiry
- Tokens stored exclusively in token vault via storeEncryptedToken -- no plaintext columns
- Connection health derivation correctly categorises green/amber/red with 7-day warning window
- Facebook page tokens identified as non-expiring (Research pitfall 3)
- 21 tests covering security-critical OAuth state validation and health logic

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite OAuth actions (RED)** - `e61af36` (test)
2. **Task 1: Rewrite OAuth actions (GREEN)** - `7cb3997` (feat)
3. **Task 2: Connection health derivation (RED)** - `bcb48bd` (test)
4. **Task 2: Connection health + data queries (GREEN)** - `c44b058` (feat)

## Files Created/Modified
- `src/app/(app)/connections/actions.ts` - Rewritten with initiateOAuthConnect, completeOAuthConnect, disconnectProvider
- `src/app/(app)/connections/actions.test.ts` - 11 tests for OAuth security logic
- `src/app/api/oauth/[provider]/callback/route.ts` - Updated redirect pattern (?connected= instead of ?oauth=)
- `src/lib/connections/health.ts` - New: deriveConnectionHealth and getConnectionHealthSummaries
- `src/lib/connections/health.test.ts` - 10 tests for health derivation logic
- `src/lib/connections/data.ts` - Updated to v2 columns (platform_account_name, token_expires_at)
- `src/features/connections/connection-oauth-button.tsx` - Updated to use initiateOAuthConnect
- `src/features/connections/connection-oauth-handler.tsx` - Updated for v2 redirect pattern
- `tests/completeConnectionOAuth.test.ts` - Deprecated (v1 API removed)
- `tests/integration/connection-flow.test.ts` - Deprecated (v1 API removed)

## Decisions Made
- **'disconnected' instead of 'revoked':** The plan specified 'revoked' but the DB enum only has active/expiring/expired/disconnected. Used 'disconnected' to match schema.
- **Facebook non-expiring:** Facebook page tokens have no expiry. Null token_expires_at returns 'green' for Facebook, 'amber' for others.
- **v1 test deprecation:** Old test files testing completeConnectionOAuth skipped rather than deleted to preserve git history.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Used 'disconnected' instead of 'revoked' for disconnect status**
- **Found during:** Task 1 (actions rewrite)
- **Issue:** Plan specified status='revoked' but connection_status enum only has active/expiring/expired/disconnected
- **Fix:** Used 'disconnected' which is the correct enum value for this operation
- **Files modified:** src/app/(app)/connections/actions.ts
- **Verification:** TypeScript compiles cleanly, test passes
- **Committed in:** 7cb3997

**2. [Rule 3 - Blocking] Updated consumer components for renamed functions**
- **Found during:** Task 2 (typecheck revealed broken imports)
- **Issue:** connection-oauth-button.tsx and connection-oauth-handler.tsx imported old v1 function names
- **Fix:** Updated imports and call sites to new v2 API (initiateOAuthConnect, completeOAuthConnect)
- **Files modified:** src/features/connections/connection-oauth-button.tsx, src/features/connections/connection-oauth-handler.tsx
- **Verification:** npx tsc --noEmit passes (only pre-existing unrelated error remains)
- **Committed in:** c44b058

**3. [Rule 3 - Blocking] Deprecated v1 test files referencing removed functions**
- **Found during:** Task 2 (typecheck revealed broken test imports)
- **Issue:** tests/completeConnectionOAuth.test.ts and tests/integration/connection-flow.test.ts referenced removed v1 API
- **Fix:** Replaced with describe.skip blocks pointing to new v2 test coverage
- **Files modified:** tests/completeConnectionOAuth.test.ts, tests/integration/connection-flow.test.ts
- **Verification:** npx tsc --noEmit passes
- **Committed in:** c44b058

---

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking)
**Impact on plan:** All auto-fixes necessary for correctness and type safety. No scope creep.

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all functions fully implemented with real logic.

## Next Phase Readiness
- OAuth flow ready for end-to-end testing with real provider tokens
- Health derivation ready for sidebar integration (green/amber/red dots)
- Connection data queries compatible with v2 schema

---
*Phase: 03-provider-integration*
*Completed: 2026-05-19*
