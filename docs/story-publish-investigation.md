# Story Publish Failure Investigation – "Story derivative not available for selected media"

_Last updated: 2025-10-08_

## Context
Instagram and Facebook story publishes are still failing, but the error has changed to `"Story derivative not available for selected media"`. We gathered fresh database snapshots to understand why the publish worker can’t locate the 9:16 derivative it expects.

## Data collected
### 1. Recent failing jobs
```ts
const { data } = await supabase
  .from('publish_jobs')
  .select('id, content_item_id, placement, status, attempt, last_error, next_attempt_at, created_at, updated_at')
  .order('created_at', { ascending: false })
  .limit(5);
```
Result (truncated):
```json
[
  {
    "id": "219788da-c9e4-41ad-9153-db7f26382cae",
    "content_item_id": "3815ba6d-7480-4a15-8890-bfb9cc5c76ed",
    "placement": "story",
    "status": "failed",
    "attempt": 1,
    "last_error": "Story derivative not available for selected media",
    "updated_at": "2025-10-08T19:23:32.218373+00:00"
  },
  {
    "id": "55b3523b-e737-4be2-9e63-908f9015a817",
    "content_item_id": "5830709c-24dc-4335-ba0f-f93b2874b47c",
    "placement": "story",
    "status": "failed",
    "attempt": 1,
    "last_error": "Story derivative not available for selected media",
    "updated_at": "2025-10-08T19:23:33.495274+00:00"
  }
]
```
Both fail on their first attempt with the new error.

### 2. Media asset referenced by the failing jobs
The `content_variants` for both jobs point to media asset `6e53b03e-c6a4-4b5b-9e75-854befdb95b0`. Querying `media_assets`:
```ts
const { data } = await supabase
  .from('media_assets')
  .select('id, media_type, mime_type, derived_variants, processed_status, processed_at, storage_path')
  .eq('id', '6e53b03e-c6a4-4b5b-9e75-854befdb95b0')
  .maybeSingle();
```
Result:
```json
{
  "id": "6e53b03e-c6a4-4b5b-9e75-854befdb95b0",
  "media_type": "image",
  "mime_type": "image/png",
  "derived_variants": {
    "original": "91fda684-2801-4abb-980e-f42cec017cef/6e53b03e-c6a4-4b5b-9e75-854befdb95b0/sunday-lunch-your-story-.png"
  },
  "processed_status": "ready",
  "processed_at": "2025-10-08T10:33:27.009+00:00",
  "storage_path": "91fda684-2801-4abb-980e-f42cec017cef/6e53b03e-c6a4-4b5b-9e75-854befdb95b0/sunday-lunch-your-story-.png"
}
```
**Observation:** the `derived_variants` JSON only contains `original`; the `story` derivative key is missing even though `processed_status` is `ready`.

### 3. Publish worker expectation
Excerpt from `supabase/functions/publish-queue/index.ts` (current deployment):
```ts
if (placement === "story") {
  if (row.media_type !== "image") {
    throw new Error("Stories support images only");
  }
  const storyVariant = resolveDerivedPath(row.derived_variants, "story");
  if (!storyVariant) {
    throw new Error("Story derivative not available for selected media");
  }
  targetPath = normaliseStoragePath(storyVariant);
}
```
For story placements we hard-require `derived_variants.story`. Because the record above lacks that key, the worker will always throw.

### 4. Derivative generation function
The media derivative worker (`supabase/functions/media-derivatives/index.ts`) is responsible for populating the variants:
```ts
const variants = [
  { name: "square",    args: ["-vf", "scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350", "square.jpg"] },
  { name: "story",     args: ["-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920", "story.jpg"] },
  { name: "landscape", args: ["-vf", "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080", "landscape.jpg"] }
];
...
derivedPaths[variant.name] = storagePath;
...
await supabase
  .from("media_assets")
  .update({
    processed_status: "ready",
    processed_at: new Date().toISOString(),
    derived_variants: derivedPaths,
  })
  .eq("id", assetId);
```
If the story derivative were generated successfully we would see a `story` key referencing a JPEG. The absence indicates that derivative generation either never ran, or failed before `story.jpg` was uploaded.

## Hypothesis
The media derivative pipeline did not generate the story rendition for this asset. Because the publish worker strictly requires `derived_variants.story`, every story publish attempt with this asset fails. Possible reasons the story derivative is missing:

- The asset was uploaded before the derivative worker ran or before the story variant logic was deployed.
- The derivative function is skipping PNGs or failing silently (no notification surfaced for this asset).
- The derivative worker never triggered for this asset (e.g. background job didn’t enqueue it).

## Recommendations / Next actions
1. **Regenerate derivatives for the offending asset** (and any others missing the story key). We can invoke the derivative function manually or add a backfill job:
   ```bash
   supabase functions invoke media-derivatives --env-file .env.local --no-verify-jwt --data '{"assetId": "6e53b03e-c6a4-4b5b-9e75-854befdb95b0"}'
   ```
   After rerun, confirm `derived_variants.story` exists and retry the publish.

2. **Add monitoring** to detect derivative outputs missing required keys. For example, enforce a constraint or validation when updating `media_assets` so `processed_status = 'ready'` implies derived keys exist.

3. **Consider a graceful fallback:** if `story` is absent, either generate it synchronously before publish or fall back to `original` with a warning instead of failing outright (depending on product requirements).

4. **Review the derivative pipeline for PNG inputs** to ensure story variants are produced consistently. Check logs/notifications around `2025-10-08T10:33Z` for this asset to see if the worker reported an error.

5. **Update publish retry logic metrics** to differentiate between "variant missing" (previous issue) and "derivative missing" (current issue) so we can track regressions separately.

Document prepared for consultant review; contains all relevant database snapshots and code snippets.
