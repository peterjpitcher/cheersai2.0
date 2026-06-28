# App Section Review — Event-post media not showing in Create wizard

**Date:** 2026-06-28
**Section:** `src/features/create` (create wizard → generate step → media picker)
**Base commit:** `956fd895ec6245573f755c1014d8a8472e55a124`
**Mode:** Continuous Remediation
**Reported symptom:** Building event posts, the generate-step previews render "No media attached" even though media was attached.

## Root cause

`MediaPicker` (`src/features/create/media/media-picker.tsx`) kept its **own local copy** of the
library (`allItems`, seeded once from the `libraryItems` prop). On upload it did
`setAllItems([item, ...prev])` + added the id to `selectedMediaIds`, **but never propagated the new
asset back up to the create wizard's `libraryItems` state** (fetched once on mount via
`getCreateModalData`).

`generate-step.tsx` resolves each slot's media by looking the selected ids up **in the wizard's
`libraryItems`**:

```ts
const slotMedia = slotMediaIds
  .map((id) => libraryItems?.find((item) => item.id === id))
  .filter(Boolean);
const primary = slotMedia[0] ?? null; // null → "No media attached"
```

So a freshly uploaded asset existed only inside `MediaPicker` and was **absent from the wizard
library** generate-step searches → `.find()` returned nothing → `primary = null` → "No media
attached". The image render gate also requires `primary.previewUrl`.

**Why it looked event-specific:** events are typically created by uploading a fresh event poster
(rather than re-using existing library media). Picking *existing* library media worked because those
items are already in the mount-time fetch. It is really "newly-uploaded media", not events per se.

The per-slot "Add / Replace" swap modal in generate-step shared the same stale `libraryItems`, so
even re-uploading there could not fix the missing preview (sibling instance of the same defect).

## Investigation notes (ruled out)

- `previewUrl` resolution — refuted: `resolvePreviewCandidates` always adds the original storage
  path (`src/lib/library/data.ts:236`), so normal images do sign a `previewUrl`.
- `selectedMediaIds` empty — refuted for the reported case: the MediaStep thumbnail strip renders the
  selection from the picker's local copy, so the user sees their media in step 1; ids are present.
- Recent regression — none found in the slot-media resolution chain across recent commits.

## Defects

| ID | Type | Severity | Confidence | Root cause | Fix | Bucket |
|----|------|----------|-----------|-----------|-----|--------|
| ASR-001 | Bug | High | High | `MediaPicker` uploads not propagated to wizard `libraryItems`; generate-step resolves previews from the stale list | Thread `onLibraryItemsChange` from `MediaPicker` → `MediaStep` / swap modal → wizard `setLibraryItems` | Safe fix (done) |
| ASR-002 | Bug (edge) | Medium | Medium | `slotCopy?.mediaIds ?? selectedMediaIds` — `??` does not fall back on an empty array, so a slot whose `mediaIds` became `[]` (e.g. generate-then-add-media) stays empty even after regenerate (`generate-step.tsx` ~327, ~666) | Treat `[]` distinctly only where intended; needs product call on whether `[]` means "inherit wizard selection" vs "explicit no media" (per-slot removal relies on the latter) | Flag — NOT fixed (semantic risk) |

## Fix (ASR-001)

Single source of truth for the wizard media library — uploads now mirror up:

- `src/features/create/media/media-picker.tsx` — new optional `onLibraryItemsChange` prop;
  `applyLibraryChange` updates local `allItems` **and** notifies the parent (used on upload and for
  the upload-panel's library changes).
- `src/features/create/steps/media-step.tsx` — threads `onLibraryItemsChange` to `MediaPicker`.
- `src/features/create/steps/generate-step.tsx` — new `onLibraryUpdate` prop; the per-slot
  `SlotMediaModal` forwards it to its `MediaPicker` (sibling fix).
- `src/features/create/create-wizard.tsx` — passes `setLibraryItems` to both `MediaStep`
  (`onLibraryItemsChange`) and `GenerateStep` (`onLibraryUpdate`).

## Verification

- `npx tsc --noEmit` — exit 0.
- `npx eslint` on the 4 changed files — exit 0, no warnings.
- `npx vitest run` media-picker + generate-step — 5 passed (incl. new regression test
  `media-picker.test.tsx`).
- `npm run build` — exit 0, "Compiled successfully".

## Round 2 — additional issues found & fixed ("fix all")

| ID | Type | Severity | Fix | Status |
|----|------|----------|-----|--------|
| ASR-002 | Bug | Medium | `generate-step.tsx` no longer bakes `selectedMediaIds` into slots at seed time — `undefined` = inherit live selection, `[]` = explicit per-slot clear. Fixes the stuck-empty case where generate-then-add-media left a slot showing (and **publishing**) with no media even after regenerate. | Fixed |
| ASR-003 | Observability | Medium | `create-wizard.tsx` library-load failure no longer swallowed — logs + shows a toast. A silent failure here previously left every preview as "No media attached" with no signal. | Fixed |
| ASR-004 | Bug (expiry) | Medium | Signed preview-URL TTL raised 600s → 3600s (`data.ts`, named const `PREVIEW_URL_SIGN_TTL_SECONDS`) so previews don't break mid-session. | Fixed |
| ASR-005 | Bug (edge) | Low-Med | `listMediaAssets` gained an opt-in `limit` (default 100 unchanged); the create flow now requests 250 so older/draft-referenced assets stay resolvable. | Fixed (create flow only) |
| ASR-006 | Dead code | Low | Removed orphaned create UI: `event/promotion/weekly-campaign-form.tsx`, `instant-post-form.tsx`, `generated-content-review-list.tsx` + `review-list-grouping.test.ts`, and the 5 now-orphaned server-action wrappers (`handle*Submission`, `fetchGeneratedContentDetails`) + `parseManualSlot` and their dead imports in `create/actions.ts`. `CreateWizard` is the only live entry point. | Removed |

Verified safe to delete ASR-006 via a dedicated reference audit (the live wizard persists through `@/app/actions/content` + `@/app/actions/media`, never the deleted code). `*FormSchema`/`*FormValues` in `src/lib/create/schema.ts` are kept (still used by `create/actions.ts` management prefill + `management-app/mappers.ts`).

### Round 2 verification
- `tsc --noEmit` → 0 · `npm run lint` (full) → 0 warnings · `npm run build` → Compiled successfully
- `npm run test` (full) → **1637 passed, 2 skipped** (updated `mediaAssetsData.test.ts` to assert the new 3600s TTL)

## Remaining risks / follow-ups

- ASR-002 (empty-array `??` trap) left as a flagged follow-up — fixing it needs a decision on the
  meaning of an empty per-slot `mediaIds`.
- `MediaPicker.allItems` is still initialised once from props; the mirror keeps it in sync going
  forward but does not re-seed if the parent library changes externally mid-step. Not triggered by
  the wizard flow today.
