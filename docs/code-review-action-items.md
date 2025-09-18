# CheersAI Code Review – Required Changes

_Last updated: 2025-02-15_

## Overview
This document tracks the remediation work requested during the repository review. Each item cites the affected files, current status, and any follow-up tasks. Tests and verification guidance are listed at the end.

---

## High Severity

1. **Re-enable build-time lint/type safety**  
   - **Refs:** `next.config.ts`  
   - **Status:** ✅ `ignoreDuringBuilds` and `ignoreBuildErrors` removed; TypeScript/ESLint errors now break builds. Remaining lint warnings stem from legacy Tailwind ordering and `any` usage across the repo.  
   - **Follow-up:** Resolve outstanding lint warnings before re-enabling the lint gate in CI.  
   - **Checks:** `npm run lint`, `npx tsc --noEmit`, `next build`.

2. **Fix cron internal authentication when `CRON_SECRET` is unset**  
   - **Refs:** `app/api/cron/route.ts`, `app/api/queue/process/route.ts`, `app/api/gdpr/cleanup/route.ts`, `app/api/queue/run-now/route.ts`  
   - **Status:** ✅ Internal calls now share header construction; `Authorization` is omitted when the secret is blank while the Vercel cron header is forwarded. Structured logging added for auth failures.  
   - **Follow-up:** Apply the same helper to any new cron endpoints introduced later.  
   - **Checks:** `__tests__/app/api/cron/route.test.ts`, manual cron smoke tests.

3. **Persist and validate OAuth state nonces**  
   - **Refs:** `app/api/social/connect/facebook/route.ts`, `app/api/social/callback/route.ts`, `app/api/auth/google-my-business/connect/route.ts`, `app/api/auth/google-my-business/callback/route.ts`, `lib/security/oauth-state.ts`, `__tests__/lib/security/oauth-state.test.ts`  
   - **Status:** ✅ Introduced encrypted cookie-backed nonce store; callbacks now verify nonce + tenant/user matches before proceeding. Structured logs capture mismatches.  
   - **Follow-up:** Extend the helper to additional OAuth providers if/when they are added.  
   - **Checks:** Unit tests plus manual Facebook/GBP auth flows.

4. **Guarantee post lock release on failures**  
   - **Refs:** `app/api/social/publish/route.ts`  
   - **Status:** ✅ Publishing loop wrapped with `try/finally`; unlock emits telemetry even on errors. External publish calls run through reliability wrappers.  
   - **Follow-up:** Consider an integration test for lock/unlock if regressions recur.  
   - **Checks:** Covered indirectly via queue processing tests; add targeted test if needed.

---

## Medium Severity

5. **Use reliable base URL detection for internal calls**  
   - **Refs:** `lib/utils/get-app-url.ts`, `app/api/cron/route.ts`, `app/api/queue/process/route.ts`, `app/api/queue/run-now/route.ts`  
   - **Status:** ✅ Added `getInternalBaseUrl(request)` helper and refactored cron/queue endpoints to use it.  
   - **Follow-up:** Audit other internal fetches (e.g., Stripe/support ticket flows) to remove direct `NEXT_PUBLIC_APP_URL` usage.  
   - **Checks:** Cron unit tests; manual verification without `NEXT_PUBLIC_APP_URL` set.

6. **Wrap provider API calls with reliability utilities**  
   - **Refs:** `lib/social/facebook.ts`, `lib/social/google-my-business/client.ts`, `app/api/social/publish/route.ts`, `app/api/analyse-website/route.ts`  
   - **Status:** ✅ External requests now go through `createServiceFetch` + `withRetry`; structured logging captures retries/exhaustion.  
   - **Follow-up:** Repeat for remaining providers (Stripe, Resend, Supabase admin helpers).  
   - **Checks:** Manual smoke tests; extend automated coverage as new wrappers land.

7. **Fail fast when notification emails cannot send**  
   - **Refs:** `app/api/notifications/email/route.ts`  
   - **Status:** ✅ API now returns 500 on send failure and logs the error via `createRequestLogger`.  
   - **Follow-up:** Bubble provider-specific error codes to callers for richer UX if desired.  
   - **Checks:** Manual API verification; add Jest coverage if the endpoint evolves.

8. **Replace raw console logging with structured logging**  
   - **Refs:** All `app/api/**` routes now emit through `createRequestLogger`/`logger`; eslint guard added.  
   - **Status:** ✅ Server routes are console-free and the new `no-console` rule prevents regressions. Client-side components/scripts still use `console.*` by design.  
   - **Follow-up:** None for server runtime; extend lint coverage to client bundles later if desired.  
   - **Checks:** `rg "console" app/api` (clean) and lint rule enforcement.

