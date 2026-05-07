# Review Pack: banner-overlay-consistency

**Generated:** 2026-05-07
**Mode:** C (A=Adversarial / B=Code / C=Spec Compliance)
**Project root:** `/Users/peterpitcher/Cursor/OJ-CheersAI2.0/.claude/worktrees/loving-antonelli-8797d7`
**Base ref:** `HEAD~1`
**HEAD:** `2b03dc4`
**Diff range:** `HEAD~1...HEAD`

> This pack is the sole input for reviewers. Do NOT read files outside it unless a specific finding requires verification. If a file not in the pack is needed, mark the finding `Needs verification` and describe what would resolve it.

## Changed Files

_(none detected for this diff range)_

## User Concerns

Spec for unifying banner overlay behaviour across post types. Banner becomes derived data — labels computed live in UI, JPEG rendered server-side at publish time, no caching. Includes schema migration dropping banner_state machinery. Concerns: timezone/DST correctness, migration safety, render-failure-blocks-publish, coverage of all post types (instant/event/promotion/weekly/story).

## Spec

Source: `/Users/peterpitcher/Cursor/OJ-CheersAI2.0/.claude/worktrees/loving-antonelli-8797d7/docs/superpowers/specs/2026-05-07-banner-overlay-consistency-design.md`

```markdown
# Banner Overlay Consistency — Design

**Date:** 2026-05-07
**Author:** Brainstormed with Peter
**Status:** Design approved, awaiting implementation plan

## Problem

Banner overlays (the small edge strip carrying labels like `THIS WEDNESDAY`) are inconsistent across the app. Today they are:

- Applied unevenly across post types (instant, event, promotion, weekly, story).
- Treated as snapshots that go stale when schedules change, content is rewritten, or simply when the clock advances.
- Surfaced through two divergent preview components (canvas-based vs SVG/CSS).
- Bounded to ≤6 days out — anything further never gets a banner.
- Cached in DB columns and Supabase Storage with manual invalidation rules and a `"stale"` state declared in schema but never set.

The user wants the banner to be consistent across every post type and every surface, and to always reflect the correct context.

## Goals

- Banner is **always** correct relative to the current schedule and current time.
- Same rules apply to every post type (instant, event, promotion, weekly) and every placement (feed post, story).
- One source of truth for label and config — computed from data on every read.
- Account-level default with per-post override, enforced uniformly.
- Smaller surface area (less DB, less code, fewer states).

## Non-goals

- Per-platform branding (separate Instagram-only or Facebook-only styles). Same look everywhere.
- User-controlled banner shape or animation. Strip on one of four edges, that's it.
- Multilingual labels. English only, matching the rest of the app.
- A/B testing or analytics on banner performance.

## Locked decisions (from brainstorming)

| # | Decision | Choice |
|---|---|---|
| Q1 | Label set | Full horizon. Day-name labels for current and next week, then date format. |
| Q2 | Drift handling | Always auto-rerender silently. Banner is derived data. |
| Q3 | Stories vs feed posts | Same rules everywhere. Renderer adapts to aspect ratio proportionally. |
| Q4 | Label boundaries | `THIS [WEEKDAY]` (2–6d) → `NEXT [WEEKDAY]` (7–13d) → date format `FRI 13 JUN` (14d+). |
| Q5 | Toggle scope | Account default with per-post override. |

## Architecture

Five pieces. Two pure functions (used by both client and server), one server-only renderer, two UI components.

### 1. `labelEngine`

Pure function. Lives at [src/lib/scheduling/proximity-label.ts](src/lib/scheduling/proximity-label.ts) (extend the existing module).

```ts
type LabelKind = 'time' | 'date' | 'none';
type LabelResult = { label: string | null; kind: LabelKind };

function labelEngine(
  target: Date,
  now: Date,
  timezone: string,    // 'Europe/London'
  eventEnd?: Date,     // optional, for post-event detection
): LabelResult;
```

Used by:
- The `<BannerOverlay />` component (browser clock).
- `renderBannerServer` (server clock at publish).

### 2. `bannerConfigResolver`

Pure function. New file: `src/lib/banner/config.ts`.

```ts
type ResolvedConfig = {
  enabled: boolean;
  position: 'top' | 'bottom' | 'left' | 'right';
  bgColour: string;     // hex
  textColour: string;   // hex
  textOverride: string | null;  // ≤20 chars
};

