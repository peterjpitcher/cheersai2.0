# Architecture

**Analysis Date:** 2026-05-18

## Pattern Overview

**Overall:** Layered server-client Next.js 16 App Router with strict separation of concerns.

**Key Characteristics:**
- **Server-first by default** — Server Components for data fetching; Client Components only for interactivity
- **Server Actions for mutations** — All state changes via `'use server'` functions with auth re-verification
- **Supabase RLS-enforced** — Client queries respect Row-Level Security; service-role admin client isolated
- **Feature-first directory structure** — Shared `lib/` utilities, feature-specific components in `features/`
- **Centralised type definitions** — Single source of truth in `src/types/`

## Layers

**Presentation Layer:**
- Purpose: React components for UI rendering
- Location: `src/components/`, `src/features/`
- Contains: Server Components, Client Components, UI primitives (buttons, cards, dialogs)
- Depends on: `lib/auth/`, `lib/utils`, design tokens in `globals.css`
- Used by: Route handlers in `src/app/`

**Feature Layer:**
- Purpose: Feature-specific logic and components grouped by domain
- Location: `src/features/` (campaigns, create, library, planner, connections, settings, reviews)
- Contains: Domain-specific forms, components, utilities (banner configs, content schedules)
- Depends on: `lib/` utilities, types, Supabase client
- Used by: Route pages and layouts

**Business Logic Layer:**
- Purpose: Core domain logic, data transformations, external integrations
- Location: `src/lib/` (ai, banner, campaigns, create, scheduling, tournament, etc.)
- Contains: OpenAI integration, Meta API client, scheduling algorithms, content generation, conflict detection
- Depends on: Supabase client, external SDKs (OpenAI, Resend, libphonenumber-js)
- Used by: Server actions, API routes, features

**Data Access Layer:**
- Purpose: Database and external service interactions
- Location: `src/lib/supabase/`, `src/lib/auth/`, `src/lib/*/data.ts` or `*/queries.ts`
- Contains: Supabase client factories (server, service-role), auth helpers, query builders
- Depends on: Supabase SDK, environment variables
- Used by: Business logic layer

**Server Actions:**
- Purpose: Authenticated mutation entry points with auth re-verification
- Location: `src/app/actions/`, `src/app/(app)/*/actions.ts`
- Contains: Campaign operations, tournament publishing, reviews, content creation
- Depends on: `requireAuthContext()`, business logic
- Used by: Client components via form submissions

**API Routes:**
- Purpose: Webhooks, OAuth callbacks, cron jobs, internal integrations
- Location: `src/app/api/`
- Contains: Instagram/Facebook webhooks, OAuth state handlers, Vercel cron triggers
- Depends on: Supabase service-role client, external API clients
- Used by: External services, cron triggers

## Data Flow

**Content Creation Flow:**

1. User submits form in `src/features/create/` component
2. Client sends data to server action (`src/app/(app)/create/actions.ts` or similar)
3. Server action calls `requireAuthContext()` to verify session and get `accountId`
4. Business logic in `src/lib/create/`, `src/lib/campaigns/`, or `src/lib/tournament/` processes data
5. Service-role Supabase client writes to database via `src/lib/supabase/service.ts`
6. Cache invalidation via `revalidatePath()` triggers re-render
7. Client receives success/error response; UI updates via React Query

**Social Publishing Flow:**

1. User triggers publish in Planner (UI in `src/features/planner/`)
2. Server action preflight check via `src/lib/publishing/preflight.ts`
3. Publishing queue in `src/lib/publishing/queue.ts` dequeues job
4. Meta API client in `src/lib/meta/` posts to Instagram/Facebook
5. Webhook from Meta via `src/app/api/feed/` updates database status
6. Audit log via `logAuditEvent()` recorded in database

**Data Fetching (Client-Side):**

1. Client Component renders with React Query hook from `src/lib/hooks/`
2. Query sends request to server component or API route
3. Server component fetches from Supabase anon-key client (respects RLS)
4. Response wrapped with `fromDb<T>()` conversion (snake_case → camelCase)
5. Data cached by React Query; re-fetching on background updates

**Auth Flow:**

1. User navigates to `/login`, signs up, or uses OAuth
2. Supabase JWT stored in HTTP-only cookie via `src/lib/supabase/server.ts`
3. Middleware or server component calls `getCurrentUser()` from `src/lib/auth/server.ts`
4. Account record created/updated in `accounts` table if missing
5. User object (with `accountId`, `email`, `timezone`) injected into `AuthProvider`
6. Protected routes render `AppShell` with sidebar navigation

**State Management:**

- **Authentication:** Context Provider in `src/components/providers/auth-provider.tsx` — read-only, server-initialized
- **Data fetching:** React Query via `QueryClientProvider` in `src/components/providers/app-providers.tsx`
- **UI state:** Local component state (forms, modals, toggles)
- **Server state:** Supabase database with RLS policies enforcing account-level isolation
- **Toast notifications:** Sonner via `ToastProvider` in `src/components/providers/toast-provider.tsx`

## Key Abstractions

**Server Actions Pattern:**

- Purpose: Type-safe mutation entry points with built-in auth verification
- Examples: `src/app/actions/tournament.ts`, `src/app/(app)/campaigns/actions.ts`
- Pattern: `'use server'` decorator, `requireAuthContext()` call, Zod schema validation, Supabase service-role write, `revalidatePath()` cache invalidation, `logAuditEvent()` audit trail

**Supabase Client Factory:**

