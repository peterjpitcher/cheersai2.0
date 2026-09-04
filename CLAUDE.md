# CLAUDE.md, CheersAI 2.0

Workspace standards (stack defaults, TypeScript, Tailwind, Supabase, Git, testing, server actions) live in `/Users/peterpitcher/Cursor/CLAUDE.md`: read that first. This file holds only what is unique to this repo. `AGENTS.md` is a relative symlink to this file so Codex and Cursor read the same rules. Longer reference material (layer map, conventions, full env table, ops scripts, cron schedule) is in `docs/agent-reference.md`.

## What this is

CheersAI is an AI-assisted social media tool for hospitality venues. An owner creates a piece of content once, the AI adapts it per platform, and the publishing pipeline schedules, preflight-checks and delivers it to Facebook and Instagram with no manual work after approval. It also builds and monitors paid Meta campaigns. The first and main customer is The Anchor; the app lives at `cheers.orangejelly.co.uk`.

## Stack: where this repo differs from the workspace default

- Next.js **16.2** App Router (workspace default is 15), React 19.2, Tailwind v4, TypeScript strict. Node **20.x** (`engines`), npm with `package-lock.json`.
- `npm run build` runs `next build --webpack`: webpack, not Turbopack. The build type-checks against `tsconfig.build.json` (src only); `npm run typecheck` uses `tsconfig.json`, which also covers `tests/` and `scripts/`, so the two can disagree.
- Tests are **Vitest 4** (node environment, `TZ` forced to Europe/London) plus **Playwright** for e2e. Not Jest.
- No `middleware.ts` or `proxy.ts`. The auth gate is `src/app/(app)/layout.tsx` calling `getCurrentUser()` (redirects to `/auth/login` or `/no-access`); server actions and routes call `requireAuthContext()` from `src/lib/auth/server.ts`.
- Background work: Vercel Cron (`vercel.json`, region `lhr1`) for scheduling, **Upstash QStash** for publish delivery, and two Supabase edge functions (`publish-queue`, `media-derivatives`) for the legacy and media paths.
- Logging is **Axiom** via `createLogger()` in `src/lib/logging`. Rate limiting is Upstash Redis (`src/lib/auth/rate-limit.ts`, 5 requests per 60 seconds, skipped when the Upstash vars are unset).
- `cheersai.uk` is retired and 307-redirects to the new host (`src/lib/routing/legacy-host-redirects.ts`), browser traffic only.

## Commands

```bash
npm run dev                 # local server on :3000
npm run lint:ci             # eslint --max-warnings=0 (what CI runs; `npm run lint` is the lenient form)
npm run typecheck           # tsc --noEmit against tsconfig.json
npm run test:ci             # CI=1 vitest run (`npm test` is watch mode)
npm run ci:verify           # lint:ci + typecheck + test:ci + build; all four must pass before a PR
npm run test:e2e:smoke      # Playwright smoke suite; needs E2E_TEST_EMAIL, E2E_TEST_PASSWORD, BASE_URL
npm run db:rebuild          # reset the LOCAL Supabase DB with the v1 baseline staged (see gotchas)
npm run ops:<name>          # tsx scripts in scripts/ops/ (catalogue in docs/agent-reference.md)
```

CI (`.github/workflows/ci.yml`) runs typecheck, lint, test:ci and build as separate jobs, then `supabase db lint` on a from-scratch local database and the e2e smoke suite when credentials are configured.

## Architecture

```
src/app/                (app) authenticated routes, (auth), (public), actions/ (server actions)
src/app/api/            cron/, webhooks/ (QStash), oauth/, internal/ (banner render), feed/, booking-conversions/
src/features/<domain>   feature components: analytics, campaigns, connections, create, library,
                        link-in-bio, planner, publishing, settings, tournament
src/lib/<domain>        domain logic: ai, banner, campaigns, meta, providers, publishing, scheduling,
                        token-vault, management-app, supabase, security, logging, and more
src/types/              central types        src/env.ts   Zod env validation
supabase/               migrations/ (30), baseline/ (v1 baseline, NOT a migration), functions/, SCHEMA.md snapshot
tests/                  mirrors src/ (co-located src/**/*.test.ts also run)     e2e/  Playwright
tasks/                  SPEC-*.md, PLAN-*.md, ADS-PLAYBOOK-the-anchor.md
```

## Domain and business rules

