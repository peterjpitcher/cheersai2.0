# Drop `story_series` Campaign Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `story_series` as a campaign type. Stories become a placement choice on `event` and `promotion` campaigns. Same expressiveness, fewer concepts; the create UI loses one tab and one whole form.

**Architecture:** Mostly subtractive. The story_series code paths already fall through to event-style label logic, so removing the type is a code simplification, not a behavioural change. Existing `story_series` campaigns are migrated to `event` (campaign_type only — content_items keep their `placement = 'story'`). The create wizard's "Stories" tab is deleted; the Event and Promotion forms gain a placement multi-select.

**Tech Stack:** Postgres CHECK constraint migration, TypeScript strict, react-hook-form + Zod, Vitest.

**Spec:** [docs/superpowers/specs/2026-05-07-drop-story-series-design.md](../specs/2026-05-07-drop-story-series-design.md)

---

## File Structure

### New
- `supabase/migrations/20260507130000_drop_story_series_campaign_type.sql`

### Modified
- `src/lib/scheduling/campaign-timing.ts` — narrow `campaignType` union; drop story_series ternary.
- `src/lib/scheduling/proximity-label.ts` — delete `case "story_series"` branch.
- `supabase/functions/publish-queue/banner-label.ts` — same as the two above (Deno copy).
- `src/lib/create/service.ts` — delete `createStorySeries`; add `placements` arg to `createEventCampaign` and `createPromotionCampaign`.
- `src/lib/create/schema.ts` — delete `storySeriesSlotFormSchema`, `storySeriesSlotSchema`, `storySeriesFormSchema`, `storySeriesSchema`, `StorySeriesInput`, `StorySeriesFormValues`. Add `placements` field to `eventCampaignFormSchema` and `promotionCampaignFormSchema`.
- `src/app/(app)/create/actions.ts` — delete `handleStorySeriesSubmission` and the related imports.
- `src/features/create/event-campaign-form.tsx` — placement multi-select.
- `src/features/create/promotion-campaign-form.tsx` — placement multi-select.
- `src/features/create/create-wizard.tsx` — drop the "stories" tab and the StorySeriesForm import.
- `tests/app/create/actions.test.ts` — drop story-series cases.
- `tests/app/create/management-actions.test.ts` — drop story-series cases.
- `tests/lib/create/schema.test.ts` — drop storySeries* schema tests.

### Deleted
- `src/features/create/story-series-form.tsx`

---

## Task 1: Migration — drop `story_series` from `campaign_type` CHECK

**Files:**
- Create: `supabase/migrations/20260507130000_drop_story_series_campaign_type.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Drop story_series campaign type. The type is functionally identical to
-- 'event' (the proximity-label code already falls through to event logic),
-- and stories are a placement, not a campaign type. Existing story_series
-- campaigns become 'event' campaigns; their content_items keep placement='story'.
--
-- See docs/superpowers/specs/2026-05-07-drop-story-series-design.md

-- Data step first so the constraint recreate doesn't fail.
UPDATE public.campaigns
   SET campaign_type = 'event'
 WHERE campaign_type = 'story_series';

-- Replace the CHECK constraint to remove story_series.
ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_campaign_type_check;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_campaign_type_check
    CHECK (campaign_type IN ('event','promotion','weekly','instant'));
```

- [ ] **Step 2: Confirm no other CHECK / index / function references the value**

Run: `grep -rn "story_series" supabase/`
Expected: matches only in the new migration file and the two pre-existing migrations (`20250203120000_initial.sql`, `20251021143000_update_campaign_type_check.sql`). Those two are history — no edit.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260507130000_drop_story_series_campaign_type.sql
git commit -m "feat: drop story_series campaign type

Migrates existing story_series rows to 'event' and recreates the
CHECK constraint without 'story_series'. Stories become a placement
choice on event/promotion campaigns instead of their own type.

