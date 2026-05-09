# Review Pack: tournament-content-spec

**Generated:** 2026-05-09
**Mode:** A (A=Adversarial / B=Code / C=Spec Compliance)
**Project root:** `/Users/peterpitcher/Cursor/OJ-CheersAI2.0/.claude/worktrees/inspiring-cerf-4ad700`
**Base ref:** `main`
**HEAD:** `9e8c79b`
**Diff range:** `main...HEAD`

> This pack is the sole input for reviewers. Do NOT read files outside it unless a specific finding requires verification. If a file not in the pack is needed, mark the finding `Needs verification` and describe what would resolve it.

## Changed Files

_(none detected for this diff range)_

## User Concerns

Spec review: tournament content module design — challenge data model, content generation flow, edge cases, and integration boundaries

## Diff (`main...HEAD`)

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


## Design Spec Under Review

```markdown
# Tournament Content Module — Design Spec

**Date:** 2026-05-09
**Status:** Approved
**Scope:** CheersAI 2.0 — standalone tournament management with automated social content generation and scheduling
**Out of scope:** Website API for The Anchor pub (follow-on work)

---

## Problem

The Anchor needs to promote World Cup 2026 games on social media (Instagram + Facebook). Each showing game needs a branded post and story published 24 hours before kick-off, with team names, date/time, and house rules overlaid onto a tournament template image. Many team names are TBD until knockout rounds resolve. This should be reusable for future tournaments (Euros, etc.).

## Solution

A standalone tournament module with:
- Two new database tables (`tournaments`, `tournament_fixtures`)
- A dedicated management UI at `/dashboard/tournaments`
- A Satori + Sharp overlay renderer (separate from the existing banner system)
- Integration with the existing content_items → publish_jobs pipeline for scheduling and publishing

---

## Data Model

### `tournaments`

| Column | Type | Nullable | Default | Purpose |
|--------|------|----------|---------|---------|
| id | uuid | NO | uuid_generate_v4() | PK |
| account_id | uuid FK → accounts | NO | | Owner account |
| name | text | NO | | Display name, e.g. "FIFA World Cup 2026" |
| slug | text | NO | | URL-friendly key, e.g. `world-cup-2026` |
| status | text | NO | 'draft' | `draft` / `active` / `archived` |
| base_image_square_id | uuid FK → media_assets | YES | | Square (1:1) template image |
| base_image_story_id | uuid FK → media_assets | YES | | Story (9:16) template image |
| house_rules_text | text | YES | | Closing-time blurb displayed on overlay |
| post_template | text | NO | | Post copy with `{team_a}`, `{team_b}`, `{date}`, `{time}`, `{booking_url}` placeholders |
| platforms | text[] | NO | '{instagram,facebook}' | Target platforms |
| post_lead_hours | int | NO | 24 | Hours before kick-off to publish |
| created_at | timestamptz | NO | now() | |
| updated_at | timestamptz | NO | now() | |

- RLS enabled, scoped to account_id
- Unique constraint on (account_id, slug)

### `tournament_fixtures`

| Column | Type | Nullable | Default | Purpose |
|--------|------|----------|---------|---------|
| id | uuid | NO | uuid_generate_v4() | PK |
| tournament_id | uuid FK → tournaments | NO | | Parent tournament (CASCADE delete) |
| match_number | int | NO | | Official match number (1–104) |
| round | text | NO | | `group_stage` / `round_of_32` / `round_of_16` / `quarter_final` / `semi_final` / `third_place` / `final` |
| group_name | text | YES | | "Group A" etc. Null for knockout rounds |
| team_a | text | NO | | Team name or placeholder code |
| team_b | text | NO | | Team name or placeholder code |
| teams_confirmed | bool | NO | false | Gate for content generation |
| kick_off_at | timestamptz | NO | | Kick-off in UTC |
| venue_city | text | YES | | "Mexico City, Mexico" |
| showing | bool | NO | false | Whether the pub is showing this game |
| showing_note | text | YES | | "May run past closing" etc. |
| booking_url | text | YES | | "Book Table" link |
| content_generated | bool | NO | false | Whether social content has been created |
| created_at | timestamptz | NO | now() | |
| updated_at | timestamptz | NO | now() | |

- RLS enabled, scoped via tournament → account_id
- Unique constraint on (tournament_id, match_number)
- Index on (tournament_id, showing, teams_confirmed) for filtering

### Relationship to existing content pipeline

Fixtures do NOT have a direct FK to `content_items`. Instead:
- `content_items.metadata` JSONB stores `{ tournament_fixture_id: uuid }` when generated from a fixture
- This keeps the tournament module decoupled from the core content pipeline
- Lookup: `content_items.metadata->>'tournament_fixture_id' = fixture.id`

---

## Overlay Renderer

### Design

Separate code path from the existing banner system (`src/lib/banner/`). Lives in `src/lib/tournament/overlay.ts`.

**Overlay layout (approved mockup — "Classic Centre Stack, supersized"):**
- Group/round label — small, uppercase, white at 70% opacity, letter-spaced
- Team A name — large, bold, white, uppercase
- "vs" — gold (#c9952e), smaller weight
- Team B name — large, bold, white, uppercase
- Date — gold, medium weight
- "KICK-OFF {TIME}" — large, bold, white
- House rules — small, white at 60% opacity, bottom of content area

**Positioning:**
- Content area: top 18% to bottom 10% of image (centred via flexbox)
- No logo rendered (template image already contains it)
- No flags

**Rendering pipeline:**
1. Satori renders overlay as SVG from a React-like JSX template
2. Dynamic font sizing: if team name text exceeds 85% of image width, scale font down
3. Sharp composites SVG onto base template image (JPEG, quality 92)
4. Two outputs per fixture: square (1080x1080) and story (1080x1920)

**Output:**
- Saved to `media_assets` table with `account_id` from tournament
- Referenced by `content_variants.media_ids`

### Colour palette

| Element | Colour |
|---------|--------|
| Team names | #FFFFFF |
| "vs" | #c9952e (gold) |
| Date | #c9952e (gold) |
| Kick-off time | #FFFFFF |
| Group/round label | rgba(255,255,255,0.7) |
| House rules | rgba(255,255,255,0.6) |

---

## Content Generation Flow

### Trigger conditions

Content generates for a fixture when ALL of:
- `showing = true`
- `teams_confirmed = true`
- `content_generated = false`

### What gets created (4 items per fixture)

| # | Platform | Placement | Image | Post Copy |
|---|----------|-----------|-------|-----------|
| 1 | instagram | feed | Square overlay | Template text |
| 2 | instagram | story | Story overlay | None (image-only) |
| 3 | facebook | feed | Square overlay | Template text |
| 4 | facebook | story | Story overlay | None (image-only) |

### Post copy template (default, editable per tournament)

```
We're showing {team_a} vs {team_b} live at The Anchor!

