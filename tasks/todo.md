# Fix: Instagram story failed with Meta code 9004 (2026-09-04)

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
- [ ] Merge PR and deploy `publish-queue` by name (needs Peter's go-ahead)
- [ ] Re-schedule the missed story to a new time so it publishes (needs Peter's go-ahead)

## Notes
- The manual retry button will not work for this story: the worker rejects stories
  more than 5 minutes past `scheduled_for`. It needs a new time.
- The deployed `publish-queue` is version 34 from 2026-07-27. The 2026-09-02 domain
  commit also touched the function and has not been deployed yet.

# API connection fixes

- [x] Trace Settings diagnostic and both booking conversion loaders.
- [x] Implement GET-only capability checks and fail closed on unavailable booking evidence.
- [x] Add failure-injection regression tests; 48 targeted tests passed.
- [x] Complete lint, typecheck, full London and UTC tests, clean production build.
- [x] Exercise exact connection helper and review sibling paths again.
- [x] Hand verified local changes to root for coordinated deployment.
