# CLAUDE.md — CheersAI 2.0

This file provides project-specific guidance. See the workspace-level `CLAUDE.md` one directory up for shared conventions.

## Quick Profile

- **Framework**: Next.js 16.1, React 19.2
- **Test runner**: Vitest
- **Database**: Supabase (PostgreSQL + RLS)
- **Key integrations**: OpenAI, Resend Email, Framer Motion animations, React Query, Social media APIs (Instagram, Facebook, Google My Business)
- **Size**: ~158 files in src/

## Commands

```bash
npm run dev              # Start development server
npm run build            # Production build
npm run start            # Start production server
npm run lint             # ESLint check (max-warnings=0 in CI)
npm run test             # Vitest run (single pass)
npm run test:watch       # Vitest watch mode
npm run typecheck        # TypeScript check (tsc --noEmit)
npm run ci:verify        # Full CI pipeline: lint + typecheck + test + build
npm run ops:*            # Operational scripts (backfill, link-auth, regenerate derivatives)
```

## Architecture

**Route Structure**: App Router with next.js 16 conventions. Key sections:
- `/auth` — Sign in, sign up, password reset (Supabase JWT + cookies)
- `/dashboard` — Main workspace for authenticated users
- `/api/` — Webhooks and integrations (Instagram, Facebook callbacks)

**Auth**: Supabase Auth with JWT + HTTP-only cookies. Auth context in `src/lib/auth/` provides user state and permissions. All server actions re-verify auth server-side.

**Database**: Supabase PostgreSQL with RLS enabled. Service-role operations for system tasks only (backfills, crons). Client operations use anon-key client.

**Key Integrations**:
- **OpenAI**: `src/lib/` — content generation and AI features
- **Social APIs**: Instagram (webhooks), Facebook (Graph API), Google My Business integrations
- **Resend**: Email notifications and transactional email
- **React Query**: Data fetching with custom hooks in `src/lib/`
- **Framer Motion**: Page transitions and animations

**Data Flow**: Server actions handle mutations (auth, content operations). Client components use React Query for fetching. All responses validated with Zod.

## Key Files

| Path | Purpose |
|------|---------|
| `src/types/` | TypeScript definitions (database, API contracts) |
| `src/lib/auth/` | Authentication, server-side auth helpers, rate limiting |
| `src/lib/publishing/` | Publishing queue and preflight checks |
| `src/lib/scheduling/` | Event conflict detection, scheduling logic |
| `src/lib/planner/` | Data fetching for planner features |
| `src/lib/settings/` | Settings data and user preferences |
| `src/env.ts` | Environment variable validation (Zod) |
| `src/app/api/` | Webhooks (Instagram, Facebook, email) |
| `src/features/` | Feature-specific components and logic |
| `supabase/migrations/` | Database schema migrations |
| `vitest.config.ts` | Vitest configuration |

## Environment Variables

| Var | Purpose |
|-----|---------|
| `OPENAI_API_KEY` | OpenAI API key for content generation |
| `RESEND_API_KEY` | Resend email service key |
| `RESEND_FROM` | Email sender address |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server-only) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public) |
| `NEXT_PUBLIC_SITE_URL` | App base URL for redirects/links |
| `FACEBOOK_APP_ID` | Facebook app ID (public) |
| `FACEBOOK_APP_SECRET` | Facebook app secret (server-only) |
| `INSTAGRAM_APP_ID` | Instagram app ID (public) |
| `INSTAGRAM_APP_SECRET` | Instagram app secret (server-only) |
| `INSTAGRAM_VERIFY_TOKEN` | Instagram webhook verification token |
| `GOOGLE_MY_BUSINESS_CLIENT_ID` | Google My Business OAuth client ID |
| `GOOGLE_MY_BUSINESS_CLIENT_SECRET` | Google My Business OAuth secret |
| `ALERTS_SECRET` | Internal webhook secret for alerts |
| `CRON_SECRET` | Internal webhook secret for cron jobs |
| `ENABLE_CONNECTION_DIAGNOSTICS` | Enable debug logging for integrations |
| `VERCEL_OIDC_TOKEN` | Vercel deployment OIDC (for Vercel functions) |

