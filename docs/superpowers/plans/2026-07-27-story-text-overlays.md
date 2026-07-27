# Story Text Overlays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user type a text overlay on a story in the create wizard, preview it over the real 9:16 crop, and have it publish, with the same rules feed posts already follow.

**Architecture:** The render and publish pipeline already handles stories end to end. The overlay is suppressed by a single ternary in `createScheduledBatch` and by the wizard hiding the input on story cards. This plan removes both, adds the story-cropped preview URL the wizard has never had, and first closes two pre-existing validation gaps on the same path.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Supabase (Postgres + RLS + Storage), Vitest, Deno edge function for the publish worker.

**Spec:** `tasks/SPEC-story-text-overlays.md`. **Review:** `tasks/REVIEW-story-text-overlays.md`.

**Sequencing note:** Phase A is spec PR 2 (media validation). Phase B is spec PR 3 (the feature). Spec PR 1 (Facebook token redaction) is being done in a separate session and is not in this plan. Phase C is a production data backfill and must not run until Phase B is merged and verified.

**House rule:** no em dashes (U+2014) anywhere, including code comments and commit messages. A pre-write hook enforces this. Where an instruction says to copy existing UI copy verbatim, copy it from the file rather than retyping it.

---

## File Structure

**Phase A, media validation**

| File | Responsibility | Change |
|---|---|---|
| `src/app/actions/content.ts` | Batch create action | Add one pre-write media validation gate |
| `src/features/create/media-attachment-selector.tsx` | Per-slot media picker | Constrain selection for story placement |
| `tests/app/actions/content.test.ts` | Action tests | New ownership and eligibility cases |

**Phase B, story overlays**

| File | Responsibility | Change |
|---|---|---|
| `src/lib/library/data.ts` | Library list + preview URL resolution | Add `storyPreviewUrl` to summary and populate it |
| `src/app/(app)/library/actions.ts` | Upload/update/fetch preview signing | Populate `storyPreviewUrl`; add placement to fetch |
| `src/app/actions/content.ts` | Batch create action | Remove story guard, extend auto event label |
| `src/features/planner/banner-overlay.tsx` | Overlay preview component | Add optional `alt` prop |
| `src/features/create/steps/generate-step.tsx` | Wizard generate step | Overlay input + preview on story cards, mixed placement, text preservation |
| `src/features/planner/post-drawer.tsx` | Planner drawer | Allow story overlay editing |
| `src/types/content.ts` | Type docs | Correct stale comment |

Test files mirror each source file. `generate-step.tsx` is already 1302 lines; extract the overlay input into a local component rather than adding another inline block.

---

## Task 0: Branch

- [ ] **Step 1: Create the working branch**

```bash
git checkout main && git pull && git checkout -b feat/story-text-overlays
```

- [ ] **Step 2: Confirm a clean baseline**

Run: `npm run test`
Expected: all suites pass. Record the count. If anything fails on a clean `main`, stop and report before making changes.

---

# Phase A: Media validation (spec PR 2)

## Task 1: Reject media the account does not own

`createScheduledBatch` accepts client-supplied media UUIDs and never checks ownership. `content_variants.media_ids` is what drives publishing, and the worker resolves those IDs with service-role and no account filter.

**Files:**
- Modify: `src/app/actions/content.ts` (insert after the story media presence check that ends at line 732)
- Test: `tests/app/actions/content.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/app/actions/content.test.ts`, inside the `createScheduledBatch` describe block:

```ts
it('rejects media ids that do not belong to the account', async () => {
  supabaseMock.enqueueResult({ data: { id: 'draft-1' }, error: null }); // draft lookup
  // ownership lookup returns only one of the two submitted ids
  supabaseMock.enqueueResult({ data: [{ id: 'media-1' }], error: null });

  const result = await createScheduledBatch({
    draftContentId: 'draft-1',
    contentType: 'instant_post',
    brief: { prompt: 'Quiz night', platforms: ['facebook'] },
    selectedMediaIds: ['media-1', 'media-someone-elses'],
    slotCopies: [
      {
        slotKey: 'now',
        scheduledAt: '2026-08-01T18:00:00.000Z',
        copy: { facebook: { body: 'FB' } },
      },
    ],
    platforms: ['facebook'],
    mode: 'schedule',
  });

  expect(result.error).toBe('One or more selected images are not available. Reselect your media.');
  expect(supabaseMock.calls.find((call) => call.method === 'upsert')).toBeUndefined();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/app/actions/content.test.ts -t 'do not belong to the account'`
Expected: FAIL. The action currently returns `success: true` because nothing checks ownership.

- [ ] **Step 3: Implement the gate**

In `src/app/actions/content.ts`, immediately after the `storySlotMissingMedia` block that ends at line 732, insert:

```ts
    // Trust boundary: media ids arrive from the client and are written straight
    // into content_variants.media_ids, which the service-role publish worker
    // later resolves with no account filter. Verify ownership here, before any
    // write, so another account's asset can never be published from this one.
    const submittedMediaIds = Array.from(
      new Set(slotCopies.flatMap((slot) => slot.mediaIds ?? selectedMediaIds)),
    );

    if (submittedMediaIds.length > 0) {
      const { data: ownedMedia, error: ownedMediaError } = await supabase
        .from('media_assets')
        .select('id')
        .eq('account_id', accountId)
        .in('id', submittedMediaIds);

      if (ownedMediaError) {
        return { error: `Could not verify media: ${ownedMediaError.message}` };
      }

      const ownedIds = new Set((ownedMedia ?? []).map((row) => row.id));
      if (submittedMediaIds.some((id) => !ownedIds.has(id))) {
        return { error: 'One or more selected images are not available. Reselect your media.' };
      }
    }
```

The error message is deliberately vague: it must not confirm to a caller whether a given UUID exists on another account.

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/app/actions/content.test.ts -t 'do not belong to the account'`
Expected: PASS.

- [ ] **Step 5: Run the whole action suite for regressions**

Run: `npx vitest run tests/app/actions/content.test.ts`
Expected: all pass. Existing tests enqueue results in order, so the new ownership query consumes one queued result. Any test that now fails on result ordering needs an extra `enqueueResult` for the ownership lookup, not a change to the assertion.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/content.ts tests/app/actions/content.test.ts
git commit -m "fix(security): verify media ownership before scheduling content

Media ids arrive from the client and are written to content_variants.media_ids,
which the service-role publish worker resolves without an account filter. A
caller who obtained another account's media UUID could publish that asset.
Validate ownership in createScheduledBatch before any write."
```

