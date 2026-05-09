# Tournament Content Module — Design Spec

**Date:** 2026-05-09
**Status:** Approved (revised after Codex adversarial review)
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
| house_rules_text | text | YES | | Closing-time blurb displayed on overlay (max 200 chars) |
| post_template | text | NO | | Post copy with placeholders (max 500 chars) |
| platforms | text[] | NO | '{instagram,facebook}' | Target platforms — controls which content is generated |
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
| team_a | text | NO | | Team name or placeholder code (max 50 chars) |
| team_b | text | NO | | Team name or placeholder code (max 50 chars) |
| teams_confirmed | bool | NO | false | Gate for content generation |
| kick_off_at | timestamptz | NO | | Kick-off in UTC |
| venue_city | text | YES | | "Mexico City, Mexico" |
| showing | bool | NO | false | Whether the pub is showing this game |
| showing_note | text | YES | | "May run past closing" etc. |
| booking_url | text | YES | | "Book Table" link (must be `https://` — validated on save) |
| content_generated | bool | NO | false | Whether social content has been created |
| created_at | timestamptz | NO | now() | |
| updated_at | timestamptz | NO | now() | |

- RLS enabled, scoped via tournament → account_id
- Unique constraint on (tournament_id, match_number)
- Index on (tournament_id, showing, teams_confirmed) for filtering

### Input validation rules

| Field | Rule |
|-------|------|
| team_a, team_b | Max 50 characters, plain text only |
| house_rules_text | Max 200 characters |
| post_template | Max 500 characters |
| booking_url | Must be `https://` protocol or null. Reject `http://`, `javascript:`, and other schemes. |
| slug | Lowercase alphanumeric + hyphens only |

### Relationship to existing content pipeline

Fixtures do NOT have a direct FK to `content_items`. Instead:
- `content_items.metadata` JSONB stores `{ tournament_fixture_id: uuid, tournament_id: uuid, source: 'tournament' }` when generated from a fixture
- This keeps the tournament module decoupled from the core content pipeline
- Lookup: `content_items.metadata->>'tournament_fixture_id' = fixture.id AND content_items.account_id = tournament.account_id`
- The `source: 'tournament'` discriminator prevents accidental cross-contamination with non-tournament content

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
4. Two renders per fixture: square (1080x1080) and story (1080x1920)

**Output:**
- One `media_assets` row per content item (not shared across items)
- Each media asset tagged with `{ tournament_fixture_id, source: 'tournament' }` in a metadata column or derived_variants JSONB
- Referenced by `content_variants.media_ids`
- This 1:1 ownership model simplifies cleanup — deleting a content item deletes its own media asset with no cross-reference risk

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

### Tournament-level preconditions

Before any content can be generated (single or bulk), the tournament must satisfy ALL of:
- `tournament.status = 'active'`
- `tournament.base_image_square_id IS NOT NULL`
- `tournament.base_image_story_id IS NOT NULL`
- `tournament.post_template IS NOT NULL AND != ''`
- `tournament.platforms` has at least one entry
- At least one social connection exists for each platform in `tournament.platforms` (checked via existing connection helpers)

If preconditions are not met, the UI disables generation buttons and shows which requirements are missing.

### Fixture-level trigger conditions

Content generates for a fixture when ALL of:
- Tournament preconditions pass (above)
- `showing = true`
- `teams_confirmed = true`
- `content_generated = false`

### What gets created (dynamic, platform-driven)

Generation iterates `tournament.platforms × [feed, story]` to build the content item list. For the default `['instagram', 'facebook']` this produces 4 items:

| # | Platform | Placement | Image | Post Copy |
|---|----------|-----------|-------|-----------|
| 1 | instagram | feed | Square overlay | Template text |
| 2 | instagram | story | Story overlay | None (image-only) |
| 3 | facebook | feed | Square overlay | Template text |
| 4 | facebook | story | Story overlay | None (image-only) |

If a user configures only `['instagram']`, only 2 items are created. The platforms field on the tournament controls what gets generated — it is not decorative.

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
- Uses existing `enqueuePublishJob()` from `src/lib/publishing/queue.ts` — does NOT write directly to publish_jobs
- Runs existing preflight validation (`getPublishReadinessIssues()`) per content item before queuing
- If preflight fails for a content item, that item is created but not queued — surfaces as `blocked` status in fixture table
- Existing publish cron picks up queued jobs — no changes to publish pipeline

