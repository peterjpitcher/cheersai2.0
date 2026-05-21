# Wave 1 — Types & Data Layer Handoff

## What was done

### `src/types/content.ts`
- Added `ScheduleSlot` interface (key, date, time, label, source, suggestionId)
- Added `SlotGeneratedCopy` interface (slotKey, scheduledAt, label, copy, warnings, error, status)
- Added `GenerationBatchContext` interface (mediaIds, slots array)
- Updated `DraftState` to include multi-slot fields (`selectedSlots`, `generatedSlotCopies`, `lastGenerationContext`) alongside legacy single-slot fields (`scheduledAt`, `generatedCopy`) for backwards compatibility

### `src/app/actions/content.ts`
- Added `getCalendarItemsAction(startIso, endIso)` — returns `CalendarItemDisplay[]` for the ScheduleCalendar component. Queries content_items with scheduled_for (primary) and falls back to scheduled_at for v2 drafts. Left-joins content_media_attachments and media_library for first media preview.
- Added `createScheduledBatch(input)` — batch-creates planner-compatible content_items + content_variants + content_media_attachments from the wizard's generated slot previews. Creates a campaigns row for event/promotion/weekly_recurring types. Writes both `scheduled_for` and `scheduled_at` for column compatibility. Enqueues publish jobs when mode is 'queue_now'. Deletes the original wizard draft row after successful creation.

## Assumptions

1. **CalendarItemDisplay type defined inline** — not imported from schedule-calendar.tsx (client component) as specified in the brief. The type shape matches `ExistingPlannerItemDisplay` exactly.
2. **Platform-specific body extraction** — `createScheduledBatch` extracts `slot.copy[platform].body` for each platform's content_variants row. This assumes PlatformCopy always has a matching key for each platform in the platforms array.
3. **Media attachments non-fatal** — content_media_attachments insert failures are logged but do not fail the batch, since the primary media_ids on content_variants is the canonical reference.
4. **Campaign name derivation** — uses `brief.title` or `brief.eventTitle` for the campaign name, falling back to a generated name from contentType.
5. **getCalendarItemsAction OR filter** — uses Supabase `.or()` to match items where either scheduled_for or scheduled_at falls in range, then post-filters to ensure items are strictly within range. Excludes draft status items.

## Pre-existing issues

- `src/app/actions/ai-generate.ts` has two TS errors referencing `slotLabel` on `GenerationContextInput` — this is expected and will be resolved by the AI generation wave agent that updates that interface.

## Files modified

- `src/types/content.ts` — 3 new exported interfaces, DraftState updated
- `src/app/actions/content.ts` — 2 new exported server actions, 1 new internal interface, additional imports
