# Spec: Multi-Date Schedule Step

## Critical Review

The calendar direction is right, but the previous draft was not implementation-safe. The current codebase has two scheduling models that this feature must reconcile:

- The current wizard actions in `src/app/actions/content.ts` create and mutate a single `content_items` row using `scheduled_at`, `body_draft`, and v2 media attachments.
- The planner, campaign services, link-in-bio, and publish workers primarily use `scheduled_for`, `platform`, `placement`, `campaign_id`, `prompt_context`, and `content_variants`.

The feature must not call `scheduleContent()` once per slot against the initial draft row. That would repeatedly update the same row and would not create planner-visible variants. The final implementation needs a batch creation action that writes the planner-compatible records for every selected slot.

Other corrections from the code review:

- `ScheduleCalendar` does not return suggestion labels from `onAddSlot`. It only calls `onAddSlot({ date, time })`, so the wrapper must reattach `label` and `suggestionId` by matching the selected date/time against the suggestion list.
- `deconflictSuggestions()` filters out clashing suggestions. It does not shift them to a nearby time. The UI should describe conflicts through existing planner items and omitted suggestions, not pretend a replacement slot was found automatically.
- `getScheduledContentAction()` returns v2 `ContentItem` data, not the `ExistingPlannerItemDisplay` shape expected by `ScheduleCalendar`. Add an adapter or a new action that returns the calendar display DTO for the visible month.
- Existing generation only supports one schedule context: `GenerationContextInput` has `mediaIds` and `scheduledAt`. Multi-date requires `slotLabel`, per-slot generation state, partial failure handling, and a stable stale-context comparison.
- The previous spec said story scheduling was both in scope and out of scope. This version treats story as single-slot only; special v1 story cadence and story-specific derivations stay out of scope.

## Implementation Decision

Use the wizard to collect selected slots, generate editable previews per slot, then create a batch of planner-compatible content rows when the user chooses the final action.

Do not expand multi-date content by mutating the original draft row in a loop. The original draft row is only the wizard working draft. After a successful batch create, it should be marked superseded, deleted if safe, or otherwise hidden from planner listings so it cannot appear as a duplicate draft.

## Scope

### In Scope

- Replace the Schedule step's single `datetime-local` input with `ScheduleCalendar`.
- Show existing planner items on the calendar for the visible month.
- Add content-type-aware suggestions for events, promotions, and weekly recurring content.
- Support manual slot addition and removal.
- Persist `selectedSlots[]` and `generatedSlotCopies[]` in `DraftState`.
- Generate one preview card per slot, with copy contextualized by date/time and slot label.
- Allow per-slot regeneration and partial retry when one slot fails.
- Create a planner-compatible batch of content rows and variants from generated previews.
- Keep backwards compatibility for drafts that only have `scheduledAt` and `generatedCopy`.

### Out of Scope

- New publish worker behavior. This spec may create scheduled content rows, but it should not redesign dispatching.
- Banner overlay configuration.
- Management app import/prefill.
- Story cadence automation from v1. Stories are allowed as a single scheduled slot only.
- A full schema migration from `scheduled_for` to `scheduled_at`. This spec bridges the current split and calls out the follow-up migration.

## Current Code Constraints

The implementation must account for these actual contracts:

- `src/features/create/schedule/schedule-calendar.tsx`
  - `selected` expects `{ key, date, time }[]`.
  - `suggestions` expects `{ id, date, time, label }[]`.
  - `existingItems` expects `ExistingPlannerItemDisplay[]` with `scheduledFor`, `platform`, `status`, optional `placement`, `campaignName`, and `mediaPreview`.
  - `onAddSlot` receives only `{ date, time }`; it does not include `id` or `label`.
- `src/features/create/schedule/suggestion-utils.ts`
  - `buildEventSuggestions({ startDate, startTime, timezone })`
  - `buildPromotionSuggestions({ endDate, timezone })`
  - `buildWeeklySuggestions({ startDate, dayOfWeek, time, weeksAhead, timezone })`
  - `deconflictSuggestions(suggestions, existingItems, timezone)` expects existing items with a `date` field and filters clashing suggestions.
