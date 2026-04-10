# Smart Scheduling & Copy Engagement Improvements

**Date:** 2026-04-10
**Status:** Draft
**Complexity:** L (7+ files, new scheduling algorithm, prompt changes, schema changes)

## Problem

Campaign posts cluster on the same days because cadences use fixed weekdays. A "post every Thursday" campaign means Thursday gets stacked while Monday-Wednesday sit empty. When multiple campaigns overlap, some days get 3+ posts and others get none.

Additionally, the copy generation system produces solid output but lacks variety mechanisms. Consecutive posts often share similar opening structures, angles, and tone regardless of when they're scheduled relative to the event.

## Success Criteria

1. Campaigns can use a "spread evenly" mode that distributes posts across the emptiest days in the calendar
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

---

## Part 1: Smart Scheduling — "Spread Evenly" Mode

### Campaign Scheduling Modes

Campaigns support two scheduling modes via a new `scheduleMode` field on campaign metadata:

- **`fixed_days`** (existing behaviour) — user picks exact weekdays for the cadence
- **`spread_evenly`** (new) — user defines a frequency (e.g., 3 posts per week) and the system auto-distributes across the emptiest days

### Spread Algorithm

When `scheduleMode` is `spread_evenly`:

1. Determine the scheduling window (e.g., campaign start to event date, or N weeks)
2. For each week in the window, fetch all existing scheduled feed posts (all platforms, all campaigns) for the account
3. Build a day-occupancy map: count feed posts per day (Monday-Sunday)
4. Score each day: empty = highest priority, 1 post = medium, 2+ posts = lowest
5. Place new posts on the highest-scoring (emptiest) days first
6. Enforce a minimum 1-day gap between posts on the same platform within the same campaign
7. If all 7 days are occupied, double up on the least-busy day

### Platform Staggering

New `staggerPlatforms` boolean on campaign metadata (default: `true`).

When `staggerPlatforms` is `true` and a post targets multiple platforms:

- Each platform version is placed on a different day within the same week
- Platform priority order: Instagram (visual teaser first), Facebook (detail/engagement), GBP (factual/SEO)
- Example: if 3 empty days are Tuesday, Wednesday, Thursday — Instagram gets Tuesday, Facebook gets Wednesday, GBP gets Thursday

When staggering is bypassed (automatic):

- Same-day posts (scheduled for the day of the event) publish to all platforms simultaneously — there's no time to stagger
- The system detects this by comparing the post's scheduled date against the event/promotion date

When `staggerPlatforms` is `false`:

- All platform versions go out on the same day (existing behaviour)

### Time Selection

Default posting times are engagement-optimised rather than a fixed time:

- **7+ days before event:** 12pm (lunch browsers, planning ahead)
- **1-6 days before event:** 12pm (lunch browsers)
- **Same day, auto-selected:** 5pm (after-work crowd, high intent)
- **User override:** Brand settings gain a `defaultPostingTime` field; if set, this takes precedence over the optimised defaults

The existing 30-minute slot conflict resolution within a day remains unchanged.

### Schema Changes

`content_items` table: no changes needed (posts already have `scheduled_for`, `platform`, `placement`).

Campaign metadata gains:

```typescript
interface CampaignScheduleMetadata {
  scheduleMode: "fixed_days" | "spread_evenly";
  postsPerWeek?: number;           // used when scheduleMode is "spread_evenly"
  staggerPlatforms?: boolean;      // default true
  // existing fields remain unchanged
  cadence?: CadenceEntry[];        // used when scheduleMode is "fixed_days"
}
```

Brand settings gain:

```typescript
interface BrandProfile {
  // ... existing fields ...
  defaultPostingTime?: string;     // e.g. "12:00" — HH:mm format, optional override
  venueLocation?: string;          // e.g. "Leatherhead, Surrey" — for GBP keyword inclusion
}
```

### UI Changes

Campaign creation form:

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

### Selection Logic

1. Fetch the last 3 hook strategies used for this account (from `content_items.hook_strategy`)
2. Filter the 8 strategies to exclude those 3
3. Pick one at random from the remaining 5
4. If the campaign has fewer than 3 prior posts, just pick at random from all 8
5. Store the selected strategy as `hook_strategy` on the `content_items` row

### Prompt Integration

The selected hook instruction is added as a new line in the "Adjustments" section of the user prompt, after existing tone/length/emoji adjustments. It does not replace any existing prompt content.

### Schema Changes

`content_items` table gains:

```sql
ALTER TABLE content_items ADD COLUMN hook_strategy text;
```

No enum constraint — stored as a plain text value for flexibility.

---

## Part 3: Copy Generation — Content Pillar Awareness

### Content Pillars

Six pillars representing the angle/topic of a post:

| Pillar | Keyword triggers (title/prompt matching) |
|--------|------------------------------------------|
| `food_drink` | food, menu, dish, burger, roast, kitchen, chef, drink, pint, cocktail, wine, beer, lunch, dinner, breakfast |
| `events` | event, quiz, music, live, band, karaoke, sport, match, screening, bingo, comedy, DJ |
| `people` | staff, team, chef, manager, barman, new starter, anniversary, charity, community |
| `behind_scenes` | behind the scenes, prep, setup, delivery, morning, before we open, getting ready |
| `customer_love` | review, favourite, popular, most-requested, regulars, feedback, thank you |
| `seasonal` | christmas, easter, bank holiday, summer, winter, spring, autumn, halloween, valentine, mother's day, father's day, new year, weather, sun, rain |