{group_round}
Kick-off: {date} at {time}

{house_rules}

{booking_url}
```

Available placeholders: `{team_a}`, `{team_b}`, `{date}`, `{time}`, `{group_round}`, `{house_rules}`, `{booking_url}`. Empty values render as blank (no leftover braces).

### Scheduling

- `content_items.scheduled_for` = `kick_off_at - post_lead_hours` (default 24h before)
- `publish_jobs` created with `status = 'queued'`, `next_attempt_at = scheduled_for`
- Existing publish cron picks up jobs — no changes to publish pipeline
- **Same-time stagger:** when two fixtures have identical `kick_off_at`, the second fixture's content is offset by +5 minutes to avoid platform rate limits and feed spam

### Triggers

1. **Single fixture** — save fixture with confirmed teams → server action generates 4 content items + overlay images + publish jobs
2. **Bulk generate** — "Generate All" button processes all fixtures matching trigger conditions

---

## Regeneration & Lifecycle

### Team name update (fixture already has content)

When team names change on a fixture where `content_generated = true`:
1. Find all content items with `metadata->>'tournament_fixture_id' = fixture.id`
2. For items where publish_jobs.status != 'published': delete publish_jobs, content_variants, content_items, and associated media_assets
3. Regenerate fresh content with new team names
4. Already-published content is never touched

### Showing status change

- **Showing → not showing:** delete all unpublished content for that fixture, set `content_generated = false`
- **Not showing → showing:** if `teams_confirmed = true`, trigger content generation

### Kick-off time change

- Recalculate `scheduled_for` on all unpublished content items for that fixture
- Update `next_attempt_at` on queued publish jobs

### Tournament archival

- Setting status to `archived` prevents new content generation
- Existing scheduled/published content is left alone
- Archived tournaments are hidden from the main list but still queryable

---

## Management UI

### Route: `/dashboard/tournaments`

Tournament list page:
- Card/row per tournament with name, status badge, date range
- Progress stats: "34/52 fixtures confirmed, 28/52 scheduled"
- "New Tournament" button

### Route: `/dashboard/tournaments/[id]`

Tournament detail page with two zones:

**Header zone:**
- Tournament name + status badge
- Base image previews (square + story)
- Edit button → settings modal (name, house rules, post template, platforms, lead hours, base images)
- "Generate All" bulk action button
- Summary stats bar: total / showing / confirmed / scheduled / published

**Fixture table (main workspace):**
- All fixtures in a sortable, filterable table
- Columns: Match #, Date/Time (Europe/London), Team A, Team B, Group/Round, Showing, Confirmed, Status
- **Inline editing** for team names — click cell, type, tab to next
- Showing toggle (checkbox) per row
- Content status badges: `no teams` / `ready` / `scheduled` / `published`
- Filters: All / Showing only / Needs team names / Ready to generate
- Sort by: date (default), match number, status

**Inline editing flow for TBD teams:**
1. Click "W73" in Team A cell → editable input appears
2. Type "Germany", tab to Team B
3. Type "Japan", press Enter or click away
4. `teams_confirmed` auto-sets to `true` when both names no longer match known placeholder patterns
5. Server action fires → generates content → status updates to "scheduled"

**Placeholder pattern detection** (used for auto-confirm convenience):
- Single letter + digits: `A1`, `B2`, `C3`
- `W` + digits: `W73`, `W89`
- Digit + letter: `1C`, `2F`
- `RU` + digits: `RU101`, `RU102`
- Complex group references: `3ABCDF`, `3CDFGH`, `3EHIJK`
- FIFA/UEFA qualifiers: `FIFA PO 1`, `UEFA PO A`, `UEFA PO B`, `UEFA PO C`, `UEFA PO D`
- Regex: `/^[A-Z]{1,4}\d+$|^\d[A-Z]+$|^(FIFA|UEFA)\s+PO\s+/i`

Note: `teams_confirmed` can also be manually toggled as a fallback if auto-detection doesn't match a pattern.

---

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| Two fixtures at same kick-off time | Second fixture's posts staggered +5 minutes |
| Fixture kick-off time changes | Recalculate scheduled_for on unpublished content |
| Fixture toggled to "not showing" | Delete unpublished content, reset content_generated |
| Team names updated after content exists | Delete unpublished content, regenerate with new names |
| Content already published, team name changes | Published content left alone (already posted) |
| Very long team name (e.g. "Bosnia & Herzegovina") | Satori auto-scales font down if text exceeds 85% image width |
| Tournament archived | No new content generated; existing content untouched |
| All 4 posts for a fixture published | `content_generated` stays true, fixture shows "published" status |
| Fixture has no booking_url | `{booking_url}` placeholder renders as empty string in post copy |

---

## Technical Boundaries

### What this module owns
- `tournaments` and `tournament_fixtures` tables + RLS policies
- Tournament overlay renderer (`src/lib/tournament/overlay.ts`)
- Tournament server actions (`src/app/actions/tournament.ts`)
- Tournament management pages (`src/app/(app)/dashboard/tournaments/`)
- Tournament-specific data fetching hooks

### What this module reuses (no changes needed)
- `content_items`, `content_variants`, `publish_jobs` tables
- `media_assets` table and Supabase storage
- Existing publish cron (`/api/cron/publish/`)
- Existing preflight validation (`src/lib/publishing/preflight.ts`)
- Existing social connection infrastructure

### What this module does NOT touch
- Banner overlay system (`src/lib/banner/`)
- Campaign creation wizard (`src/features/create/`)
- Materialise/scheduling system (`src/lib/scheduling/`)
- Any existing campaign types (event, promotion, weekly, instant)

---

## Data Seeding

Initial World Cup 2026 fixture data (104 matches) will be seeded via a migration or ops script. Fixture data includes:
- Match numbers 1–104
- Kick-off times in UTC (converted from the UK times provided)
- Group/round classifications
- Placeholder team names (A1, B2, W73, etc.)
- Showing/not-showing status
- Showing notes ("May run past closing")
- Venue city information

This seed data is specific to the World Cup 2026 tournament instance. Future tournaments would be populated via the management UI or a similar import mechanism.

---

## Success Criteria

1. Can create a tournament with base images, house rules, and post template
2. Can view all 104 fixtures in a filterable, sortable table
3. Can inline-edit team names and have content auto-generate
4. Can bulk-generate content for all confirmed+showing fixtures
5. Generated overlay images match the approved mockup (classic centre stack, supersized, white text, gold accents)
6. Content schedules 24 hours before kick-off via existing publish pipeline
7. Updating team names regenerates unpublished content correctly
8. Toggling showing status creates/removes content appropriately
9. Existing banner system, campaign creation, and scheduling are completely unaffected
10. Module is reusable — can create a "Euro 2028" tournament with different base images and fixtures

```