- Purpose: Consistent client initialization for different auth contexts
- Examples: `createServerSupabaseClient()`, `createServiceSupabaseClient()`, `getSupabaseBrowserClient()`
- Pattern: Clients imported from `src/lib/supabase/{server|service|client}.ts`; anon-key respects RLS, service-role bypasses

**Type Conversion Helper:**

- Purpose: Convert database snake_case columns to camelCase TypeScript types
- Examples: `fromDb<Tournament>()`, `fromDb<CampaignDashboardModel>()`
- Pattern: Wraps raw DB row, converts keys, parses ISO date strings to Date objects

**Scheduling and Conflict Detection:**

- Purpose: Manage event timing, timezone conversions, prevent double-booking
- Examples: `src/lib/scheduling/conflicts.ts`, `src/lib/scheduling/materialise.ts`
- Pattern: Luxon library for dates, calendar-day semantics for event boundaries, conflict matrix builder

**Banner Rendering:**

- Purpose: Generate social media overlay images with text, colours, positioning
- Examples: `src/lib/banner/render-server.ts`, `src/lib/banner/config.ts`
- Pattern: Server-side image generation, palette builder, position/colour configuration

**AI Content Generation:**

- Purpose: OpenAI API integration with prompt engineering and post-processing
- Examples: `src/lib/ai/client.ts`, `src/lib/ai/prompts.ts`, `src/lib/ai/voice.ts`
- Pattern: Pillar-based prompts, voice/brand guidelines, proof points incorporation, deterministic post-processing

**Meta/Facebook Integration:**

- Purpose: OAuth token exchange, Graph API calls, campaign creation, interest targeting
- Examples: `src/lib/meta/marketing.ts`, `src/lib/campaigns/interest-targeting.ts`
- Pattern: Token refresh logic, audience segmentation, performance sync, budget optimization

## Entry Points

**Web App Root:**
- Location: `src/app/layout.tsx` (RootLayout)
- Triggers: Application startup
- Responsibilities: Font loading, global styles, AppProviders wrapper

**App Shell:**
- Location: `src/app/(app)/layout.tsx` (AppLayout)
- Triggers: Access to `/` and all `/dashboard/*` routes
- Responsibilities: Auth check via `getCurrentUser()`, AppShell wrapper (sidebar, nav), role-based access control

**Planner:**
- Location: `src/app/(app)/planner/page.tsx`
- Triggers: User navigates to `/planner`
- Responsibilities: Query param parsing (month, status filters, show_images), Suspense boundary, calendar component rendering

**Create (Content Wizard):**
- Location: `src/app/(app)/create/page.tsx`
- Triggers: User clicks "Create Post" or navigates to `/create`
- Responsibilities: Multi-step form (campaign selection, content generation, preview, publish)

**Campaigns:**
- Location: `src/app/(app)/campaigns/page.tsx`, `src/app/(app)/campaigns/[id]/page.tsx`
- Triggers: User navigates to `/campaigns` or campaign detail
- Responsibilities: Campaign listing with Meta sync, detail view with performance metrics

**Settings:**
- Location: `src/app/(app)/settings/page.tsx`
- Triggers: User navigates to `/settings`
- Responsibilities: Social connection management (OAuth), brand voice, posting defaults

**API Webhooks:**
- Location: `src/app/api/feed/`, `src/app/api/cron/`, `src/app/api/oauth/`
- Triggers: External service callbacks (Meta, cron scheduler)
- Responsibilities: Async job processing, status updates, token refresh

## Error Handling

**Strategy:** Layered error handling with schema-aware fallbacks and production logging.

**Patterns:**

- **Schema Missing Detection:** `isSchemaMissingError()` and `isSchemaMissingErrorWithWarning()` in `src/lib/supabase/errors.ts` catch migration gaps; production logs critical errors, dev silently falls back
- **Auth Errors:** `requireAuthContext()` catches `"session_not_found"` errors, clears cookies, redirects to `/login`
- **Validation Errors:** Zod schemas in `src/lib/*/validation.ts` validate inputs; errors returned to client with schema-specific messages
- **API Errors:** Server actions return `{ success?: boolean; error?: string }` shape; client surfaces via toast notifications
- **Async Job Errors:** Publishing queue in `src/lib/publishing/queue.ts` retries with backoff; failures logged to database

## Cross-Cutting Concerns

**Logging:**
- Approach: Console-based with context (production-only for schema gaps)
- Key locations: `src/lib/supabase/errors.ts`, `src/lib/audit-log/` (if present), individual service error handlers

**Validation:**
- Approach: Zod schemas at API boundaries and form submissions
- Key locations: `src/lib/*/validation.ts` (campaigns, tournament, create)

**Authentication:**
- Approach: Supabase JWT in HTTP-only cookies, server-side session verification
- Key locations: `src/lib/auth/server.ts` (getCurrentUser, requireAuthContext), middleware (if present)

**Audit Logging:**
- Approach: `logAuditEvent()` called on all mutations
- Key locations: Server actions, API routes that modify data

**Rate Limiting:**
- Approach: Upstash or similar; per-user rate limits on sensitive operations
- Key locations: `src/lib/auth/rate-limit.ts`

**Timezone Handling:**
- Approach: Luxon library, default timezone Europe/London, user timezone override via account preferences
- Key locations: `src/lib/constants.ts` (DEFAULT_TIMEZONE), `src/lib/*/time-utils.ts`

---

*Architecture analysis: 2026-05-18*
