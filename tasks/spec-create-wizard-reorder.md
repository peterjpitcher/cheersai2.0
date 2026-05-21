# Spec: Reorder Create Wizard Steps

## Critical Review

The product idea is sound: the wizard should collect media and schedule intent before AI generation so the copy can be written with the actual publishing context in mind.

The original spec underestimates the implementation work and has several incorrect assumptions against the current code:

1. `DraftState` already has `scheduledAt?: string`; adding `scheduledDate` would introduce a second name for the same concept.
2. Step 0 cannot remain fully unchanged. `InstantPostFields` currently includes the schedule datetime input, so leaving it there creates duplicate scheduling UI once `ScheduleStep` moves before `GenerateStep`.
3. The current `datetime-local` input produces local values like `2026-06-15T19:30`, but `contentBriefSchema` expects an ISO datetime string such as `2026-06-15T18:30:00.000Z`. The schedule step must normalise local input before saving it to draft state or `brief.scheduledFor`.
4. Passing only media IDs to the AI is not enough for visual-aware copy. The server action can load file names, media types, tags, and aspect classes, but it still cannot know image contents unless we add vision analysis. The prompt must not ask the model to infer unseen visual details.
5. `MediaStep` currently persists attachments both on unmount and in `CreateWizard.goNext`. That should be reduced to one controlled persistence point.
6. Media clearing is currently broken: both persistence paths skip `attachMediaToContent` when `selectedMediaIds` is empty, so removing all media would leave old attachments in the database. The new flow must call `attachMediaToContent(draftId, [])`.
7. `MediaStep` does not currently enforce "stories require exactly one image"; that validation exists in the older instant-post schema path, not in this wizard.
8. `GenerateStep` textareas use `defaultValue` and do not write user edits back into `generatedCopy`. Moving the final actions into `GenerateStep` without fixing this would silently ignore edited copy.
9. Draft auto-save stores the current step before incrementing, so resume can land one step behind. The reorder should save the target step explicitly.
10. The current final actions in `ScheduleStep` call `saveDraft`, `scheduleContent`, and `approveForQueue`. Those actions update `content_items`, but they do not create `publish_jobs` or `content_variants`. If this wizard is expected to publish through the newer pipeline, that is a separate release blocker.
11. The launcher passes `?flow=instant|event|promotion|weekly`, but `CreateWizard` always defaults to `instant_post`. That is adjacent to this reorder and should be fixed or explicitly left out of scope.

## Decision

Implement the reordered flow as:

```text
Step 0: Brief
Step 1: Media
Step 2: Schedule
Step 3: Generate and Confirm
```

Labels:

```ts
const STEP_LABELS = ['Brief', 'Media', 'Schedule', 'Generate'] as const;
```

This spec is scoped to reordering the wizard, preserving draft resume, passing media/schedule context into generation, and moving the existing final actions. It does not claim to add true publish-job creation unless the implementation also routes final confirmation through the publish pipeline.

## State Model

Use these names consistently:

```ts
interface DraftState {
  step: number;
  contentType: ContentType;
  brief: Record<string, unknown>;
  generatedCopy?: PlatformCopy;
  selectedMediaIds?: string[];
  scheduledAt?: string | null; // ISO datetime, UTC preferred
}
```

Do not add `scheduledDate`.

Wizard-owned state:

```ts
const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
const [scheduledAt, setScheduledAt] = useState<string | null>(null);
const [lastGenerationContext, setLastGenerationContext] = useState<{
  mediaIds: string[];
  scheduledAt: string | null;
} | null>(null);
```

`scheduledAt` is the canonical schedule value for the wizard. For instant posts, also keep the form's `publishMode` and `scheduledFor` fields in sync so existing brief parsing and prompt code keep working:

- `publishMode === 'now'`: `scheduledAt = null`, clear `brief.scheduledFor`.
- `publishMode === 'schedule'`: `scheduledAt = selected ISO value`, set `brief.scheduledFor` to the same ISO value.

## Flow Behaviour

### Step 0 -> 1: Brief to Media

- Run `form.trigger()` against the brief fields.
- Create the draft via `createDraft(form.getValues())` if `draftId` does not exist.
- Immediately save a full `DraftState` with `step: 1` after draft creation. Do not leave new drafts with only the raw brief in `body_draft`.
- Navigate to Media.

