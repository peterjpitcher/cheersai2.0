# Fix: Instagram story failed with Meta code 9004 (2026-09-04)

Completed. Moved out of `tasks/todo.md` on 2026-09-09 so that file could hold the
current plan. Spec: `tasks/SPEC-instagram-media-fetch-retry.md`.

## Problem
The 11:00 BST Instagram story for "Big Sing Friday: Karaoke Night" failed on
attempt 1 of 4 with `9004 / 2207052 Only photo or video can be accepted as media
type`. The banner JPEG and signed URL were valid and Meta never fetched the file,
so this was a transient Meta-side media fetch failure that the worker treated as
permanent.

## Tasks
- [x] Trace the failed job, banner upload, signed URL and edge logs on the live project
- [x] Confirm the rendered banner is a valid 1080x1920 JPEG identical to the Facebook story
- [x] Classify Meta code 9004 as retryable in `meta-error.ts`
- [x] Unit tests for the classifier (`tests/publish-queue-meta-error.test.ts`)
- [x] Worker-level test for the 9004 story retry (`tests/publish-queue.test.ts`)
- [x] Spec written: `tasks/SPEC-instagram-media-fetch-retry.md`
- [x] `npm run ci:verify` green (lint, typecheck, 1971 tests, build)
- [x] PR #45 merged; `publish-queue` deployed by name (v35, 2026-09-04 12:10 BST)
- [x] Missed story re-queued for 13:00 BST on 2026-09-04 (job 138e9892)
- [x] Re-queued story published 2026-09-04 12:55 BST, first attempt, Instagram media 18166381858480873

## Notes
- The manual retry button will not work for this story: the worker rejects stories
  more than 5 minutes past `scheduled_for`. It needs a new time.
- The deployed `publish-queue` is version 34 from 2026-07-27. The 2026-09-02 domain
  commit also touched the function and has not been deployed yet.