## Project-Specific Rules / Gotchas

### Env Validation
- `src/env.ts` uses Zod to validate all environment variables at startup
- Missing required vars will throw at build/start time
- Always add new vars to `src/env.ts` before using in code

### Social Media Integrations
- Instagram, Facebook, Google My Business require OAuth tokens and refresh logic
- Webhook verification tokens must match config exactly
- Rate limits enforced per platform — check `src/lib/auth/rate-limit.ts`

### Publishing Queue
- `src/lib/publishing/preflight.ts` validates posts before scheduling
- `src/lib/publishing/queue.ts` manages async publishing
- Always check preflight results before queuing posts

### Scheduling Logic
- `src/lib/scheduling/conflicts.ts` prevents double-booking
- `src/lib/scheduling/materialise.ts` expands recurring events
- Timezone handling uses Luxon library (see workspace CLAUDE.md)

### Testing with Vitest
- Test files coexist with source: `src/**/*.test.ts(x)`
- Mock external services (OpenAI, Resend, Supabase)
- Use factories for test data, not inline object literals
- Minimum 80% coverage on business logic

### Framer Motion Usage
- Used for page transitions and micro-interactions
- Keep animations performant (prefer transform, opacity)
- Test animations disabled in unit tests

### Supabase RLS
- All queries respect RLS — use service-role only for system operations
- Service-role operations documented with comments: `// admin operation: [reason]`
- Never disable RLS "temporarily"

### Resend Email
- All transactional email goes through Resend
- Email templates should be tested with `RESEND_API_KEY` set
- From address format: `"Name (email@domain)"`

### Operational Scripts
- `ops:backfill-connections` — sync social connections
- `ops:backfill-link-in-bio-url` — update profile links
- `ops:link-auth-user` — link Supabase auth to business profile
- `ops:regenerate-story-derivatives` — rebuild cached story variants
- Run in test environment first, then production with caution

### CI Pipeline
- `npm run ci:verify` runs full suite: lint → typecheck → test → build
- All four steps must pass before merge
- No console warnings allowed in CI

### Next.js 16 Specifics
- Using latest App Router patterns
- Server actions with 'use server' directive
- Streaming responses supported but not heavily used
- Build optimization enabled by default

<!-- GSD:project-start source:PROJECT.md -->
## Project

**CheersAI 2.0 — Complete Redesign**

CheersAI is an AI-powered social media management platform for hospitality venues (pubs, restaurants, bars). Owners create content once — the AI adapts it per platform (Facebook, Instagram, Google Business Profile) — and the publishing pipeline handles scheduling, preflight checks, and delivery. This is a ground-up rebuild of v1, driven by a comprehensive 12-document design audit that identified 6 critical security issues, 28 high-severity problems, and 30+ minor issues making v1 unsafe for production scale.

**Core Value:** An owner can create a single piece of content, have AI generate platform-specific copy, and reliably publish it to Facebook, Instagram, and Google Business Profile — without manual intervention after approval.

### Constraints

