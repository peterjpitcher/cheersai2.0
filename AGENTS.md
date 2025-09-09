# Repository Guidelines

## Project Structure & Module Organization
- `app/`: Next.js App Router pages, layouts, and `app/api/*` routes.
- `components/`: Reusable UI and feature components (e.g., `components/ui/*`, `publish-modal.tsx`).
- `lib/`: Domain logic and services (`supabase/`, `reliability/`, `security/`, `openai/`, `utils/`, `validation/`). Import via `@/lib/...`.
- `__tests__/`: Jest tests by domain (e.g., `__tests__/lib/reliability/*`).
- `public/`: Static assets. `docs/`: Architecture, auth, and setup notes. `scripts/` and `supabase/`: ops and SQL/policies.

## Build, Test, and Development Commands
- `npm run dev`: Start local dev server at `http://localhost:3000` (Node 20).
- `npm run build` / `npm run start`: Build and run production output.
- `npm run lint`: ESLint (Next core-web-vitals + TS). Fix warnings before PRs.
- `npm test` | `npm run test:watch` | `npm run test:coverage`: Run Jest (jsdom) and coverage.
- `npx tsc --noEmit`: Type-check the project.
- `npm run lint:ci`: ESLint + Prettier + Stylelint in CI mode (no warnings allowed).
- `npm run check:bundle`: Enforce bundle-size budgets and server-only dep checks in client bundles.
- `npm run lint:api-runtime`: Verify every `app/api/**/route.ts` explicitly declares a `runtime` export.

Runtime/tooling
- Next.js 15, React 19, Node 20. Align local environment accordingly.
- TypeScript strict; prefer explicit types and safe narrowing.

## Coding Style & Naming Conventions
- TypeScript-first; prefer explicit types and `zod` schemas (`lib/validation/schemas.ts`).
- React components in `.tsx`; files typically kebab-case (e.g., `quick-post-modal.tsx`). Hooks use `use*` naming.
- User-facing copy: British English spelling (e.g., organise, colour). Keep US spelling in code/CSS.
- Dates/times: use `lib/utils/format.ts` helpers to ensure `en-GB` formatting.
- Tailwind for styling; keep classnames readable and co-locate styles in components.
- Lint and fix: `npm run lint` (use `--fix` if needed). Address `@typescript-eslint/*` and React hooks warnings.
- UI components: prefer `@/components/ui/*` (shadcn). Avoid legacy class names (`btn-*`, `.card`) per `check:legacy` script. Use `<BrandLogo variant="auth|header|icon" />` — not arbitrary variants.
- Avoid importing server-only modules in client components. The ESLint rule blocks `@/lib/server-only` from client.

## Testing Guidelines
- Framework: Jest + Testing Library (jsdom). Example: `__tests__/lib/reliability/retry.test.ts`.
- Test files: `*.test.ts(x)` under `__tests__` or co-located when small.
- Aim for ≥80% coverage across `app/`, `components/`, and `lib/` (see `jest.config.js`). Add tests for new/changed logic.
- Testing helpers: `types/testing.d.ts` loads `@testing-library/jest-dom` types. Prefer RTL for component tests.
- For compatibility, reliability tests expect backward-compatible APIs for retry/circuit breaker (see Reliability standards).

## Database & Migrations
- CLI: Supabase project files live in `supabase/`. Install the Supabase CLI locally.
- Create migration: `npx supabase migration new <name>`; Apply: `npx supabase db push`.
- Always test migrations locally; document changes and RLS updates in `docs/` if applicable.

## Commit & Pull Request Guidelines
- Commits: short imperative subject; optional emoji scope aligns with history (e.g., `✨ Add Instagram and GMB connection options`, `🔧 Fix OAuth callback flow`).
- PRs: clear description, linked issues, reproduction steps, and screenshots/GIFs for UI changes. Ensure `npm run lint` and `npm test` pass; update `docs/` and `.env.example` when behaviour or config changes.

## Security & Configuration Tips
- Copy `.env.example` → `.env.local`; never commit secrets. Use `NEXT_PUBLIC_*` only for values safe on the client.
- Multi-tenancy: Always include `tenant_id` filters in queries; RLS is enforced at DB level.
- Service role keys are server-only; never log OAuth tokens or API keys. Update `NEXT_PUBLIC_APP_URL` when deploying.
- Token security: Always store provider tokens encrypted using AES‑256‑GCM via `@/lib/security/encryption`.
  - Prefer `ENCRYPTION_KEY` (base64, 32 bytes) in development/tests; in production, use `ENCRYPTION_SECRET` or `SUPABASE_SERVICE_ROLE_KEY` for PBKDF2 key derivation.
  - Use `encryptToken/decryptToken`, `encryptObject/decryptObject`, and `safeCompare` for constant‑time equality.
- Supabase access:
  - Use `@/lib/supabase/server` for server routes and `@/lib/supabase/client` for browser.
  - Service-role client only in cron/admin/OAuth callbacks (never in client or regular user routes).
- Request IPs: Do not use `request.ip`. Derive IP from `x-forwarded-for` or `x-real-ip` headers.
- CORS: Apply `withCors()` or `applyCorsHeaders()` from `@/lib/security/cors` where cross-origin access is intended. Default to restrictive production options.

## Quality Gates
- Pass lint, type-check, tests, and build before PR. Maintain UK locale in user-facing text and avoid leaking secrets.

