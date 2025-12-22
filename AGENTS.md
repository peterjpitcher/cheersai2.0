# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains the Next.js app: routes in `src/app`, shared UI in `src/components`, domain logic in `src/lib`, and feature bundles in `src/features`.
- `tests/` mirrors `src/` and holds Vitest specs.
- `supabase/` stores Edge Functions, SQL migrations, and Supabase config.
- `public/` hosts static assets (favicons, images).
- `vercel.json` defines the Vercel Cron schedule that calls `/api/cron/publish`.

## Build, Test, and Development Commands
- `npm run dev` starts the Next.js dev server with hot reload.
- `npm run build` creates the production build and runs type/static analysis.
- `npm run lint:ci` and `npm run typecheck` run ESLint and TypeScript without emitting output.
- `CI=1 npm test -- --run` (or `npm run test:ci`) executes Vitest in non-interactive mode.

## Coding Style & Naming Conventions
- Follow the ESLint + TypeScript rules in `eslint.config.mjs`.
- Indentation is 2 spaces; prefer named exports.
- Use descriptive filenames (`planner-calendar.tsx`), PascalCase for components, camelCase for helpers, and SCREAMING_SNAKE_CASE for constants.
- Tailwind v4 is the default styling approach; group classes by purpose (layout → spacing → color).

## Testing Guidelines
- Vitest is the test framework; place specs in `tests/` with the `*.test.ts` suffix.
- Mirror module paths (`src/lib/foo.ts` → `tests/lib/foo.test.ts`).
- For long runs: `CI=1 npm test -- --run > test-output.log 2>&1`.

## Commit & Pull Request Guidelines
- Use Conventional Commits (`feat:`, `fix:`, `style:`) and keep messages under 72 chars.
- In PRs, describe scope, key changes, and tests; add screenshots/logs when UI or Cron/ops changes.

## Security & Configuration Tips
- Secrets live in `.env.local` and should never be committed.
- Cron requests require `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, and `NEXT_PUBLIC_SUPABASE_URL`.
- `src/app/api/cron/publish` bridges Vercel Cron to the Supabase `publish-queue` function.
