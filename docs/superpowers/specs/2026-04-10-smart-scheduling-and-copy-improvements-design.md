# Smart Scheduling & Copy Engagement Improvements

**Date:** 2026-04-10
**Status:** Draft (v2 — updated after QA review)
**Complexity:** L (7+ files, new scheduling algorithm, prompt changes, schema changes)
**QA Report:** `tasks/codex-qa-review/2026-04-10-smart-scheduling-copy-codex-qa-report.md`

## Problem

Campaign posts cluster on the same days because cadences use fixed weekdays. A "post every Thursday" campaign means Thursday gets stacked while Monday-Wednesday sit empty. When multiple campaigns overlap, some days get 3+ posts and others get none.

Additionally, the copy generation system produces solid output but lacks variety mechanisms. Consecutive posts often share similar opening structures, angles, and tone regardless of when they're scheduled relative to the event.

## Success Criteria

1. Weekly campaigns can use a "spread evenly" mode that distributes posts across the emptiest days in the calendar
2. Multi-platform posts stagger across different days by default, maximising calendar coverage
3. Post copy varies in opening hook style across consecutive posts
4. Post copy reflects temporal proximity to the event (early awareness vs same-day urgency)
5. Each platform gets sharper, differentiated copy that plays to its strengths
6. Content angle varies based on what recent posts have covered
7. Existing fixed-day cadence mode continues to work unchanged

## Non-Goals

- No new post types or campaign types
- No changes to story scheduling (stories remain exempt from conflict logic)
- No changes to the review/edit/approve workflow
- No changes to post-processing, linting, or content-rules pipelines
- No changes to the publishing queue mechanics
- Event and promotion campaigns are out of scope for spread-evenly (they have fixed offset-based schedules)

---

## Part 0: Prerequisite Fixes (before feature work)

The QA review identified existing bugs and gaps that must be resolved before building new features on top.

### 0.1 Fix `findResolution()` in `conflicts.ts`

**Bug:** The function always returns +15 minutes because the resolution window check is always true for the given offsets (max 60 min vs 120 min window). It also never checks whether the candidate time conflicts with *other* occupied slots — only the triggering conflict.

**Fix:** Pass the full `occupied` array into `findResolution()` and verify each candidate does not conflict with any existing slot (same platform, within 30 minutes). Test with: two existing posts at 12:00 and 12:30 — a third post at 12:00 should resolve to 13:00, not 12:15.

### 0.2 Fix `reserveSlotOnSameDay()` in `service.ts`

**Bug:** Only searches forward from the requested time. A post requested at 11pm throws "no slots remain" instead of searching backward to earlier unused slots.

**Fix:** After forward search fails, search backward from the requested time before throwing. This ensures late-evening requests find morning/afternoon gaps.

### 0.3 Fix cross-campaign conflict detection in `materialise.ts`

**Bug:** `materialise.ts` only checks conflicts within the same campaign when calling `resolveConflicts()`. Two weekly campaigns can both schedule posts at the same time on the same day for the same platform.

**Fix:** Query all existing `content_items` for the account in the materialisation window (not just the current campaign) and include them in the occupied slots when resolving conflicts. Mirror the pattern used in `service.ts:resolveScheduleConflicts()`.

### 0.4 Fix `describeEventTimingCue()` post-event handling

**Bug:** Posts scheduled after an event are described as "event is underway now" instead of a recap tone.

**Fix:** Add a post-event bracket: if `scheduledFor > eventEnd` (or `eventStart + reasonable duration`), return a recap-oriented cue. This aligns with the new temporal proximity system in Part 5.

### 0.5 Add composite database index

```sql
CREATE INDEX idx_content_items_account_schedule
ON content_items(account_id, scheduled_for);
```

The spread algorithm queries `content_items` filtered by `account_id` + date range. This index ensures efficient lookups regardless of window size.

### 0.6 Write baseline tests

