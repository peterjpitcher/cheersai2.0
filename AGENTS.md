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
