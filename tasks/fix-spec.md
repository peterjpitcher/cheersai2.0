# Fix Spec — Create Navigation, Event Latency, Tournament Assets

## Problem Summary

| # | Issue | Impact |
|---|-------|--------|
| A | Create button in nav/planner opens modal instead of navigating | Breaks expected UX; users can't reach the full /create page from planner |
| B | Event campaign generation takes 4-5 minutes | Unusable wait time when creating event campaigns |
| C | Tournament assets fill the library and leak into pickers | Normal media assets pushed out of view; tournament images shown where they shouldn't be |
| D | Lint CI scanning generated worktree output | False positives in CI reports |

---

## A. Create Navigation

### A1. Replace planner "Create Post" modal with navigation

**File:** `src/features/planner/create-post-button.tsx`
**Current:** Calls `openModal({ initialTab: "instant" })` on click.
**Fix:** Replace with `router.push('/create?tab=instant')` or render as a styled `<Link href="/create?tab=instant">`.

### A2. Replace planner calendar/weekly actions with URL navigation

**File:** `src/features/planner/planner-interaction-components.tsx`
**Current:**
- `AddToCalendarButton` (line 15) calls `openModal({ initialTab: "instant", initialDate: dateObj })`
- `CreateWeeklyPlanButton` (line 42) calls `openModal({ initialTab: "weekly" })`

**Fix:** Navigate with URL params:
- `AddToCalendarButton` → `/create?tab=instant&date={ISO date}`
- `CreateWeeklyPlanButton` → `/create?tab=weekly`

The `/create` page already reads `tab` from searchParams (line 32 of `src/app/(app)/create/page.tsx`). Extend it to also read an optional `date` param and pass both to `CreatePageClient`.

### A3. Retire or reduce global create modal

**File:** `src/components/providers/app-providers.tsx` (lines 26-29)
**Current:** `CreateModalProvider` + `CreateModal` mounted globally on every page.
**Decision needed:** If no remaining callers need the modal after A1/A2, remove it entirely. If there's a deliberate inline-modal use case elsewhere, keep it but document when to use modal vs navigation.

### A4. Regression tests

- Test that planner header action navigates to `/create?tab=instant`
- Test that `AddToCalendarButton` navigates to `/create?tab=instant&date=...`
- Test that `CreateWeeklyPlanButton` navigates to `/create?tab=weekly`
- Test that `/create` page reads tab and date params correctly

---

## B. Event Campaign Latency

The latency has two independent causes that compound:

### B1. Anchor Management Tools API is slow

**Symptom:** Loading event list/details from `management.orangejelly.co.uk/api/events` takes a long time.
**Root cause (likely):** Cold starts + database connection pool contention from 30+ cron jobs + unindexed joins.

**Fix (in OJ-AnchorManagementTools):**
1. Add response cache headers: `Cache-Control: public, s-maxage=60` on `/api/events` responses
2. Add database index: `CREATE INDEX IF NOT EXISTS idx_events_date_status ON events(date, event_status)`
3. Review connection pool — with crons running every minute, the pool may be exhausted when the events API is called
4. Consider increasing the CheersAI client timeout from 10s to 20s if cold starts genuinely take that long

### B2. Reduce default event generation scope

**File:** `src/lib/create/event-cadence.ts`
**Current:** Up to 8 weekly hype slots + 3 countdown slots = 11 slots. Each generates content per platform.
**Fix:** Default `maxWeekly` to 3-4 instead of 8. Make weekly hype beyond that opt-in via the form UI.

### B3. Submit displayed slots, not recomputed ones

**File:** `src/app/(app)/create/actions.ts` (line 69)
**Current:** `handleEventCampaignSubmission` recomputes cadence from raw params, so the user may see different slots than what gets generated.
**Fix:** When using auto schedule, submit the displayed slot list from the UI so the backend generates exactly what was previewed. When using manual schedule this already works correctly.

### B4. Move large generation to background job

For campaigns with many slots (5+) × multiple platforms, the server action holds a connection open for the entire generation. This is fragile and blocks the UI.

**Fix:** Create the campaign record immediately (status: "generating"), return the campaign ID to the client, generate drafts asynchronously (Vercel Queue or polling endpoint), and show progress in the UI via polling or SSE.

### B5. Add timing instrumentation

**File:** `src/lib/create/service.ts` — around `createCampaignFromPlans` and `buildVariants`
**Log:** slot count, platform count, OpenAI call count, total OpenAI time, DB insert time, total request duration. This makes future regressions visible.

---

