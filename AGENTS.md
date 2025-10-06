# Repository Guidelines

## Project Structure & Module Organization
- `src/` houses application code: Next.js routes under `src/app`, reusable UI in `src/components`, domain logic in `src/lib`, and feature bundles in `src/features`.
- `src/app/api/cron/publish` bridges Vercel Cron to the Supabase `publish-queue` function; it requires `CRON_SECRET` and forwards to Supabase using the service role key.
- `tests/` contains Vitest suites; mirror the `src/` tree when adding coverage.
- `supabase/` stores Edge Functions, SQL migrations, and config used for Supabase deployments.
- `public/` holds static assets served as-is (e.g., favicons, images).
- `vercel.json` declares scheduled jobs that Vercel Cron executes (currently `/api/cron/publish` every minute).

## Build, Test, and Development Commands
- `npm run dev` — start the Next.js dev server with hot reload.
- `npm run build` — generate the production build (runs type check and static analysis during the process).
- `npm run lint:ci` / `npm run typecheck` — run ESLint (max-warnings=0) and TypeScript without emitting output.
- `CI=1 npm test -- --run` (or `npm run test:ci`) — execute the Vitest suite in non-interactive mode; use the `CI=1` flag for consistent reporter behaviour.

## Coding Style & Naming Conventions
- Follow the existing ESLint + TypeScript configuration (see `eslint.config.mjs`). Indentation is two spaces; prefer named exports and descriptive filenames (e.g., `planner-calendar.tsx`).
- Tailwind v4 utilities are the default styling approach; keep classes declarative and grouped by purpose (layout → spacing → colour).
- Use PascalCase for React components, camelCase for helpers, and SCREAMING_SNAKE_CASE for constants.

## Testing Guidelines
- Vitest is the unit/integration framework; place new specs in `tests/` with the suffix `.test.ts` and mirror module names (e.g., `plannerActivity.test.ts`).
- Aim to cover new server actions, Supabase interactions, and scheduling utilities; add regression tests for bug fixes.
- For long test runs, redirect output (`CI=1 npm test -- --run > test-output.log 2>&1`) and inspect the log.

## Commit & Pull Request Guidelines
- Git history follows conventional commits (`feat:`, `fix:`, `style:`). Match that prefix and keep messages imperative and <72 chars.
- PRs should describe scope, list key changes, note testing performed, and include screenshots or logs if UI or ops behaviour changed.

## Security & Configuration Tips
- Sensitive environment keys live in `.env.local`; never commit them. Mirror required keys (`CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`) into Vercel project settings so cron requests authenticate correctly.
- Supabase service calls require valid `SUPABASE_SERVICE_ROLE_KEY`; check `src/lib/supabase/service.ts` before running scripts.