- `src/features/create/schemas/content-schemas.ts`
  - `weekly_recurring` briefs have `dayOfWeek`, `time`, and `weeksAhead`, but no `startDate`. Derive the weekly suggestion `startDate` from the current local date unless a future brief field is added.
- `src/features/create/steps/generate-step.tsx`
  - Currently renders one `PlatformCopy`.
  - Calls `generateContent(contentId, contentBrief, { mediaIds, scheduledAt })`.
  - Tracks stale context with one `scheduledAt`, so this must become a stable hash of media IDs plus normalized slots.
- `src/app/actions/ai-generate.ts`
  - `GenerationContextInput` needs `slotLabel?: string`.
  - `buildUserPrompt()` needs to include both scheduled time and slot narrative purpose.
- Planner data currently reads `scheduled_for` and `content_variants`, so newly created batch rows must write those fields if they should appear in the existing planner.

## Data Model

### Draft State

Keep the old fields for resume compatibility, but treat `selectedSlots` and `generatedSlotCopies` as canonical for this flow.

```ts
interface ScheduleSlot {
  key: string;
  date: string; // YYYY-MM-DD in Europe/London
  time: string; // HH:mm in Europe/London
  label?: string;
  source: "suggestion" | "manual" | "migrated";
  suggestionId?: string;
}

interface SlotGeneratedCopy {
  slotKey: string;
  scheduledAt: string | null; // ISO timestamp, null only for "post now"
  label?: string;
  copy: PlatformCopy | null;
  warnings?: string[];
  error?: string;
  status: "pending" | "generating" | "ready" | "failed";
}

interface GenerationBatchContext {
  mediaIds: string[];
  slots: Array<{
    key: string;
    date: string;
    time: string;
    label?: string;
  }>;
}

interface DraftState {
  step: number;
  contentType: ContentType;
  brief: Record<string, unknown>;
  selectedMediaIds?: string[];
  selectedSlots?: ScheduleSlot[];
  generatedSlotCopies?: SlotGeneratedCopy[];
  lastGenerationContext?: GenerationBatchContext;

  // Legacy single-slot fields, still read on draft resume.
  scheduledAt?: string;
  generatedCopy?: PlatformCopy;
}
```

### Slot Keys

Slot keys must be stable. Use the suggestion ID for accepted suggestions when possible, for example `suggestion:event-day:2026-06-04:17:00`. For manual slots, create the key when adding the slot with `crypto.randomUUID()` or a deterministic `manual:${date}:${time}:${n}` collision suffix. Do not create keys during render.

### Backwards Compatibility

On draft resume:

- If `selectedSlots` exists, use it.
- If only `scheduledAt` exists, convert it into one migrated slot.
- If only `generatedCopy` exists, convert it into one `generatedSlotCopies` entry when there is exactly one slot. Otherwise mark generated copy stale and require regeneration.

```ts
if (!draft.selectedSlots?.length && draft.scheduledAt) {
  const dt = DateTime.fromISO(draft.scheduledAt, { zone: DEFAULT_TIMEZONE });
  const migratedSlot = {
    key: "migrated:scheduled-at",
    date: dt.toISODate(),
    time: dt.toFormat("HH:mm"),
    source: "migrated" as const,
  };
}
```

## Schedule Step

### Routing

| Content type | Calendar shown? | Suggestions | Manual slots | Slot limit |
| --- | --- | --- | --- | --- |
| `instant_post` with `publishMode: "now"` | No | None | No | 0 |
| `instant_post` with `publishMode: "schedule"` | Yes | None | Yes | 12 |
| `story` | Yes | None | Yes | 1 |
| `event` | Yes | Event cadence | Yes | 12 |
| `promotion` | Yes | Promotion cadence | Yes | 12 |
| `weekly_recurring` | Yes | Weekly cadence | Yes | `weeksAhead`, capped at 12 |

### Props

```ts
interface ScheduleStepProps {
  contentId: string | null;
  contentBrief: ContentBrief;
  publishMode: "now" | "schedule";
  selectedSlots: ScheduleSlot[];
  onPublishModeChange: (mode: "now" | "schedule") => void;
  onSlotsChange: (slots: ScheduleSlot[]) => void;
  accountId: string;
}
```