Refs docs/superpowers/specs/2026-05-07-drop-story-series-design.md"
```

(The migration is applied later by the orchestrator via Supabase MCP.)

---

## Task 2: Drop `story_series` from `CampaignTiming` union and `getProximityLabel`

**Files:**
- Modify: `src/lib/scheduling/campaign-timing.ts`
- Modify: `src/lib/scheduling/proximity-label.ts`
- Modify: `supabase/functions/publish-queue/banner-label.ts`

The story_series branches all fall through to event logic today. Removing them is a no-op behaviourally.

- [ ] **Step 1: Update `src/lib/scheduling/campaign-timing.ts`**

Find the `CampaignTiming` interface (around line 20):
```ts
campaignType: "event" | "promotion" | "weekly" | "story_series";
```
Replace with:
```ts
campaignType: "event" | "promotion" | "weekly";
```

Find the resolvedType ternary (around line 90):
```ts
const resolvedType = campaign.campaign_type === "story_series" ? "story_series" : "event";
return {
    campaignType: resolvedType,
    ...
};
```
Replace with:
```ts
return {
    campaignType: "event",
    ...
};
```

(Make sure you don't break the `weekly` branch above this — that branch returns early with `campaignType: "weekly"`, so the `event` fallthrough is correct.)

- [ ] **Step 2: Update `src/lib/scheduling/proximity-label.ts`**

Delete the entire `case "story_series":` block (around line 117). It calls `getEventLabel` — same as the `case "event":` above. Both can collapse into the event case (i.e., just delete the story_series case).

- [ ] **Step 3: Update `supabase/functions/publish-queue/banner-label.ts` (Deno copy)**

Same two edits as steps 1 and 2:
- Narrow the union (around line 28).
- Drop the resolvedType ternary (around line 92) — replace with `campaignType: "event"`.
- Delete the `case "story_series":` block (around line 267).

- [ ] **Step 4: Update tests if any reference the type literally**

Run: `grep -rn "story_series" src/ tests/`
Update any test that uses `campaign_type: "story_series"` to use `"event"`. Most are in `tests/lib/scheduling/` and `tests/supabase/publish-queue/`. Replace literally.

- [ ] **Step 5: Run typecheck and unit tests**

```
npm run typecheck
npx vitest run src/lib/scheduling tests/lib/scheduling supabase/functions/publish-queue tests/supabase/publish-queue tests/publish-queue.test.ts tests/publish-queue-banner-label.test.ts
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scheduling supabase/functions/publish-queue tests
git commit -m "refactor(scheduling): drop story_series from CampaignTiming

story_series was always falling through to event-label logic. Drops
the redundant case/ternary in both the Node and Deno copies of the
proximity-label module."
```

---

## Task 3: Delete `createStorySeries` and the storySeries Zod schemas

**Files:**
- Modify: `src/lib/create/service.ts`
- Modify: `src/lib/create/schema.ts`
- Modify: `src/app/(app)/create/actions.ts`
- Modify: `tests/app/create/actions.test.ts`
- Modify: `tests/app/create/management-actions.test.ts`
- Modify: `tests/lib/create/schema.test.ts`

We delete the story-series-only entry points. The placement support that lets you generate stories from event/promotion campaigns lands in Tasks 4 and 5.

- [ ] **Step 1: Delete `createStorySeries` from `src/lib/create/service.ts`**

Find `export async function createStorySeries(input: StorySeriesInput)` (line ~673). Delete the entire function (about 60 lines through the closing `}` at line ~730).

If `StorySeriesInput` is imported at the top of the file, remove that import.

- [ ] **Step 2: Delete the storySeries schemas from `src/lib/create/schema.ts`**

Find and delete:
- `storySeriesSlotFormSchema` (around line 178)
- `storySeriesSlotSchema` (around line 208)
- `storySeriesFormSchema` (around line 237) — the `export`
- `storySeriesSchema` (around line 271) — the `export`
- `export type StorySeriesInput` (line 607)
- `export type StorySeriesFormValues` (line 608)

- [ ] **Step 3: Delete `handleStorySeriesSubmission` from `src/app/(app)/create/actions.ts`**

Find:
```ts
import {
  ...,
  createStorySeries,
  ...
} from "@/lib/create/service";
import {
  ...,
  storySeriesFormSchema,
  storySeriesSchema,
  ...
} from "@/lib/create/schema";
```
Remove those two entries from the imports.

Then find `export async function handleStorySeriesSubmission(rawValues: unknown)` (around line 69). Delete the entire function (about 30 lines).

- [ ] **Step 4: Update tests**

```bash
grep -ln "story_series\|StorySeries\|story-series\|storySeries" tests/
```

For each match in:
- `tests/app/create/actions.test.ts`
- `tests/app/create/management-actions.test.ts`
- `tests/lib/create/schema.test.ts`

Delete or update story-series-specific test cases. Keep tests that exercise other campaign types unchanged.

- [ ] **Step 5: Run lint, typecheck, tests**

```
npm run lint
npm run typecheck
npx vitest run src/lib/create tests/app/create tests/lib/create
```
Expected: clean. Any leftover reference to a deleted symbol shows up as a typecheck error — fix.

- [ ] **Step 6: Commit**

```bash
git add src/lib/create src/app/\(app\)/create tests/app/create tests/lib/create
git commit -m "refactor(create): remove createStorySeries and related schemas

