Contributing Guidelines

Prerequisites
- Node 20.x, npm 10.x; Next.js 15, React 19.
- Copy `.env.example` to `.env.local` and fill required values.

Development
- Install dependencies: `npm ci`
- Run dev server: `npm run dev`
- Lint locally: `npm run lint && npm run lint:ci`
- Type-check: `npm run typecheck`
- Tests: `npm test` (see below)

Build & CI Gates
- Local gates before PR: `npm run lint:ci && npm run typecheck && npm test && npm run build`
- Bundle budget: `npm run check:bundle` (keep gz page chunks ≤ 180 KB, no server-only deps in client)
- API runtime: `npm run lint:api-runtime` (every `app/api/**/route.ts` declares a `runtime` export)

Coding Standards
- TypeScript-first; explicit types. Validate inputs with Zod (see `lib/validation/schemas.ts`).
- British English in user-facing copy (e.g., colour, organise).
- Use Tailwind + shadcn/ui components. Avoid legacy utility classes (see `npm run check:legacy`).
- Avoid importing server-only modules (`@/lib/server-only`) from client components.
- Dates/times via `lib/datetime`/`lib/utils/format` helpers to ensure `en-GB` formatting.

API Route Standards
- Export `export const runtime = 'nodejs'` unless explicitly using edge.
- Validate request bodies/params with Zod; prefer schemas from `lib/validation/schemas.ts`.
- Tenancy: always derive `tenant_id` from the authenticated user and scope queries.
- Rate limiting: use `withRateLimit`/`rateLimit` or `enforceUserAndTenantLimits` for AI‑costly endpoints.
- Reliability: wrap external calls with `withRetry()` and circuit breaker from `lib/reliability`. Use `fetchWithTimeout`.
- Observability: create a request-scoped logger via `createRequestLogger(request as Request)` and include `tenantId`, `requestId`, `traceId` where available.

Security
- Never commit secrets. Update `.env.example` when adding new env vars.
- Token handling: use `@/lib/security/encryption` (`encryptToken`, `decryptToken`, `safeCompare`).
- IP detection: do not use `request.ip`; read `x-forwarded-for`/`x-real-ip` headers.
- CORS: use `lib/security/cors` helpers with restrictive production defaults.

Database & Migrations
- Create migration: `npx supabase migration new <name>`; apply: `npx supabase db push`.
- Test locally before PR; document schema/RLS changes in `docs/`.

Design System & Visual Regression
- Storybook: `npm run storybook`; stories live in `stories/` and component folders.
- Chromatic publishes builds on PRs (requires `CHROMATIC_PROJECT_TOKEN`). Review and approve diffs.

Navigation Labels
- Edit nav copy in `lib/nav.ts`. Header and sub-nav consume from here.

Testing
- Unit tests: `npm test`, `npm run test:watch`. Maintain coverage (≥80%) across app/components/lib.
- Reliability tests: keep compatibility with retry/circuit breaker APIs (see `lib/reliability`).

PR Checklist (summary)
- [ ] `npm run lint:ci && npm run typecheck && npm test && npm run build` pass locally
- [ ] `npm run check:bundle` passes (bundle budgets)
- [ ] API inputs validated with Zod; `runtime` exported in API routes
- [ ] Tenancy enforced (`tenant_id` scoped queries)
- [ ] External calls use retry/timeout/circuit breaker where appropriate
- [ ] Observability/structured logging present; errors mapped to stable codes
- [ ] No secrets committed; `.env.example` updated if needed
- [ ] Docs updated (README/AGENTS/CONTRIBUTING) if behaviour/config changed
- [ ] UI adheres to shadcn/ui; legacy classes removed; Chromatic diffs approved

Refer to `AGENTS.md` for the full set of standards enforced in this repository.