---

## Task 2: Reject stories whose media cannot publish

The only story media check is a count-of-zero test. The worker requires exactly one asset, `media_type = 'image'`, and a non-empty `derived_variants.story`. `getPublishReadinessIssues` in `src/lib/publishing/preflight.ts` already implements all three with user-facing messages.

**Files:**
- Modify: `src/app/actions/content.ts` (replace the `storySlotMissingMedia` block at lines 725-732)
- Test: `tests/app/actions/content.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('rejects a story slot with two images', async () => {
  supabaseMock.enqueueResult({ data: { id: 'draft-1' }, error: null });
  supabaseMock.enqueueResult({ data: [{ id: 'media-1' }, { id: 'media-2' }], error: null });
  supabaseMock.enqueueResult({
    data: [
      { id: 'media-1', media_type: 'image', derived_variants: { story: 'derived/media-1/story.jpg' } },
      { id: 'media-2', media_type: 'image', derived_variants: { story: 'derived/media-2/story.jpg' } },
    ],
    error: null,
  });

  const result = await createScheduledBatch({
    draftContentId: 'draft-1',
    contentType: 'story',
    brief: { prompt: 'Quiz night', placement: 'story', platforms: ['instagram'] },
    selectedMediaIds: ['media-1', 'media-2'],
    slotCopies: [
      { slotKey: 'slot-1', scheduledAt: '2026-08-01T18:00:00.000Z', copy: { instagram: { body: '' } } },
    ],
    platforms: ['instagram'],
    mode: 'schedule',
  });

  expect(result.error).toContain('Stories can only include one image.');
  expect(supabaseMock.calls.find((call) => call.method === 'upsert')).toBeUndefined();
});

it('rejects a story slot whose image has no story derivative', async () => {
  supabaseMock.enqueueResult({ data: { id: 'draft-1' }, error: null });
  supabaseMock.enqueueResult({ data: [{ id: 'media-1' }], error: null });
  supabaseMock.enqueueResult({
    data: [{ id: 'media-1', media_type: 'image', derived_variants: {} }],
    error: null,
  });

  const result = await createScheduledBatch({
    draftContentId: 'draft-1',
    contentType: 'story',
    brief: { prompt: 'Quiz night', placement: 'story', platforms: ['instagram'] },
    selectedMediaIds: ['media-1'],
    slotCopies: [
      { slotKey: 'slot-1', scheduledAt: '2026-08-01T18:00:00.000Z', copy: { instagram: { body: '' } } },
    ],
    platforms: ['instagram'],
    mode: 'schedule',
  });

  expect(result.error).toContain('Story image is still processing.');
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/app/actions/content.test.ts -t 'story slot'`
Expected: FAIL. Both currently schedule successfully.

- [ ] **Step 3: Confirm the preflight call signature before writing code**

Run: `sed -n '20,60p' src/lib/publishing/preflight.ts`

Read the `PublishReadinessParams` type and note the exact property names and which are optional. The next step assumes `{ supabase, placement, mediaIds, body, lintPassed }`. If reality differs, adapt the call, not preflight.

- [ ] **Step 4: Implement the gate**

In `src/app/actions/content.ts`, replace the whole `if (placements.includes('story')) { ... }` block at lines 725-732 with:

```ts
    // Stories have a hard media contract the publish worker enforces: exactly one
    // asset, an image, with a ready 1080x1920 derivative. Checking only for
    // "at least one" lets a user schedule a story that is guaranteed to fail at
    // publish time, long after the UI told them it was ready. Reuse the shared
    // readiness checks so the wording matches the planner's preflight errors.
    if (placements.includes('story')) {
      for (const slot of slotCopies) {
        const slotMediaIds = slot.mediaIds ?? selectedMediaIds;
        const issues = await getPublishReadinessIssues({
          supabase,
          placement: 'story',
          mediaIds: slotMediaIds,
          body: '',
          lintPassed: true,
        });
        if (issues.length > 0) {
          return { error: issues.map((issue) => issue.message).join(' ') };
        }
      }
    }
```

Add the import alongside the other `@/lib/publishing` imports:

```ts
import { getPublishReadinessIssues } from '@/lib/publishing/preflight';
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/app/actions/content.test.ts -t 'story slot'`
Expected: PASS.

- [ ] **Step 6: Run the whole suite**

Run: `npx vitest run tests/app/actions/content.test.ts`
Expected: all pass. The existing "Stories need at least one image" test may now receive the preflight wording `Stories require one processed image. Add a story image before scheduling.` If so, update that assertion. The behaviour is the same, only the message changed, and the new message matches what the planner shows.

- [ ] **Step 7: Commit**

```bash
git add src/app/actions/content.ts tests/app/actions/content.test.ts
git commit -m "fix: validate story media eligibility before scheduling

A story slot only had to have at least one media id. The publish worker requires
exactly one ready image with a story derivative, so a story with two images, a
video, or a missing derivative could be scheduled and was guaranteed to fail at
publish. Reuse getPublishReadinessIssues so messages match planner preflight."
```

---

## Task 3: Constrain the story media picker

Prevent the invalid selection at source, so Task 2's gate is a backstop rather than the first time the user hears about it.

**Files:**
- Modify: `src/features/create/media-attachment-selector.tsx:317` and `:386`
- Test: `src/features/create/media-attachment-selector.test.tsx` (create if absent)

- [ ] **Step 1: Read the component's current props**

Run: `sed -n '300,395p' src/features/create/media-attachment-selector.tsx`

Note how `multiple` (line 317) and `isAssetSelectable` (line 386) are passed today. `isAssetSelectable` is currently `(asset) => asset.processedStatus === "ready"`.

- [ ] **Step 2: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { isStoryAssetSelectable } from '@/features/create/media-attachment-selector';

const base = {
  id: 'm1',
  fileName: 'a.jpg',
  mediaType: 'image' as const,
  tags: [],
  uploadedAt: '2026-07-01T00:00:00.000Z',
  storagePath: 'orig/a.jpg',
  processedStatus: 'ready' as const,
  derivedVariants: { story: 'derived/m1/story.jpg' },
  aspectClass: 'square' as const,
  previewShape: 'square' as const,
};