## C. Tournament Assets

### C1. Exclude tournament assets from Library

**File:** `src/features/library/media-asset-grid.tsx` (line 5)
**Current:** `const assets = await listMediaAssets();` — no filter, `.limit(100)` means tournament images fill all slots.
**Fix:** Either:
- Pass `{ excludeTags: ["Tournament"] }` to hide them entirely
- Or add a "Show tournament assets" toggle with tournament images excluded by default
- Or remove the `.limit(100)` and paginate properly

**Decision needed:** Should tournament images be visible in Library at all? The original commit said yes (grouped under "Tournament" tag), but they crowd out normal uploads.

### C2. Exclude tournament assets from tournament base image picker

**File:** `src/app/actions/tournament.ts` line 681 (`getMediaAssetsForPicker`)
**Current:** Queries `media_assets` filtered by `aspect_class` and `hidden_at` only — no tag exclusion and no `storage_path` filter.
**Fix:** Add `.not("tags", "cs", "{Tournament}")` or `.not("storage_path", "like", "tournaments/%")` to exclude generated fixture images from the base image picker.

### C3. Make filtering robust

**Current approach:** Relies on exact case-sensitive `tags @> ['Tournament']`.
**Risk:** If tags are inconsistently cased or missing on older rows, the filter silently fails.

**Fix options (pick one):**
- Filter by both normalised tags AND `storage_path LIKE 'tournaments/%'` as a belt-and-braces approach
- Or add a dedicated `source` column (e.g. `'tournament_generated'`) that's cheaper to index and filter than array containment
- Or standardise tags as lowercase (`tournament`) and use case-insensitive filtering

### C4. Verify backfill migration was deployed

**Migration:** `supabase/migrations/20260516120000_tag_tournament_media_assets.sql`
**Check:** Run against production:
```sql
SELECT COUNT(*) FROM media_assets
WHERE storage_path LIKE 'tournaments/%'
AND NOT (tags @> ARRAY['Tournament']::text[]);
```
If > 0, the migration hasn't been applied. Run `npx supabase db push`.

### C5. Tournament asset tests

- `listMediaAssets({ excludeTags: ["Tournament"] })` excludes tagged assets
- `getMediaAssetsForPicker()` does not return tournament-generated images
- Case-insensitive tag matching (if applicable)
- Fallback exclusion by `storage_path`

---

## D. Lint CI Scope

### D1. Exclude generated directories from ESLint

**Files:** `eslint.config.mjs` or equivalent
**Fix:** Add ignore patterns for `.claude/`, `.next/`, and any worktree output directories so CI only reports source issues.

---

## Priority Order

| Priority | Item | Rationale |
|----------|------|-----------|
| 1 | A1, A2 | Navigation broken — affects daily workflow |
| 2 | C1, C2 | Library unusable — normal assets hidden |
| 3 | C4 | Quick verification — may fix C1 partially |
| 4 | B1 | Root cause of latency — fix in AnchorManagementTools |
| 5 | B2, B3 | Reduce generation scope as a mitigation |
| 6 | A3 | Cleanup — retire unused modal infrastructure |
| 7 | B4 | Proper solution for long-running generation |
| 8 | D1 | CI hygiene |
| 9 | B5, A4, C5 | Instrumentation and test coverage |
| 10 | C3 | Robustness improvement — low urgency |

---

## Files Affected

| File | Changes |
|------|---------|
| `src/features/planner/create-post-button.tsx` | Replace modal with Link/navigation |
| `src/features/planner/planner-interaction-components.tsx` | Replace modal calls with URL navigation |
| `src/app/(app)/create/page.tsx` | Accept `date` query param |
| `src/components/providers/app-providers.tsx` | Remove CreateModal if no longer needed |
| `src/features/create/create-modal-context.tsx` | Remove if retired |
| `src/features/create/create-modal.tsx` | Remove if retired |
| `src/features/create/create-modal-actions.ts` | Remove if retired |
| `src/features/library/media-asset-grid.tsx` | Add excludeTags or toggle |
| `src/app/actions/tournament.ts` | Add tag/path filter to getMediaAssetsForPicker |
| `src/lib/create/event-cadence.ts` | Reduce MAX_WEEKLY_BEATS default |
| `src/app/(app)/create/actions.ts` | Accept displayed slots from UI |
| `src/lib/create/service.ts` | Add timing instrumentation |
| `eslint.config.mjs` | Exclude .claude/ and .next/ |
| _(OJ-AnchorManagementTools)_ `/api/events/route.ts` | Add caching, index |