Before modifying any business logic, write tests for:
- `src/lib/scheduling/conflicts.test.ts` — conflict resolution, slot reservation
- `src/lib/scheduling/materialise.test.ts` — campaign materialisation, cadence parsing
- `src/lib/ai/content-rules.test.ts` — channel rules, linting, claim detection
- `src/lib/ai/voice.test.ts` — banned phrase scrubbing, hype reduction

Minimum: happy path + 1 error/edge case per function.

### 0.7 Parallelise OpenAI API calls

**Current:** `generateVariants()` iterates platforms with `for...of` + `await` sequentially. `buildVariants()` iterates plans sequentially. A 3-platform, 4-week campaign = 12 sequential API calls = 12-36 seconds.

**Fix:** Use `Promise.all()` for platform calls within a plan (max 3 concurrent). Use `p-limit(4)` for parallelising plans. Combined: reduces 12-call campaigns from ~36s to ~9s.

### 0.8 Extract shared utility

Extract `formatFriendlyTime()` (duplicated in `prompts.ts` and `service.ts`) to `src/lib/utils/date.ts`.

### 0.9 Add missing return types

Add explicit return types to all exported functions in: `voice.ts`, `service.ts`, `materialise.ts`, `content-rules.ts` (where missing). Per workspace CLAUDE.md convention.

---

## Part 1: Smart Scheduling — "Spread Evenly" Mode

### Scope: Weekly Campaigns Only

The spread-evenly mode applies to **weekly campaigns only**. Event campaigns use offset-based scheduling and promotion campaigns use phased scheduling — both have fixed temporal relationships to their target dates that spread-evenly would break. The existing per-campaign-type schema architecture remains unchanged.

### Weekly Campaign Schema Changes

The weekly campaign schema (`weeklyCampaignSchema` in `schema.ts`) gains new fields:

```typescript
// Added to weeklyCampaignSchema
scheduleMode: z.enum(["fixed_days", "spread_evenly"]).default("fixed_days"),
postsPerWeek: z.number().int().min(1).max(7).optional(),
staggerPlatforms: z.boolean().default(true),
```

Validation rule: `postsPerWeek` is required when `scheduleMode` is `"spread_evenly"`, ignored otherwise. Added via `.superRefine()`.

The weekly campaign service function (`createWeeklyCampaign` in `service.ts`) reads these fields from the validated input and stores them in the campaign `metadata` JSONB column. On read, `parseCadence()` in `materialise.ts` is extended to also parse these new fields with a typed `parseWeeklyCampaignMetadata()` function using Zod validation.

### Spread Algorithm

When `scheduleMode` is `spread_evenly`:

1. Determine the scheduling window: campaign start date to `weeksAhead` weeks later
2. Fetch all existing scheduled feed posts for the **authenticated account** in that window using a single query with `.eq("account_id", accountId)` — selecting only `scheduled_for, platform, placement`
3. Build a day-occupancy map: count feed posts per day (Monday-Sunday) per week
4. Score each day: empty = highest priority, 1 post = medium, 2+ posts = lowest
5. Place new posts on the highest-scoring (emptiest) days first
6. Enforce a minimum 1-day gap between posts on the same platform within the same campaign
7. If all 7 days are occupied, double up on the least-busy day
8. **Fallback priority** (when constraints conflict): preserve post count > preserve min-gap > same-day bypass. Explicitly: a 1-day campaign window places the post on that day regardless of occupancy or gap rules.

**Auth requirement:** The spread algorithm runs within the existing `createWeeklyCampaign()` flow, which calls `requireAuthContext()`. All queries are scoped to the authenticated `accountId`. The algorithm MUST NOT be callable outside this authenticated context.

### Platform Staggering

New `staggerPlatforms` boolean on weekly campaign metadata (default: `true`).

When `staggerPlatforms` is `true` and a post targets multiple platforms:

- Each platform version is placed on a different day within the same week
- Platform priority order: Instagram (visual teaser first), Facebook (detail/engagement), GBP (factual/SEO)
- Example: if 3 empty days are Tuesday, Wednesday, Thursday — Instagram gets Tuesday, Facebook gets Wednesday, GBP gets Thursday
- **Insufficient empty days:** If fewer empty days than platforms, group remaining platforms onto the least-busy available day. E.g., 2 empty days + 3 platforms: Instagram gets day 1, Facebook + GBP share day 2.

When staggering is bypassed (automatic):

- Same-day posts (scheduled for the day of the event) publish to all platforms simultaneously
- The system detects this by comparing the post's scheduled date against the event/promotion date

When `staggerPlatforms` is `false`:

- All platform versions go out on the same day (existing behaviour)

### Time Selection

Default posting times are engagement-optimised rather than a fixed time:

- **7+ days before event:** 12pm (lunch browsers, planning ahead)
- **1-6 days before event:** 12pm (lunch browsers)
- **Same day, auto-selected:** 5pm (after-work crowd, high intent)
- **User override:** Posting defaults gain a `default_posting_time` field; if set, this takes precedence

The existing 30-minute slot conflict resolution within a day remains unchanged (after the prerequisite fix in 0.1/0.2).

### Posting Defaults Schema Changes

New fields are added to the **posting defaults** model (not `BrandProfile`, which is voice/tone-oriented):

**Database migration:**

```sql
-- Add to posting_defaults table (or accounts table if posting_defaults is JSONB)
ALTER TABLE posting_defaults ADD COLUMN default_posting_time text
  CHECK (default_posting_time IS NULL OR default_posting_time ~ '^([01]\d|2[0-3]):[0-5]\d$');
ALTER TABLE posting_defaults ADD COLUMN venue_location text
  CHECK (venue_location IS NULL OR length(venue_location) <= 100);
```

**Full change chain:**
1. SQL migration adds columns with CHECK constraints
2. Update `PostingDefaultsRow` type in `src/lib/settings/data.ts`
3. Update `PostingDefaults` TypeScript interface
4. Update SELECT query in `getOwnerSettings()`
5. Update mapping in `getOwnerSettings()` (use `fromDb` helper)
6. Update settings Zod schema in `src/features/settings/schema.ts`
7. Update settings server action in `src/app/(app)/settings/actions.ts`
8. Update settings UI form

**Input validation for `venueLocation`** (addresses prompt injection risk):

```typescript
// In settings schema
venueLocation: z.string()
  .max(100)
  .regex(/^[\p{L}\p{N}\s,.\-']+$/u, "Only letters, numbers, spaces, commas, full stops, hyphens, and apostrophes")
  .optional()
  .nullable(),
```

The same validation pattern should be applied to `venueName` / `display_name` where it feeds into AI prompts.

### Race Condition Mitigation

Concurrent campaign creation could read the same "empty days" and both schedule onto the same day. Mitigation: the slot reservation in `reserveSlotOnSameDay()` uses a read-then-write pattern that is sufficient for single-tenant use (one user creating campaigns). For true concurrency safety, a Postgres advisory lock per account could be added later, but is not needed for the current single-tenant architecture.

### UI Changes

Weekly campaign creation form:

- New toggle: "Specific days" / "Spread evenly" (defaults to "Spread evenly")
- When "Spread evenly" is selected: show a "Posts per week" dropdown (1-7, default 3)
- New toggle: "Stagger across platforms" (default on), with tooltip explaining the behaviour
- When "Specific days" is selected: existing weekday picker, unchanged

---

## Part 2: Copy Generation — Hook Variety System

### Hook Strategies

Eight hook strategies, each with a prompt instruction appended to the user prompt:

| Strategy | Prompt instruction |
|----------|-------------------|
| `question` | "Open with a question that invites a response from the reader." |
| `bold_statement` | "Open with a confident, opinionated statement — own it." |
| `direct_address` | "Open by speaking directly to a specific group (e.g., families, dog owners, rugby fans)." |
| `curiosity_gap` | "Open by teasing something without revealing it all — make them want to read on." |
| `seasonal` | "Open with a reference to the weather, season, time of year, or a timely local moment." |
| `scarcity` | "Open by highlighting limited availability, time pressure, or high demand." |
| `behind_scenes` | "Open as if sharing an insider glimpse — something the reader wouldn't normally see." |
| `social_proof` | "Open by referencing popularity, customer love, or high demand for this." |

