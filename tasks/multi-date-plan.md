# Implementation Plan: Multi-Date Schedule Step

## Overview

Replace the Schedule step's single datetime-local with `ScheduleCalendar`, support multi-slot selection with content-type suggestions, batch AI generation per slot, and planner-compatible batch content creation.

Spec: `tasks/spec-multi-date-schedule.md`

## Work Streams

| # | Agent | Wave | Depends On | Key Outputs |
|---|-------|------|------------|-------------|
| 1 | Types & Data Layer | 1 | None | Type defs, planner item adapter, createScheduledBatch action |
| 2 | Schedule Step UI | 1 | None | ScheduleCalendar integration, suggestion building, slot management |
| 3 | AI Generation Context | 1 | None | slotLabel in prompts, per-slot generation support |
| 4 | Wizard Core & Generate UI | 2 | All Wave 1 | Multi-slot wizard state, multi-card Generate step, final actions |

## Wave Structure

- **Wave 1**: Agents 1, 2, 3 — parallel, independent file scopes
- **Wave 2**: Agent 4 — integrates all Wave 1 outputs into wizard core and Generate step

---

## Agent 1: Types & Data Layer

### Files owned
- `src/types/content.ts` — new type definitions
- `src/app/actions/content.ts` — new `getCalendarItemsAction` and `createScheduledBatch` actions
- `src/lib/planner/calendar-adapter.ts` (new) — adapter to convert planner data to `ExistingPlannerItemDisplay`

### Tasks

1. **Add types to `src/types/content.ts`**:
   ```ts
   export interface ScheduleSlot {
     key: string;
     date: string;
     time: string;
     label?: string;
     source: 'suggestion' | 'manual' | 'migrated';
     suggestionId?: string;
   }

   export interface SlotGeneratedCopy {
     slotKey: string;
     scheduledAt: string | null;
     label?: string;
     copy: PlatformCopy | null;
     warnings?: string[];
     error?: string;
     status: 'pending' | 'generating' | 'ready' | 'failed';
   }

   export interface GenerationBatchContext {
     mediaIds: string[];
     slots: Array<{ key: string; date: string; time: string; label?: string }>;
   }
   ```

   Update `DraftState` to include `selectedSlots`, `generatedSlotCopies`, `lastGenerationContext` alongside legacy fields.

2. **Add `getCalendarItemsAction(startIso, endIso)` to `src/app/actions/content.ts`**:
   - Query `content_items` joined with `content_variants` and `content_media_attachments` → `media_library` for the date range
   - Query by `scheduled_for` for planner parity; also include v2 rows with `scheduled_at` that lack `scheduled_for`
   - Return `ExistingPlannerItemDisplay[]` shape (the type from `schedule-calendar.tsx`)
   - Include platform, status, placement, campaignName, and mediaPreview

3. **Add `createScheduledBatch()` to `src/app/actions/content.ts`**:
   - Accept: `{ draftContentId, contentType, brief, selectedMediaIds, slotCopies[], mode: 'schedule' | 'queue_now' }`
   - Auth check + account_id derivation
   - Create a `campaigns` row (event/promotion/weekly get a campaign parent; instant posts can skip or use one)
   - For each slot × each platform in brief.platforms:
     - Insert `content_items` row with `campaign_id`, `account_id`, `platform`, `scheduled_for`, status
     - Insert `content_variants` row with body from slot copy, media_ids
     - Insert `content_media_attachments` rows
   - For `mode: 'schedule'`: set status to `'scheduled'`
   - For `mode: 'queue_now'`: set status to `'queued'`, enqueue publish jobs
   - Mark the original wizard draft row as superseded (delete or set status to a terminal state)
   - Return `{ campaignId?, contentItemIds[], status }`
   - Follow the patterns from `createCampaignFromPlans` in `src/lib/create/service.ts`

### Constraints
- Do not modify `schedule-calendar.tsx`
- Do not modify `suggestion-utils.ts`
- Do not touch wizard or step components
- Match existing `createCampaignFromPlans` patterns for content_items/content_variants/publish_jobs

---

## Agent 2: Schedule Step UI

### Files owned
- `src/features/create/steps/schedule-step.tsx` — complete rewrite

### Tasks