describe('isStoryAssetSelectable', () => {
  it('accepts a ready image with a story derivative', () => {
    expect(isStoryAssetSelectable(base)).toBe(true);
  });

  it('rejects a video', () => {
    expect(isStoryAssetSelectable({ ...base, mediaType: 'video' })).toBe(false);
  });

  it('rejects an image with no story derivative', () => {
    expect(isStoryAssetSelectable({ ...base, derivedVariants: {} })).toBe(false);
  });

  it('rejects an image that is still processing', () => {
    expect(isStoryAssetSelectable({ ...base, processedStatus: 'processing' })).toBe(false);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/features/create/media-attachment-selector.test.tsx`
Expected: FAIL with an import error, because `isStoryAssetSelectable` does not exist.

- [ ] **Step 4: Implement the predicate and wire it in**

Add to `src/features/create/media-attachment-selector.tsx`, above the component:

```tsx
import type { MediaAssetSummary } from '@/lib/library/data';

/**
 * Story placement has a hard media contract the publish worker enforces: one
 * ready image with a 1080x1920 derivative. Gate selection on it so a user
 * cannot attach media that could never publish as a story.
 */
export function isStoryAssetSelectable(asset: MediaAssetSummary): boolean {
  return (
    asset.processedStatus === 'ready' &&
    asset.mediaType === 'image' &&
    typeof asset.derivedVariants?.story === 'string' &&
    asset.derivedVariants.story.length > 0
  );
}
```

Then change line 386 from:

```tsx
isAssetSelectable={(asset) => asset.processedStatus === "ready"}
```

to:

```tsx
isAssetSelectable={placement === 'story' ? isStoryAssetSelectable : (asset) => asset.processedStatus === "ready"}
```

and line 317 from `multiple` to `multiple={placement !== 'story'}`.

If the component does not already receive a `placement` prop, add it as `placement?: 'feed' | 'story'` to its props interface and pass it from the call sites in `src/features/create/steps/generate-step.tsx` (the media modal opened by `setMediaTargetSlot`). Find them with:

Run: `grep -n 'MediaAttachmentSelector' src/features/create/steps/generate-step.tsx`

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/features/create/media-attachment-selector.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/features/create/media-attachment-selector.tsx src/features/create/media-attachment-selector.test.tsx src/features/create/steps/generate-step.tsx
git commit -m "fix: restrict story media picker to one publishable image

Story slots could select multiple assets or a video that the worker would then
reject at publish time."
```

- [ ] **Step 7: Phase A gate**

Run: `npm run ci:verify`
Expected: lint, typecheck, test and build all pass. Do not start Phase B until this is green.

---

# Phase B: Story text overlays (spec PR 3)

## Task 4: Expose a story-cropped preview URL from the library list

`listMediaAssets` already batch-signs every candidate path, including the story derivative, then discards all but the first hit. Keep the story one.

**Files:**
- Modify: `src/lib/library/data.ts:16-30` (interface), `:185-204` (return mapping)
- Test: `src/lib/library/data.test.ts` (create if absent)

- [ ] **Step 1: Write the pinning test**

```ts
import { describe, it, expect } from 'vitest';
import { orderPreviewCandidatesForPlacement } from '@/lib/library/data';

describe('orderPreviewCandidatesForPlacement', () => {
  it('puts the story-shaped candidate first for story placement', () => {
    const candidates = [
      { path: 'orig/a.jpg', shape: 'square' as const },
      { path: 'derived/a/story.jpg', shape: 'story' as const },
    ];
    const ordered = orderPreviewCandidatesForPlacement({
      candidates,
      storagePath: 'orig/a.jpg',
      placement: 'story',
    });
    expect(ordered[0].path).toBe('derived/a/story.jpg');
  });

  it('has no story candidate when the asset has no story derivative', () => {
    const candidates = [{ path: 'orig/a.jpg', shape: 'square' as const }];
    const ordered = orderPreviewCandidatesForPlacement({
      candidates,
      storagePath: 'orig/a.jpg',
      placement: 'story',
    });
    expect(ordered.find((c) => c.shape === 'story')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/lib/library/data.test.ts`
Expected: PASS immediately. `orderPreviewCandidatesForPlacement` already exists at `data.ts:224` and already handles story. This test pins the behaviour the next step depends on. If it fails, stop: the assumption behind Task 4 is wrong.

- [ ] **Step 3: Add the field to the interface**

In `src/lib/library/data.ts`, add to `MediaAssetSummary` after `previewUrl`:

```ts
  previewUrl?: string;
  /**
   * Signed URL for the 1080x1920 story crop, when one exists. The wizard needs
   * this to preview a story overlay against the image that will actually
   * publish: previewUrl resolves with feed ordering, which hoists the original
   * upload ahead of every derivative.
   */
  storyPreviewUrl?: string;
  previewShape: "square" | "story";
```

- [ ] **Step 4: Populate it in the return mapping**

In `src/lib/library/data.ts`, replace the `return summaries.map(...)` block at lines 185-204 with:

```ts
    return summaries.map((asset) => {
      const candidates = previewCandidatesById.get(asset.id) ?? [];
      let previewUrl: string | undefined;
      let previewShape: "square" | "story" = "square";

      for (const candidate of candidates) {
        const signedUrl = signedUrlMap.get(candidate.path);
        if (signedUrl) {
          previewUrl = signedUrl;
          previewShape = candidate.shape;
          break;
        }
      }

      // Re-order the same already-signed candidates for story placement and keep
      // the first genuinely story-shaped hit. No extra storage round trip: every
      // candidate path was in the batch createSignedUrls call above. Falling back
      // to a square crop would defeat the purpose, so leave it undefined instead.
      const storyOrdered = orderPreviewCandidatesForPlacement({
        candidates,
        storagePath: asset.storagePath,
        placement: "story",
      });
      const storyCandidate = storyOrdered.find((candidate) => candidate.shape === "story");
      const storyPreviewUrl = storyCandidate ? signedUrlMap.get(storyCandidate.path) : undefined;

      return {
        ...asset,
        previewUrl,
        previewShape,
        storyPreviewUrl,
      } satisfies MediaAssetSummary;
    });
```

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run src/lib/library/data.test.ts
npm run typecheck
git add src/lib/library/data.ts src/lib/library/data.test.ts
git commit -m "feat(library): expose a signed story-crop preview URL

listMediaAssets already signed the story derivative and threw it away. Keep it
so the create wizard can preview a story overlay against the 9:16 image that
will actually publish."
```

## Task 5: Populate `storyPreviewUrl` on the upload and fetch paths

`signPreviewFromCandidates` returns on first success, so it never signs the story variant.

**Files:**
- Modify: `src/app/(app)/library/actions.ts:1187-1240` (`signPreviewFromCandidates`, `mapToSummary`), `:1242-1272` (`fetchMediaAssetPreviewUrl`), and the `finaliseMediaUpload` / `updateMediaAsset` call sites at `:228-238` and `:308-318`

- [ ] **Step 1: Add a story signer**

In `src/app/(app)/library/actions.ts`, directly after `signPreviewFromCandidates`, add:

```ts
/**
 * Sign the story-shaped candidate specifically. signPreviewFromCandidates
 * returns on the first success, which under feed ordering is the original
 * upload, so it never reaches the story derivative.
 */
async function signStoryPreview(
  supabase: SupabaseClient,
  candidates: PreviewCandidate[],
): Promise<string | undefined> {
  const storyCandidate = candidates.find((candidate) => candidate.shape === "story");
  if (!storyCandidate) return undefined;
  try {
    const { data, error } = await supabase.storage
      .from(MEDIA_BUCKET)
      .createSignedUrl(storyCandidate.path, 600);
    if (!error && data?.signedUrl) return data.signedUrl;
  } catch (error) {
    console.error("[library] failed to sign story preview", { path: storyCandidate.path, error });
  }
  return undefined;
}
```

- [ ] **Step 2: Thread it through `mapToSummary`**

Add a fourth parameter and return it. Keep every existing field exactly as it is:

```ts
function mapToSummary(
  row: { /* unchanged */ },
  previewUrl?: string,
  previewShape: "square" | "story" = "square",
  storyPreviewUrl?: string,
): MediaAssetSummary {
  return {
    // ...all existing fields unchanged...
    previewUrl,
    storyPreviewUrl,
    previewShape,
  };
}
```

- [ ] **Step 3: Update the two call sites**

Read `finaliseMediaUpload` (around line 228) and `updateMediaAsset` (around line 308) first; the local variable names differ between them. Each currently resolves candidates, signs a preview, and calls `mapToSummary`. Add one line before the `mapToSummary` call and one argument to it:

```ts
const storyPreviewUrl = await signStoryPreview(supabase, candidates);
return mapToSummary(assetRow, previewUrl, previewShape, storyPreviewUrl);
```

If the candidates are built inline rather than assigned to a variable, hoist them to a `const candidates = resolvePreviewCandidates({ ... })` first so both signers share one list.

- [ ] **Step 4: Add placement to `fetchMediaAssetPreviewUrl`**

```ts
export async function fetchMediaAssetPreviewUrl(
  assetId: string,
  placement: "feed" | "story" = "feed",
) {
  const { supabase, accountId } = await requireAuthContext();

  const { data: asset, error } = await supabase
    .from("media_assets")
    .select("storage_path, derived_variants, aspect_class")
    .eq("id", assetId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (error) throw error;
  if (!asset) return null;

  const { url } = await signPreviewFromCandidates(
    supabase,
    resolvePreviewCandidates({
      storagePath: asset.storage_path,
      derivedVariants: asset.derived_variants ?? {},
      aspectClass: asset.aspect_class,
      placement,
    }),
  );

  return url ?? null;
}
```

The default keeps all existing callers working unchanged.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck
npx vitest run
git add src/app/\(app\)/library/actions.ts
git commit -m "feat(library): sign story preview URLs on upload and fetch paths"
```

## Task 6: Remove the write-time story guard

**Files:**
- Modify: `src/app/actions/content.ts:879-889`
- Test: `tests/app/actions/content.test.ts:509`

- [ ] **Step 1: Invert the existing test and add the event cases**

Replace the test named `forces banner off on story placements even when overlay text is supplied` with:

```ts
it('persists an overlay on story placements when text is supplied', async () => {
  supabaseMock.enqueueResult({ data: { id: 'draft-1' }, error: null });
  supabaseMock.enqueueResult({ data: [{ id: 'media-1' }], error: null }); // ownership
  supabaseMock.enqueueResult({
    data: [{ id: 'media-1', media_type: 'image', derived_variants: { story: 'derived/media-1/story.jpg' } }],
    error: null,
  }); // story readiness
  supabaseMock.enqueueResult({ data: { id: 'camp-1' }, error: null });

  const result = await createScheduledBatch({
    draftContentId: 'draft-1',
    contentType: 'weekly_recurring',
    brief: { title: 'Friday Specials', prompt: 'Weekly food special', daysOfWeek: [5], time: '18:00', endDate: '2026-08-31', placement: 'story', platforms: ['facebook', 'instagram'] },
    selectedMediaIds: ['media-1'],
    slotCopies: [
      {
        slotKey: 'week-1',
        scheduledAt: '2026-07-03T18:00:00.000Z',
        label: 'Week 1',
        copy: { facebook: { body: 'FB' }, instagram: { body: 'IG' } },
        bannerTextOverride: '£5 PINTS',
      },
    ],
    platforms: ['facebook', 'instagram'],
    mode: 'schedule',
  });

  expect(result.error).toBeUndefined();
  const variantRows = supabaseMock.calls.find((call) => call.method === 'upsert')?.args[0] as Array<Record<string, unknown>>;
  expect(variantRows.length).toBe(2);
  for (const row of variantRows) {
    expect(row.banner_enabled).toBe(true);
    expect(row.banner_text_override).toBe('£5 PINTS');
  }
});

it('writes an explicit banner_enabled false for a non-event story with no overlay text', async () => {
  supabaseMock.enqueueResult({ data: { id: 'draft-1' }, error: null });
  supabaseMock.enqueueResult({ data: [{ id: 'media-1' }], error: null });
  supabaseMock.enqueueResult({
    data: [{ id: 'media-1', media_type: 'image', derived_variants: { story: 'derived/media-1/story.jpg' } }],
    error: null,
  });

  const result = await createScheduledBatch({
    draftContentId: 'draft-1',
    contentType: 'story',
    brief: { prompt: 'Quiz night', placement: 'story', platforms: ['instagram'] },
    selectedMediaIds: ['media-1'],
    slotCopies: [
      { slotKey: 'slot-1', scheduledAt: '2026-08-01T18:00:00.000Z', copy: { instagram: { body: '' } } },
    ],
    platforms: ['instagram'],
    mode: 'schedule',
  });

  expect(result.error).toBeUndefined();
  const variantRows = supabaseMock.calls.find((call) => call.method === 'upsert')?.args[0] as Array<Record<string, unknown>>;
  for (const row of variantRows) {
    expect(row.banner_enabled).toBe(false);
    expect(row.banner_text_override).toBeNull();
  }
});

it('auto-enables the proximity label on an event story with no overlay text', async () => {
  supabaseMock.enqueueResult({ data: { id: 'draft-1' }, error: null });
  supabaseMock.enqueueResult({ data: [{ id: 'media-1' }], error: null });
  supabaseMock.enqueueResult({
    data: [{ id: 'media-1', media_type: 'image', derived_variants: { story: 'derived/media-1/story.jpg' } }],
    error: null,
  });
  supabaseMock.enqueueResult({ data: { id: 'camp-1' }, error: null });

  const result = await createScheduledBatch({
    draftContentId: 'draft-1',
    contentType: 'event',
    brief: { title: 'Quiz Night', prompt: 'Quiz', eventDate: '2026-08-07', placement: 'story', platforms: ['instagram'] },
    selectedMediaIds: ['media-1'],
    slotCopies: [
      { slotKey: 'slot-1', scheduledAt: '2026-08-01T18:00:00.000Z', copy: { instagram: { body: '' } } },
    ],
    platforms: ['instagram'],
    mode: 'schedule',
  });

  expect(result.error).toBeUndefined();
  const variantRows = supabaseMock.calls.find((call) => call.method === 'upsert')?.args[0] as Array<Record<string, unknown>>;
  for (const row of variantRows) {
    expect(row.banner_enabled).toBe(true);
    expect(row.banner_text_override).toBeNull();
  }
});
```

Adjust the `brief` objects if `contentBriefSchema` rejects them. Run one test first and read the validation error rather than guessing at required fields.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run tests/app/actions/content.test.ts -t 'story'`
Expected: the three new banner tests FAIL.

- [ ] **Step 3: Remove the guard**

In `src/app/actions/content.ts`, replace lines 879-889 with:

```ts
      // Overlays are opt-in per post. Derive the overlay once per slot; it applies
      // to every platform variant of that slot. Write an explicit banner_enabled
      // (never NULL) so the resolver's account-default fallback can't re-enable it,
      // and keep the invariant "enabled implies non-empty text or a computed label".
      // Placement is deliberately not consulted: stories follow the same rule as
      // feed posts (see tasks/SPEC-story-text-overlays.md section 4.1).
      const overlay = normaliseBannerText(slot.bannerTextOverride);
      // Events auto-enable a dynamic date overlay even without typed text: the
      // banner is enabled with a null override so the worker prints the per-post
      // proximity label (TONIGHT, THIS FRIDAY, FRIDAY 17TH JULY).
      const autoOverlayForEvent = contentType === 'event';
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/app/actions/content.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/content.ts tests/app/actions/content.test.ts
git commit -m "feat: allow text overlays on story placements

Stories were forced to banner_enabled=false at write time. The render and
publish pipeline already handles 9:16, so remove the guard and apply the same
overlay rule to every placement, including the automatic event date label."
```

## Task 7: Give `BannerOverlay` an alt prop

**Files:**
- Modify: `src/features/planner/banner-overlay.tsx:14-19`, `:61-66`
- Test: `src/features/planner/banner-overlay.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('uses the supplied alt text on the image', () => {
  render(
    <BannerOverlay
      mediaUrl="https://example.test/a.jpg"
      config={{ enabled: true, position: 'right', bgColour: '#a57626', textColour: '#FFFFFF', textOverride: 'QUIZ' }}
      label="QUIZ"
      alt="Post media"
    />,
  );
  expect(screen.getByAltText('Post media')).toBeInTheDocument();
});

it('defaults to decorative when no alt is given', () => {
  const { container } = render(
    <BannerOverlay
      mediaUrl="https://example.test/a.jpg"
      config={{ enabled: true, position: 'right', bgColour: '#a57626', textColour: '#FFFFFF', textOverride: 'QUIZ' }}
      label="QUIZ"
    />,
  );
  expect(container.querySelector('img')?.getAttribute('alt')).toBe('');
});
```

- [ ] **Step 2: Run and watch the first fail**

Run: `npx vitest run src/features/planner/banner-overlay.test.tsx`
Expected: the alt-text case FAILS, the decorative case passes.

- [ ] **Step 3: Implement**

In `src/features/planner/banner-overlay.tsx`, change the props type:

```tsx
type Props = {
  mediaUrl: string;
  config: ResolvedConfig;
  label: string | null;
  className?: string;
  /** Meaningful description of the image. Omit for decorative use. */
  alt?: string;
};
```

Change the destructure on line 38 to `export function BannerOverlay({ mediaUrl, config, label, className, alt }: Props) {` and line 63 from `alt=""` to `alt={alt ?? ''}`.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/features/planner/banner-overlay.test.tsx
git add src/features/planner/banner-overlay.tsx src/features/planner/banner-overlay.test.tsx
git commit -m "feat(a11y): let BannerOverlay accept alt text

The component hardcoded an empty alt, so any post with an overlay lost its image
description. Defaults to decorative so existing call sites are unchanged."
```

## Task 8: Extract the overlay input and show it on story cards

**Files:**
- Modify: `src/features/create/steps/generate-step.tsx:748`, `:876-925`, `:1037-1070`
- Test: `src/features/create/generate-step.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it('shows an enabled overlay input on a story slot', async () => {
  renderStoryWizard(); // use the existing story-render helper in this file
  const input = await screen.findByLabelText(/image overlay/i);
  expect(input).toBeEnabled();
});

it('propagates typed story overlay text', async () => {
  const onSlotCopiesChange = vi.fn();
  renderStoryWizard({ onSlotCopiesChange });
  const input = await screen.findByLabelText(/image overlay/i);
  fireEvent.change(input, { target: { value: '£5 PINTS' } });
  expect(onSlotCopiesChange).toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ bannerTextOverride: '£5 PINTS' })]),
  );
});
```

Read the existing story tests at lines 127-250 of that file first and reuse their render helper and props rather than inventing a new one.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/features/create/generate-step.test.tsx -t 'story slot'`
Expected: FAIL. No overlay input exists on story cards.

- [ ] **Step 3: Extract the existing markup verbatim into a local component**

This is a move, not a rewrite. Cut the JSX currently at lines 1037-1070 and paste it as the body of a new local component defined above the main component in the same file. Do not retype the two placeholder strings or the helper text: they contain punctuation that must not change, and the file's copy is the source of truth.

The wrapper to paste it into:

```tsx
function SlotOverlayInput({
  slotKey,
  value,
  autoLabel,
  invalid,
  disabled,
  onChange,
}: {
  slotKey: string;
  value: string;
  autoLabel: string | null;
  invalid: boolean;
  disabled: boolean;
  onChange: (slotKey: string, value: string) => void;
}) {
  return (
    /* PASTE lines 1037-1070 here, then rename the references below */
  );
}
```

Inside the pasted markup, make exactly these substitutions and no others:
- `slot.key` becomes `slotKey`
- `slotCopy?.bannerTextOverride ?? ''` becomes `value`
- `autoOverlayLabel` becomes `autoLabel`
- `slotOverlayInvalid` becomes `invalid`
- `isApproved || isBusy` becomes `disabled`
- `handleSlotBannerChange(slot.key, e.target.value)` becomes `onChange(slotKey, e.target.value)`

- [ ] **Step 4: Replace the feed call site**

Where lines 1037-1070 used to be, put:

```tsx
                      {/* Per-post image overlay (opt-in) */}
                      <SlotOverlayInput
                        slotKey={slot.key}
                        value={slotCopy?.bannerTextOverride ?? ''}
                        autoLabel={autoOverlayLabel}
                        invalid={slotOverlayInvalid}
                        disabled={isApproved || isBusy}
                        onChange={handleSlotBannerChange}
                      />
```

- [ ] **Step 5: Add the story call site**

In the story branch, immediately after the platform badges block that ends at line 920 and before the "Story media ready to schedule" block, insert:

```tsx
                      <SlotOverlayInput
                        slotKey={slot.key}
                        value={slotCopy?.bannerTextOverride ?? ''}
                        autoLabel={autoOverlayLabel}
                        invalid={slotOverlayInvalid}
                        disabled={isBusy}
                        onChange={handleSlotBannerChange}
                      />
```

`disabled` is `isBusy` only, not `isApproved || isBusy`. Story slots are force-approved at line 253, so including `isApproved` would make the input permanently read-only.

- [ ] **Step 6: Let event stories compute the auto label**

At line 748, remove the `!isStorySchedule &&` clause so the computation reads:

```tsx
    const autoOverlayLabel =
      !typedOverlay && contentBrief.contentType === 'event' && slot.key !== 'now'
```

Keep every other condition in that expression exactly as it is.

- [ ] **Step 7: Run the tests and commit**

```bash
npx vitest run src/features/create/generate-step.test.tsx
npm run typecheck
git add src/features/create/steps/generate-step.tsx src/features/create/generate-step.test.tsx
git commit -m "feat(create): add the overlay text input to story cards"
```

## Task 9: Preview the overlay over the story crop

**Files:**
- Modify: `src/features/create/steps/generate-step.tsx:884-890`
- Test: `src/features/create/generate-step.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it('renders the overlay preview over the story crop', async () => {
  renderStoryWizard({
    libraryItems: [{ ...storyAsset, storyPreviewUrl: 'https://example.test/story.jpg' }],
    slotCopies: [{ ...storySlot, bannerTextOverride: 'QUIZ' }],
  });
  const overlay = await screen.findByTestId('banner-overlay');
  expect(overlay).toBeInTheDocument();
});

it('shows a not-ready state when the asset has no story crop', async () => {
  renderStoryWizard({
    libraryItems: [{ ...storyAsset, storyPreviewUrl: undefined, derivedVariants: {} }],
  });
  expect(await screen.findByText(/story crop not ready/i)).toBeInTheDocument();
});
```

The existing suite mocks `BannerOverlay` as `() => <div data-testid="banner-overlay" />`. Follow that pattern; check how `src/features/planner/post-drawer.test.tsx:34` does it.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/features/create/generate-step.test.tsx -t 'story crop'`
Expected: FAIL.

- [ ] **Step 3: Implement**

Replace lines 884-890 (the bare `<img>` in the story branch) with:

```tsx
                          {primary && primary.mediaType === 'image' && !primary.storyPreviewUrl ? (
                            <div className="flex size-full items-center justify-center p-3 text-center">
                              <span className="text-xs text-muted-foreground">
                                Story crop not ready. Pick another image.
                              </span>
                            </div>
                          ) : primary && primary.mediaType === 'image' && primary.storyPreviewUrl ? (
                            slotBannerConfig ? (
                              <BannerOverlay
                                mediaUrl={primary.storyPreviewUrl}
                                config={slotBannerConfig}
                                label={slotOverlayText}
                                alt="Story media"
                                className="size-full"
                              />
                            ) : (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={primary.storyPreviewUrl}
                                alt={primary.fileName ?? ''}
                                className="size-full object-contain"
                              />
                            )
```

Leave the video and no-media branches that follow unchanged.

- [ ] **Step 4: Add alt to the existing feed call site**

At line 970, add `alt="Post media"` to the `<BannerOverlay>` props so the feed path stops losing its image description too.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run src/features/create/generate-step.test.tsx
git add src/features/create/steps/generate-step.tsx src/features/create/generate-step.test.tsx
git commit -m "feat(create): preview story overlays over the 9:16 crop

The wizard previewed the raw upload, so the strip sat on the wrong edge relative
to what publishes. Use the story-cropped signed URL, and say so plainly when no
story crop exists rather than silently drawing over the feed image."
```

## Task 10: Stop story slot rebuilds wiping overlay text

The story auto-seed effect rebuilds slot copies from scratch and drops `bannerTextOverride`. Typing alone is safe because the signature also omits the field, so the effect early-returns. But when any other signature field changes, typically on media replacement, the typed text is silently discarded.

**Files:**
- Modify: `src/features/create/steps/generate-step.tsx:109-122`, `:244-256`
- Test: `src/features/create/generate-step.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('keeps overlay text when the story slot media changes', async () => {
  const onSlotCopiesChange = vi.fn();
  const { rerender } = renderStoryWizard({
    onSlotCopiesChange,
    slotCopies: [{ ...storySlot, bannerTextOverride: '£5 PINTS', mediaIds: ['media-1'] }],
  });

  rerender(storyWizardWith({
    onSlotCopiesChange,
    slotCopies: [{ ...storySlot, bannerTextOverride: '£5 PINTS', mediaIds: ['media-2'] }],
  }));

  const lastCall = onSlotCopiesChange.mock.calls.at(-1)?.[0];
  expect(lastCall?.[0]?.bannerTextOverride).toBe('£5 PINTS');
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/features/create/generate-step.test.tsx -t 'keeps overlay text'`
Expected: FAIL, `bannerTextOverride` comes back undefined.

- [ ] **Step 3: Implement**

At line 254, add the field to the rebuilt object:

```tsx
        mediaIds: existing?.mediaIds,
        bannerTextOverride: existing?.bannerTextOverride,
```

And add it to `storyCopySignature` at lines 111-120, after `mediaIds`:

```ts
      mediaIds: copy.mediaIds ?? null,
      bannerTextOverride: copy.bannerTextOverride ?? null,
```

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/features/create/generate-step.test.tsx
git add src/features/create/steps/generate-step.tsx src/features/create/generate-step.test.tsx
git commit -m "fix(create): preserve story overlay text across slot rebuilds"
```

## Task 11: Allow story overlay editing in the planner drawer

**Files:**
- Modify: `src/features/planner/post-drawer.tsx:326`
- Test: `src/features/planner/post-drawer.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('allows editing the overlay on a scheduled story', () => {
  renderDrawer({ content: { ...baseContent, placement: 'story', status: 'scheduled' } });
  expect(screen.getByLabelText(/overlay text/i)).toBeEnabled();
});

it('keeps the overlay read-only on a published story', () => {
  renderDrawer({ content: { ...baseContent, placement: 'story', status: 'posted' } });
  expect(screen.getByLabelText(/overlay text/i)).toBeDisabled();
});
```

Read the existing tests in this file for the correct render helper and the real label text used by `BannerControls`.

- [ ] **Step 2: Run and watch the first fail**

Run: `npx vitest run src/features/planner/post-drawer.test.tsx -t 'story'`
Expected: the scheduled-story case FAILS.

- [ ] **Step 3: Implement**

At line 326, change:

```tsx
        canEdit={canEdit && content.placement !== 'story'}
```

to:

```tsx
        canEdit={canEdit}
```

Leave `isStory={content.placement === 'story'}` on the next line alone. Status gating is already handled by `BANNER_EDITABLE_STATUSES` in both `banner-controls.tsx:37` and `planner/actions.ts:1306`, so the published case keeps working without further change.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/features/planner/post-drawer.test.tsx
git add src/features/planner/post-drawer.tsx src/features/planner/post-drawer.test.tsx
git commit -m "feat(planner): allow story overlays to be edited after scheduling"
```

## Task 12: Show both previews for mixed feed and story briefs

A brief with `placements: ['feed','story']` resolves `contentPlacement` to null and takes the feed branch, so the user approves a story overlay they never saw at 9:16.

**Files:**
- Modify: `src/features/create/steps/generate-step.tsx:186-194`, and after the platform column grid closes at `:1034`
- Test: `src/features/create/generate-step.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('shows a story preview alongside the feed preview for mixed placements', async () => {
  renderWizard({
    contentBrief: { ...promotionBrief, placements: ['feed', 'story'] },
    libraryItems: [{ ...storyAsset, storyPreviewUrl: 'https://example.test/story.jpg' }],
    slotCopies: [{ ...feedSlot, bannerTextOverride: 'QUIZ' }],
  });
  expect(await screen.findByTestId('story-preview')).toBeInTheDocument();
  expect(screen.getAllByLabelText(/image overlay/i)).toHaveLength(1);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/features/create/generate-step.test.tsx -t 'mixed placements'`
Expected: FAIL.

- [ ] **Step 3: Add a mixed-placement flag**

After the `contentPlacement` computation at lines 186-194, add:

```tsx
  const hasStoryPlacement =
    contentPlacement === 'story' ||
    ('placements' in contentBrief &&
      Array.isArray(contentBrief.placements) &&
      contentBrief.placements.includes('story'));
  const isMixedPlacement = hasStoryPlacement && !isStorySchedule;
```

- [ ] **Step 4: Render the extra story preview**

Inside the feed branch, immediately after the platform columns grid closes at line 1034, insert:

```tsx
                      {isMixedPlacement && (
                        <div className="mx-auto w-full max-w-6xl">
                          <p className="mb-2 text-xs font-medium text-muted-foreground">Story preview</p>
                          <div className="mx-auto w-full max-w-[200px]" data-testid="story-preview">
                            <MediaFrame placement="story" size="preview" className="rounded-md border-border bg-muted">
                              {primary?.storyPreviewUrl ? (
                                slotBannerConfig ? (
                                  <BannerOverlay
                                    mediaUrl={primary.storyPreviewUrl}
                                    config={slotBannerConfig}
                                    label={slotOverlayText}
                                    alt="Story media"
                                    className="size-full"
                                  />
                                ) : (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={primary.storyPreviewUrl} alt={primary.fileName ?? ''} className="size-full object-contain" />
                                )
                              ) : (
                                <div className="flex size-full items-center justify-center p-3 text-center">
                                  <span className="text-xs text-muted-foreground">Story crop not ready</span>
                                </div>
                              )}
                            </MediaFrame>
                          </div>
                        </div>
                      )}
```

One overlay input still drives both previews, matching the decision that mixed placements share one text.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run src/features/create/generate-step.test.tsx
npm run typecheck
git add src/features/create/steps/generate-step.tsx src/features/create/generate-step.test.tsx
git commit -m "feat(create): preview the story crop for mixed feed and story briefs"
```

## Task 13: Prove the worker path end to end

The renderer test only proves a JPEG comes out. Nothing proves the worker picks the story derivative, calls the render route, and hands the rendered image to the providers.

**Files:**
- Test: `tests/publish-queue.test.ts`

- [ ] **Step 1: Read the existing worker test setup**

Run: `grep -n 'describe\|banner\|derived_variants\|story' tests/publish-queue.test.ts | head -40`

Reuse the existing worker harness, fetch mock and storage mock. Do not build a new one.

- [ ] **Step 2: Write the test**

```ts
it('renders a banner onto the story derivative and publishes that image', async () => {
  // content: placement 'story'; variant: banner_enabled true, banner_text_override 'QUIZ'
  // media_assets row: media_type 'image', derived_variants { story: 'derived/m1/story.jpg' }
  const { renderRequests, uploadedPaths, providerMedia } = await runWorkerForStoryWithBanner();

  expect(renderRequests).toHaveLength(1);
  expect(renderRequests[0].body.label).toBe('QUIZ');
  expect(renderRequests[0].body.sourceMediaUrl).toContain('derived/m1/story.jpg');
  expect(uploadedPaths).toContain('banners/content-1/variant-1.jpg');
  expect(providerMedia[0]).toContain('banners/content-1/variant-1.jpg');
});
```

Replace `runWorkerForStoryWithBanner()` with the actual harness call this suite uses. The four assertions are the point: correct source, correct label, correct upload path, and that path reaching the provider.

- [ ] **Step 3: Run it**

Run: `npx vitest run tests/publish-queue.test.ts -t 'story derivative'`
Expected: PASS without any worker change. The worker already does all of this; this test pins it so a future change cannot quietly break story overlays. If it fails, stop and report: an assumption in the spec is wrong.

- [ ] **Step 4: Commit**

```bash
git add tests/publish-queue.test.ts
git commit -m "test: pin the story banner render path end to end"
```

## Task 14: Correct the stale type comment and run the full gate

**Files:**
- Modify: `src/types/content.ts:76-78`

- [ ] **Step 1: Fix the comment**

Replace "Stories never carry an overlay." with:

```
   * Applies to feed and story placements alike.
```

- [ ] **Step 2: Search for other stale assertions**

Run: `grep -rn "never carry an overlay\|non-story only\|stories never" src/ tests/ --include='*.ts' --include='*.tsx' -i`

Fix any comment that still claims stories cannot have overlays.

- [ ] **Step 3: Full verification**

Run: `npm run ci:verify`
Expected: lint (zero warnings), typecheck, all tests, and build all pass.

- [ ] **Step 4: Commit and push**

```bash
git add -A
git commit -m "docs: correct stale comments asserting stories cannot carry overlays"
git push -u origin feat/story-text-overlays
```

PR body must record: the three decisions from spec section 1, the assumption that spec PR 1 (Facebook token redaction) lands separately, and the live verification plan below.

## Task 15: Live verification

Do not skip this. Unit tests cannot prove the Vercel to Supabase Storage to edge worker to Meta path.

- [ ] **Step 1: Name the parameters in the PR before merging**

Environment, Meta account, owner, planned publish time, cleanup, and where evidence is stored.

- [ ] **Step 2: Confirm spec PR 1 has merged**

Publishing a Facebook story before the token redaction lands writes another Page access token to the logs. Check that the fix is deployed first.

- [ ] **Step 3: Publish one Instagram story and one Facebook story**

The two providers use different upload flows, so an Instagram success does not verify Facebook.

- [ ] **Step 4: Check the output**

Confirm the strip is legible, that the middle of the repeated label sits clear of the top and bottom Instagram UI chrome, and that the published asset is the 1080x1920 derivative and not the original. Capture screenshots and job IDs.

- [ ] **Step 5: Decide on geometry follow-up**

If the strip reads badly on a real story, raise a separate ticket for story-specific geometry. Do not adjust it speculatively.

---

# Phase C: Production backfill

**Do not start until Phase B is merged, deployed and verified by Task 15.**

Existing scheduled stories were written before this change, so they carry `banner_enabled = false` or NULL. New event stories get the automatic date label; already-scheduled ones will not, which is inconsistent.

The backfill enables the automatic label on **pending event stories only**. Non-event stories stay untouched, because with no typed text they are correctly off and there is no text to invent.

## Task 16: Backfill pending event stories

- [ ] **Step 1: Confirm the discriminator**

Read `supabase/functions/publish-queue/banner-label.ts` and check how `extractCampaignTiming` decides a campaign is an event. Confirm `campaigns.campaign_type = 'event'` is the right predicate before running anything. If content type lives elsewhere, adjust the queries below.

- [ ] **Step 2: Count and inspect before changing anything**

```sql
select ci.id, ci.status, ci.scheduled_for, c.campaign_type,
       cv.banner_enabled, cv.banner_text_override
from content_variants cv
join content_items ci on ci.id = cv.content_item_id
join campaigns c on c.id = ci.campaign_id
where ci.placement = 'story'
  and ci.status in ('draft','scheduled','queued')
  and c.campaign_type = 'event'
  and coalesce(cv.banner_enabled, false) = false
order by ci.scheduled_for;
```

- [ ] **Step 3: Show the list to Peter and get explicit approval**

This changes what already-scheduled posts will publish. Report the row count and the earliest `scheduled_for`. Do not proceed without a clear yes.

- [ ] **Step 4: Export the current values**

Save the full result of the Step 2 query, including ids, so the change can be reversed exactly.

- [ ] **Step 5: Apply**

```sql
update content_variants cv
set banner_enabled = true
from content_items ci, campaigns c
where cv.content_item_id = ci.id
  and ci.campaign_id = c.id
  and ci.placement = 'story'
  and ci.status in ('draft','scheduled','queued')
  and c.campaign_type = 'event'
  and coalesce(cv.banner_enabled, false) = false;
```

`banner_text_override` stays NULL on purpose: that is what makes the worker compute the proximity label instead of printing fixed text.

- [ ] **Step 6: Verify**

Re-run the Step 2 query. Expected: zero rows. Confirm the affected count matches Step 2's original count.

- [ ] **Step 7: Spot-check one post in the planner**

Open one backfilled story in the planner drawer and confirm the overlay preview shows the expected date label.

**Rollback:** set `banner_enabled = false` for exactly the ids exported in Step 4. Never run an unscoped update against `content_variants`.

---

## Self-review notes

**Spec coverage.** Every acceptance criterion in spec section 7 maps to a task: 1-2 to Task 8; 3-4 to Task 9; 5 to Task 10; 6-8 to Task 6; 9 to Task 8 step 6; 10 to Task 13; 11 to Task 11; 12 to Task 12; 13 to Task 6's regression run; 14 is unchanged behaviour covered by the existing kill-switch tests.

**Deliberate omissions.** Spec PR 1 is a separate session. The deferred tickets in spec section 9 (contrast, planner edit race, fetch hardening, telemetry) are out of scope by decision, not oversight.

**Known soft spots.** Task 2's `getPublishReadinessIssues` call signature, Task 5's call-site variable names, and Task 12's mixed-placement brief shape are written from reading, not running. Each of those steps says to verify the real shape first rather than trusting the snippet.