- **Tech stack**: Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, Supabase, deployed on Vercel
- **Replace in place**: v1 goes offline while v2 is built in the same repository
- **Ship complete**: entire redesign ships together, no partial releases
- **Security first**: all 6 critical issues (C-1 through C-6) must be resolved before any feature work
- **Europe/London timezone**: hardcoded, no multi-timezone support
- **Platform APIs**: Facebook, Instagram, GBP — each with different rate limits, token lifecycles, and content formats
- **Background jobs**: QStash (not Vercel Cron) for publish pipeline reliability
- **Observability**: Axiom for structured logging (new addition to stack)
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5.x — Full codebase, strict mode enabled
- JavaScript (ES2017+) — Next.js configuration, build scripts
- SQL — Supabase PostgreSQL migrations and queries
- HTML/CSS — Rendered via React/Tailwind
## Runtime
- Node.js (LTS recommended) — Server runtime via Next.js
- Browser (modern) — Client runtime via React 19
- npm — Primary (v9+)
- Lockfile: `package-lock.json` (present)
## Frameworks
- Next.js 16.1.0 — Full-stack App Router with server components and actions
- React 19.2.3 — UI rendering, hooks, server/client components
- TypeScript 5.x — Type safety, strict mode
- Tailwind CSS 4.x — Utility-first CSS framework
- Tailwind Merge 3.4.0 — Dynamic class merging without conflicts
- Class Variance Authority 0.7.1 — Component variant management
- Radix UI (dialog, label, separator, slot, tooltip) 1.1.x — Accessible components
- Lucide React 0.562.0 — Icon library
- Framer Motion 12.23.26 — Page transitions and micro-interactions
- React Hook Form 7.69.0 — Efficient form state management
- Zod 4.2.1 — Schema validation and type inference
- @hookform/resolvers 5.2.2 — Zod integration with React Hook Form
- TanStack React Query 5.90.x — Server state management, caching, background sync
- TanStack React Query DevTools 5.91.x — Development debugging
- Vitest 4.0.16 — Test runner (fast, Vite-native)
- @testing-library/react 16.3.2 — Component testing utilities
- @testing-library/jest-dom 6.9.1 — DOM matchers
- jsdom 29.1.1 — DOM implementation for Node.js tests
- Next.js internal Webpack 5 — Configured via `npm run build --webpack`
- Tailwind PostCSS 4.x — CSS processing pipeline
- Lightning CSS (Darwin ARM64) 1.30.2 — Optional fast CSS transpiler
- tsx 4.21.0 — TypeScript execution for scripts (ops, seeds)
- ESLint 9.x — Linting with Next.js config
- dotenv 17.2.3 — Environment variable loading
## Key Dependencies
- @supabase/supabase-js 2.89.0 — PostgreSQL client with auth, RLS support
- @supabase/ssr 0.8.0 — Server-side rendering helpers for cookie-based auth
- openai 6.15.0 — OpenAI API client for content generation
- resend 6.6.0 — Transactional email service
- luxon 3.7.2 — Date/time library with timezone support (Europe/London default)
- libphonenumber-js — Phone number normalization (referenced in standards, check imports)
- p-limit 7.3.0 — Promise concurrency limiting for bulk operations
- satori 0.26.0 — HTML-to-image rendering (banner/social image generation)
- sharp 0.34.5 — Image processing and optimization (serverExternalPackage in Next.js)
- text-to-svg 3.1.5 — Text rendering for image generation
- clsx 2.1.1 — Conditional class name composition
## Configuration
- `src/env.ts` — Zod-validated environment variables (server + client scoped)
- Two client patterns: anon-key (user auth) and service-role (system operations)
- Production validation enforces required vars: `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `FACEBOOK_APP_SECRET`, `GOOGLE_MY_BUSINESS_CLIENT_ID/SECRET`, `RESEND_API_KEY`, `RESEND_FROM`, `OPENAI_API_KEY`
- `next.config.ts` — Next.js configuration (sharp as external package, no index crawling)
- `tsconfig.json` — TypeScript strict mode, path aliases (`@/*` → `./src/*`)
- `vitest.config.ts` — Test runner config with path aliases and module mocks
- `postcss.config.mjs` — Tailwind CSS PostCSS pipeline
- `eslint.config.mjs` — ESLint 9 flat config with Next.js rules
## Platform Requirements
- Node.js LTS (v18+)
- npm v9+
- Supabase local dev CLI (optional, for migrations)
- Modern IDE with TypeScript support
- Deployed on Vercel (Next.js native)
- Supabase PostgreSQL backend
- Environment variables for all external services configured
## Deployment
- Vercel (Next.js native platform)
- Supabase PostgreSQL (remote, RLS enabled)
- `npm run ci:verify` → Full pipeline: lint → typecheck → test → build
- All four gates must pass before merge
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- Components: PascalCase (e.g., `BannerOverlay.tsx`, `DeleteCampaignButton.tsx`)
- Utilities and helpers: camelCase (e.g., `palette.ts`, `validation.ts`, `time-utils.ts`)
- Test files: co-located alongside source with `.test.ts` or `.test.tsx` suffix (e.g., `palette.test.ts`, `banner-overlay.test.tsx`)
- Types: `snake_case` in database context, `camelCase` in TypeScript interfaces
- Server actions: camelCase with verb prefix (e.g., `createTournament`, `deleteCampaign`)
- Utility functions: camelCase verb-first pattern
- React Components: PascalCase
- Hooks: `use` prefix (e.g., `use-now-minute.test.tsx`)
- camelCase: standard for all variables
- Constants: UPPERCASE_SNAKE_CASE (e.g., `BANNER_LABEL_REPEAT_COUNT`, `DEFAULT_TIMEZONE`)
- React props: camelCase (e.g., `mediaUrl`, `postTemplate`, `houseRulesText`)
- Interfaces: PascalCase (e.g., `Tournament`, `CampaignPerformanceMetrics`)
- Type aliases for unions: PascalCase (e.g., `TournamentStatus`, `CampaignObjective`)
- Database domain types separate: snake_case in DB, camelCase in TS (converted via `fromDb<T>`)
- Enum-like types stored as unions: `type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED'`
## Code Style
- Prettier (implicit via Next.js config)
- 2-space indentation
- Single quotes for strings
- Trailing commas in multi-line objects/arrays
- Line length: no hard limit enforced, but keep readable
- ESLint config: `eslint.config.mjs` with Next.js presets (`eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`)
- Strict TypeScript: `tsconfig.json` has `"strict": true`
- No `any` types unless explicitly justified with a comment
- `skipLibCheck: true` (skip type checking of node_modules)
- `isolatedModules: true` (each file is independently valid)
- Next.js core web vitals (image optimization, font optimization, script loading)
- TypeScript strict mode rules
- React hooks rules (built-in to next/typescript preset)
- Accessibility rules via JSX A11y plugin
## Import Organization
- `@/*` → `./src/*` (defined in `tsconfig.json` and `vitest.config.ts`)
- Example: `import { formatFriendlyTime } from '@/lib/utils/date'`
- Barrel exports not heavily used; direct imports preferred
- Internal helpers kept private (no `export`)
- Type exports always use `import type { ... }`
## Error Handling
- Server actions return `Promise<{ success?: boolean; error?: string }>` with optional additional fields
- Input validation via Zod schemas (e.g., `tournamentCreateSchema`, `fixtureCreateSchema`)
- Parse before using: `const parsed = schema.parse(input)` — throws if invalid
- Try/catch in server actions to catch Zod errors and Supabase errors
- Errors logged with context helpers (e.g., `tournamentDebugError`, `redactId`)
- No silent failures: always surface errors to caller via return value
## Logging
- Debug helpers with context: `tournamentDebug(redactId(tournamentId), 'doing work')`
- Error helpers: `tournamentDebugError(redactId(tournamentId), err)`
- All console calls should have descriptive context (what operation, which resource)
- Use `redactId()` to anonymize sensitive IDs in logs
- Entry/exit of long-running operations
- Important state transitions (draft → active)
- Errors with full context for debugging
- External API calls and responses (when safe)
## Comments
- Algorithm explanations (especially date/timezone logic)
- Non-obvious business rules or constraints
- Workarounds with reason for workaround
- Complex regex patterns or data transformations
- Date/timezone handling edge cases (e.g., GMT vs BST transitions)
- Exported functions have single-line or multi-line JSDoc
- Parameters documented only if non-obvious
- Example from codebase:
## Function Design
- Aim for 20-50 lines (excluding comments)
- Extract helper functions aggressively for readability
- Single responsibility principle: one function, one job
- Max 3-4 parameters; use objects for related parameters
- Always typed explicitly: `function foo(id: string, count: number): Promise<Result>`
- Optional/nullable parameters at end, use `?` and `default` values
- Objects destructured at function signature when appropriate
- Always explicitly typed on exported functions
- Server actions return wrapped success/error objects: `Promise<{ success?: boolean; error?: string }>`
- Query functions return typed data (via `fromDb<T>`) or null
- Validators return structured result objects with `ready: boolean` and `missing: string[]`
## Module Design
- Named exports for everything; no default exports
- Private helpers use no `export` keyword
- Barrel files (`index.ts`) not commonly used; direct imports preferred
- Feature-specific code in `src/features/[feature]/`
- Shared utilities in `src/lib/[domain]/`
- Types in `src/types/[domain].ts` (centralized)
- Server actions in `src/app/actions/[domain].ts`
- Components in `src/components/` or `src/features/`
## Type Patterns
- All database types centralized in `src/types/database.ts` (or domain-specific: `tournament.ts`, `campaigns.ts`)
- Database columns: `snake_case`
- TypeScript properties: `camelCase`
- Conversion always via `fromDb<T>(dbRow)` utility
- Named interface, never inline anonymous object for props
- Convention: `interface ComponentNameProps { ... }`
- Example:
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- **Server-first by default** — Server Components for data fetching; Client Components only for interactivity
- **Server Actions for mutations** — All state changes via `'use server'` functions with auth re-verification
- **Supabase RLS-enforced** — Client queries respect Row-Level Security; service-role admin client isolated
- **Feature-first directory structure** — Shared `lib/` utilities, feature-specific components in `features/`
- **Centralised type definitions** — Single source of truth in `src/types/`
## Layers
- Purpose: React components for UI rendering
- Location: `src/components/`, `src/features/`
- Contains: Server Components, Client Components, UI primitives (buttons, cards, dialogs)
- Depends on: `lib/auth/`, `lib/utils`, design tokens in `globals.css`
- Used by: Route handlers in `src/app/`
- Purpose: Feature-specific logic and components grouped by domain
- Location: `src/features/` (campaigns, create, library, planner, connections, settings, reviews)
- Contains: Domain-specific forms, components, utilities (banner configs, content schedules)
- Depends on: `lib/` utilities, types, Supabase client
- Used by: Route pages and layouts
- Purpose: Core domain logic, data transformations, external integrations
- Location: `src/lib/` (ai, banner, campaigns, create, scheduling, tournament, etc.)
- Contains: OpenAI integration, Meta API client, scheduling algorithms, content generation, conflict detection
- Depends on: Supabase client, external SDKs (OpenAI, Resend, libphonenumber-js)
- Used by: Server actions, API routes, features
- Purpose: Database and external service interactions
- Location: `src/lib/supabase/`, `src/lib/auth/`, `src/lib/*/data.ts` or `*/queries.ts`
- Contains: Supabase client factories (server, service-role), auth helpers, query builders
- Depends on: Supabase SDK, environment variables
- Used by: Business logic layer
- Purpose: Authenticated mutation entry points with auth re-verification
- Location: `src/app/actions/`, `src/app/(app)/*/actions.ts`
- Contains: Campaign operations, tournament publishing, reviews, content creation
- Depends on: `requireAuthContext()`, business logic
- Used by: Client components via form submissions
- Purpose: Webhooks, OAuth callbacks, cron jobs, internal integrations
- Location: `src/app/api/`
- Contains: Instagram/Facebook webhooks, OAuth state handlers, Vercel cron triggers
- Depends on: Supabase service-role client, external API clients
- Used by: External services, cron triggers
## Data Flow
- **Authentication:** Context Provider in `src/components/providers/auth-provider.tsx` — read-only, server-initialized
- **Data fetching:** React Query via `QueryClientProvider` in `src/components/providers/app-providers.tsx`
- **UI state:** Local component state (forms, modals, toggles)
- **Server state:** Supabase database with RLS policies enforcing account-level isolation
- **Toast notifications:** Sonner via `ToastProvider` in `src/components/providers/toast-provider.tsx`
## Key Abstractions
- Purpose: Type-safe mutation entry points with built-in auth verification
- Examples: `src/app/actions/tournament.ts`, `src/app/(app)/campaigns/actions.ts`
- Pattern: `'use server'` decorator, `requireAuthContext()` call, Zod schema validation, Supabase service-role write, `revalidatePath()` cache invalidation, `logAuditEvent()` audit trail
- Purpose: Consistent client initialization for different auth contexts
- Examples: `createServerSupabaseClient()`, `createServiceSupabaseClient()`, `getSupabaseBrowserClient()`
- Pattern: Clients imported from `src/lib/supabase/{server|service|client}.ts`; anon-key respects RLS, service-role bypasses
- Purpose: Convert database snake_case columns to camelCase TypeScript types
- Examples: `fromDb<Tournament>()`, `fromDb<CampaignDashboardModel>()`
- Pattern: Wraps raw DB row, converts keys, parses ISO date strings to Date objects
- Purpose: Manage event timing, timezone conversions, prevent double-booking
- Examples: `src/lib/scheduling/conflicts.ts`, `src/lib/scheduling/materialise.ts`
- Pattern: Luxon library for dates, calendar-day semantics for event boundaries, conflict matrix builder
- Purpose: Generate social media overlay images with text, colours, positioning
- Examples: `src/lib/banner/render-server.ts`, `src/lib/banner/config.ts`
- Pattern: Server-side image generation, palette builder, position/colour configuration
- Purpose: OpenAI API integration with prompt engineering and post-processing
- Examples: `src/lib/ai/client.ts`, `src/lib/ai/prompts.ts`, `src/lib/ai/voice.ts`
- Pattern: Pillar-based prompts, voice/brand guidelines, proof points incorporation, deterministic post-processing
- Purpose: OAuth token exchange, Graph API calls, campaign creation, interest targeting
- Examples: `src/lib/meta/marketing.ts`, `src/lib/campaigns/interest-targeting.ts`
- Pattern: Token refresh logic, audience segmentation, performance sync, budget optimization
## Entry Points
- Location: `src/app/layout.tsx` (RootLayout)
- Triggers: Application startup
- Responsibilities: Font loading, global styles, AppProviders wrapper
- Location: `src/app/(app)/layout.tsx` (AppLayout)
- Triggers: Access to `/` and all `/dashboard/*` routes
- Responsibilities: Auth check via `getCurrentUser()`, AppShell wrapper (sidebar, nav), role-based access control
- Location: `src/app/(app)/planner/page.tsx`
- Triggers: User navigates to `/planner`
- Responsibilities: Query param parsing (month, status filters, show_images), Suspense boundary, calendar component rendering
- Location: `src/app/(app)/create/page.tsx`
- Triggers: User clicks "Create Post" or navigates to `/create`
- Responsibilities: Multi-step form (campaign selection, content generation, preview, publish)
- Location: `src/app/(app)/campaigns/page.tsx`, `src/app/(app)/campaigns/[id]/page.tsx`
- Triggers: User navigates to `/campaigns` or campaign detail
- Responsibilities: Campaign listing with Meta sync, detail view with performance metrics
- Location: `src/app/(app)/settings/page.tsx`
- Triggers: User navigates to `/settings`
- Responsibilities: Social connection management (OAuth), brand voice, posting defaults
- Location: `src/app/api/feed/`, `src/app/api/cron/`, `src/app/api/oauth/`
- Triggers: External service callbacks (Meta, cron scheduler)
- Responsibilities: Async job processing, status updates, token refresh
## Error Handling
- **Schema Missing Detection:** `isSchemaMissingError()` and `isSchemaMissingErrorWithWarning()` in `src/lib/supabase/errors.ts` catch migration gaps; production logs critical errors, dev silently falls back
- **Auth Errors:** `requireAuthContext()` catches `"session_not_found"` errors, clears cookies, redirects to `/login`
- **Validation Errors:** Zod schemas in `src/lib/*/validation.ts` validate inputs; errors returned to client with schema-specific messages
- **API Errors:** Server actions return `{ success?: boolean; error?: string }` shape; client surfaces via toast notifications
- **Async Job Errors:** Publishing queue in `src/lib/publishing/queue.ts` retries with backoff; failures logged to database
## Cross-Cutting Concerns
- Approach: Console-based with context (production-only for schema gaps)
- Key locations: `src/lib/supabase/errors.ts`, `src/lib/audit-log/` (if present), individual service error handlers
- Approach: Zod schemas at API boundaries and form submissions
- Key locations: `src/lib/*/validation.ts` (campaigns, tournament, create)
- Approach: Supabase JWT in HTTP-only cookies, server-side session verification
- Key locations: `src/lib/auth/server.ts` (getCurrentUser, requireAuthContext), middleware (if present)
- Approach: `logAuditEvent()` called on all mutations
- Key locations: Server actions, API routes that modify data
- Approach: Upstash or similar; per-user rate limits on sensitive operations
- Key locations: `src/lib/auth/rate-limit.ts`
- Approach: Luxon library, default timezone Europe/London, user timezone override via account preferences
- Key locations: `src/lib/constants.ts` (DEFAULT_TIMEZONE), `src/lib/*/time-utils.ts`
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->

# context-mode — MANDATORY routing rules

You have context-mode MCP tools available. These rules are NOT optional — they protect your context window from flooding. A single unrouted command can dump 56 KB into context and waste the entire session.

## BLOCKED commands — do NOT attempt these

### curl / wget — BLOCKED
Any Bash command containing `curl` or `wget` is intercepted and replaced with an error message. Do NOT retry.
Instead use:
- `ctx_fetch_and_index(url, source)` to fetch and index web pages
- `ctx_execute(language: "javascript", code: "const r = await fetch(...)")` to run HTTP calls in sandbox

### Inline HTTP — BLOCKED
Any Bash command containing `fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, or `http.request(` is intercepted and replaced with an error message. Do NOT retry with Bash.
Instead use:
- `ctx_execute(language, code)` to run HTTP calls in sandbox — only stdout enters context

