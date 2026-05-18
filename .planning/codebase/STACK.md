# Technology Stack

**Analysis Date:** 2026-05-18

## Languages

**Primary:**
- TypeScript 5.x — Full codebase, strict mode enabled
- JavaScript (ES2017+) — Next.js configuration, build scripts

**Secondary:**
- SQL — Supabase PostgreSQL migrations and queries
- HTML/CSS — Rendered via React/Tailwind

## Runtime

**Environment:**
- Node.js (LTS recommended) — Server runtime via Next.js
- Browser (modern) — Client runtime via React 19

**Package Manager:**
- npm — Primary (v9+)
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core:**
- Next.js 16.1.0 — Full-stack App Router with server components and actions
- React 19.2.3 — UI rendering, hooks, server/client components
- TypeScript 5.x — Type safety, strict mode

**UI & Styling:**
- Tailwind CSS 4.x — Utility-first CSS framework
- Tailwind Merge 3.4.0 — Dynamic class merging without conflicts
- Class Variance Authority 0.7.1 — Component variant management
- Radix UI (dialog, label, separator, slot, tooltip) 1.1.x — Accessible components
- Lucide React 0.562.0 — Icon library
- Framer Motion 12.23.26 — Page transitions and micro-interactions

**Forms & Validation:**
- React Hook Form 7.69.0 — Efficient form state management
- Zod 4.2.1 — Schema validation and type inference
- @hookform/resolvers 5.2.2 — Zod integration with React Hook Form

**Data Management:**
- TanStack React Query 5.90.x — Server state management, caching, background sync
- TanStack React Query DevTools 5.91.x — Development debugging

**Testing:**
- Vitest 4.0.16 — Test runner (fast, Vite-native)
- @testing-library/react 16.3.2 — Component testing utilities
- @testing-library/jest-dom 6.9.1 — DOM matchers
- jsdom 29.1.1 — DOM implementation for Node.js tests

**Build/Dev:**
- Next.js internal Webpack 5 — Configured via `npm run build --webpack`
- Tailwind PostCSS 4.x — CSS processing pipeline
- Lightning CSS (Darwin ARM64) 1.30.2 — Optional fast CSS transpiler

**Build/Development Tools:**
- tsx 4.21.0 — TypeScript execution for scripts (ops, seeds)
- ESLint 9.x — Linting with Next.js config
- dotenv 17.2.3 — Environment variable loading

## Key Dependencies

**Critical:**
- @supabase/supabase-js 2.89.0 — PostgreSQL client with auth, RLS support
- @supabase/ssr 0.8.0 — Server-side rendering helpers for cookie-based auth
- openai 6.15.0 — OpenAI API client for content generation
- resend 6.6.0 — Transactional email service
- luxon 3.7.2 — Date/time library with timezone support (Europe/London default)
- libphonenumber-js — Phone number normalization (referenced in standards, check imports)

**Infrastructure:**
- p-limit 7.3.0 — Promise concurrency limiting for bulk operations
- satori 0.26.0 — HTML-to-image rendering (banner/social image generation)
- sharp 0.34.5 — Image processing and optimization (serverExternalPackage in Next.js)
- text-to-svg 3.1.5 — Text rendering for image generation
- clsx 2.1.1 — Conditional class name composition

## Configuration

**Environment:**
- `src/env.ts` — Zod-validated environment variables (server + client scoped)
- Two client patterns: anon-key (user auth) and service-role (system operations)
- Production validation enforces required vars: `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `FACEBOOK_APP_SECRET`, `GOOGLE_MY_BUSINESS_CLIENT_ID/SECRET`, `RESEND_API_KEY`, `RESEND_FROM`, `OPENAI_API_KEY`

**Build:**
- `next.config.ts` — Next.js configuration (sharp as external package, no index crawling)
- `tsconfig.json` — TypeScript strict mode, path aliases (`@/*` → `./src/*`)
- `vitest.config.ts` — Test runner config with path aliases and module mocks
- `postcss.config.mjs` — Tailwind CSS PostCSS pipeline
- `eslint.config.mjs` — ESLint 9 flat config with Next.js rules

## Platform Requirements

**Development:**
- Node.js LTS (v18+)
- npm v9+
- Supabase local dev CLI (optional, for migrations)
- Modern IDE with TypeScript support

**Production:**
- Deployed on Vercel (Next.js native)
- Supabase PostgreSQL backend
- Environment variables for all external services configured

## Deployment

**Hosting:**
- Vercel (Next.js native platform)

**Database:**
- Supabase PostgreSQL (remote, RLS enabled)

**CI/CD:**
- `npm run ci:verify` → Full pipeline: lint → typecheck → test → build
- All four gates must pass before merge

---

*Stack analysis: 2026-05-18*