### Selection Logic — Hoisted with In-Memory Batch Tracking

**Key design decision:** Hook and pillar selection are hoisted to campaign level, not per-plan. A single DB query at the start of `createWeeklyCampaign()` fetches recent history. Selections within the current batch are tracked in-memory to ensure intra-batch variety.

1. At the start of campaign creation (in `createWeeklyCampaign()` / `createInstantPost()`), fetch the last 3 `hook_strategy` values from `content_items` for this account, ordered by `created_at DESC`
2. Initialise an in-memory `usedHooks: string[]` array, seeded with those 3 values
3. For each plan/variant in the batch:
   a. Filter the 8 strategies to exclude the last 3 in `usedHooks`
   b. Pick one at random from the remaining
   c. Push the selection onto `usedHooks` (so subsequent plans in the same batch see it)
4. If fewer than 3 posts exist for the account, pick at random from all 8
5. Store the selected strategy as `hook_strategy` on the `content_items` row at insert time

**Combined query:** Fetch both `hook_strategy` and `content_pillar` in a single query:

```sql
SELECT hook_strategy, content_pillar
FROM content_items
WHERE account_id = $1
ORDER BY created_at DESC
LIMIT 5;
```

This runs once per campaign creation, not per plan.

### Prompt Integration

The selected hook instruction is added as a new line in the "Adjustments" section of the user prompt, after existing tone/length/emoji adjustments. It does not replace any existing prompt content.

### Schema Changes

```sql
ALTER TABLE content_items ADD COLUMN hook_strategy text
  CHECK (hook_strategy IS NULL OR hook_strategy IN (
    'question', 'bold_statement', 'direct_address', 'curiosity_gap',
    'seasonal', 'scarcity', 'behind_scenes', 'social_proof'
  ));
```

Application-layer validation via Zod enum before writing.

---

## Part 3: Copy Generation — Content Pillar Awareness

### Content Pillars

Six pillars representing the angle/topic of a post:

| Pillar | Keyword triggers (title/prompt matching) |
|--------|------------------------------------------|
| `food_drink` | food, menu, dish, burger, roast, kitchen, chef, drink, pint, cocktail, wine, beer, lunch, dinner, breakfast |
| `events` | event, quiz, music, live, band, karaoke, sport, match, screening, bingo, comedy, DJ |
| `people` | staff, team, manager, barman, new starter, anniversary, charity, community |
| `behind_scenes` | behind the scenes, prep, setup, delivery, morning, before we open, getting ready |
| `customer_love` | review, favourite, popular, most-requested, regulars, feedback, thank you |
| `seasonal` | christmas, easter, bank holiday, summer, winter, spring, autumn, halloween, valentine, mother's day, father's day, new year |

### Inference Logic — Word Boundary Matching

1. Scan the post title and prompt against keyword lists using **word-boundary regex** (`\b` anchors) to prevent partial matches (e.g., "sun" must not match "Sunday")
2. Use pre-compiled module-level regex patterns (one combined pattern per pillar, e.g., `/\b(?:food|menu|dish|burger)\b/i`)
3. Score by match count — the pillar with the most keyword hits wins (not first-match-wins, which created ordering bias)
4. Tie-break order: events > seasonal > customer_love > behind_scenes > people > food_drink
5. If no match, default to `food_drink` (most common for pubs)
6. Store as `content_pillar` on the `content_items` row

**Note:** "chef" is in both `food_drink` and `people` — the score-based approach handles this correctly. Weather-related words ("sun", "rain") removed from seasonal keywords to avoid false positives; weather context is better handled by the hook system's `seasonal` strategy.

### Prompt Nudge — Hoisted with In-Memory Tracking