Stories are a placement, not a campaign type. createEventCampaign and
createPromotionCampaign will gain placement support in following commits;
this commit deletes the dedicated story-series entry point and its
Zod schemas/server action."
```

---

## Task 4: Add placement multi-select to Event campaigns

**Files:**
- Modify: `src/lib/create/schema.ts` (add field to `eventCampaignFormSchema` and `eventCampaignSchema`)
- Modify: `src/lib/create/service.ts` (extend `createEventCampaign` to honour placements)
- Modify: `src/features/create/event-campaign-form.tsx` (UI)

- [ ] **Step 1: Add `placements` to the event Zod schema**

In `src/lib/create/schema.ts`, find `eventCampaignFormSchema` and `eventCampaignSchema`. Add the field to both:

```ts
placements: z.array(placementEnum).min(1, "Select at least one placement").default(["feed"]),
```

(The `placementEnum` is already exported from this file as `z.enum(["feed", "story"])`.)

- [ ] **Step 2: Wire `placements` into `createEventCampaign`**

In `src/lib/create/service.ts`, find `createEventCampaign(input: EventCampaignInput)`. The input now has `input.placements: ('feed' | 'story')[]`.

For each plan currently produced (the `plans` array of `VariantPlan`), expand it: for each requested placement, produce a plan with that `placement`. Today's code produces one feed plan per slot; the new code produces one plan per (slot × placement).

Concretely, where the code currently does:
```ts
const plans: VariantPlan[] = [...].map((slot, index) => ({
  ...
  placement: "feed",
  ...
}));
```
Replace with:
```ts
const plans: VariantPlan[] = [...].flatMap((slot, index) =>
  input.placements.map((placement) => ({
    ...
    placement,
    ...
  }))
);
```

(Same applies to the manual-schedule and offset-schedule branches inside `createEventCampaign` — both already exist; both need the same flatMap.)

- [ ] **Step 3: Add the placement multi-select to `event-campaign-form.tsx`**

Use the project's react-hook-form pattern (matching how other multi-selects look in the same file or in `posting-defaults-form.tsx`). Two checkboxes:

```tsx
<div>
  <label className="text-sm font-medium">Where should this post?</label>
  <div className="flex gap-4 mt-2">
    <label className="flex items-center gap-2">
      <input type="checkbox" {...register("placements")} value="feed" />
      <span>Feed</span>
    </label>
    <label className="flex items-center gap-2">
      <input type="checkbox" {...register("placements")} value="story" />
      <span>Stories</span>
    </label>
  </div>
  {errors.placements && <p className="text-sm text-destructive">{errors.placements.message}</p>}
</div>
```

(Match the existing form's styling tokens; the snippet above is illustrative. Check how `event-campaign-form.tsx` does its other selects and follow that pattern. If the project uses Radix `Checkbox` primitives elsewhere, prefer those over native `<input>`.)

The default values passed to `useForm` should include `placements: ["feed"]`.

- [ ] **Step 4: Run lint, typecheck, tests**

```
npm run lint
npm run typecheck
npx vitest run src/lib/create src/features/create tests/app/create
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/create src/features/create/event-campaign-form.tsx
git commit -m "feat(create): add placement multi-select to event campaigns

