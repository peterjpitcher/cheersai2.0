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

## Coding Style & Naming Conventions
- TypeScript-first; prefer explicit types and `zod` schemas (`lib/validation/schemas.ts`).
- React components in `.tsx`; files typically kebab-case (e.g., `quick-post-modal.tsx`). Hooks use `use*` naming.
- User-facing copy: British English spelling (e.g., organise, colour). Keep US spelling in code/CSS.
- Dates/times: use `lib/utils/format.ts` helpers to ensure `en-GB` formatting.
- Tailwind for styling; keep classnames readable and co-locate styles in components.
- Lint and fix: `npm run lint` (use `--fix` if needed). Address `@typescript-eslint/*` and React hooks warnings.

## Testing Guidelines
- Framework: Jest + Testing Library (jsdom). Example: `__tests__/lib/reliability/retry.test.ts`.
- Test files: `*.test.ts(x)` under `__tests__` or co-located when small.
- Aim for ≥80% coverage across `app/`, `components/`, and `lib/` (see `jest.config.js`). Add tests for new/changed logic.

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

## Quality Gates
- Pass lint, type-check, tests, and build before PR. Maintain UK locale in user-facing text and avoid leaking secrets.

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

### Observability & Errors
- Structured logging: Use `logger.event()` to emit JSON events with `area`, `op`, `platform`, `status`, `tenantId`, `requestId`, `traceId`, and `errorCode` when relevant. Prefer request‑scoped loggers from `createRequestLogger()`.
- Error codes: Map provider errors to stable `ErrorCode` values using `lib/errors.ts` and return sanitized, UI‑mappable messages. In the UI, convert `errorCode` to friendly text via `lib/client/error-codes.ts`.

### Performance & Bundles
- Analyzer: Enable `ANALYZE=true` to inspect bundles when needed.
- Budgets: Keep initial page chunks under 180 KB gz. If you add heavy dependencies, code‑split with dynamic imports.

### Environment & Secrets
- Never commit secrets. Add placeholders to `.env.example` when introducing new env vars (e.g., `SENTRY_DSN`, provider keys).
- Follow RLS and tenancy rules in every DB interaction; include `tenant_id` constraints consistently.

### Definition of Done (per issue)
- Code implemented and scoped to the issue.
- Lint/typecheck/tests/build pass; budgets respected.
- Docs updated (README/AGENTS/CONTRIBUTING as needed); `.env.example` updated for new configuration.
- Observability in place for new routes (events, error mapping, captures).
- Issue closed on GitHub with a succinct summary and acceptance confirmation.