1. **Replace datetime-local with ScheduleCalendar**:
   - Import `ScheduleCalendar` and types from `src/features/create/schedule/schedule-calendar.tsx`
   - Import suggestion builders from `src/features/create/schedule/suggestion-utils.ts`
   - Use `DEFAULT_TIMEZONE` from `src/lib/constants.ts`

2. **New props interface**:
   ```ts
   interface ScheduleStepProps {
     contentId: string | null;
     contentBrief: ContentBrief;
     publishMode: 'now' | 'schedule';
     selectedSlots: ScheduleSlot[];
     onPublishModeChange: (mode: 'now' | 'schedule') => void;
     onSlotsChange: (slots: ScheduleSlot[]) => void;
     accountId: string;
   }
   ```

3. **Publish mode toggle** (instant posts only):
   - "Post Now" / "Schedule" radio group (keep existing UI pattern)
   - When "Post Now": hide calendar, clear slots, show message
   - When "Schedule": show calendar

4. **Load existing planner items**:
   - Call `getCalendarItemsAction(monthStart, monthEnd)` when month changes
   - Pass as `existingItems` to `ScheduleCalendar`
   - Use `useCallback` + `useEffect` to refetch on month navigation

5. **Build suggestions** based on content type:
   - Event: `buildEventSuggestions({ startDate: brief.eventDate, startTime: brief.eventTime, timezone })`
   - Promotion: `buildPromotionSuggestions({ endDate: brief.endDate, timezone })`
   - Weekly: `buildWeeklySuggestions({ startDate: todayIso, dayOfWeek: brief.dayOfWeek, time: brief.time, weeksAhead: brief.weeksAhead, timezone })`
   - Run through `deconflictSuggestions()` with existing items

6. **Slot management wrapper**:
   - `handleAddSlot({ date, time })` from calendar's `onAddSlot`:
     - Reject past dates
     - Enforce slot limit (12, or 1 for story)
     - Dedupe exact date+time
     - Match against suggestions to reattach label/suggestionId
     - For story: replace existing slot
     - Generate stable key
   - `handleRemoveSlot(slotKey)` from calendar's `onRemoveSlot`

7. **Initial month derivation**:
   - Event: month of `brief.eventDate`
   - Promotion: month of `brief.endDate`
   - Weekly/instant: current month

8. **Summary display**:
   - Below calendar, show count: "N slots selected"
   - Show validation message when no slots selected in schedule mode

### Constraints
- Do not modify `schedule-calendar.tsx` or `suggestion-utils.ts`
- Do not touch wizard core, generate step, or AI code
- The component receives `ScheduleSlot[]` from the type defined in the spec — use the exact interface from the spec with `key`, `date`, `time`, `label`, `source`, `suggestionId`

---

## Agent 3: AI Generation Context

### Files owned
- `src/app/actions/ai-generate.ts` — extend with slotLabel
- `src/lib/ai/prompts.ts` — extend buildUserPrompt with slot label

### Tasks

1. **Extend `GenerationContextInput`** in `ai-generate.ts`:
   ```ts
   interface GenerationContextInput {
     mediaIds?: string[];
     scheduledAt?: string | null;
     slotLabel?: string;  // NEW
   }
   ```

2. **Pass slotLabel through** in both `generateContent` and `regenerateWithModifier`:
   - Forward to `buildUserPrompt(brief, modifier, { scheduledAt, media, slotLabel })`

3. **Store slotLabel** in `ai_generation_params.generationContext`

4. **Extend `buildUserPrompt`** in `prompts.ts`:
   - Accept `slotLabel?: string` in context param
   - If present, add after the schedule line:
     ```
     Post scheduled for Wednesday 4 June at 12:00 (Europe/London).
     Slot purpose: "2 weeks out" event warm-up.
     ```
   - Use the label to describe narrative purpose
   - If no label, omit the line (backwards compatible with current single-slot flow)

### Constraints
- Do not modify wizard, step components, or type files
- Keep existing function signatures backwards-compatible (slotLabel is optional)
- Do not change the v1 `buildInstantPostPrompt` function

---

## Agent 4: Wizard Core & Generate UI (Wave 2)

### Files owned
- `src/features/create/create-wizard.tsx` — multi-slot state management
- `src/features/create/steps/generate-step.tsx` — multi-card UI

### Tasks

#### Wizard Core (`create-wizard.tsx`)

