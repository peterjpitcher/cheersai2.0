# Codebase Structure

**Analysis Date:** 2026-05-18

## Directory Layout

```
src/
├── app/                          # Next.js 16 App Router routes
│   ├── (app)/                    # Protected routes (requires auth)
│   │   ├── campaigns/            # Campaign management
│   │   ├── connections/          # Social media OAuth/integrations
│   │   ├── create/               # Content creation wizard
│   │   ├── dashboard/            # Home page redirect
│   │   ├── library/              # Media asset management
│   │   ├── planner/              # Content calendar
│   │   ├── reviews/              # Review management
│   │   ├── settings/             # Account settings
│   │   └── layout.tsx            # App shell layout (auth check, sidebar)
│   ├── (auth)/                   # Auth routes (login, etc.)
│   │   ├── login/
│   │   └── layout.tsx
│   ├── (public)/                 # Public pages (privacy, etc.)
│   │   ├── l/                    # Link redirection
│   │   ├── privacy/
│   │   └── layout.tsx
│   ├── actions/                  # Server actions (tournament, misc.)
│   ├── api/                      # API routes (webhooks, OAuth, cron)
│   │   ├── auth/
│   │   ├── booking-conversions/
│   │   ├── create/
│   │   ├── cron/
│   │   ├── feed/                 # Webhook from Meta
│   │   ├── internal/
│   │   ├── oauth/                # OAuth state handler
│   │   └── planner/
│   ├── auth/                     # Pre-app-router auth pages (deprecated?)
│   ├── dashboard/
│   ├── help/
│   ├── terms/
│   ├── favicon.ico
│   ├── globals.css               # Global styles, design tokens
│   ├── layout.tsx                # Root layout
│   ├── manifest.json
│   ├── page.tsx                  # Home (redirects to /planner)
│   └── robots.ts
├── components/                   # Shared UI components
│   ├── auth/                     # Auth-specific components
│   ├── layout/                   # Layout primitives (AppShell, Sidebar, PageHeader)
│   ├── providers/                # Context providers (app-providers, auth-provider, toast-provider)
│   └── ui/                       # Shadcn/Radix UI primitives (button, card, dialog, input, etc.)
├── config/
│   └── navigation.ts             # Sidebar/navigation links
├── env.ts                        # Environment variable validation (Zod)
├── features/                     # Feature-specific components and logic
│   ├── campaigns/                # Campaign creation, editing, performance
│   ├── connections/              # OAuth management, diagnostics
│   ├── create/                   # Content creation forms and wizards
│   ├── library/                  # Media asset browsing
│   ├── link-in-bio/              # Link in bio profiles
│   ├── planner/                  # Calendar, content schedule
│   ├── reviews/                  # Review management
│   ├── settings/                 # Settings forms
│   └── tournaments/              # Tournament management (if present)
├── hooks/                        # Custom React hooks
│   └── use-mobile.tsx
├── lib/                          # Business logic, utilities, data access
│   ├── ai/                       # OpenAI integration
│   │   ├── client.ts             # OpenAI client wrapper
│   │   ├── prompts.ts            # Prompt templates
│   │   ├── voice.ts              # Brand voice builder
│   │   ├── pillars.ts
│   │   ├── content-rules.ts
│   │   ├── postprocess.ts
│   │   ├── proof-points.ts
│   │   └── hooks.ts
│   ├── auth/                     # Authentication
│   │   ├── server.ts             # getCurrentUser, requireAuthContext, auth state
│   │   ├── actions.ts            # Login, signup, logout server actions
│   │   ├── rate-limit.ts         # Rate limiting
│   │   └── types.ts              # AppUser, auth types
│   ├── banner/                   # Image overlay generation
│   │   ├── render-server.ts      # Canvas-based image rendering
│   │   ├── config.ts             # Banner config, defaults
│   │   └── palette.ts            # Colour palette utilities
│   ├── campaigns/                # Campaign management logic
│   │   ├── dashboard.ts          # Dashboard data builder
│   │   ├── generate.ts           # Campaign generation
│   │   ├── performance-sync.ts   # Meta API sync
│   │   ├── optimisation.ts       # Campaign optimization
│   │   ├── phases.ts             # Campaign lifecycle
│   │   ├── interest-targeting.ts # Audience interest mapping
│   │   └── [etc.]
│   ├── connections/              # Social API integrations
│   │   ├── oauth.ts              # OAuth flow
│   │   ├── metadata.ts           # Connection metadata
│   │   ├── data.ts               # Data fetching
│   │   └── diagnostics.ts
│   ├── create/                   # Content creation logic
│   │   ├── service.ts            # Core creation service
│   │   ├── schema.ts             # Zod validation
│   │   ├── story-schedule.ts     # Story timing logic
│   │   └── event-cadence.ts
│   ├── email/                    # Resend integration
│   │   └── resend.ts
│   ├── gbp/                      # Google Business Profile
│   ├── hooks/                    # Custom hooks
│   │   └── use-now-minute.tsx    # Current time hook
│   ├── library/                  # Media library
│   │   ├── data.ts               # Fetch library media
│   │   └── queries.ts
│   ├── link-in-bio/              # Link in bio feature
│   ├── management-app/           # Meta Management API
│   │   ├── client.ts
│   │   └── data.ts
│   ├── meta/                     # Meta Graph API (Instagram, Facebook)
│   │   └── marketing.ts          # Create ads, upload images, search interests
│   ├── planner/                  # Planner data and logic
│   │   ├── data.ts               # Fetch scheduled content
│   │   └── queries.ts
│   ├── publishing/               # Publishing queue
│   │   ├── preflight.ts          # Validation before publish
│   │   └── queue.ts              # Job queue, retry logic
│   ├── scheduling/               # Event scheduling and conflict detection
│   │   ├── conflicts.ts          # Overlap detection
│   │   ├── materialise.ts        # Expand recurring events
│   │   ├── banner-config.ts
│   │   └── time-utils.ts
│   ├── settings/                 # Settings data and defaults
│   │   ├── data.ts
│   │   └── defaults.ts
│   ├── supabase/                 # Database client and helpers
│   │   ├── server.ts             # createServerSupabaseClient() — anon-key + cookies
│   │   ├── service.ts            # createServiceSupabaseClient() — service-role
│   │   ├── client.ts             # getSupabaseBrowserClient() — browser client
│   │   ├── errors.ts             # Schema missing detection
│   │   ├── owner.ts
│   │   └── route.ts
│   ├── tournament/               # Tournament and fixture management
│   │   ├── validation.ts         # Zod schemas
│   │   ├── queries.ts            # Data fetching
│   │   ├── generate.ts           # Content generation
│   │   ├── debug.ts              # Debug utilities
│   │   └── [etc.]
│   ├── utils/                    # General utilities
│   ├── constants.ts              # App-wide constants (timezones, account IDs)
│   └── utils.ts                  # cn() for Tailwind merging
├── types/                        # TypeScript type definitions
│   ├── campaigns.ts              # Campaign types
│   ├── tournament.ts             # Tournament types
│   ├── reviews.ts
│   └── [etc.]
└── config/
    └── navigation.ts             # Sidebar navigation config
```