### Inference Logic

1. Scan the post title and prompt against keyword lists
2. First match wins (check in order: seasonal, events, customer_love, behind_scenes, people, food_drink)
3. If no match, default to `food_drink` (most common for pubs)
4. Store as `content_pillar` on the `content_items` row

### Prompt Nudge

When building the prompt:

1. Fetch the last 5 posts' `content_pillar` values for this account
2. If the current post's inferred pillar matches the most recent pillar, add a nudge:
   "Recent posts have focused on [pillar label]. If possible, try a different angle — e.g., frame this from the [suggest 2 alternative angles] perspective rather than [current pillar label]."
3. If the pillar differs from recent posts, add nothing — no nudge needed

This is advisory, not enforced. The AI may still write a food-focused post if that's what the brief demands.

### Schema Changes

```sql
ALTER TABLE content_items ADD COLUMN content_pillar text;
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

The `venueName` and new `venueLocation` from brand settings are passed into the GBP prompt context for natural keyword inclusion.

### No Other Changes

Post-processing, linting, and content rules are unaffected. These are prompt-input-only changes.

---

## Part 5: Copy Generation — Time-Aware Copy

### Temporal Proximity Brackets

New function `describeTemporalProximity(scheduledFor: Date, eventStart: Date)` returns a label and tone cue:

| Gap | Label | Tone cue |
|-----|-------|----------|
| 7+ days before event | `early_awareness` | "This is an early heads-up. Focus on saving the date, not urgency. Tone: informative, warm." |
| 3-6 days before | `building` | "Build anticipation. Give details that help people plan. Tone: enthusiastic, inviting." |
| 1-2 days before | `tomorrow` | "This is happening very soon. Create gentle urgency. Tone: excited, 'don't forget'." |
| Same day, morning post (before 2pm) | `today_morning` | "This is today. Set the scene for later. Tone: anticipation, 'it's happening'." |
| Same day, afternoon+ (2pm onwards) | `today_imminent` | "This is happening now or very soon. Be direct and punchy. Tone: urgent, 'get here'." |
| After event | `recap` | "This already happened. Celebrate it, thank people, share highlights. Tone: warm, grateful." |

### Prompt Integration

The tone cue is added to the "Timing and context" section of the user prompt, after the existing schedule/event date lines. Example:

```
Post scheduled for Thursday 15 April at 5pm (local time).
Event starts Thursday 15 April at 7pm.
Timing tone: This is happening very soon. Be direct and punchy. Tone: urgent, 'get here'.
```

### Implementation

Extends the existing `buildContextBlock()` function in `prompts.ts`. The existing `describeEventTimingCue()` in `service.ts` already calculates temporal distance — we reuse that pattern.

No changes to post-processing or linting.

---

## Files Affected

| File | Changes |
|------|---------|
| `src/lib/ai/prompts.ts` | Hook instruction line, platform guidance additions, temporal proximity cue, content pillar nudge, venueLocation for GBP |
| `src/lib/create/service.ts` | Spread algorithm, time selection logic, pillar inference, hook selection, temporal proximity function |
| `src/lib/create/schema.ts` | New fields: scheduleMode, postsPerWeek, staggerPlatforms on campaign input |
| `src/lib/scheduling/materialise.ts` | Support spread_evenly mode for recurring campaign materialisation |
| `src/lib/settings/data.ts` | New BrandProfile fields: defaultPostingTime, venueLocation |
| Campaign creation UI components | Spread/fixed toggle, posts-per-week selector, stagger toggle |
| Database migration | Add hook_strategy and content_pillar columns to content_items |

## Files NOT Affected

| File | Why |
|------|-----|
| `src/lib/ai/voice.ts` | No tone/phrase changes |
| `src/lib/ai/content-rules.ts` | No linting/post-processing changes |
| `src/lib/scheduling/conflicts.ts` | Conflict resolution within a day unchanged |
| `src/lib/publishing/queue.ts` | Publishing mechanics unchanged |
| Review/edit/approve UI | Workflow unchanged |

---

## Migration & Rollback

**Database migration:**
- Two new nullable text columns on `content_items` — non-breaking, no data backfill needed
- New campaign metadata fields are optional — existing campaigns continue to work as `fixed_days` mode

**Rollback:**
- If spread algorithm causes issues, campaigns fall back to `fixed_days` behaviour (the default for existing campaigns)
- Hook and pillar features are additive prompt changes — removing them just removes the extra instruction line
- No destructive changes to existing data

## Testing Strategy

1. **Spread algorithm** — unit tests: empty calendar, partially filled calendar, fully booked calendar, multi-platform staggering, same-day bypass
2. **Hook selection** — unit tests: rotation avoids last 3, random from full set when <3 posts exist
3. **Pillar inference** — unit tests: keyword matching, default fallback, nudge generation
4. **Temporal proximity** — unit tests: each bracket boundary (7 days, 3 days, 1 day, same-day AM, same-day PM, post-event)
5. **Platform guidance** — snapshot tests on prompt output per platform to verify new instructions appear
6. **Integration** — end-to-end test: create a spread-evenly campaign with 3 posts/week, verify posts land on different days with different hooks