1. **Replace single-slot state with multi-slot**:
   - Remove `scheduledAt` state
   - Add `selectedSlots: ScheduleSlot[]` state
   - Add `generatedSlotCopies: SlotGeneratedCopy[]` state
   - Keep `lastGenerationContext: GenerationBatchContext | null`

2. **Update `buildDraftState`**:
   - Include `selectedSlots`, `generatedSlotCopies`, `lastGenerationContext`
   - Keep writing legacy `scheduledAt` as first slot's ISO (for backwards compat)

3. **Draft resume backwards compatibility**:
   - If `draft.selectedSlots` exists, restore it
   - If only `draft.scheduledAt`, convert to single migrated slot
   - If `draft.generatedCopy` exists without `generatedSlotCopies`, wrap into single entry

4. **Update step transitions**:
   - Step 2→3: Validate slots (at least one for schedule mode, all future, no dupes)
   - Sync form values for instant posts
   - Save draft state with step 3

5. **Update ScheduleStep rendering** (step 2):
   - Pass `selectedSlots` and `onSlotsChange` instead of `scheduledAt`/`onScheduledAtChange`
   - Pass `accountId`

6. **Update GenerateStep rendering** (step 3):
   - Pass `selectedSlots`, `generatedSlotCopies`, `onSlotCopiesChange`
   - Compute `isContextStale` from `lastGenerationContext` vs current slots+media
   - Pass `onSaveDraft`, `onScheduleAll`, `onQueueAll`

7. **Final action handlers**:
   - `onSaveDraft`: Save full draft state including slot copies. Close wizard.
   - `onScheduleAll`: Call `createScheduledBatch(mode: 'schedule')`. Show success toast. Close wizard.
   - `onQueueAll`: Call `createScheduledBatch(mode: 'queue_now')`. Show success toast. Close wizard.

#### Generate Step (`generate-step.tsx`)

1. **Multi-card generation**:
   - "Generate All" button triggers batch generation
   - For each slot, call `generateContent(contentId, contentBrief, { mediaIds, scheduledAt: slotIso, slotLabel: slot.label })`
   - Use `Promise.allSettled` with concurrency limit (p-limit, 3 concurrent)
   - Track per-slot status: pending → generating → ready | failed

2. **Multi-card display**:
   - Scrollable list of slot cards
   - Each card header: date, time, label, status indicator
   - Each card body: editable controlled textareas per platform
   - Each card actions: regenerate, apply modifier
   - Failed cards show error with retry button

3. **Stale context detection**:
   - Compare `lastGenerationContext` with current `{ mediaIds (sorted), slots (by time) }`
   - Stable serialization for comparison

4. **Final action buttons**:
   - "Save as Draft" — always available
   - "Schedule All" — disabled when stale or any slot not ready
   - "Queue Now" — for publishMode 'now', disabled when stale or not ready

5. **Single-slot fallback**:
   - For `publishMode: 'now'` with no slots: generate one card with `scheduledAt: null`
   - UI adapts naturally since it's just a list with one card

### Constraints
- Use types from `src/types/content.ts` (Agent 1 output)
- Use `getCalendarItemsAction` from `src/app/actions/content.ts` (Agent 1 output)
- Use `createScheduledBatch` from `src/app/actions/content.ts` (Agent 1 output)
- Use the `slotLabel` context from `ai-generate.ts` (Agent 3 output)
- Import `ScheduleSlot`, `SlotGeneratedCopy`, `GenerationBatchContext` from types

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| `campaigns` + `content_variants` tables not in local migrations | Agent 1 checks live schema before writing insert code; uses existing `createCampaignFromPlans` patterns |
| `ScheduleCalendar` API mismatch | Agent 2 uses exact existing props; no modifications to calendar component |
| AI rate limiting with 12 concurrent calls | Agent 4 uses p-limit(3) for bounded concurrency |
| Draft resume breaks existing drafts | Backwards compat layer converts old `scheduledAt` → `selectedSlots` |
| Planner doesn't show new content | Agent 1 writes both `scheduled_for` and `scheduled_at` columns |

## Verification

After integration:
1. `npm run typecheck` — zero errors
2. `npm run lint` — no new warnings in modified files
3. `npm test` — all existing tests pass
4. Browser verification of full wizard flow
5. Verify planner shows batch-created content
