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
- [x] Merge PR and deploy `publish-queue` by name (PR #45, v35, 2026-09-04 12:10 BST)
- [x] Re-schedule the missed story (published 2026-09-04 12:55 BST, first attempt)

Full record: `tasks/DONE-2026-09-04-instagram-media-fetch-retry.md`.

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

## Tournament upload-only artwork
- [x] Replace library selection with direct uploads and current previews.
- [x] Validate and save tournament-owned originals without shared library entries.
- [x] Exercise upload, replacement, errors and library exclusion; run release gates.

Local verification: ci:verify passed (2,098 tests passed, three skipped), 30 focused backend/route tests and eight UI tests passed. Isolated Chromium exercised uploads, replacement, recovery and mobile layout. Production storage writes were not used for tests.

## Terrestrial rugby bookings
- [x] Support owner booking approval separately from detailed screen setup.
- [x] Accept bookings within existing hours with accurate food and partial-coverage wording.
- [ ] Test and deploy website and Cheers compatibility.
- [ ] Apply the approved November fixture decisions and verify live booking entry points without creating bookings.

## Public browser configuration follow-up, 5 September 2026

- [x] Reproduce localhost public link on the production Settings screen.
- [x] Replace dynamic reads for all four affected public variables with literal references so Next.js embeds the configured values.
- [x] Lint, typecheck, production build and both timezone suites passed (2,116 tests each).
- [ ] Verify production Settings after deployment.

No environment values, secrets, database records or feature flag settings changed.

## Nations Sunday menu links

- [x] Match menu destination to the London fixture day and verified food service.
- [x] Cover Sunday during and before games, weekdays and unavailable kitchen service.
- [x] Full ci:verify and UTC suite passed: 2,191 tests passed, 3 skipped in each timezone.
- [ ] Deploy and verify the exact production alias.

## Tournament overlay names and scheduling defaults
- [x] Inspect live schema, existing lead-time controls and generated Nations content.
- [x] Render the tournament name on square and story artwork and test layout.
- [x] Add clear default scheduling controls to tournament creation and settings.
- [x] Run focused tests, lint, types, full London and UTC suites and build. Both zones: 2,207 passed, three skipped.
- [ ] Deploy verified increments, set Nations to 72 hours, verify existing future content through normal generation.

## Conditional late match finishes
- [x] Check current screening, booking and content paths and record the owner policy.
- [x] Add scoped conditional late-finish feed and social wording with tests.
- [x] Verify lint, types, London and UTC tests and build. Both zones: 2,214 passed, three skipped.
- [ ] Deploy compatible website, Cheers and worker; regenerate existing content and check live.

## Story calendar artwork
- [x] Verify live assets and trace the calendar preview mismatch.
- [x] Add regression coverage and use placement-aware asset previews.
- [ ] Run full verification, deploy and check the production create calendar.

---

# Plan: temporal date context in generation prompts, Phase 1 (2026-09-09)

Spec: `tasks/SPEC-temporal-date-context-in-prompts.md`
Review: `tasks/REVIEW-temporal-date-context-in-prompts.md`
Decisions: D1 approved but deferred to Phase 2, D2 anchor only, D3 warn first, D4 delete the legacy route.

Phase 1 only. No house-style change. Validation changes only ever lift a block, never add one.

## Order of work

Each step is independently verifiable. Run lint, typecheck and the affected tests after each group, and `npm run ci:verify` plus `npm run test:utc` at the end.

### A. Shared temporal facts (the foundation everything else consumes)
- [x] A1. Add `resolveEffectivePublishAt({ scheduledAt, referenceAt })` to `src/lib/create/temporal-context.ts`, returning `{ kind: 'scheduled' | 'now' | 'invalid', at: DateTime | null }`. Valid `scheduledAt` wins, absent falls back to `referenceAt`, `referenceAt` defaults to `DateTime.now()` in `DEFAULT_TIMEZONE`, invalid is its own state.
- [x] A2. Add `referenceAt` to `buildGenerationTemporalContext` and route it through `describeEventTimingCue` and `describePromotionTimingCue`, which now always receive a resolved instant.
- [x] A3. Delete the null-schedule branches (`temporal-context.ts:84`, `:161`) that cause the post-now bug. Invalid schedule returns `{}`.
- [x] A4. `formatDayMonth` uses `formatEventDateLong` so instructions read "Saturday 19th September".
- [x] A5. Unit tests for A1 to A4 with an injected clock, including the invalid-schedule case.

### B. One timing block in the prompt
- [x] B1. Add `buildTimingBlock(facts)` to `src/lib/ai/prompts.ts`: publish line, event or promotion line, the day gap in words, the required absolute-date form, and the forbidden relative vocabulary derived from the same gap banding as `getProximityLabel`.
- [x] B2. `buildUserPrompt` always emits the publish line, every content type, including post-now.
- [x] B3. Remove the raw ISO `Event date: ${brief.eventDate}` line and the `Timing label:` enum line. Keep the `proximityLabel` exclusion and its regression test untouched.
- [x] B4. Strip date and countdown vocabulary from `buildTemporalInstructions`; it keeps narrative purpose only.
- [x] B5. Ordinals in the remaining `prompts.ts` formatters (`formatDate`, `formatDateTime`, the `scheduledAt` line).
- [x] B6. Prompt tests: publish line present for every content type, no ISO date, no `Timing label:`, forbidden list never contradicts an instruction elsewhere in the same prompt.

### C. Move clock resolution server-side
- [x] C1. `generateContent` and `regenerateWithModifier` compute the temporal context server-side from `brief` plus `context.scheduledAt`, instead of trusting the client's spread.
- [x] C2. `generate-step.tsx` stops calling `buildGenerationTemporalContext` for generation. It keeps `getCreatePreviewBannerLabel` for the preview overlay.
- [x] C3. Persist the resolved effective instant in `ai_generation_params.generationContext` so Phase 3 has something to build on. Not consumed yet.
- [x] C4. Action tests with a frozen clock: post-now for an event 11 days out must not describe the event as happening today, tonight or now.

### D. Stop the destructive normaliser
- [x] D1. `normalizeDayNames`: two or more different weekdays leaves copy untouched; no reference date leaves copy untouched; a single contradicting weekday is no longer silently rewritten.
- [x] D2. Tests: "Join us Saturday. Sunday roast follows." survives; missing reference date leaves copy alone; correct single weekday still untouched.

### E. Stop the lint blocking legitimate copy
- [x] E1. `validateDayNames` checks against a set of legitimate dates (event start, publish date, promotion start and end) and stops failing on two different weekdays.
- [x] E2. Give the day-name issue a message that names the offending day. The generic `lint_failed` preflight message is untouched: day_name_mismatch is now advisory, so it never reaches preflight.
- [x] E3. Tests: two legitimate weekdays pass, weekly-recurring wording passes, a weekday matching nothing still fails.

### F. Remove the orphaned v1 path
- [x] F1. Delete `src/app/api/create/generate-stream/route.ts` and `tests/api/generate-stream-route.test.ts`.
- [x] F2. Trace what in `src/lib/create/service.ts` is now unreachable, including the duplicate `describeEventTimingCue`, and remove only that. Anything still referenced stays.
- [x] F3. Confirm no other caller broke.

### G. Gates
- [x] G1. Add `test:utc` to `ci:verify` and to `.github/workflows/ci.yml`.
- [x] G2. DST cases for the today/tonight/tomorrow/this-weekday bands either side of 29 March and 25 October.
- [x] G3. `npm run ci:verify` green.
- [x] G4. `npm run test:utc` green.

## Assumptions
- Post-now means "publishes at approximately the moment of generation". Using generation time as the reference is correct to within the seconds it takes to save.
- `getProximityLabel` banding is the single source of truth for which relative words are legitimate at a given gap. Phase 1 consumes it, never changes it.
- Removing a blocking condition cannot break an already-scheduled post.

## Results

All Phase 1 items complete. `npm run ci:verify` exits 0: lint (0 warnings), typecheck, 1961 tests under Europe/London, 1961 tests under UTC, build successful.

Verified behaviour changes, measured by running the real functions:

| Case | Before | After |
|---|---|---|
| Event 11 days out, "post now" | "Use live, present-tense wording such as today, tonight, or happening now" | "The event is on Saturday 19th September at 7pm, 11 days after this post publishes" plus an explicit ban on today/tonight/tomorrow |
| Noon event, posted 07:00 same day | permitted "tonight" | permits "today", bans "tonight" |
| Unparseable schedule | became "happening now" | no temporal claim at all |
| Instant post, "post now" | no date in the prompt at all | "This post publishes immediately, today, Tuesday 8th September at 3:40pm." |
| "Join us Saturday. Sunday roast follows." | published as "Join us . roast follows." | unchanged |
| "Live music Saturday", scheduled Tuesday | rewritten to "Live music Tuesday" | unchanged |
| Copy naming two legitimate weekdays | blocked approval | reported, does not block |
| Weekly recurring "this Wednesday" published Monday | blocked approval | passes |

Two decisions changed during implementation, both recorded in the spec:

1. The normaliser keeps correcting a single contradicting weekday. Dropping it would have pushed that copy into the lint and created a new block, breaking the "only ever removes blocks" property.
2. `day_name_mismatch` became advisory rather than merely set-based. A set of dates cannot tell that a Sunday roast mentioned in a Saturday event post is legitimate, so the set alone still reported it and would still have blocked.

Deferred, unchanged from the spec: Phase 2 (natural relative wording, approved but needs its own vocabulary table) and Phase 3 (drift detection, blocked on a per-body provenance contract that does not exist yet).

Not done, deliberately: `buildInstantPostPrompt` and `postProcessGeneratedCopy` are now unused by application code but kept, because their helpers are interleaved with live v2 code and an integration test still exercises the former.