### Existing Planner Items

Do not pass `getScheduledContentAction()` results directly to `ScheduleCalendar`. Add one of the following:

1. A new action such as `getCreateCalendarItemsAction({ startIso, endIso })` that queries planner-compatible rows and returns `ExistingPlannerItemDisplay[]`.
2. A local adapter only if all required fields are already present. At the moment they are not, because media preview and placement/campaign labels come from planner data and variants.

The preferred action should query by `scheduled_for` for planner parity. If a short-term bridge needs v2 draft rows too, merge in rows with `scheduled_at` that have no `scheduled_for`.

### Suggestion Building

Use the actual helper signatures:

```ts
const today = DateTime.now().setZone(timezone).toFormat("yyyy-MM-dd");

const suggestions =
  contentBrief.contentType === "event"
    ? buildEventSuggestions({
        startDate: contentBrief.eventDate,
        startTime: contentBrief.eventTime,
        timezone,
      })
    : contentBrief.contentType === "promotion"
    ? buildPromotionSuggestions({
        endDate: contentBrief.endDate,
        timezone,
      })
    : contentBrief.contentType === "weekly_recurring"
    ? buildWeeklySuggestions({
        startDate: today,
        dayOfWeek: contentBrief.dayOfWeek,
        time: contentBrief.time,
        weeksAhead: contentBrief.weeksAhead,
        timezone,
      })
    : [];

const deconflicted = deconflictSuggestions(
  suggestions,
  existingItems.map((item) => ({
    date: DateTime.fromISO(item.scheduledFor, { zone: "utc" })
      .setZone(timezone)
      .toISODate(),
  })),
  timezone,
);
```

If `deconflictSuggestions()` drops an important suggestion such as "Event day", show it as unavailable rather than silently hiding all context. Otherwise the user may not understand why an expected slot disappeared.

### Slot Add/Remove

`ScheduleCalendar` calls `onAddSlot({ date, time })`. The wrapper must:

- Reject past date/time selections.
- Dedupe exact `date + time` matches.
- Enforce the content-type slot limit.
- Reattach `label` and `suggestionId` by finding a suggestion with the same `date` and `time`.
- Replace the existing slot for stories instead of adding a second slot.
- Store the resulting normalized slot through `onSlotsChange`.

### Step Validation

Before moving from Schedule to Generate:

- `publishMode: "now"` is valid only for `instant_post`.
- Scheduled modes require at least one selected slot.
- All slots must parse in `Europe/London`.
- All slots must be in the future.
- Duplicate `date + time` pairs are invalid.
- Slot count must not exceed 12.

## Generate Step

### Generation Strategy

For scheduled content, generate one preview per selected slot. For instant "post now", generate one preview with `scheduledAt: null` and a synthetic slot key such as `now`.

Use bounded concurrency and partial failure handling. Avoid an unbounded `Promise.all()` for 12 slots.

```ts
const results = await Promise.allSettled(
  slotsToGenerate.map((slot) =>
    limit(() =>
      generateContent(contentId, contentBrief, {
        mediaIds: selectedMediaIds,
        scheduledAt: slot.scheduledAt,
        slotLabel: slot.label,
      }),
    ),
  ),
);
```

Recommended concurrency: 3. Each failed slot should render an error card with retry. Successful slots remain editable.

### Display Requirements

Render a scrollable list of generated post cards:

- Header: date, time, label, and status.
- Body: editable controlled textareas for each platform in `PlatformCopy`.
- Media context: show selected media thumbnails or at least selected media filenames if thumbnails are not available in this step yet.
- Actions: regenerate this slot, apply modifier, remove failed copy.
- Warnings: show AI validation warnings per slot.

The existing single-copy `generatedCopy` UI can be kept behind a compatibility adapter, but the canonical UI should operate on `generatedSlotCopies`.

### Stale Context

Generated previews are stale when any of the following change:

- `selectedMediaIds`
- selected slot key/date/time/label
- content brief fields that are used by AI generation

Compare a stable serialized context, not object identity. Sort `selectedMediaIds`; preserve slot order by scheduled time.

