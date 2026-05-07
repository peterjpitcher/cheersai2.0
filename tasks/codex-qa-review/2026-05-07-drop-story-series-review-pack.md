# Review Pack: drop-story-series

**Generated:** 2026-05-07
**Mode:** C (A=Adversarial / B=Code / C=Spec Compliance)
**Project root:** `/Users/peterpitcher/Cursor/OJ-CheersAI2.0/.claude/worktrees/loving-antonelli-8797d7`
**Base ref:** `HEAD~1`
**HEAD:** `be4b9e5`
**Diff range:** `HEAD~1...HEAD`

> This pack is the sole input for reviewers. Do NOT read files outside it unless a specific finding requires verification. If a file not in the pack is needed, mark the finding `Needs verification` and describe what would resolve it.

## Changed Files

_(none detected for this diff range)_

## User Concerns

Drop story_series as a campaign type. It's redundant — already falls through to event-style label logic. Existing story_series campaigns migrate to event campaigns; their content_items keep placement='story'. UI gains a placement multi-select on event + promotion forms; StorySeriesForm is deleted. Concerns: (a) data migration safety — any rows the UPDATE misses (constraint violation)? (b) any other code paths that branch on 'story_series' beyond the two found (campaign-timing.ts, proximity-label.ts, banner-label.ts, create/service.ts, create-wizard.tsx, story-series-form.tsx)? (c) is the placement multi-select the right UX or should story be a separate post-type toggle? (d) what happens if a user has a draft campaign in flight with type=story_series at deploy time?

## Spec

Source: `/Users/peterpitcher/Cursor/OJ-CheersAI2.0/.claude/worktrees/loving-antonelli-8797d7/docs/superpowers/specs/2026-05-07-drop-story-series-design.md`

```markdown
# Drop `story_series` campaign type — Design

**Date:** 2026-05-07
**Author:** Brainstormed with Peter
**Status:** Design draft, awaiting codex-qa-review

## Problem

`story_series` is a campaign type, but it is functionally identical to `event` — the only difference is that `story_series` produces story-placement posts and `event` produces feed-placement posts. The `extractCampaignTiming` and `getProximityLabel` code paths for `story_series` already fall through to the event-label logic.

This conflates two orthogonal axes:
- **Campaign intent** (event vs promotion vs weekly vs one-off) — drives label semantics.
- **Placement** (feed vs story) — drives post format.

The current model forces users to pick "Story Series" when they really want "an event with story posts". The user-facing UI carries five top-level campaign types when four would express the same surface. The user has flagged the create UI as more complex than they would like.

## Goal

Remove `story_series` as a campaign type. Stories become a placement choice on `event`, `promotion`, and `weekly` campaigns. Same expressiveness, fewer concepts.

## Non-goals

- Changing label rules. Stories continue to use the campaign-intent label set (event-style for events, promotion-style for promotions, weekly-style for weekly).
- Adding new campaign types.
- Reworking the entire create wizard. Only the type-picker and the per-type forms change.
- Touching the `placement` column on `content_items` — it already exists and is correct.

## Locked decisions

| # | Decision |
|---|---|
| 1 | Drop `story_series` from `campaigns.campaign_type` allowed values. |
| 2 | Existing `story_series` campaigns are migrated to `event` (campaign_type only — content_items keep `placement = 'story'`). |
| 3 | The "Story Series" option in the create wizard is removed. Event and promotion forms gain a placement multi-select (Feed / Story / Both). |
| 4 | `instant` and `weekly` posts default to feed-only for now (no UI change for those). Future work can extend if needed. |
| 5 | No new column on `campaigns`. Placement stays on `content_items`. The form just controls which content_items get generated. |

## Architecture

The fix is mostly subtractive. Five shapes change:

### 1. Schema (Migration 1)

Replace the existing `campaigns_campaign_type_check` constraint to drop `story_series`. Atomic with the data migration: `UPDATE campaigns SET campaign_type = 'event' WHERE campaign_type = 'story_series'` runs first; constraint is then re-created without `story_series`.

```sql
UPDATE campaigns SET campaign_type = 'event' WHERE campaign_type = 'story_series';
ALTER TABLE campaigns DROP CONSTRAINT campaigns_campaign_type_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_campaign_type_check
  CHECK (campaign_type IN ('event','promotion','weekly','instant'));