## API Route Standards
- Every API route in `app/api/**/route.ts` must export `export const runtime = 'nodejs'` unless explicitly edge.
- Validate inputs with Zod (`lib/validation/schemas.ts`); accept both camelCase and snake_case if routes bridge UI and DB fields (see admin prompts and guardrails routes for patterns).
- Rate limiting:
  - For general API endpoints, use `withRateLimit(request, handler, 'api')` or call `rateLimit(request, 'api')` and include headers.
  - For AI‑costly endpoints, use `enforceUserAndTenantLimits()` with tighter budgets per user/tenant.
- Reliability:
  - Wrap external calls with `withRetry()` + circuit breaker from `@/lib/reliability`.
  - Get breakers via `getCircuitBreaker(service)`; prefer timeouts from `lib/reliability/timeout.ts`.
  - Use `withPerformanceTracking()` or `PerformanceTracker` for critical ops.
- Observability: attach a request‑scoped logger via `createRequestLogger(request as Request)`; include `tenantId`, `requestId`, `traceId` where available.
- Tenancy and RLS: Always fetch the `tenant_id` from the authenticated user and scope all mutations/reads accordingly.

## Reliability & Rate Limiting
- Retry (`lib/reliability/retry.ts`):
  - Use `withRetry(fn, { maxAttempts, baseDelay, jitter })`. Default jitter is enabled.
  - `RetryError` is thrown on exhaustion; tests rely on this. Catch and map to UI‑safe errors.
- Circuit breaker (`lib/reliability/circuit-breaker.ts`):
  - Use `getCircuitBreaker('service')`. Backwards‑compatible `execute(service, fn, fallback?)` is available; preferred is `breaker.execute(fn)`.
  - Platform configs live in `PLATFORM_CIRCUIT_CONFIG`. Half‑open closes on first success.
- Timeouts (`lib/reliability/timeout.ts`):
  - Use `fetchWithTimeout` or `createServiceFetch(service)`; default per‑service budgets are defined (OpenAI, Stripe, Supabase, etc.).
- Rate limit (`lib/rate-limit.ts`):
  - Upstash Redis in production; in‑memory fallback in dev/tests. Expose helpers `withRateLimit`, `rateLimit`, and `enforceUserAndTenantLimits`.

## Agent Workflow (GitHub Issues)
- Source of truth: Treat GitHub issues as the canonical backlog. Pull details with `gh issue view` and use labels/acceptance criteria to scope work.
- Plan first: Create a short, verifiable plan (update via the plan tool) before coding. Keep 1 in-progress step; mark steps completed as you move.
- Work end‑to‑end: Implement the full scope (code, tests, docs, CI hooks) for each issue before handing off. Close the issue with a concise summary if acceptance criteria are met.
- Preambles: Before running grouped commands, post a brief preamble describing the next action bundle. Keep it 1–2 short sentences.
- Edits: Use `apply_patch` for focused, minimal diffs that follow existing style. Avoid unrelated refactors.
- Validation: Run lint, typecheck, targeted tests, and builds when the environment permits. Prefer fast, issue‑specific checks first.
- Approvals/sandbox: If network/filesystem writes or destructive actions require approval, pause and request it. Avoid risky operations without explicit consent.
- Commits/PRs: Don’t commit or push unless asked. When requested, group changes per issue and provide a clear PR summary with linked issues.
- Issue closure: When finished, close the GitHub issue via `gh issue close -c "summary"` including what changed and how acceptance criteria were satisfied.

### Quality & CI
- Gates: Ensure `lint:ci`, `typecheck`, `test`, and `next build` pass locally or in CI. Performance budgets are enforced via `check:bundle` (page gz ≤ 180 KB, no server‑only deps in client bundles).
- Artifacts: CI uploads coverage and `.next` build artifacts; Vercel preview deploy can be enabled with repo secrets.
- Build strictness: In CI, do not ignore TypeScript or ESLint errors during build.

### Observability & Errors
- Structured logging: Use `logger.event()` to emit JSON events with `area`, `op`, `platform`, `status`, `tenantId`, `requestId`, `traceId`, and `errorCode` when relevant. Prefer request‑scoped loggers from `createRequestLogger()`.
- Error codes: Map provider errors to stable `ErrorCode` values using `lib/errors.ts` and return sanitized, UI‑mappable messages. In the UI, convert `errorCode` to friendly text via `lib/client/error-codes.ts`.
- Error typing: Always log `Error` instances (convert `unknown` via `error instanceof Error ? error : new Error(String(error))`).

### Performance & Bundles
- Analyzer: Enable `ANALYZE=true` to inspect bundles when needed.
- Budgets: Keep initial page chunks under 180 KB gz. If you add heavy dependencies, code‑split with dynamic imports.

### Environment & Secrets
- Never commit secrets. Add placeholders to `.env.example` when introducing new env vars (e.g., `SENTRY_DSN`, provider keys).
- Follow RLS and tenancy rules in every DB interaction; include `tenant_id` constraints consistently.
- Stripe: API version pinned in client (`lib/stripe/client.ts`). Always unwrap joined `tenants` rows (some selects return arrays) before reading Stripe fields.
- Social (GBP/Twitter):
  - GBP: store account as resource name (`accounts/{id}`) and location as `locations/{id}`; tokens are encrypted; handle quota errors by creating pending connections.
  - Twitter: tokens encrypted; log Postgrest errors without relying on non‑standard fields.

### Definition of Done (per issue)
- Code implemented and scoped to the issue.
- Lint/typecheck/tests/build pass; budgets respected.
- Docs updated (README/AGENTS/CONTRIBUTING as needed); `.env.example` updated for new configuration.
- Observability in place for new routes (events, error mapping, captures).
- Issue closed on GitHub with a succinct summary and acceptance confirmation.
