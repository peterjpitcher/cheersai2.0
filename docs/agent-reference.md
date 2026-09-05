# CheersAI 2.0 agent reference

Reference material moved out of `CLAUDE.md` on 2026-09-04 so the instruction file stays short. This is background, not rules: the rules are in `CLAUDE.md` (project) and `/Users/peterpitcher/Cursor/CLAUDE.md` (workspace). Everything below was checked against the repo on that date; where the code and this file disagree, the code wins.

## 1. Project background and constraints

CheersAI 2.0 is a ground-up rebuild of v1, driven by a 12-document design audit (`docs/redesign-plan/`) that found 6 critical security issues (C-1 to C-6), 28 high-severity problems and 30+ minor issues. Core value: an owner creates one piece of content, the AI generates platform-specific copy, and the pipeline publishes it reliably with no manual intervention after approval.

Constraints that shaped the build:

- Replace in place: v1 went offline while v2 was built in the same repository, and the v1 schema survives as `supabase/baseline/v1_baseline.sql`.
- Security first: the six critical issues were fixed before feature work (the token vault, `src/lib/token-vault`, resolves C-1, plaintext token storage).
- Europe/London only; no multi-timezone support.
- Facebook and Instagram, each with different rate limits, token lifecycles and content formats. Google Business Profile was part of the original scope and was removed in June 2026.
- Background jobs: Vercel Cron promotes scheduled jobs, Upstash QStash delivers them (chosen over cron-only delivery for reliability).
- Observability: Axiom for structured logging.

Historical planning residue: `.planning/` (GSD phases, archived 2026-07-03), `docs/redesign-plan/`, `docs/superpowers/`, root `HANDOFF.md` and `BACKLOG.md`.

## 2. Technology stack (from `package.json`)

| Area | Package and version |
|---|---|
| Framework | `next` 16.2.6 (App Router, `next build --webpack`), `react` and `react-dom` 19.2.3 |
| Language and tooling | TypeScript 5 (strict), ESLint 9 with `eslint-config-next` 16.2.6 (flat config in `eslint.config.mjs`), `tsx` 4 for scripts, `dotenv` 17 |
| Styling | Tailwind CSS 4 via `@tailwindcss/postcss`, `tailwind-merge` 3, `class-variance-authority` 0.7, `clsx`, `tailwindcss-animate`, Radix UI (dialog, label, separator, slot, tooltip), `lucide-react`, `framer-motion` 12, `@dnd-kit` (core, sortable, utilities), `recharts` 3, `sonner` 2 |
| Forms and validation | `react-hook-form` 7, `@hookform/resolvers` 5, `zod` 4 |
| Data | `@supabase/supabase-js` 2.89, `@supabase/ssr` 0.8, `@tanstack/react-query` 5.90 (+ devtools) |
| Background and infra | `@upstash/qstash` 2, `@upstash/ratelimit` 2, `@upstash/redis` 1, `@axiomhq/js` 1, `p-limit` 7 |
| External services | `openai` 6.38, `resend` 6.6 |
| Dates | `luxon` 3.7 (`@types/luxon`) |
| Images | `sharp` 0.34 (declared in `serverExternalPackages`), `satori` 0.26, `text-to-svg` 3 |
| Testing | `vitest` 4 with `@vitest/coverage-v8`, `@testing-library/react` 16, `@testing-library/jest-dom` 6, `jsdom` 29, `msw` 2, `@playwright/test` 1.60, `autocannon` 8 (`perf:load-test`) |

Runtime: Node 20.x (`engines`), npm with `package-lock.json`, deployed on Vercel in `lhr1`, Supabase PostgreSQL with RLS on every table. Path alias `@/*` maps to `./src/*` in both `tsconfig.json` and `vitest.config.ts`. `next.config.ts` also wires `securityHeaders` (`src/lib/security/headers.ts`) and `legacyHostRedirects` (`src/lib/routing/legacy-host-redirects.ts`) and allows `**.supabase.co` as an image host.

Not in this project (despite older notes): `libphonenumber-js`, Lightning CSS, Prettier config, Jest, any Google Business Profile SDK.

## 3. Layer map

| Layer | Location | Contains | Depends on |
|---|---|---|---|
| Presentation | `src/components/`, `src/features/<domain>/` | Server and Client Components, UI primitives, feature forms and views | `lib/`, types, design tokens in `globals.css` |
| Business logic | `src/lib/<domain>/` | OpenAI prompts and post-processing, Meta clients, scheduling and conflict detection, banner rendering, publishing state machine | Supabase clients, external SDKs |
| Data access | `src/lib/supabase/`, `src/lib/auth/`, `src/lib/*/data.ts` and `*/queries.ts` | Client factories, auth helpers, query builders, hand-written row mappers | Supabase SDK, `src/env.ts` |
| Server actions | `src/app/actions/`, `src/app/(app)/*/actions.ts` | Authenticated mutation entry points | `requireAuthContext()`, business logic |
| API routes | `src/app/api/` | Cron triggers, QStash webhooks, OAuth callbacks, internal render route, tournament feed, booking-conversion ingest | Service-role client, provider clients |