```

### 2. `CampaignTiming` type

In both copies (`src/lib/scheduling/campaign-timing.ts` and `supabase/functions/publish-queue/banner-label.ts`), drop `'story_series'` from the union. The fall-through assignment `campaign.campaign_type === "story_series" ? "story_series" : "event"` becomes just `'event'` — i.e., the line is deleted.

### 3. `getProximityLabel`

In both copies (`src/lib/scheduling/proximity-label.ts` and `supabase/functions/publish-queue/banner-label.ts`), delete the `case "story_series"` branch. Already redundant — both branches called `getEventLabel`.

### 4. Campaign creation

In `src/lib/create/service.ts`:
- Delete `createStorySeries` and its `StorySeriesInput` type.
- Extend `createEventCampaign` to accept an optional `placements: Array<'feed' | 'story'>` (default `['feed']`).
- For each chosen placement, generate the corresponding `content_items` with `placement` set accordingly.

The plan generation logic that's currently duplicated between `createEventCampaign` and `createStorySeries` collapses into one path that branches on placement at the content_items insert.

### 5. UI

In `src/features/create/`:
- Delete `story-series-form.tsx`.
- Remove the StorySeriesForm import and route from `create-wizard.tsx`.
- Remove the "Story Series" option from the type picker.
- Add a placement multi-select to `event-campaign-form.tsx` and `promotion-campaign-form.tsx`. Default: Feed only.
- The picker label might read "Where should this post?" with two checkboxes: "Feed" and "Stories" (Stories implies both Instagram and Facebook stories where the channels are connected; matches existing per-platform behaviour).

## Data flow

Unchanged. `content_items.placement` already drives the publish path. The publish worker reads placement and the renderer adapts accordingly. No schema changes outside the campaigns CHECK constraint.

## Edge cases

| Case | Handling |
|---|---|
| Existing `story_series` campaign with active content | Migrated to `event`. content_items retain their existing `placement = 'story'`. Banner labels are unchanged because story_series already used event-label logic. |
| Existing `story_series` campaign with `metadata.startDate` | Already shaped like an event campaign. No metadata transformation needed. |
| Existing `story_series` campaign with `metadata.placement = 'story'` | Field is left in place — harmless. After cleanup pass, can be removed. |
| Existing `story_series` campaign with no story content_items yet (drafts only) | Migrated to `event`. The user can regenerate with placement of choice. |
| User in mid-flight create flow on the Story Series step | The UI removes that step. Any in-flight session loses progress on that screen. Acceptable: the create wizard is short and re-runnable. |
| Tests using `campaign_type: 'story_series'` fixtures | Updated to `campaign_type: 'event'` with `placement: 'story'` content_items. |
| Code that explicitly switches on `campaign_type === 'story_series'` | Removed (only two such call sites — both fall through to event today). |

## Migration plan

Single migration. No dual-write window because `story_series` and `event` already produce identical output today.

**Migration:** `supabase/migrations/{ts}_drop_story_series_campaign_type.sql`
- Data step: `UPDATE campaigns SET campaign_type = 'event' WHERE campaign_type = 'story_series'`
- Schema step: drop and recreate `campaigns_campaign_type_check` without `story_series`
- Idempotent: `IF EXISTS` on the constraint drop; the UPDATE is a no-op when no rows match.

**Code commits** (each green at HEAD):
1. Migration only — applied later by orchestrator.
2. Drop `story_series` from `CampaignTiming` union and `getProximityLabel` (both Node and Deno copies).
3. Replace `createStorySeries` with placement-aware `createEventCampaign`. Update tests.
4. UI: remove StorySeriesForm, add placement multi-select to event + promotion forms.
5. Delete `story-series-form.tsx` and dead test fixtures.

## Files affected

### New
- `supabase/migrations/{ts}_drop_story_series_campaign_type.sql`

### Modified
- `src/lib/scheduling/campaign-timing.ts` — drop story_series from union and resolveType.
- `src/lib/scheduling/proximity-label.ts` — drop case story_series.
- `supabase/functions/publish-queue/banner-label.ts` — drop story_series from union, resolveType, and case branch.
- `src/lib/create/service.ts` — delete createStorySeries; add `placements` arg to createEventCampaign; (optionally) extend createPromotionCampaign similarly.
- `src/features/create/create-wizard.tsx` — drop StorySeriesForm route.
- `src/features/create/event-campaign-form.tsx` — add placement multi-select.
- `src/features/create/promotion-campaign-form.tsx` — add placement multi-select.
- Any tests under `tests/lib/create/`, `tests/lib/scheduling/`, `tests/supabase/publish-queue/` that reference `'story_series'` — update to `'event'` with story content_items where appropriate.

### Deleted
- `src/features/create/story-series-form.tsx` and any sibling test file.

## Testing strategy

- **Unit — `extractCampaignTiming`**: existing tests updated; one new test asserts an event campaign with no `metadata.startTime` produces the expected timing.
- **Unit — `getProximityLabel`**: existing tests covering events stay; story_series-specific tests removed.
- **Integration — `createEventCampaign`**: new tests for `placements: ['story']` (story-only) and `placements: ['feed','story']` (both). Asserts the right number of `content_items` rows with the right `placement`.
- **Migration test (manual)**: seed a `story_series` row, run migration, assert it's now `event` with story content_items intact.
- **CI verify**: `npm run ci:verify` clean.

## Out of scope

- Adding placement to `weekly` and `instant` (defer; current behaviour stays).
- Reworking the campaign-creation wizard navigation.
- Removing `metadata.placement` from migrated rows (cosmetic; leave for a later cleanup).
- Updating Obsidian/architecture docs (regenerated by the next session-setup pass).
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
