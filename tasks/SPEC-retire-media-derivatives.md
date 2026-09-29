# SPEC: retire the media-derivatives edge function

## Decision (Peter, 29 September 2026)

Retire the image-processing function instead of fixing it. This supersedes PR #164, which added a
caller check to the function.

## Why

- Nothing in the app calls it. Library uploads build their square, story and landscape sizes in
  the browser (`generateImageDerivatives()` in `src/lib/library/client-derivatives.ts`) and save
  them through `finaliseMediaUpload()` in `src/app/(app)/library/actions.ts`. Its only callers
  were two ops scripts: `scripts/ops/regenerate-story-derivatives.ts` and
  `npm run ops:invoke -- media-derivatives ...`.
- It has failed to start on every call for about a year. The live copy (v7, `verify_jwt = false`,
  last deployed on 8 October 2025 from an older checkout) answers 503 `BOOT_ERROR`, because it
  imports `createFFmpeg` from `https://esm.sh/@ffmpeg/ffmpeg@0.12.6`, which that version no longer
  exports (checked by the main session on 29 September 2026).
- Live data, read only, 29 September 2026: all 426 `media_assets` rows are
  `processed_status = 'ready'`, and `notifications` has no `media_derivative_skipped` or
  `media_derivative_failed` rows.

## Change

- Delete `supabase/functions/media-derivatives/index.ts`, the function's only file.
- `supabase/config.toml`: remove the `[functions."media-derivatives"]` block and its comment, and
  leave a short retirement note.
- Delete `scripts/ops/regenerate-story-derivatives.ts` and its `ops:regenerate-story-derivatives`
  npm script. It existed only to call this function.
- Keep `scripts/ops/invoke-function.ts` (`npm run ops:invoke`). It invokes any edge function by
  name and is still the documented way to trigger `publish-queue`; only the media-derivatives
  examples go from the docs.
- Delete `tests/__mocks__/ffmpeg.ts` and its alias in `vitest.config.ts`. No test ever imported
  this function; the stub was added for the old publish-queue banner renderer (removed in the
  banner overlay redesign), and after this change nothing imports FFmpeg.
- Docs describe one edge function, `publish-queue`, with a retirement note where media-derivatives
  was documented: `CLAUDE.md` (background work, integrations table, testing), `docs/runbook.md`
  (sections 4.3, 8, 11 and 12) and `docs/agent-reference.md` (ops scripts table).

No change under `src/`, no migration and no data change. `publish-queue` is untouched.

## Deliberately kept

- `media_assets.derived_variants`, `processed_status`, `processed_at` and `aspect_class`, and every
  read and write of them in `src/`. Uploads, the library, the planner, publishing and tournaments
  use them without this function.
- The `processed_status` values `pending`, `processing` and `skipped`, in
  `MediaAssetSummary["processedStatus"]` and the labels in
  `src/features/create/media-attachment-selector.tsx`. This function was the only writer of
  `processing` and `skipped` and no live row has them, but the type mirrors the live CHECK
  `media_assets_processed_status_check`, which stays.
- The `media_derivative_skipped` and `media_derivative_failed` notification categories
  (`src/types/notifications.ts`, `src/lib/notifications/routing.ts`,
  `src/lib/planner/notifications.ts`, the presenters in `src/features/planner/activity-feed.tsx`,
  and `tests/plannerActivity.test.ts` and `tests/lib/planner/notifications.test.ts`). They now have
  no writer and no live rows, so they are harmless; the same call as the writer-less connection
  categories in `tasks/SPEC-remove-token-health-cron.md`. Removing them is a separate tidy-up.
- The `MEDIA_BUCKET` edge secret: `publish-queue` still reads it.
- Historical records keep what they recorded: `HANDOFF.md`, `BACKLOG.md`, `.planning/`,
  `docs/redesign-plan/`, `docs/superpowers/`, `docs/publishing-consultant-report.md`,
  `docs/story-publish-investigation.md`, the early design docs in `docs/`, `tasks/codex-qa-review/`
  and the older specs that mention it (`tasks/SPEC-create-flow-improvements.md`,
  `SPEC-domain-migration-cheers-orangejelly.md`, `SPEC-draft-reschedule-no-publish-job.md`,
  `SPEC-instagram-media-fetch-retry.md`, `SPEC-notification-insert-message.md`).

## Deploy order

1. Merge this PR. Nothing in `src/` imports the function or the removed script, so the app deploy
   changes nothing at runtime, and CI has no function deploy step.
2. Then delete the live function by name:
   `npx supabase functions delete media-derivatives --project-ref nbkjciurhvkfpcpatbnt`.
   Check that `list_edge_functions` shows only `publish-queue` and that a POST to
   `https://nbkjciurhvkfpcpatbnt.supabase.co/functions/v1/media-derivatives` answers 404.

Keep deploying `publish-queue` by name only, never with a bare deploy-all.

## Rollback

Code: revert the PR. Live function: restore `supabase/functions/media-derivatives/` and its
`verify_jwt = false` block from git history, then deploy it by name
(`npx supabase functions deploy media-derivatives --project-ref nbkjciurhvkfpcpatbnt`). The code
was already broken (it cannot start on `@ffmpeg/ffmpeg@0.12.6`), so a redeploy brings back a
function that still fails; nothing depends on it.

## Checklist

- [x] Owner decision, 29 September 2026
- [x] Remove the function, its config block, the story-derivatives script and npm alias, and the
      FFmpeg test stub; update the docs
- [x] The `ci:verify` steps: lint and typecheck clean; tests under London and UTC green (351
      files, 4,000 tests, 3 skipped, in each zone); build green with the CI placeholder env
- [ ] PR opened (not merged; the main session deletes the live function after merge)