Data flow: auth context is server-initialised and exposed read-only through `src/components/providers/auth-provider.tsx`; React Query (`app-providers.tsx`) handles client fetching; UI state is local; toasts are Sonner via `toast-provider.tsx`; server state is Supabase with account-level RLS.

### Key abstractions

- **Server action**: `'use server'`, `requireAuthContext()`, Zod validation, service-role write scoped by `account_id`, `revalidatePath()`, and `logPublishAuditEvent()` where the pipeline is touched. Return shape `Promise<{ success?: boolean; error?: string }>`.
- **Supabase clients**: `createServerSupabaseClient()` (cookie, RLS), `createServiceSupabaseClient()` and `tryCreateServiceSupabaseClient()` (service role), `createBrowserSupabaseClient()`.
- **Row mapping**: no `fromDb<T>()` utility exists; each domain maps `snake_case` to `camelCase` by hand (for example `src/lib/management-app/mappers.ts`).
- **Scheduling**: `src/lib/scheduling/conflicts.ts` (double-booking prevention), `materialise.ts` (expands recurring events), Luxon with calendar-day semantics.
- **Banner rendering**: `src/lib/banner/render-server.ts` and `config.ts`, sharp plus text-to-svg with an embedded font, served through `/api/internal/render-banner`.
- **AI**: `src/lib/ai/client.ts`, `prompts.ts`, `voice.ts`; pillar-based prompts, brand voice, proof points, deterministic post-processing.
- **Meta**: `src/lib/meta/marketing.ts` (OAuth exchange, Marketing API, campaign creation), `src/lib/campaigns/interest-targeting.ts`, provider adapters in `src/lib/providers/{facebook,instagram}` with `rate-limits.ts`, `token-helpers.ts` and a `registry.ts`.
- **Token vault**: `src/lib/token-vault` (`encryptPayload`, `decryptPayload`, `getKey`, `getCurrentKeyVersion`), AES-256-GCM with versioned keys.
- **Errors**: `isSchemaMissingError()` in `src/lib/supabase/errors.ts`; `requireAuthContext()` treats `session_not_found` as unauthenticated and redirects to `/auth/login`; tournament debug helpers `tournamentDebug()` and `redactId()` in `src/lib/tournament/debug.ts`.

### Entry points

| Location | Responsibility |
|---|---|
| `src/app/layout.tsx` | Fonts, global styles, `AppProviders` |
| `src/app/(app)/layout.tsx` | `getCurrentUser()` gate, redirects to `/auth/login` or `/no-access`, app shell |
| `src/app/(app)/planner/page.tsx` | Calendar with month, status and image filters |
| `src/app/(app)/create/page.tsx` | Multi-step create flow (campaign, generation, preview, publish) |
| `src/app/(app)/campaigns/page.tsx` and `[id]/page.tsx` | Paid campaign list with Meta sync, detail with performance metrics |
| `src/app/(app)/settings/page.tsx` | Social connections (OAuth), brand voice, posting defaults |

## 4. API route surface (`src/app/api/`)

`auth/login`, `auth/magic-link`, `booking-conversions`, `content/[id]`, `create/event-artwork`, `create/generate-stream`, `cron/*` (see section 5), `feed/[tournamentId]`, `internal/link-in-bio-timing`, `internal/render-banner`, `oauth/[provider]` and `oauth/[provider]/callback`, `oauth/facebook-ads` and its callback, `planner/activity`, `social/delete-data`, `webhooks/qstash-publish` and `webhooks/qstash-publish/failure`, `webhooks/qstash-food-materialise`.

## 5. Scheduled jobs

Vercel Cron (`vercel.json`; Vercel evaluates schedules in UTC), all authenticated with `CRON_SECRET` through `verifyCronAuth()`:

| Route | Schedule | Purpose |
|---|---|---|
| `/api/cron/publish-scheduler` | every minute | promote due `publish_jobs` to `queued` and dispatch to QStash |
| `/api/cron/notify-failures` | hourly at :30 | alert on publish failures |
| `/api/cron/retry-capi-conversions` | hourly at :20 | retry booking-conversion sends |
| `/api/cron/purge-trash` | 03:15 daily | purge soft-deleted content |
| `/api/cron/sync-meta-campaigns` | 06:00 daily | pull Meta campaign performance |
| `/api/cron/optimise-meta-campaigns` | 06:30 daily | run the campaign optimiser |
| `/api/cron/notify-expiring-connections` | 08:00 daily | warn about expiring tokens |
| `/api/cron/materialise-food-windows` | Sundays 01:00 | extend rolling food campaigns (no-op unless `FOOD_AUTO_MATERIALISE_ENABLED`) |

