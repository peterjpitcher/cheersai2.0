# Wave 2: Wizard Core & Generate UI -- Handoff

## What changed

### `src/features/create/create-wizard.tsx`
- Replaced single-slot state (`scheduledAt`, `generatedCopy`, `aiWarnings`) with multi-slot state (`selectedSlots`, `generatedSlotCopies`, `lastGenerationContext`)
- `buildDraftState` writes both canonical multi-slot fields and legacy single-slot fields for backwards compat
- Draft resume handles: multi-slot restore, legacy `scheduledAt` migration to `ScheduleSlot`, legacy `generatedCopy` wrapping into `SlotGeneratedCopy`
- Step 2->3 transition validates slots (at least one for schedule mode), syncs form values
- ScheduleStep now receives `selectedSlots`/`onSlotsChange`/`accountId` props (matching Wave 1 interface)
- GenerateStep receives multi-slot props with `onScheduleAll`/`onQueueAll` calling `createScheduledBatch`
- Removed imports of `scheduleContent` and `approveForQueue`; added `createScheduledBatch`
- Stale detection compares sorted media IDs and sorted slot date:time strings

### `src/features/create/steps/generate-step.tsx`
- Complete rewrite for multi-card batch generation
- "Generate All" uses `p-limit(3)` for bounded concurrency across slots
- Each slot card is collapsible with status indicator (pending/generating/ready/failed)
- Ready cards show editable platform copy in 3-column grid (Facebook/Instagram/GBP)
- Per-slot modifier chips and regenerate button using `regenerateWithModifier`
- Failed cards show error with retry button
- "Post Now" mode creates a virtual "now" slot with `scheduledAt: null`
- Final actions: Save as Draft (always), Schedule All (schedule mode), Post Now (now mode)
- Stale context warning banner disables Schedule/Queue buttons

## Testing notes
- TypeScript compiles cleanly (zero errors on both files)
- No files outside ownership scope were modified
- `p-limit` is already in project dependencies (used elsewhere)
- `luxon` and `DEFAULT_TIMEZONE` imported for slot ISO conversion

## Integration points
- ScheduleStep props match the Wave 1 interface exactly
- `generateContent` and `regenerateWithModifier` called with correct `GenerationContextInput` shape
- `createScheduledBatch` called with correct `CreateScheduledBatchInput` shape
- Types imported from `@/types/content` match Wave 1 definitions