Implementation note: because `useAutoSaveDraft(draftId)` still has `draftId = null` in the same tick after `createDraft`, call `saveDraft(newDraftId, buildDraftState(1))` directly or refactor the save helper to accept an explicit content ID.

### Step 1 -> 2: Media to Schedule

- Validate media for content types that require it:
  - Story: exactly one selected media item.
  - Story: selected item must be an image.
- Persist attachments with `attachMediaToContent(draftId, selectedMediaIds)` even when `selectedMediaIds` is empty.
- Save `DraftState` with `step: 2`.
- Navigate to Schedule.

Do not also persist on `MediaStep` unmount. The transition handler should be the single source of persistence.

### Step 2 -> 3: Schedule to Generate

- Store schedule intent in wizard state, not only inside `ScheduleStep`.
- Convert `datetime-local` values with `DateTime.fromISO(value, { zone: DEFAULT_TIMEZONE })`.
- Persist the ISO value in `DraftState.scheduledAt`.
- For instant posts, synchronise form values:
  - `form.setValue('publishMode', 'now' | 'schedule')`
  - `form.setValue('scheduledFor', isoOrUndefined)`
- Save `DraftState` with `step: 3`.
- Navigate to Generate.

If the selected schedule date is in the past, block the transition for `publishMode === 'schedule'`.

### Step 3: Generate and Confirm

- Generate receives the selected media and schedule context.
- Generated copy appears next to a selected-media preview strip.
- Save as Draft, Schedule, and Save and Queue move from `ScheduleStep` into `GenerateStep`.
- If media or schedule changes after copy is generated, show a stale-context warning and require regeneration before Schedule or Save and Queue. Save as Draft can remain available.

## File Changes

### `src/features/create/create-wizard.tsx`

Required changes:

- Update `STEP_LABELS`.
- Add `scheduledAt` and `lastGenerationContext` state.
- Load media library data into the wizard or accept it as a prop. The current wizard passes no `libraryItems`, so selected existing assets cannot render thumbnails.
- Change `buildDraftState(targetStep?: number)` so transitions persist the destination step, not the current step.
- Add backwards-compatible draft loading:
  - If `body_draft.brief` exists, treat it as `DraftState`.
  - If `body_draft.contentType` exists without `brief`, treat it as an older raw brief and wrap it.
  - Restore `scheduledAt` from `draft.scheduledAt`, `draft.brief.scheduledFor`, or `contentItem.scheduledAt`.
- Step rendering:
  - `currentStep === 1` renders `MediaStep`.
  - `currentStep === 2` renders `ScheduleStep`.
  - `currentStep === 3` renders `GenerateStep`.
- Pass media metadata and `scheduledAt` to `GenerateStep`.
- Pass `contentType`, selected media metadata, and validation requirements to `MediaStep`.
- Remove the generic bottom "Next" button on the final step as today; final actions live inside `GenerateStep`.

### `src/features/create/steps/brief-step.tsx`

Keep content type, title, prompt, platform, tone, length, hashtag, emoji, CTA, and proof-point inputs.

Do not ask for the schedule datetime here. The schedule datetime belongs in the Schedule step.

### `src/features/create/forms/instant-post-fields.tsx`

Move scheduling UI out of this component:

- Remove the `scheduledFor` `datetime-local` input.
- Prefer moving the `publishMode` radio group to `ScheduleStep` as well.
- Keep `publishMode: 'now'` as the wizard default so the schema still has a value before the Schedule step.

If `publishMode` remains in Brief for now, the Schedule step must still be the only place that edits `scheduledFor`.

### `src/features/create/steps/media-step.tsx`

Required changes:

- Remove the unmount persistence effect.
- Accept `contentType` and enough media metadata to validate story requirements.
- Surface validation errors from the wizard transition or expose a validator callback.
- Pass actual `libraryItems` into `MediaPicker`; the current default empty array means the library tab cannot show existing assets.
- Keep reorder support, but avoid the current empty-URL `CarouselUploader` path unless actual preview URLs are available. `MediaPicker` already supports drag reorder.

### `src/features/create/media/media-picker.tsx`