### WebFetch — BLOCKED
WebFetch calls are denied entirely. The URL is extracted and you are told to use `ctx_fetch_and_index` instead.
Instead use:
- `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` to query the indexed content

## REDIRECTED tools — use sandbox equivalents

### Bash (>20 lines output)
Bash is ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`, and other short-output commands.
For everything else, use:
- `ctx_batch_execute(commands, queries)` — run multiple commands + search in ONE call
- `ctx_execute(language: "shell", code: "...")` — run in sandbox, only stdout enters context

### Read (for analysis)
If you are reading a file to **Edit** it → Read is correct (Edit needs content in context).
If you are reading to **analyze, explore, or summarize** → use `ctx_execute_file(path, language, code)` instead. Only your printed summary enters context. The raw file content stays in the sandbox.

### Grep (large results)
Grep results can flood context. Use `ctx_execute(language: "shell", code: "grep ...")` to run searches in sandbox. Only your printed summary enters context.

## Tool selection hierarchy

1. **GATHER**: `ctx_batch_execute(commands, queries)` — Primary tool. Runs all commands, auto-indexes output, returns search results. ONE call replaces 30+ individual calls.
2. **FOLLOW-UP**: `ctx_search(queries: ["q1", "q2", ...])` — Query indexed content. Pass ALL questions as array in ONE call.
3. **PROCESSING**: `ctx_execute(language, code)` | `ctx_execute_file(path, language, code)` — Sandbox execution. Only stdout enters context.
4. **WEB**: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` — Fetch, chunk, index, query. Raw HTML never enters context.
5. **INDEX**: `ctx_index(content, source)` — Store content in FTS5 knowledge base for later search.

## Subagent routing

When spawning subagents (Agent/Task tool), the routing block is automatically injected into their prompt. Bash-type subagents are upgraded to general-purpose so they have access to MCP tools. You do NOT need to manually instruct subagents about context-mode.

## Output constraints

- Keep responses under 500 words.
- Write artifacts (code, configs, PRDs) to FILES — never return them as inline text. Return only: file path + 1-line description.
- When indexing content, use descriptive source labels so others can `ctx_search(source: "label")` later.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call the `ctx_stats` MCP tool and display the full output verbatim |
| `ctx doctor` | Call the `ctx_doctor` MCP tool, run the returned shell command, display as checklist |
| `ctx upgrade` | Call the `ctx_upgrade` MCP tool, run the returned shell command, display as checklist |
