# Task: Auto name + tag library uploads (AI vision)

Replicate the create flow's "auto-tag on upload" for the /library page. On /library there is
no campaign to borrow a tag from, so uploads are named + tagged by OpenAI vision instead.

Scope: images uploaded via `/library` only. Videos and the create flow are untouched.

## Steps
- [x] 1. `src/lib/ai/media-tagging.ts` — `generateMediaNameAndTags({ imageUrl })` (vision, structured output)
        plus pure helpers `buildMediaFileName()` / `deriveExtension()` / `MAX_MEDIA_TAGS`.
- [x] 2. `src/app/(app)/library/actions.ts` — new server action `autoNameAndTagMediaAsset(assetId)`:
        sign a preview URL, call the AI helper, persist via existing `updateMediaAsset`. Fails soft.
- [x] 3. `src/features/library/media-asset-grid-client.tsx` — after finalise (images only), call the
        action, show an "Auto-tagging" status, swap in the enriched asset.
- [x] 4. `src/lib/ai/media-tagging.test.ts` — happy path + edge cases (mock OpenAI client). 12 tests pass.
- [x] 5. Verify: typecheck ✓ lint ✓ test (1665 pass) ✓ build ✓.

## Assumptions
- Model: `process.env.OPENAI_MODEL ?? 'gpt-4o-mini'` (vision-capable), matching `generate.ts`. No new env var.
- Graceful failure: if AI errors, the asset keeps its original filename and no tags (no user-facing error).
- Reuses `updateMediaAsset`, the same persistence path the create flow uses for its campaign tag.