```ts
const generationContext = {
  mediaIds: [...selectedMediaIds].sort(),
  slots: normalizedSlots.map(({ key, date, time, label }) => ({ key, date, time, label })),
};
```

Changing only edited copy text should not mark context stale.

### AI Context

Extend `GenerationContextInput`:

```ts
interface GenerationContextInput {
  mediaIds?: string[];
  scheduledAt?: string | null;
  slotLabel?: string;
}
```

Update `buildUserPrompt()` so the model receives both the scheduled time and narrative purpose:

```text
Post scheduled for Wednesday 4 June at 12:00 (Europe/London).
Slot purpose: "2 weeks out" event warm-up.
```

This matters because an event-day post, a countdown post, and a launch post need materially different copy.

## Final Actions

### Save Draft

Save the wizard draft with:

- `selectedSlots`
- `generatedSlotCopies`
- `selectedMediaIds`
- `lastGenerationContext`

This is a resume feature only. It should not create scheduled planner rows.

### Schedule All

Call a new server action, tentatively `createScheduledBatch()`. It must create actual planner-visible content from the generated previews.

```ts
interface CreateScheduledBatchInput {
  draftContentId: string;
  contentType: ContentType;
  brief: ContentBrief;
  selectedMediaIds: string[];
  slotCopies: Array<{
    slotKey: string;
    scheduledAt: string;
    label?: string;
    copy: PlatformCopy;
  }>;
  mode: "schedule" | "queue_now";
}
```

Server-side responsibilities:

1. Authenticate and derive `accountId` server-side.
2. Verify the draft belongs to the account.
3. Verify selected media belongs to the account.
4. Validate every generated slot has ready copy.
5. Create or reuse a `campaigns` parent for event, promotion, weekly recurring, and multi-slot instant batches. Use metadata to preserve source brief fields and slot labels.
6. Insert one `content_items` row per publishable platform/placement per slot. This matches the current planner model, where platform and placement live on `content_items`.
7. Write `scheduled_for` for planner/publish compatibility. Also write `scheduled_at` during the bridge period if v2 consumers still need it.
8. Write `content_variants` for each row with the generated body and selected `media_ids`.
9. Write `content_media_attachments` too if the v2 attachment path is still used by create thumbnails or previews.
10. Return created IDs grouped by slot.
11. Mark the original wizard draft as superseded or delete it if safe.

The acceptance criterion is not "one content item per slot" in this codebase. It is "one planner-visible content item per required platform/placement per slot, with variants attached."

### Queue All

For instant `publishMode: "now"`, use the same batch creation path with one synthetic slot and `mode: "queue_now"`. The current `approveForQueue(contentId)` is insufficient because it only changes status on the single draft row and does not guarantee that edited generated copy and media are in `content_variants`.

If immediate queueing is implemented in this feature, `createScheduledBatch()` must either:

- create `publish_jobs` through the existing queue helper, or
- create content rows in the status expected by the existing recurring dispatcher.

Do not leave this ambiguous in implementation. The chosen queue path must be tested end to end.

## Column Compatibility Decision

For this feature, bridge both scheduling columns:

- Write `scheduled_for` because planner, campaigns, link-in-bio, and publish workers rely on it today.
- Write `scheduled_at` as a compatibility mirror while wizard v2 actions and queries still use it.

Add a follow-up tech debt item to unify the schema and remove one column after planner/create/publish all read the same field. Without this decision, multi-date content may save successfully but not appear where users expect it.

## File Changes

| File | Required change |
| --- | --- |
| `src/types/content.ts` | Add `ScheduleSlot`, `SlotGeneratedCopy`, `GenerationBatchContext`, and draft compatibility fields. |
| `src/features/create/create-wizard.tsx` | Replace single `scheduledAt` generation state with slots/copies; migrate resumed drafts; validate step transitions; save the new state. |
| `src/features/create/steps/schedule-step.tsx` | Replace `datetime-local` UI with `ScheduleCalendar`; build suggestions; load/adapt existing planner items; manage slot limits. |
| `src/features/create/schedule/schedule-calendar.tsx` | No required API change, but consider emitting suggestion ID/label in `onAddSlot` to reduce wrapper inference. |
| `src/features/create/schedule/suggestion-utils.ts` | No required helper rename; tests should lock current signatures and deconflict behavior. |
| `src/features/create/steps/generate-step.tsx` | Render multi-card generated previews, per-slot retry/regenerate, and stable stale-context handling. |
| `src/app/actions/ai-generate.ts` | Add `slotLabel`; support per-slot generation context. |
| `src/lib/ai/prompts.ts` | Include slot label and scheduled local time in the prompt. |
| `src/app/actions/content.ts` or new action module | Add `createScheduledBatch()`; do not overload `scheduleContent()`. |
| `src/lib/planner/data.ts` or create action helper | Reuse or expose a planner-item query that can produce `ExistingPlannerItemDisplay[]`. |