Same pattern as hooks: pillar history is fetched once at campaign level and tracked in-memory across the batch.

1. Seed `recentPillars: string[]` from the combined query (Part 2)
2. For each plan, check if the inferred pillar matches the most recent 2 entries in `recentPillars`
3. If it does, add a nudge: "Recent posts have focused on [pillar label]. If possible, try a different angle — e.g., frame this from the [2 alternative pillars] perspective."
4. Push the inferred pillar onto `recentPillars` for subsequent plans in the batch
5. Advisory only — the AI may still write to the inferred pillar if the brief demands it

### Schema Changes

```sql
ALTER TABLE content_items ADD COLUMN content_pillar text
  CHECK (content_pillar IS NULL OR content_pillar IN (
    'food_drink', 'events', 'people', 'behind_scenes', 'customer_love', 'seasonal'
  ));
```

---

## Part 4: Copy Generation — Platform Personality Sharpening

### Facebook Guidance Additions

Added to the `facebook` case in `buildPlatformGuidance()`:

```
"Where natural, close with a question or opinion prompt that invites comments (e.g., 'What's your order?', 'Who's joining us?'). Facebook rewards posts that generate replies."
"Write as if talking to a regular — conversational, not announcement-style."
```

### Instagram Guidance Additions

Added to the `instagram` case:

```
"The first line must stop the scroll. Front-load the hook — only the first 125 characters show before 'more'."
"Use line breaks to create scannable structure. One thought per line."
```

Word limit guidance softened from "Write up to 80 words" to "Aim for 60-80 words with line breaks."

### GBP Guidance Additions

Added to the `gbp` case:

```
"Write for someone searching Google for a local pub. Include natural local keywords (e.g., the town name, 'pub near [area]')."
"Lead with the most important fact — what, when, and how to act. No preamble."
```

The `venueName` and `venueLocation` (from posting defaults, validated per Part 1) are passed into the GBP prompt context for natural keyword inclusion. Both values are wrapped in XML-style delimiters in the prompt to create clear boundaries:

```
Venue name: <venue_name>The Anchor</venue_name>
Venue location: <venue_location>Leatherhead, Surrey</venue_location>
```

### No Other Changes

Post-processing, linting, and content rules are unaffected. These are prompt-input-only changes. The streaming preview route (`generate-stream/route.ts`) will automatically reflect prompt changes since it calls `buildInstantPostPrompt()`.

---

## Part 5: Copy Generation — Time-Aware Copy

### Temporal Proximity Brackets

**Extends the existing `describeEventTimingCue()`** in `service.ts` rather than creating a parallel function. The existing function already computes temporal distance with 7 brackets — we modify it to also return a prompt-facing tone cue.

Updated signature:

```typescript
function describeEventTimingCue(
  scheduledFor: Date | null,
  eventStart: Date
): { description: string; toneCue: string; label: string }
```

| Gap | Label | Tone cue |
|-----|-------|----------|
| 7+ days before event | `early_awareness` | "This is an early heads-up. Focus on saving the date, not urgency. Tone: informative, warm." |
| 3-6 days before | `building` | "Build anticipation. Give details that help people plan. Tone: enthusiastic, inviting." |
| 1-2 days before | `tomorrow` | "This is happening very soon. Create gentle urgency. Tone: excited, 'don't forget'." |
| Same day, morning post (before 2pm) | `today_morning` | "This is today. Set the scene for later. Tone: anticipation, 'it's happening'." |
| Same day, afternoon+ (2pm onwards) | `today_imminent` | "This is happening now or very soon. Be direct and punchy. Tone: urgent, 'get here'." |
| After event | `recap` | "This already happened. Celebrate it, thank people, share highlights. Tone: warm, grateful." |

### Prompt Integration

The `toneCue` is added to the "Timing and context" section of the user prompt via `buildContextBlock()`, after the existing schedule/event date lines:

```
Post scheduled for Thursday 15 April at 5pm (local time).
Event starts Thursday 15 April at 7pm.
Timing tone: This is happening very soon. Be direct and punchy. Tone: urgent, 'get here'.
```

The `toneCue` is also written to `prompt_context.temporalProximity` on the `content_items` row so that publish-time validation and preview rendering have access to it.

No changes to post-processing or linting.

---

## Files Affected

| File | Changes |
|------|---------|
| `src/lib/scheduling/conflicts.ts` | **Fix** `findResolution()` to check all occupied slots |
| `src/lib/create/service.ts` | Fix `reserveSlotOnSameDay()` backward search; spread algorithm; time selection; pillar inference; hook selection; parallelise OpenAI calls; extend `describeEventTimingCue()` |
| `src/lib/create/schema.ts` | New fields on `weeklyCampaignSchema`: scheduleMode, postsPerWeek, staggerPlatforms |
| `src/lib/ai/prompts.ts` | Hook instruction line, platform guidance additions, temporal proximity cue, content pillar nudge, venueLocation for GBP (XML-delimited) |
| `src/lib/scheduling/materialise.ts` | Fix cross-campaign conflict detection; support spread_evenly mode; pass supabase client from parent; add service-role comments |
| `src/lib/settings/data.ts` | New PostingDefaults fields: default_posting_time, venue_location; use `fromDb` helper |
| `src/features/settings/schema.ts` | Zod validation for new settings fields |
| `src/app/(app)/settings/actions.ts` | Read/write new settings fields with audit logging |
| `src/features/create/weekly-campaign-form.tsx` | Spread/fixed toggle, posts-per-week selector, stagger toggle |
| `src/features/create/schedule/suggestion-utils.ts` | Update scheduling suggestions for spread mode |
| `supabase/functions/campaign-materialiser/index.ts` | Update to use fixed `findResolution()` and cross-campaign conflict detection |
| `supabase/functions/materialise-weekly/worker.ts` | Same materialisation fixes |
| `src/lib/utils/date.ts` (new) | Shared `formatFriendlyTime()` extracted from prompts.ts and service.ts |
| Database migration | Add hook_strategy, content_pillar (with CHECK constraints) to content_items; add default_posting_time, venue_location to posting_defaults; add composite index |

## Files NOT Affected

| File | Why |
|------|-----|
| `src/lib/ai/voice.ts` | No tone/phrase changes |
| `src/lib/ai/content-rules.ts` | No linting/post-processing changes |
| `src/lib/publishing/queue.ts` | Publishing mechanics unchanged |
| Review/edit/approve UI | Workflow unchanged |

---

## Auth & Security

All new functionality runs within existing authenticated flows:

- **Spread algorithm:** Runs inside `createWeeklyCampaign()` which calls `requireAuthContext()`. All DB queries scoped to `accountId`.
- **Settings updates:** Run through `updateSettings()` action which calls `requireAuthContext()`. Audit logged via `logAuditEvent()`.
- **Materialise cron:** Uses `CRON_SECRET` header verification (must be added if not already present on the cron route). Uses service-role client — documented with `// admin operation: materialise recurring campaigns (cron job)`.
- **Prompt injection defence:** `venueLocation` validated with strict regex. `venueName` given same treatment. Both wrapped in XML delimiters in prompts. Content post-processing pipeline provides defence-in-depth (blocked token detection, HTML stripping).
- **New DB columns:** CHECK constraints enforce valid enum values. Application-layer Zod validation before writes.

---

## Migration & Rollback

**Database migration:**