Routes that exist but are not in `vercel.json`: `/api/cron/token-health` and `/api/cron/publish` (a 410 tombstone). Supabase-side schedules for the edge functions are documented in `docs/runbook.md` (section 11) and applied with `supabase functions schedule create`; `supabase/config.toml` only declares the two functions.

## 6. Environment variables

`src/env.ts` is the canonical, Zod-validated list. In production it throws when required variables are missing, when `TOKEN_VAULT_KEY` is not exactly 64 hex characters, or when `NEXT_PUBLIC_SITE_URL` is unset. `SKIP_ENV_VALIDATION=1` bypasses the check.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project and anon key (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key, server only |
| `NEXT_PUBLIC_SITE_URL` | Deployed base URL for redirects and links |
| `TOKEN_VAULT_KEY`, `TOKEN_VAULT_KEY_VERSION` | AES key (64 hex) and version for encrypting OAuth tokens |
| `NEXT_PUBLIC_FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | Meta app credentials |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_VERIFY_TOKEN` | Instagram app credentials and webhook verification token |
| `META_GRAPH_VERSION`, `NEXT_PUBLIC_META_GRAPH_VERSION` | Pinned Graph API version (server and client) |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | OpenAI key; model override (default `gpt-4o-mini`) |
| `RESEND_API_KEY`, `RESEND_FROM` | Transactional email; from address in the form `Name <address>` |
| `CRON_SECRET` | Header secret for all `/api/cron/*` routes |
| `ALERTS_SECRET` | Internal alerts webhook secret |
| `UPSTASH_QSTASH_TOKEN`, `UPSTASH_QSTASH_CURRENT_SIGNING_KEY`, `UPSTASH_QSTASH_NEXT_SIGNING_KEY` | QStash publishing and webhook signature verification |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Auth rate limiting (skipped when unset) |
| `AXIOM_TOKEN`, `AXIOM_DATASET` | Structured logging (silent when unset) |
| `BOOKING_CONVERSION_INGEST_SECRET`, `BOOKING_CONVERSION_ACCOUNT_ID` | Booking-conversion ingest defaults |
| `MANAGEMENT_ARTWORK_ORIGINS` | Allowed hosts for management-app artwork fetches |
| `ENABLE_CONNECTION_DIAGNOSTICS` | Verbose integration logging |
| `FOOD_OPTIMISATION_ENABLED`, `FOOD_AUTO_MATERIALISE_ENABLED`, `NEXT_PUBLIC_ENABLE_FOOD_BOOKING` | Feature flags, default off |

Read directly from `process.env` outside `src/env.ts` (debug and test switches): `BANNER_OVERLAY_DISABLED`, `BANNER_RENDER_URL`, `ENABLE_MEDIA_ATTACHMENTS_TABLE`, `TOURNAMENT_DEBUG`, `DEBUG_CONTENT_GENERATION`, `CHEERSAI_ACCOUNT_ID`, `E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD`, `E2E_AUTH_COOKIE`, `BASE_URL`, `SKIP_ENV_VALIDATION`. Listed in `.env.example` but read by nothing: `INTERNAL_RENDER_SECRET`, `INTERNAL_RENDER_URL`, `VERCEL_OIDC_TOKEN` (populated by `vercel env pull`). Removed with GBP: `GOOGLE_MY_BUSINESS_CLIENT_ID`, `GOOGLE_MY_BUSINESS_CLIENT_SECRET`.

## 7. Operational scripts

All run with `tsx` against whatever Supabase the environment points at. Read the script before running it, run against a test database first, then production with caution.

| npm alias | Script | What it does |
|---|---|---|
| `ops:link-auth-user` | `scripts/ops/link-auth-user.ts` | Links a Supabase auth user to an `accounts` row and seeds posting defaults (`--email`, `--account`, optional `--display-name`, `--account-email`) |
| `ops:bootstrap-super-admin` | `scripts/ops/bootstrap-super-admin.ts` | Creates the central super-admin for multi-brand access |
| `ops:backfill-connections` | `scripts/ops/backfill-connections.ts` | Backfills social connection records and metadata |
| `ops:backfill-link-in-bio-url` | `scripts/ops/backfill-link-in-bio-url.ts` | Backfills link-in-bio profile URLs |
| `ops:backfill-event-overlays`, `ops:backfill-opt-in-overlays` | `scripts/ops/backfill-*-overlays.ts` | Backfills banner overlay settings on existing content |
| `ops:regenerate-story-derivatives` | `scripts/ops/regenerate-story-derivatives.ts` | Re-invokes the `media-derivatives` edge function to rebuild story variants |
| `ops:repair-hidden-media-references` | `scripts/ops/repair-hidden-media-references.ts` | Repairs content that references hidden media |
| `ops:archive-planner-failures` | `scripts/ops/archive-planner-failures.ts` | Archives failed planner jobs |
| `ops:search-meta-interests` | `scripts/ops/search-meta-interests.ts` | Searches Meta interest targeting options |
| `ops:invoke` | `scripts/ops/invoke-function.ts` | Invokes a Supabase edge function by name |
| `ops:seed-world-cup` | `scripts/ops/seed-world-cup-2026.ts` | Seeds the World Cup 2026 tournament fixtures |
| (none) | `scripts/ops/cleanup-banner-storage.ts`, `diagnose-publishing.ts`, `remove-slot-language.ts` | Storage cleanup, stuck-job diagnosis, copy clean-up |
| `db:rebuild` | `scripts/db-local-rebuild.sh` | Local `supabase db reset` with the v1 baseline staged and then removed |
| `perf:load-test` | `scripts/load-test-planner.ts` | Autocannon load test of the planner |
| (none) | `scripts/build-v1-baseline.py`, `scripts/export-social-copy-csv.mjs`, `scripts/sql/artwork-coverage.sql` | Baseline builder, copy export, artwork coverage query |

## 8. Conventions

Naming: components PascalCase (`BannerOverlay.tsx`) though many feature files are kebab-case (`planner-calendar.tsx`); helpers camelCase, verb-first; hooks `use` prefix; constants `UPPER_SNAKE_CASE`; interfaces and union type aliases PascalCase (`interface ComponentNameProps`); enum-like values as string unions; DB columns `snake_case`, TypeScript properties `camelCase`; server actions camelCase with a verb (`createTournament`, `deleteCampaign`); tests `.test.ts(x)` either co-located or mirrored under `tests/`.

Style: 2-space indentation, trailing commas in multi-line literals, explicit return types on exported functions, `import type` for types, no `any` without a justifying comment, named exports everywhere except Next.js route files (pages, layouts, route handlers) which must default-export, barrel files avoided in favour of direct imports, private helpers left unexported. Quote style is mixed across the codebase; match the file you are editing. Lint runs `eslint-config-next` core-web-vitals and typescript presets (including jsx-a11y and hooks rules) with zero warnings allowed in CI.

Error handling: Zod schemas in `src/lib/*/validation.ts`, `schema.parse()` inside try/catch in server actions, errors returned to the caller in the `{ success, error }` shape and surfaced as toasts; no silent failures. Validators return `{ ready: boolean; missing: string[] }` style results.

Logging: `createLogger('<scope>')` from `src/lib/logging` for structured logs (Axiom), correlation helpers in `correlation.ts`; tournament code uses `tournamentDebug(redactId(id), ...)`. Log entry and exit of long operations, state transitions, external API calls when safe, and never a plaintext token.

Comments: explain date and timezone logic (GMT/BST transitions), non-obvious business rules, workarounds with their reason, complex regex or transforms. Exported functions carry a short JSDoc; parameters only when non-obvious.

Function and module design: 20 to 50 lines, one job per function, at most 3 or 4 parameters (use an options object beyond that), optional parameters last. Feature code in `src/features/<feature>/`, shared logic in `src/lib/<domain>/`, types in `src/types/<domain>.ts`, server actions in `src/app/actions/<domain>.ts` or next to the route.

Framer Motion: page transitions and micro-interactions only; prefer `transform` and `opacity`; animations are stubbed in unit tests. Resend: all transactional email goes through it; `RESEND_FROM` uses the `Name <address>` form.

## 9. Related documents

- `docs/runbook.md`: monitoring, incident response, scheduled jobs, media pipeline, email alerts, connection metadata and diagnostics.
- `docs/runbooks/`: `credential-rotation.md`, `publish-outage.md`, `token-reconnection.md`.
- `docs/architecture/`: `overview.md`, `routes.md`, `server-actions.md`, `data-model.md`, `relationships.md`.
- `docs/database-schema.md`, `supabase/SCHEMA.md`, `.claude/schema.md`: schema snapshots (the live database wins).
- `docs/integration-spec.md`, `docs/api-feed.md`, `docs/api-contracts.md`: provider and API contracts (the GBP section is historical).
- `docs/brand-writing-standard.md`, `docs/content-guidelines.md`, `docs/ui-guidelines.md`: copy and UI standards.
- `docs/technical-design.md`, `docs/redesign-spec.md`, `docs/cheersai-rebuild-prd.md`: rebuild design history.
- `tasks/ADS-PLAYBOOK-the-anchor.md`: verified paid-ads facts and brief template.