Event campaigns can now produce feed posts, story posts, or both.
Replaces the dedicated story_series flow."
```

---

## Task 5: Add placement multi-select to Promotion campaigns

**Files:**
- Modify: `src/lib/create/schema.ts` (add field to promotion schemas)
- Modify: `src/lib/create/service.ts` (`createPromotionCampaign` plan generation)
- Modify: `src/features/create/promotion-campaign-form.tsx`

This task is structurally identical to Task 4, applied to the promotion path.

- [ ] **Step 1: Add `placements` to the promotion Zod schema**

Same field, same default `["feed"]`, applied to `promotionCampaignFormSchema` and `promotionCampaignSchema`.

- [ ] **Step 2: flatMap `createPromotionCampaign` plan generation by placements**

Same pattern as Task 4 step 2, applied to all `plans` arrays inside `createPromotionCampaign` (there are typically multiple — phase plans, manual schedule, etc.). Each becomes `flatMap` over `input.placements`.

- [ ] **Step 3: Add the placement multi-select to `promotion-campaign-form.tsx`**

Same component shape as Task 4 step 3.

- [ ] **Step 4: Run lint, typecheck, tests**

```
npm run lint
npm run typecheck
npx vitest run src/lib/create src/features/create
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/create src/features/create/promotion-campaign-form.tsx
git commit -m "feat(create): add placement multi-select to promotion campaigns

Promotion campaigns can now produce feed posts, story posts, or both."
```

---

## Task 6: Remove the "Stories" tab from the create wizard and delete the form

**Files:**
- Modify: `src/features/create/create-wizard.tsx`
- Delete: `src/features/create/story-series-form.tsx`

- [ ] **Step 1: Remove the "stories" tab from `create-wizard.tsx`**

Open the file. Find the `TABS` constant:
```ts
const TABS = [
    { id: "instant", label: "Instant post" },
    { id: "stories", label: "Stories" },
    { id: "event", label: "Event campaign" },
    { id: "promotion", label: "Promotion" },
    { id: "weekly", label: "Weekly recurring" },
];
```
Remove the `{ id: "stories", label: "Stories" }` entry.

Remove the `import { StorySeriesForm } from "@/features/create/story-series-form";` line.

Find the `<TabsContent value="stories">...</TabsContent>` block and delete it.

If the validated initial-tab logic depended on `"stories"`, no change needed — it falls back to `"instant"` for any unknown tab.

- [ ] **Step 2: Delete the story-series form**

```bash
git rm src/features/create/story-series-form.tsx
```

- [ ] **Step 3: Confirm zero references remain**

```bash
grep -rn "story_series\|StorySeries\|story-series\|storySeries" src/ supabase/ tests/
```
Expected: no matches except the new migration file (`supabase/migrations/20260507130000_drop_story_series_campaign_type.sql`) and the two pre-existing migrations under `supabase/migrations/` whose history is preserved.

- [ ] **Step 4: Run the full CI verify**

```
npm run ci:verify
```
Expected: lint, typecheck, test, build all pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/create/create-wizard.tsx
git commit -m "chore(create): remove Stories tab from create wizard

story-series-form.tsx is deleted; the wizard no longer offers
a dedicated story-series flow. Story posts are produced via the
placement multi-select on event and promotion campaigns."
```

---

## Self-Review

- **Spec coverage:** every locked decision (1: drop type / 2: data migration / 3: placement on event+promotion / 4: weekly+instant unchanged / 5: no campaign-level column) maps to a task. G1–G3 from the codex-qa-review are addressed (G1: weekly is intentionally untouched in Tasks 4 and 5; G2: every grep hit appears in Files Affected and tasks; G3: stale-client handling falls out automatically because Zod removes the `story_series` enum value in Task 3 — POSTs of stale payloads now fail Zod parsing with a 400).
- **Placeholders:** none. Every step shows real code or real shell commands.
- **Type consistency:** `placements` is `Array<'feed' | 'story'>` everywhere; `placementEnum` is the existing Zod source of truth.
- **Migration order:** Task 1 lands the migration file; Tasks 2–6 land code that no longer references `story_series`. The orchestrator applies the migration at deploy time. Build stays green at every commit because Tasks 2 and 3 only delete dead branches (story_series fell through to event today).