function bannerConfigResolver(
  accountDefaults: AccountBannerDefaults,
  postOverrides: PostBannerOverrides,
  contentType: 'feed' | 'story',
): ResolvedConfig;
```

Resolution rules:
- Each field falls through from `postOverrides` to `accountDefaults` if `null`.
- `enabled = false` on the post wins over enabled at account level.
- `textOverride` only applies when `enabled = true`.

### 3. `<BannerOverlay />`

Single React component. New file: `src/features/planner/banner-overlay.tsx`.

Replaces both [BannerRenderedPreview](src/features/planner/banner-rendered-preview.tsx) (canvas) and [BannerOverlayPreview](src/features/planner/banner-overlay-preview.tsx) (SVG).

Props: `mediaUrl`, `config: ResolvedConfig`, `label: string | null`, optional `aspectClass` for tuning strip size.

Renders an SVG strip absolutely positioned over the image. No canvas, no DB call, no async work.

### 4. `renderBannerServer`

Server-only. New file: `src/lib/banner/render-server.ts`. Consolidates [banner-canvas.ts](src/lib/scheduling/banner-canvas.ts) server logic and the `/api/internal/render-banner` route.

```ts
async function renderBannerServer(
  source: ReadableStream | Buffer,   // source image
  config: ResolvedConfig,
  label: string,
): Promise<Buffer>;                    // JPEG buffer
```

Sharp-based. Inspects source dimensions and applies proportional strip width (8% short side for square/4:5/4:3, 6% for 9:16). Output is byte-stable for the same inputs.

### 5. `<BannerControls />` (kept, simplified)

[src/features/planner/banner-controls.tsx](src/features/planner/banner-controls.tsx). Drops the "render banner" mechanics — they no longer exist. Just edits the override fields on `content_variants`.

## Schema changes

One migration file under `supabase/migrations/`.

### `content_variants` — drop columns

- `banner_state`
- `banner_label`
- `banner_source_media_path`
- `bannered_media_path`
- `banner_render_metadata`
- `banner_rendered_for_scheduled_at`

Also delete existing JPEGs at `banners/{contentId}/{variantId}.jpg` from Supabase Storage as part of the migration.

### `content_variants` — add columns (all nullable; null means inherit account default)

- `banner_enabled boolean`
- `banner_text_override text` (≤20 chars, validated app-side)
- `banner_position text` (top/bottom/left/right)
- `banner_bg text` (hex)
- `banner_text_colour text` (hex)

### `posting_defaults` — add columns

- `banners_enabled boolean not null default true`
- `banner_position text not null default 'bottom'`
- `banner_bg text not null default '#000000'`
- `banner_text_colour text not null default '#FFFFFF'`

### `prompt_context` cleanup

The current `bannerConfig` blob inside `prompt_context` (jsonb) is no longer authoritative. Migration data step: where `content_variants.banner_enabled IS NULL` and `prompt_context.bannerConfig` exists, copy values into the new override columns. After migration, code stops reading the blob.

### Function audit

Per [.claude/rules/supabase.md](.claude/rules/supabase.md), grep all PL/pgSQL functions and triggers for the dropped column names in the same migration. Update any matches.

## Label engine rules

### Picking `target`

| Campaign type | `target` |
|---|---|
| Event | event start time |
| Promotion | the post's phase date |
| Weekly | post's `scheduled_for` |
| Instant / ad-hoc | post's `scheduled_for` |
| Story / story-series | post's `scheduled_for` |

### Boundaries (all in `Europe/London`)

| Days from `now` to `target` | Label |
|---|---|
| `target` < `now` | `null` |
| Same calendar day, `target` time < 17:00 | `TODAY` |
| Same calendar day, `target` time ≥ 17:00 | `TONIGHT` |
| Next calendar day, `target` time < 17:00 | `TOMORROW` |
| Next calendar day, `target` time ≥ 17:00 | `TOMORROW NIGHT` |
| 2–6 days, same Mon–Sun calendar week | `THIS [WEEKDAY]` |
| 7–13 days | `NEXT [WEEKDAY]` |
| 14+ days | `[WEEKDAY] [DAY] [MONTH]` (e.g. `FRI 13 JUN`) |

### Disambiguation

- **Same weekday, future post**: today = Wednesday, target = Wednesday 7 days later → `NEXT WEDNESDAY`. The day-band always wins over the weekday-name match.
- **Calendar week boundary**: `THIS [WEEKDAY]` requires the target to be in the same Mon–Sun week as `now`. A Saturday post about Tuesday 4 days later sits in next week → `NEXT TUESDAY`.
- **DST and TZ**: all comparisons via Luxon `DateTime.setZone('Europe/London')`. Calendar-day diff, not 24h-millisecond diff. The two DST-change Sundays each year are tested.

### Custom override

- If `banner_text_override` is non-empty, banner shows that text regardless of computed label.
- If override is set and computed label would be `null` (post-event, or event already happened by publish), banner still shows with override text.
- If override is empty/null, computed label is used. If computed label is `null`, no banner is shown.

### Banner visibility decision tree

```
config.enabled = false                     → no banner
config.enabled = true,  override set       → banner with override text

[spec truncated at line 200 — original has 401 lines]
```

## Diff (`HEAD~1...HEAD`)

_(no diff output)_

## Changed File Contents

_(no files to include)_
## Related Files (grep hints)

_(no related files found by basename grep)_

## Project Conventions (`CLAUDE.md`)

```markdown
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
```

---

_End of pack._