- **Platforms are Facebook and Instagram only** (`Platform` in `src/types/content.ts`, adapters in `src/lib/providers/`). Google Business Profile was removed deliberately (`tasks/SPEC-weekly-recurrence-story-gbp-removal.md`, June 2026); do not reintroduce it without an explicit brief. `HANDOFF.md`, `docs/integration-spec.md` and older plans still mention GBP and are stale on that point.
- **Tenancy**: a "brand" is a `public.accounts` row and every content table is `account_id`-scoped. Most reads use the service-role client (52 files), so scoping is the code's job: every such query must carry an explicit `.eq('account_id', accountId)`. RLS membership (the `20260714_multibrand_*` migrations) is the second layer; keep both in lockstep. A read that relies on RLS alone (historically `src/lib/content/queries.ts` and `src/lib/media/resolve-thumbnails.ts`) becomes a cross-brand leak once RLS is membership-based.
- **Timezone**: Europe/London everywhere (`DEFAULT_TIMEZONE` in `src/lib/constants.ts`; `accounts.timezone` defaults to it; Vitest and CI set `TZ`). Use Luxon for all date maths and comment GMT/BST edge cases.
- **Publishing pipeline** (`src/lib/publishing/`): jobs move `approved -> scheduled -> queued -> publishing -> published | failed`, and `failed -> queued` on retry (`state-machine.ts`). The `publish-scheduler` cron runs every minute, promotes due jobs to `queued` and dispatches them to QStash (`dispatch.ts`); QStash calls `/api/webhooks/qstash-publish` (signature-verified), which runs `handler.ts`; failures land on `/api/webhooks/qstash-publish/failure`. Run `preflight.ts` before anything is queued. `/api/cron/publish` is a 410 tombstone. The scheduler falls back to the Supabase `publish-queue` edge function only while `publish_jobs` lacks a `platform` column, and tournament publishing (`src/app/actions/tournament.ts`) still invokes `publish-queue` directly.
- **Paid Meta ads**: campaigns publish **through the app** (`src/lib/meta/marketing.ts`), never by hand in Ads Manager, so the dashboard, performance sync and optimiser all see them. The wizard builds `event` and `evergreen` campaigns, plus `food_booking` behind `NEXT_PUBLIC_ENABLE_FOOD_BOOKING`; anything else (Sunday roast, Christmas, function hire, recruitment) is off-app work. **Read `tasks/ADS-PLAYBOOK-the-anchor.md` before any ads brief**: it holds the verified ad account, Page, pixel and venue facts, real CPC and CTR benchmarks, the copy guardrails and the brief template. Re-verify the account facts against Supabase before anything that spends money.
- The Instagram `social_connections.status` value `expiring` is a dead label, not a fault. Nothing in `src/` writes it; the UI only maps it to a badge. Do not report it as needing reconnection.
- Feature flags default off: `FOOD_OPTIMISATION_ENABLED`, `FOOD_AUTO_MATERIALISE_ENABLED` (the weekly cron is a no-op when off) and `NEXT_PUBLIC_ENABLE_FOOD_BOOKING`.

## Integrations and external services

| Service | Where | Notes |
|---|---|---|
| Meta Graph API (Facebook Pages, Instagram) | `src/lib/providers/`, `src/lib/meta/` | OAuth at `/api/oauth/[provider]`; `META_GRAPH_VERSION` pins the version; per-platform limits in `providers/rate-limits.ts` |
| Meta Marketing API (paid campaigns) | `src/lib/meta/marketing.ts`, `src/lib/campaigns/` | Ads OAuth at `/api/oauth/facebook-ads`; daily `sync-meta-campaigns` and `optimise-meta-campaigns` crons |
| OpenAI | `src/lib/ai/`, `src/app/actions/ai-generate.ts` | `OPENAI_MODEL` defaults to `gpt-4o-mini` |
| Resend | `src/lib/email/`, `src/lib/notifications/` | failure and expiring-connection alerts |
| Upstash QStash and Redis | `src/lib/qstash/client.ts`, `src/lib/auth/rate-limit.ts` | delivery queue; auth rate limiting |
| Axiom | `src/lib/logging/axiom.ts` | structured logs; silent when `AXIOM_TOKEN` is unset |
| Supabase edge functions | `supabase/functions/publish-queue`, `media-derivatives` | legacy publish worker; image derivatives via FFmpeg WASM |
| The Anchor management app | `src/lib/management-app/` | event artwork import; per-account settings in `management_app_connections`; allowed hosts in `MANAGEMENT_ARTWORK_ORIGINS` |
| Booking conversions ingest | `/api/booking-conversions` | per-brand `bce_` secrets; hourly `retry-capi-conversions` cron |
| Banner rendering | `src/lib/banner/`, `/api/internal/render-banner` | satori, sharp, text-to-svg; fetches only from the project's Supabase Storage host over https |

## Environment variables

`src/env.ts` is canonical (Zod, server and client scoped). Add a variable there before reading it anywhere. Validation throws only in production, so a missing var locally fails later and quietly; `SKIP_ENV_VALIDATION=1` bypasses it (CI builds use it with placeholder Supabase values). Key groups (full table in `docs/agent-reference.md`):

- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- Token vault: `TOKEN_VAULT_KEY` (exactly 64 hex characters in production), `TOKEN_VAULT_KEY_VERSION`
- Meta: `NEXT_PUBLIC_FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_VERIFY_TOKEN`, `META_GRAPH_VERSION`, `NEXT_PUBLIC_META_GRAPH_VERSION`
- Queues and secrets: `CRON_SECRET`, `ALERTS_SECRET`, `UPSTASH_QSTASH_TOKEN`, `UPSTASH_QSTASH_CURRENT_SIGNING_KEY`, `UPSTASH_QSTASH_NEXT_SIGNING_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- Services: `OPENAI_API_KEY` (`OPENAI_MODEL` optional), `RESEND_API_KEY`, `RESEND_FROM`, `AXIOM_TOKEN`, `AXIOM_DATASET`, `NEXT_PUBLIC_SITE_URL` (must be the deployed domain in production)
- Ingest and flags: `BOOKING_CONVERSION_INGEST_SECRET`, `BOOKING_CONVERSION_ACCOUNT_ID`, `MANAGEMENT_ARTWORK_ORIGINS`, `ENABLE_CONNECTION_DIAGNOSTICS`, plus the three feature flags above

`GOOGLE_MY_BUSINESS_*` variables no longer exist. `.env.example` still lists `INTERNAL_RENDER_SECRET` and `INTERNAL_RENDER_URL`, which nothing reads. Secrets live in `.env.local` (gitignored); never commit them.

## Security rules

- Social OAuth tokens are encrypted at rest with `src/lib/token-vault` (AES-256-GCM, versioned keys for rotation). Never store or log a plaintext token; rotation steps are in `docs/runbooks/credential-rotation.md`.
- Cron routes authenticate with `verifyCronAuth()` (`src/lib/security/cron-auth.ts`): `Authorization: Bearer` or `x-cron-secret` header only, timing-safe comparison, query-string secrets rejected. QStash webhooks verify the QStash signature. Use `src/lib/security/signing.ts` for any new secret comparison.
- Security headers come from `src/lib/security/headers.ts` through `next.config.ts`; keep them there so they stay unit-tested.
- The service-role client bypasses RLS, so every service-role query must scope by `account_id` (see Tenancy).

## Supabase specifics (deviations from the workspace rule)

- Clients, all in `src/lib/supabase/`: `createServerSupabaseClient()` (cookie session, respects RLS), `createServiceSupabaseClient()` and `tryCreateServiceSupabaseClient()` (service role), `createBrowserSupabaseClient()` (client components).
- There is **no `fromDb<T>()` helper** here: map `snake_case` rows to `camelCase` types by hand in the domain's `data.ts` or `mappers.ts`.
- There is **no generic `logAuditEvent()`**: publishing writes to `audit_log` through `logPublishAuditEvent()` in `src/lib/publishing/audit.ts`. Other mutations are not audited today.
- `isSchemaMissingError()` in `src/lib/supabase/errors.ts` detects migration gaps (production logs them, dev falls back quietly).
- `supabase/SCHEMA.md` is a snapshot; the live schema wins (workspace rule). Specs refer to the live project as `cheersai2.0` (`nbkjciurhvkfpcpatbnt`).
- RLS is on for every table; add matching policies for any new multi-tenant table or the session-scoped client will see nothing.

## Testing

- Vitest picks up `tests/**/*.test.ts` and co-located `src/**/*.test.ts(x)`; both conventions are in use. Coverage thresholds in `vitest.config.ts`: `src/lib/auth` 80%, `src/lib/publishing` 85%, `src/lib/scheduling` 90%.
- `tests/setup.ts` stubs `localStorage` and Framer Motion (the node environment has no DOM). MSW handlers live in `tests/msw/`, a Supabase mock in `tests/helpers/mock-supabase.ts`, an FFmpeg stub in `tests/__mocks__/`.
- Mock OpenAI, Resend, Meta and Supabase; a unit test must never reach a live service.
- Playwright: `e2e/tests/smoke` and `e2e/tests/full`, chromium only, real login via `E2E_TEST_EMAIL` and `E2E_TEST_PASSWORD`.

## Known gotchas and past bugs

- **The v1 baseline is not a migration.** The v2 chain assumes v1 objects that no migration creates. `npm run db:rebuild` and CI copy `supabase/baseline/v1_baseline.sql` to `supabase/migrations/20260519230001_v1_baseline.sql`, run the reset, then delete it. Never commit or push that staged file.
- `src/lib/scheduling/proximity-label.ts` is duplicated in `supabase/functions/publish-queue/banner-label.ts`; change both.
- Legacy host redirects are 307 and browser-only: a cross-origin redirect strips `Authorization`, so server-to-server callers must target `cheers.orangejelly.co.uk` directly.
- Instagram media-fetch failures (Meta error code 9004) are transient and retried (PR #45); do not treat them as hard failures.
- `publish_jobs` legacy bridge: the scheduler checks for the `platform` column and falls back to the edge function when it is missing; keep that check until the bridge is retired.
- Multi-brand: reads that rely on RLS alone leak across brands once membership RLS is on (see Tenancy).
- The GSD commands (`/gsd:quick`, `/gsd:debug`, `/gsd:execute-phase`) were archived on 2026-07-03 and do not exist; `.planning/` is their residue.
- Root `HANDOFF.md` and `BACKLOG.md` are status snapshots from the rebuild, not current instructions (HANDOFF still describes a GBP provider that no longer exists).

## Planning workflow

For anything beyond a trivial edit, work through `tasks/`: write `tasks/SPEC-<slug>.md` before changing code (what changes, why, the rollback, and anything that must deploy before a production setting is flipped); use `tasks/PLAN-<slug>.md` for multi-PR work. Record decisions in the spec as they are made; open questions belong in chat, never in a file. Finish with `npm run ci:verify`.
