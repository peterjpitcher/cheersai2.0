# Deferred Items — Phase 04

## Pre-existing Type Errors (out of scope)

V1 files calling the Plan 01-refactored `enqueuePublishJob` with old parameter names:

- `src/app/(app)/planner/actions.ts` — uses `variantId` (removed in Plan 01 refactor)
- `src/app/actions/tournament.ts` — uses `scheduledFor` (renamed to `scheduledAt`)
- `src/lib/create/service.ts` — uses `variantId` (removed in Plan 01 refactor)
- `src/lib/tournament/generate.ts` — uses `variantId` (removed in Plan 01 refactor)

These are v1 code paths that will be replaced during the full rebuild. Not caused by Phase 04 changes.