**Same-time stagger:** when multiple fixtures share the same `kick_off_at`, content is staggered deterministically:
- Sort fixtures by `match_number` ascending
- Offset = `fixture_index × 5 minutes` (where index is 0-based position in the sorted group)
- This formula is applied consistently on initial generation, bulk generation, and kick-off time changes

**Past scheduled time handling:** if `scheduled_for` would be in the past (fixture confirmed late):
- Content items are created with the past `scheduled_for`
- Publish jobs are NOT auto-queued
- Fixture shows `past_due` status in the UI with a "Publish Now" button
- User must explicitly confirm to queue immediately

### Triggers

1. **Single fixture save** — user edits fixture and clicks "Save & Generate". Server action validates, generates content, runs preflight, queues eligible jobs.
2. **Bulk generate** — "Generate All" button processes all fixtures matching trigger conditions. Server-side lock prevents concurrent bulk runs per tournament. UI debounces the button.

### Generation transaction and idempotency

All generation for a single fixture runs as an atomic operation:

1. Acquire advisory lock on `fixture.id` (prevents concurrent generation for the same fixture)
2. Re-check `content_generated = false` inside the lock
3. Render overlay images (square + story)
4. Upload to Supabase storage, create `media_assets` rows
5. Create `content_items` with `metadata = { tournament_fixture_id, tournament_id, source: 'tournament' }`
6. Create `content_variants` linking to media assets
7. Run preflight per item; enqueue passing items via `enqueuePublishJob()`
8. Set `content_generated = true` on the fixture
9. Release lock

If any step fails after media upload:
- Clean up uploaded storage objects and media_assets rows
- Leave `content_generated = false` so generation can be retried
- Surface the error in the UI

**Idempotency:** the advisory lock + `content_generated` re-check inside the lock prevents double generation from concurrent save + bulk-generate clicks.

---

## Regeneration & Lifecycle

### Team name update (fixture already has content)

When team names change on a fixture where `content_generated = true`:
1. Find all content items with `metadata->>'tournament_fixture_id' = fixture.id AND account_id = tournament.account_id AND metadata->>'source' = 'tournament'`
2. Identify which `(platform, placement)` combinations are already published (publish_jobs.status = 'published')
3. For unpublished items: delete publish_jobs, content_variants, media_assets (verified unshared), and content_items
4. Regenerate content ONLY for the `(platform, placement)` combinations that were deleted — skip already-published combinations
5. If all items were published, no regeneration occurs — `content_generated` stays true
6. If some were regenerated, run preflight and queue eligible items

### Showing status change

- **Showing → not showing:** delete all unpublished content for that fixture (same scoped query as above), set `content_generated = false` only if no published content remains
- **Not showing → showing:** if `teams_confirmed = true` and tournament preconditions pass, trigger content generation

### Kick-off time change

- Recalculate `scheduled_for` on all unpublished content items for that fixture
- Update `next_attempt_at` on queued publish jobs via existing queue helpers
- Recompute stagger offsets for all fixtures sharing the old or new kick-off time

### Tournament setting changes

- **`post_lead_hours` change:** applies to future generation only. Existing unpublished content retains its current schedule. Document this in the settings UI.
- **`platforms` change:** applies to future generation only. Does not retroactively add/remove content for already-generated fixtures.

### Tournament archival

- Setting status to `archived` prevents new content generation (enforced in all generation paths via tournament precondition check)
- Existing scheduled/published content is left alone
- Archived tournaments are hidden from the main list but still queryable
- UI offers an optional "Cancel all queued content" action on archival — this deletes all queued (unpublished) publish jobs for the tournament

---

## Server Action Requirements

All tournament server actions in `src/app/actions/tournament.ts` MUST:

1. Call `getUser()` at the top of every action
2. Verify the authenticated user owns the `account_id` of the tournament being operated on
3. Scope all database queries with `account_id = user.account_id` as defence-in-depth (not just RLS)
4. Include `metadata->>'source' = 'tournament'` when querying content items to prevent cross-contamination
5. Call `revalidatePath()` after mutations

### Actions to implement