## Edge Cases

- No slots with scheduled mode: block moving to Generate.
- No slots with instant "now": valid; generate one immediate preview.
- Story with multiple selections: keep only the latest selected slot.
- Existing item on same day: show it on the calendar; filtered suggestions should be understandable.
- Existing item at exact same date/time: manual addition should be rejected or require an explicit override. Default to reject.
- Slot falls into DST transition: parse with `Europe/London`; reject nonexistent local times.
- User changes media after generation: mark generated copies stale.
- User changes slot labels/order after generation: mark generated copies stale.
- One generation fails: keep successful cards, show failed card, allow retry.
- User removes a slot after generation: remove its generated copy.
- User reorders slots: preserve generated copies by `slotKey`.
- Large weekly campaigns: cap at 12 slots for this wizard.

## Testing

Add focused tests for the high-risk boundaries:

- Schedule step maps `ExistingPlannerItemDisplay` correctly from planner rows and does not pass raw `ContentItem` rows into `ScheduleCalendar`.
- Suggestion labels survive `ScheduleCalendar.onAddSlot({ date, time })` through wrapper matching.
- `deconflictSuggestions()` behavior is reflected in UI expectations, especially for an occupied event day.
- Draft resume migrates `scheduledAt` to `selectedSlots` and preserves one legacy `generatedCopy` when safe.
- Step validation blocks past slots, duplicate slots, empty scheduled slots, and too many slots.
- Generate step handles partial failures from `Promise.allSettled`.
- Stale context changes when slots/media/brief changes and not when edited copy changes.
- `createScheduledBatch()` writes `content_items`, `content_variants`, media relationships, and both `scheduled_for` and `scheduled_at` during the bridge period.
- Batch creation creates per-platform/per-placement rows as expected by planner data.
- Queue-now path persists generated copy/media before queueing.

Run at minimum:

```sh
npm run typecheck
npm run lint:ci
CI=1 npm test -- --run
```

## Acceptance Criteria

- Schedule step uses `ScheduleCalendar` for every scheduled flow.
- Instant post "now" skips the calendar and generates one immediate preview.
- Event, promotion, and weekly recurring flows show appropriate suggestions using the existing helper signatures.
- Existing planner items are visible in the calendar with status/platform context.
- Manual slot addition validates future time, dedupes slots, and enforces slot limits.
- Suggestion labels are preserved on selected slots.
- Generate step creates one editable preview card per selected slot.
- Per-slot AI copy receives `scheduledAt` and `slotLabel`.
- Partial generation failure does not discard successful previews.
- Slot/media/brief changes mark previews stale before final scheduling.
- Save Draft persists slots and generated slot copies.
- Schedule All creates planner-visible rows and variants for every slot/platform/placement.
- Queue All for "post now" persists generated copy/media before queueing.
- The original wizard draft does not appear as an extra planner item after successful batch creation.

## Complexity

Score: 5 (XL)

The calendar component and suggestion builders already exist, but the risky work is not the calendar UI. The risky work is bridging the wizard's v2 draft model with the planner/campaign/publish model.

Estimated work:

1. Schedule calendar wiring and validation: M
2. Planner item adapter/action for calendar display: M
3. Draft state migration and stale context hashing: M
4. Multi-card generation UI with partial failure handling: L
5. `slotLabel` AI prompt context: S
6. `createScheduledBatch()` with planner-compatible rows and variants: L
7. Queue-now persistence path: M
8. Tests across schedule, generation, and batch creation: L