```sql
-- New columns on content_items
ALTER TABLE content_items ADD COLUMN hook_strategy text
  CHECK (hook_strategy IS NULL OR hook_strategy IN (
    'question', 'bold_statement', 'direct_address', 'curiosity_gap',
    'seasonal', 'scarcity', 'behind_scenes', 'social_proof'));
ALTER TABLE content_items ADD COLUMN content_pillar text
  CHECK (content_pillar IS NULL OR content_pillar IN (
    'food_drink', 'events', 'people', 'behind_scenes', 'customer_love', 'seasonal'));

-- Composite index for spread algorithm performance
CREATE INDEX idx_content_items_account_schedule
ON content_items(account_id, scheduled_for);

-- New columns on posting_defaults
ALTER TABLE posting_defaults ADD COLUMN default_posting_time text
  CHECK (default_posting_time IS NULL OR default_posting_time ~ '^([01]\d|2[0-3]):[0-5]\d$');
ALTER TABLE posting_defaults ADD COLUMN venue_location text
  CHECK (venue_location IS NULL OR length(venue_location) <= 100);
```

All columns are nullable — non-breaking, no data backfill needed. New campaign metadata fields are optional — existing campaigns continue to work as `fixed_days` mode.

**Rollback:**

- Schema: `DROP COLUMN` migration for each new column (nullable, so safe to remove)
- Code: Revert to previous `findResolution()`, `reserveSlotOnSameDay()`, `describeEventTimingCue()`
- Feature flags: spread algorithm falls back to `fixed_days` for existing campaigns
- Hook and pillar: additive prompt changes — removing them removes the extra instruction line
- No destructive changes to existing data

---

## Testing Strategy

### Baseline tests (Part 0 — before feature work)

- `conflicts.test.ts` — existing `resolveConflicts()`: two slots same time, resolution to new slot, multiple occupied slots
- `materialise.test.ts` — cadence parsing, slot building, window calculation
- `content-rules.test.ts` — `applyChannelRules()` happy path per platform, `lintContent()` with violations
- `voice.test.ts` — `scrubBannedPhrases()`, `reduceHype()`, `detectBannedPhrases()`

### Feature tests

1. **Spread algorithm:**
   - Happy: empty calendar → posts distributed evenly
   - Happy: partially filled → posts fill gaps
   - Edge: all 7 days occupied → doubles up on least busy
   - Edge: 1-day campaign window → places on that day
   - Edge: `postsPerWeek` = 7 → one post per day
   - Edge: `postsPerWeek` = 0 or > 7 → rejected by Zod validation
   - Multi-platform staggering with 3 platforms, 3 empty days
   - Staggering with 3 platforms, 1 empty day → groups 2 on one day
   - Same-day bypass: event today → all platforms fire simultaneously

2. **Hook selection:**
   - Happy: rotation avoids last 3
   - Happy: fewer than 3 prior posts → random from all 8
   - Edge: batch of 6 posts → no two consecutive posts share a hook
   - Edge: corrupted `hook_strategy` in DB → ignored, treated as no history
   - Edge: all 8 hooks used in last 8 posts → only avoids last 3, picks from remaining 5

3. **Pillar inference:**
   - Happy: "Sunday roast" → `food_drink`
   - Happy: "Live music Saturday" → `events`
   - Edge: "Chef's birthday" matches both `food_drink` (chef) and `people` (chef) → score-based resolution
   - Edge: empty title and prompt → default `food_drink`
   - Edge: "Sunday sunshine" → NOT `seasonal` (weather words removed from keywords)

4. **Temporal proximity:**
   - Each bracket boundary: 8 days, 6 days, 2 days, same day 10am, same day 3pm, day after event
   - Edge: no event start date → no tone cue added
   - Edge: `scheduledFor` is null → no tone cue added

5. **Platform guidance:**
   - Snapshot tests on prompt output per platform to verify new instructions appear
   - GBP prompt includes `venue_location` wrapped in XML delimiters

6. **Integration:**
   - Create a spread-evenly weekly campaign with 3 posts/week, 4 weeks, 3 platforms
   - Verify: posts land on different days, hooks vary, pillars inferred, temporal proximity correct
   - Verify: all queries scoped to authenticated account (mock multi-account scenario)

7. **Input validation:**
   - `postsPerWeek` > 7 → rejected
   - `scheduleMode` = "invalid" → rejected
   - `venueLocation` with special characters → rejected
   - `hook_strategy` = "injected_value" → rejected by CHECK constraint