---

## Testing & Tooling

9. **Add regression tests for critical flows**  
   - **Refs:** `__tests__/lib/security/oauth-state.test.ts`, `__tests__/app/api/cron/route.test.ts`  
   - **Status:** ✅ Added deterministic unit tests covering nonce storage/validation and cron auth permutations.  
   - **Follow-up:** Add tests for publish failure paths and notification error handling in future iterations.  
   - **Checks:** `npm test -- --runTestsByPath __tests__/lib/security/oauth-state.test.ts __tests__/app/api/cron/route.test.ts`.

10. **Restore CI gate parity**  
    - **Refs:** `package.json` scripts, repo lint output  
    - **Status:** 🔄 Partial. Admin dashboards (`content-settings`, `dashboard`, `tenants/*`) now pass accessibility checks and remove bespoke badge classes; security helpers (`lib/security/*`), Supabase auth cache, validation middleware, and settings service shed their `any` usage and emit structured logs. `npm run lint` still fails because the campaigns app, OpenAI prompts/post-processing, and reliability helpers retain legacy `any`s, missing labels, and raw `<img>` usage.  
    - **Follow-up:** Extend the type/ARIA clean-up to `app/(authed)/campaigns/**`, `lib/openai/*`, `lib/reliability/*`, and remaining social client modules, then rerun the validation suite before restoring CI gates.  
    - **Checks:** `npm run lint`, `npx tsc --noEmit`, `npm test`, `next build` once warnings resolved.

---

## Verification Checklist

- [x] `next.config.ts` no longer ignores lint/TS errors; builds fail on type/lint issues.  
- [x] Cron queue cleanup works with and without `CRON_SECRET`, without forwarding `Bearer undefined`.  
- [x] OAuth flows reject forged state and succeed with valid nonce.  
- [x] `is_publishing` resets after every publish attempt (success/failure).  
- [x] Reliability wrappers applied to external calls touched during this pass.  
- [x] Notification API surfaces email failures and logs them.  
- [x] No `console.*` calls remain in server routes (follow-up required).  
- [x] New/updated tests cover cron and OAuth helpers (`npm test -- --runTestsByPath ...`).

---

## Suggested Work Breakdown

### Phase 1 – Logging & Reliability Foundations
1. Replace all remaining `console.*` usage in server routes (Stripe, social webhook/admin endpoints, campaign exports, etc.) with `createRequestLogger`/`logger`.  
2. Add an ESLint rule (e.g. `no-console` scoped to server code) once the sweep is complete.  
3. Wrap the remaining external integrations (Stripe APIs, Resend/email helpers, Supabase admin utilities) with `createServiceFetch` + `withRetry`, mirroring the new Facebook/GBP patterns.

### Phase 2 – Lint & Type Cleanup
1. ✅ Admin dashboards (`content-settings`, `dashboard`, `tenants/*`) now use ShadCN badges, labelled form controls, and stable hooks; lint blockers there resolved.  
2. ✅ Core libraries (`lib/security/approval-gates.ts`, `lib/security/cors.ts`, `lib/security/encryption.ts`, `lib/supabase/auth-cache.ts`, `lib/supabase/server.ts`, `lib/settings/service.ts`, `lib/utils/get-app-url.ts`, `lib/utils/text.ts`, `lib/validation/middleware.ts`, `lib/validation/schemas.ts`) converted from `any`/console usage to explicit types + structured logging.  
3. ⏳ Remaining debt lives in feature surfaces outside admin/security — notably `app/(authed)/campaigns/**`, `lib/openai/**`, `lib/reliability/**`, `lib/social/**`, `lib/usage.ts`, and `lib/observability/*`. These still raise `@typescript-eslint/no-explicit-any`, missing label/alt-text, and Tailwind class warnings. Continue sweeping these modules, then rerun `npm run lint` to verify a clean pass.

### Phase 3 – CI Gate Restoration & Follow-ups
1. 🔄 Run the full validation suite once the remaining campaign/OpenAI/reliability modules are cleaned.  
2. 🔄 Re-enable lint/type/test/build gates in CI (blocked until Phase 2 sweeps conclude).  
3. (Optional) Enhance API responses with provider-specific error codes (notifications) and consider additional integration tests for publish lock/unlock and notification failures.

Document owner: _Code review agent_. Please keep this file updated as fixes are merged.