| Action | Auth | Writes |
|--------|------|--------|
| createTournament | getUser + account ownership | tournaments |
| updateTournament | getUser + account ownership | tournaments |
| archiveTournament | getUser + account ownership | tournaments, optionally publish_jobs |
| updateFixture (save without generate) | getUser + account ownership | tournament_fixtures |
| saveAndGenerateFixture | getUser + account ownership + tournament preconditions | tournament_fixtures, media_assets, content_items, content_variants, publish_jobs |
| bulkGenerate | getUser + account ownership + tournament preconditions + server lock | Same as above, for multiple fixtures |
| publishNowFixture | getUser + account ownership | publish_jobs (queue past-due items) |
| deleteFixtureContent | getUser + account ownership | content_items, content_variants, media_assets, publish_jobs |

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
- "Generate All" bulk action button (disabled if tournament preconditions not met, with tooltip showing what's missing)
- Summary stats bar: total / showing / confirmed / scheduled / published

**Fixture table (main workspace):**
- All fixtures in a sortable, filterable table
- Columns: Match #, Date/Time (Europe/London), Team A, Team B, Group/Round, Showing, Confirmed, Status
- **Inline editing** for team names — click cell, type, tab to next. Edits are draft state until saved.
- Showing toggle (checkbox) per row
- "Save & Generate" button per row (replaces auto-fire on blur)
- Content status badges: `no teams` / `ready` / `blocked` / `past_due` / `scheduled` / `published`
- Filters: All / Showing only / Needs team names / Ready to generate / Blocked
- Sort by: date (default), match number, status

**Editing flow for TBD teams:**
1. Click "W73" in Team A cell → editable input appears
2. Type "Germany", tab to Team B
3. Type "Japan" — row shows as "modified" (draft state)
4. `teams_confirmed` auto-suggests `true` when both names no longer match placeholder patterns (visual indicator, not auto-saved)
5. Click "Save & Generate" → server action validates, generates content, schedules
6. Status updates to "scheduled" (or "blocked" if preflight fails, or "past_due" if scheduled time has passed)

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
| Multiple fixtures at same kick-off time | Stagger by match_number: offset = index × 5 minutes |
| Fixture kick-off time changes | Recalculate scheduled_for, recompute stagger for affected group |
| Fixture toggled to "not showing" | Delete unpublished content; content_generated = false if nothing published |
| Team names updated after content exists | Delete unpublished content, regenerate only for unpublished (platform, placement) combos |
| Content already published, team name changes | Published content left alone; only unpublished placements regenerated |
| All items for a fixture published | content_generated stays true, fixture shows "published" status |
| Very long team name (e.g. "Bosnia & Herzegovina") | Satori auto-scales font down if text exceeds 85% image width |
| Tournament archived | No new content generated; optional cancel-queued action offered |
| Fixture has no booking_url | `{booking_url}` placeholder renders as empty string in post copy |
| Fixture confirmed after scheduled time passed | Content created but not queued; shows "past_due" with "Publish Now" button |
| Tournament missing base images | Generation disabled; UI shows which preconditions are missing |
| Concurrent save + bulk generate | Advisory lock prevents double generation per fixture |
| Generation fails mid-way | Partial writes cleaned up; content_generated stays false; error surfaced in UI |
| Preflight fails for a fixture | Content items created but publish jobs not queued; status shows "blocked" |
| Booking URL with non-https protocol | Rejected on save with validation error |

---

## Technical Boundaries

### What this module owns
- `tournaments` and `tournament_fixtures` tables + RLS policies
- Tournament overlay renderer (`src/lib/tournament/overlay.ts`)
- Tournament server actions (`src/app/actions/tournament.ts`)
- Tournament management pages (`src/app/(app)/dashboard/tournaments/`)
- Tournament-specific data fetching hooks
- Tournament content generation service (`src/lib/tournament/generate.ts`)

### What this module reuses (no changes needed)
- `content_items`, `content_variants`, `publish_jobs` tables
- `media_assets` table and Supabase storage
- Existing publish cron (`/api/cron/publish/`)
- Existing preflight validation (`src/lib/publishing/preflight.ts`)
- Existing `enqueuePublishJob()` from `src/lib/publishing/queue.ts`
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
3. Can inline-edit team names and Save & Generate to create content
4. Can bulk-generate content for all confirmed+showing fixtures (with server-side lock)
5. Generated overlay images match the approved mockup (classic centre stack, supersized, white text, gold accents)
6. Content schedules 24 hours before kick-off via existing publish pipeline (using `enqueuePublishJob()`)
7. Updating team names regenerates only unpublished content correctly (published placements preserved)
8. Toggling showing status creates/removes content appropriately
9. Existing banner system, campaign creation, and scheduling are completely unaffected
10. Module is reusable — can create a "Euro 2028" tournament with different base images and fixtures
11. All server actions verify auth + account ownership
12. Preflight validation runs before queuing; failures surface as "blocked" status
13. Past-due fixtures show warning and require explicit "Publish Now" confirmation
14. Input validation enforced: URL scheme, text lengths, required fields