Required changes:

- Ensure selected IDs that are not in the first page of `libraryItems` can still render after draft resume. Either fetch selected assets by ID or merge selected asset summaries into the library list.
- Preserve selected ID order when rendering and when calling `attachMediaToContent`; attachment position is derived from array index.

### `src/features/create/steps/schedule-step.tsx`

Make this a controlled, pure scheduling step.

New props:

```ts
interface ScheduleStepProps {
  contentId: string | null;
  contentBrief: ContentBrief;
  publishMode: 'now' | 'schedule';
  scheduledAt: string | null;
  onPublishModeChange: (mode: 'now' | 'schedule') => void;
  onScheduledAtChange: (iso: string | null) => void;
}
```

Responsibilities:

- Show "Post now" vs "Schedule" for instant posts.
- Show `datetime-local` only when scheduling.
- Convert between local input values and ISO state.
- Run conflict detection when `scheduledAt` changes.
- Show conflict warnings only; do not perform final save/schedule/queue actions.

Remove:

- Generated-copy summary.
- Attached-media summary if it is only a count. The media preview is more useful in `GenerateStep`.
- Save as Draft, Schedule, and Save and Queue buttons.

### `src/features/create/steps/generate-step.tsx`

New or changed props:

```ts
interface GenerateStepProps {
  contentId: string | null;
  contentBrief: ContentBrief;
  generatedCopy: PlatformCopy | null;
  selectedMediaIds: string[];
  selectedMediaItems: MediaAssetSummary[];
  scheduledAt: string | null;
  isContextStale: boolean;
  onCopyChange: (copy: PlatformCopy) => void;
  warnings: string[];
  onWarningsChange: (warnings: string[]) => void;
  onGeneratedWithContext: (context: { mediaIds: string[]; scheduledAt: string | null }) => void;
  onSaveDraft: () => Promise<void>;
  onSchedule: () => Promise<void>;
  onQueueNow: () => Promise<void>;
  isSubmitting: boolean;
}
```

Required changes:

- Call `generateContent(contentId, contentBrief, { mediaIds: selectedMediaIds, scheduledAt })`.
- Call `regenerateWithModifier(contentId, contentBrief, modifier, { mediaIds: selectedMediaIds, scheduledAt })`.
- Render selected media thumbnails using `selectedMediaItems`.
- Make textareas controlled or update wizard state on blur/change. Do not rely on `defaultValue`.
- Record `lastGenerationContext` after successful generation/regeneration.
- Disable Schedule and Save and Queue while `isContextStale` is true.
- Keep Save as Draft available even without generated copy.

### `src/app/actions/ai-generate.ts`

Change signatures to use an options object:

```ts
interface GenerationContextInput {
  mediaIds?: string[];
  scheduledAt?: string | null;
}

export async function generateContent(
  contentId: string,
  brief: ContentBrief,
  context?: GenerationContextInput,
): Promise<{ data?: PostprocessResult; error?: string }>;

export async function regenerateWithModifier(
  contentId: string,
  brief: ContentBrief,
  modifier: string,
  context?: GenerationContextInput,
): Promise<{ data?: PostprocessResult; error?: string }>;
```

Server-side media context:

- Load media metadata by ID from `media_assets`, scoped to `account_id`.
- Preserve the selected ID order.
- Include only safe metadata in the prompt: file name, media type, tags, aspect class.
- Do not claim visual understanding from file IDs alone.

Persist `ai_generation_params` with:

```ts
{
  brief,
  generationContext: {
    mediaIds,
    scheduledAt,
    mediaMetadata,
  },
  temperature,
  model,
}
```

### `src/lib/ai/prompts.ts`

Extend `buildUserPrompt`:

```ts
export function buildUserPrompt(
  brief: ContentBrief,
  modifier?: string,
  context?: {
    scheduledAt?: string | null;
    media?: Array<{
      id: string;
      fileName: string;
      mediaType: 'image' | 'video';
      tags: string[];
      aspectClass?: 'square' | 'story' | 'landscape';
    }>;
  },
): string
```

Prompt requirements:

- Include a friendly local scheduled time line, for example `Post scheduled for Friday 28 June at 7:30pm (Europe/London).`
- Avoid duplicate timing lines. If both `brief.scheduledFor` and `context.scheduledAt` exist, prefer `context.scheduledAt`.
- Include media metadata in order.
- Add an instruction such as: "Use media metadata only when it is explicit; do not invent visual details that are not present in the filename or tags."
- Preserve modifier behaviour for regeneration.

### `src/app/actions/content.ts`

The reorder can keep existing final actions, but the spec should be honest about their limits:

- `saveDraft` is fine for draft persistence.
- `scheduleContent` only updates `content_items.scheduled_at` and status.
- `approveForQueue` only sets status to `approved`.

If the final buttons are expected to create publishable jobs, replace `scheduleContent` and `approveForQueue` usage with a server action that:

1. Writes or updates `content_variants` from the final edited copy and media IDs.
2. Calls `approveAndSchedule`.
3. Returns preflight issues for display.

Publishing caveat: `src/lib/publishing/preflight.ts` currently reads `content_items.scheduled_for`, while this v2 wizard and `scheduleContent` use `scheduled_at`. If `approveAndSchedule` is brought into this wizard, that column mismatch must be fixed at the same time.

That publishing integration is larger than this reorder and should be tracked separately if not included.

## Adjacent Issues Not Included

- `CreatePageClient` should pass the selected launcher flow into `CreateWizard` so Event, Promotion, and Weekly tiles initialise the matching content type.
- The wizard eyebrow currently says `Create · Instant post` regardless of selected content type.
- The old form components (`InstantPostForm`, `EventCampaignForm`, `PromotionCampaignForm`, `WeeklyCampaignForm`) are parallel create paths. This spec only covers `CreateWizard`.

## Edge Cases

- No media selected: allow draft save and copy generation. Scheduling/queueing should follow the existing publish-readiness rules. Do not promise media-free publishing unless preflight is intentionally changed.
- Empty media after previously selected media: call `attachMediaToContent(draftId, [])` so old attachments are cleared.
- No schedule selected: only valid when publish mode is `now`; generation receives no scheduled-time context.
- Going back from Generate: changing media or schedule marks generated copy stale until regenerated.
- Story content type: require exactly one image before leaving Media.
- Draft resume: support both current `DraftState` and older raw-brief `body_draft` shapes.
- AI media context: do not infer image contents from IDs. If true visual-aware generation is required, add a separate vision-analysis step that stores captions/tags.

## Acceptance Criteria

- Wizard labels read `Brief / Media / Schedule / Generate` in that order.
- A new draft created from Step 0 resumes at Media, not Brief.
- Removing all selected media clears `content_media_attachments`.
- Selected media order is preserved in `content_media_attachments.position`.
- Schedule values are stored as ISO strings in `DraftState.scheduledAt`.
- Generate and Regenerate include the latest selected media metadata and schedule context.
- Editing generated textarea copy updates the state used by Save as Draft, Schedule, and Save and Queue.
- Schedule and Save and Queue are blocked or warned when generated copy is stale relative to selected media/schedule.
- Story media validation is enforced in this wizard path.

## Tests

Update or add focused tests:

- `src/features/create/schemas/content-schemas.test.ts`
  - Cover scheduled ISO strings and document that raw `datetime-local` values must be normalised before schema parsing.
- `tests/lib/ai/prompts.test.ts` or existing prompt tests
  - Scheduled context appears in the user prompt.
  - Media metadata appears in selected order.
  - Prompt includes the "do not invent visual details" instruction.
  - Modifier instructions still appear for regeneration.
- Component tests for the wizard if a test harness exists
  - Step order renders correctly.
  - Step transitions save target step.
  - Empty media selection calls `attachMediaToContent` with `[]`.
  - Changing media/schedule after generation marks copy stale.
- E2E smoke tests
  - Update `/create` tests for the new step order.
  - Add stable selectors such as `data-testid="create-wizard-step"` before relying on them.

## Complexity

Score: 4 (M/L)

This is not a 4-file prop shuffle. It touches wizard state ownership, draft persistence, media persistence, prompt generation, controlled copy editing, schedule normalisation, and tests.

If true publish-job creation is included in this work, complexity becomes 5 (L) because it must bridge generated wizard output into `content_variants` and `approveAndSchedule`.