## Directory Purposes

**src/app/(app)/**
- Purpose: Authenticated feature routes (behind auth middleware)
- Contains: Planner, campaigns, create, library, settings, connections, reviews
- Key files: `layout.tsx` (auth check + AppShell), `page.tsx` per feature

**src/app/api/**
- Purpose: API routes for webhooks, OAuth callbacks, cron triggers
- Contains: Instagram/Facebook webhook handlers, OAuth state handlers, internal endpoints
- Key patterns: Webhook signature verification, service-role client for writes

**src/components/ui/**
- Purpose: Shadcn/Radix UI primitives
- Contains: button, card, dialog, input, label, separator, sheet, sidebar, tabs, tooltip, badge, skeleton
- Usage: Import from `@/components/ui/{component-name}`

**src/features/[feature]/**
- Purpose: Feature-specific components and utilities
- Contains: Forms, multi-step wizards, domain-specific helpers
- Examples: `src/features/create/` (campaign forms, creation wizard), `src/features/planner/` (calendar, filters)

**src/lib/[domain]/**
- Purpose: Domain-specific business logic and data access
- Patterns: `{domain}/queries.ts` for fetching, `{domain}/service.ts` or `{domain}/actions.ts` for mutations, `{domain}/validation.ts` for Zod schemas
- Examples: `src/lib/campaigns/` (campaign logic), `src/lib/scheduling/` (conflict detection)

**src/lib/supabase/**
- Purpose: Supabase client initialization and error handling
- Key exports: `createServerSupabaseClient()`, `createServiceSupabaseClient()`, error detection functions
- Never import service-role client in client components (ESLint enforces)

**src/lib/auth/**
- Purpose: Authentication, user state, session management
- Key exports: `getCurrentUser()`, `requireAuthContext()`, `logAuditEvent()`
- Pattern: All protected routes call `requireAuthContext()` first

**src/types/**
- Purpose: Centralized TypeScript type definitions
- Convention: Types use `camelCase` (not snake_case from DB)
- Pattern: Types wrapped by `fromDb<T>()` on retrieval for case conversion

## Key File Locations

**Entry Points:**
- `src/app/layout.tsx`: RootLayout, font loading, AppProviders wrapper
- `src/app/(app)/layout.tsx`: AppLayout, auth check, AppShell (sidebar + nav)
- `src/app/page.tsx`: Home (redirects to `/planner`)
- `src/app/(app)/planner/page.tsx`: Planner calendar (main feature)
- `src/app/(app)/create/page.tsx`: Content creation wizard

**Configuration:**
- `src/env.ts`: Environment variable validation (Zod)
- `src/config/navigation.ts`: Sidebar navigation links
- `src/lib/constants.ts`: App-wide constants (timezones, account IDs, bucket names)

**Core Logic:**
- `src/lib/auth/server.ts`: getCurrentUser, requireAuthContext, auth helpers
- `src/lib/scheduling/conflicts.ts`: Event conflict detection algorithm
- `src/lib/ai/client.ts`: OpenAI API wrapper
- `src/lib/campaigns/generate.ts`: Campaign generation and optimization
- `src/lib/publishing/queue.ts`: Publishing job queue with retry logic

**Testing:**
- Test files coexist with source: `src/lib/**/*.test.ts`, `src/features/**/*.test.tsx`
- Test setup: Vitest with jsdom environment for React testing
- Factories and mocks: `src/lib/**/fixtures.ts` or inline in test files

**Database:**
- `src/lib/supabase/server.ts`: Server-side anon-key client (respects RLS)
- `src/lib/supabase/service.ts`: Service-role admin client (bypasses RLS, system operations only)
- `supabase/migrations/`: SQL migrations (applied with `npx supabase db push`)
- Audit log: `logAuditEvent()` called on all mutations

## Naming Conventions

**Files:**
- Components: PascalCase with `.tsx` extension (e.g., `CreatePostButton.tsx`)
- Utilities: camelCase with `.ts` extension (e.g., `dateUtils.ts`, `validation.ts`)
- Styles: Global in `src/app/globals.css`; no CSS modules or component-specific .css files
- Tests: `{filename}.test.ts` or `{filename}.test.tsx`

**Directories:**
- Feature directories: lowercase with hyphens (e.g., `link-in-bio`, `management-app`)
- Domain directories in `lib/`: lowercase (e.g., `ai`, `campaigns`, `scheduling`)

**Exports:**
- Named exports for utilities and helpers
- Default exports for Page/Layout components
- Barrel files: `index.ts` not used; direct imports preferred

**Types:**
- Interfaces for object shapes (e.g., `Campaign`, `TournamentFixture`)
- Type aliases for unions (e.g., `TournamentStatus`, `ContentPlacement`)
- Suffixes: `...Input`, `...Response`, `...Payload` for API contract types

**Constants:**
- UPPERCASE_SNAKE_CASE for module-level constants (e.g., `DEFAULT_TIMEZONE`, `MEDIA_BUCKET`)
- Scoped constants in `src/lib/constants.ts`

## Where to Add New Code

**New Feature (e.g., "Hashtag Suggestions"):**
1. Create `src/features/hashtag-suggestions/` directory
2. Add components: `HashtagSuggestionsPanel.tsx`, `HashtagForm.tsx`
3. Add `src/lib/hashtag-suggestions/service.ts` for OpenAI/data logic
4. Add `src/lib/hashtag-suggestions/validation.ts` for Zod schemas
5. Add route: `src/app/(app)/hashtag-suggestions/page.tsx` if needed
6. Add tests: `src/lib/hashtag-suggestions/service.test.ts`

**New Server Action:**
- Location: `src/app/(app)/[feature]/actions.ts` (colocated with route)
- Pattern: `'use server'` → `requireAuthContext()` → Zod validation → business logic → Supabase write → `logAuditEvent()` → `revalidatePath()` → return result

**New Utility/Service:**
- Location: `src/lib/[domain]/[filename].ts`
- Pattern: Named exports, explicit return types, Zod validation for inputs

**New Component:**
- Location: `src/components/[category]/[ComponentName].tsx` (if shared) or `src/features/[feature]/ComponentName.tsx` (if feature-specific)
- Pattern: Server Component by default; `'use client'` only if needs interactivity/hooks

**New Type:**
- Location: `src/types/[domain].ts` (centralized)
- Pattern: Export as named interface or type; prefix complex unions with domain (e.g., `CampaignStatus`, `TournamentRound`)

**New API Route:**
- Location: `src/app/api/[feature]/route.ts`
- Pattern: POST/GET handler with `requireAuthContext()` if protected; service-role client for writes; webhook verification for external callbacks

## Special Directories

**supabase/migrations/**
- Purpose: Database schema and migration scripts
- Generated: No (manually written)
- Committed: Yes (version controlled)
- Naming: `YYYYMMDDHHMMSS_description.sql` (e.g., `20250212150000_enable_rls.sql`)
- Running: `npx supabase db push` applies pending migrations locally

**src/app/globals.css**
- Purpose: Global styles, Tailwind directives, design tokens
- Convention: Design tokens via CSS custom properties; no hardcoded hex colours in components
- Usage: All components use class names; Tailwind purging requires static class names (no dynamic construction)

**src/env.ts**
- Purpose: Environment variable validation at startup
- Pattern: Zod schema with client (public) and server (secret) variables
- Enforcement: Build fails if required vars missing; prevents runtime surprises

**.planning/codebase/**
- Purpose: Architecture documentation (this folder)
- Not committed: Can be gitignored or included based on preference
- Contents: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md (generated by /gsd:map-codebase)

---

*Structure analysis: 2026-05-18*
