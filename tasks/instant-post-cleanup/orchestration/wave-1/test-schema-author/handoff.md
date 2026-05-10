# Wave 1 Handoff: Test+Schema Author

Date: 2026-05-10
Branch: `main` (no worktree)

## Files Modified

- `src/lib/create/schema.ts`
  - Added exported `bannerInputSchema` at lines 54–67 — `z.object({ enabled: z.boolean(), defaults: BannerDefaultsSchema.optional() }).optional()`.
  - Added `banner: bannerInputSchema` to the `instantPostSchema` `.object({...})` block at line 86.
  - Added `banner: bannerInputSchema` to the `instantPostFormSchema` `.object({...})` block at line 149.
  - `superRefine` validators left untouched as instructed.
  - `InstantPostInput` and `InstantPostFormValues` types (lines 498–499) auto-extend via `z.infer`.

## Files Created / Extended

- `tests/lib/create/service.test.ts` — extended with two new `describe` blocks at the bottom of the file:
  - `createInstantPost — banner override (Bug A)` (3 cases) — Bug A tests 1 + 2 + the "banner enabled" colours case.
  - `createCampaignFromPlans — campaign caller regression guard (Bug A, test 3)` (1 case) — exercises the shared helper through `createEventCampaign` to assert today's NULL-banner behaviour stays put.
  - Top-of-file mocks added for `requireAuthContext`, `getOwnerSettings`, `enqueuePublishJob`, `deconflictCampaignPlans`, plus a chainable Supabase mock builder that captures the variant upsert payload.
  - All previously-existing tests remain unchanged.

- `tests/api/generate-stream-route.test.ts` — new file with 3 cases:
  - `[Test 4] story-only POST emits done with contentItemIds and never calls OpenAI`.
  - `[Test 5] story request still succeeds when getOpenAIClient throws (lazy-init guard)`.
  - `[Test 6] feed POST still calls OpenAI and emits done — regression guard for the feed path`.
  - Mocks `createServerSupabaseClient`, `getOwnerSettings`, `getOpenAIClient`, `createInstantPost`, plus an `responses.stream` async iterable. Includes an SSE-event reader helper.

## Commits

1. `c51ce0c` — `feat(create): accept optional banner override in instant-post schema`
2. `7aa207d` — `test(create): add instant-post banner + story-OpenAI regression cases (red)`

(Tournament commits from another agent landed between the two — schema commit (1) is still first by topological order in the branch history.)

## Test State After Wave 1

Command: `CI=1 npx vitest run tests/lib/create/service.test.ts tests/api/generate-stream-route.test.ts`

Result: **5 failed | 16 passed (21 total)** across the 2 files. The 5 failures are exactly the cases the Backend Implementer must turn green; the rest are existing pure-helper tests plus the two regression guards.

### Bug A — `tests/lib/create/service.test.ts` (3 new tests)

- `writes banner_enabled=false explicitly when input.banner is undefined`
  - **FAIL** (RED, expected) — `expected ... to have property "banner_enabled" with value false; received: undefined`. The variant payload today contains `{ content_item_id, body, media_ids, validation }` only. After Wave 2 the helper must spread `{ banner_enabled: false }` into the payload.

- `writes banner_enabled=false explicitly when input.banner.enabled is false`
  - **FAIL** (RED, expected) — same shape of failure as above. Same fix required.

- `writes banner_enabled=true plus the picker colours and position when banner.enabled is true`
  - **FAIL** (RED, expected) — `expected ... to match object { banner_enabled: true, banner_position: "right", banner_bg: "#a57626" }; received: { content_item_id, body, media_ids, validation }`. After Wave 2 the helper must compute `{ banner_enabled: true, banner_position, banner_bg, banner_text_colour }` from `BANNER_COLOUR_HEX` and spread it in.

- `writes NO banner_enabled column for campaign callers that omit bannerDefaults` (Test 3)
  - **PASS** (GREEN, expected). This is the regression guard for the shared helper — it must stay green forever.

### Bug B — `tests/api/generate-stream-route.test.ts` (3 new tests)

- `[Test 4] story-only POST emits done with contentItemIds and never calls OpenAI`
  - **FAIL** (RED, expected) — `expected "vi.fn()" to not be called at all, but actually been called 1 times`. Today the route calls `getOpenAIClient()` at the top of the SSE start handler, before checking placement. After Wave 2 it must defer the call into the feed branch and skip both client init and `responses.stream` for story placements.

- `[Test 5] story request still succeeds when getOpenAIClient throws (lazy-init guard)`
  - **FAIL** (RED, expected) — `expected undefined to be defined` for the `done` event. Today the throw propagates into the SSE catch and emits an `error` event instead of `done`. After Wave 2 the throw never happens because the factory is not called for stories.

- `[Test 6] feed POST still calls OpenAI and emits done — regression guard for the feed path`
  - **PASS** (GREEN, expected). This is the regression guard for the feed path — it must stay green forever.

### Typecheck

`npx tsc --noEmit` exits 0 — clean. The schema change compiles and the new test files are type-correct.

## Schema Change Summary

- `instantPostFormSchema` now accepts an optional `banner?: { enabled: boolean; defaults?: BannerDefaults }`.
- `instantPostSchema` mirrors it.
- `InstantPostInput` and `InstantPostFormValues` types auto-extended via `z.infer` (no manual type changes needed).
- `bannerInputSchema` is exported so the Backend Implementer can re-import its inferred type if useful.
- `BannerDefaultsSchema` is imported from `@/lib/scheduling/banner-config` (already imported into the file for the campaign schemas).

## Assumptions Made

- **Test 3 implementation.** Because `createCampaignFromPlans` is not exported from `service.ts` and the brief forbids touching `service.ts`, I exercised the shared helper through `createEventCampaign` with `placements: ["story"]`. Stories bypass OpenAI in `buildVariants` and skip `resolveScheduleConflicts`, so the supabase mock surface stays small. The assertion is still on the variant insert payload — the same one `createCampaignFromPlans` writes regardless of which public caller invokes it.
- **Tests 1 + 2 use `placement: "story"`.** Same reason — story plans short-circuit in `buildVariants` (line 1537 of `service.ts`) without an OpenAI call. The variant payload columns asserted (`banner_enabled` etc.) are written by `createCampaignFromPlans` for ALL placements, so Wave 2's fix will apply to feed inputs too. If the Backend Implementer wants extra coverage for `placement: "feed"`, they can add it; for the contract this suite is sufficient.
- **`#FFFFFF` vs `#ffffff`.** The brief quotes upper-case hex; `BANNER_COLOUR_HEX` in `banner-config.ts` uses lower-case. Test 2 normalises the comparison to `toLowerCase()` so it doesn't break either way Wave 2 chooses.
- **Mock supabase chain.** I built a minimal chainable mock instead of pulling in a third-party builder. It supports `.from(...).select(...).eq(...).order(...).limit(...).maybeSingle/single()`, `.from(...).insert(...).select(...).single()`, and `.from(...).upsert(...).select(...)`. Read paths return empty arrays so `fetchRecentCopyHistory` and `resolveScheduleConflicts` are no-ops; write paths return synthetic ids.
- **`enqueuePublishJob` mocked as no-op.** The shared helper auto-schedules for campaigns (`shouldAutoSchedule = true`), so Test 3's `createEventCampaign` would otherwise call `enqueuePublishJob` against a real Supabase service client. Mocking it to `vi.fn().mockResolvedValue(undefined)` keeps the test hermetic.
- **`deconflictCampaignPlans` mocked as identity.** Same reason — keeps Test 3's mock surface minimal.

## Issues Encountered

- The agent brief asserted "all 6 tests must FAIL". Test 3 and Test 6 are explicitly described as regression guards that protect existing behaviour, so they naturally PASS today and must continue to pass after Wave 2. Tightening them to fail today would mean breaking the very behaviour they exist to guard. I have surfaced this in the commit message and in this handoff. Net state: **4 RED + 2 GREEN guards**, which is the correct test contract.
- Brief mentions `createCampaignFromPlans(supabase, {...})` but the actual signature destructures `supabase` from a single options object: `createCampaignFromPlans({ supabase, ... })`. Wave 2's plan should add `bannerOverride` to that same options object — see the existing `bannerDefaults` precedent (lines 1353 + 1368 of `service.ts`).
- `createInstantPost(input)` does NOT take `supabase` as a parameter — it calls `requireAuthContext()` internally to obtain it. Tests mock `requireAuthContext` accordingly.

## What Wave 2 Needs To Know

- The 4 RED tests are the contract for the Implementers. After Wave 2, all six must pass.
- **Test 3 specifically guards the shared helper** — Backend Implementer MUST keep `createCampaignFromPlans` behaviour identical for callers that don't pass `bannerOverride`. The test asserts the variant payload has NO `banner_enabled` / `banner_position` / `banner_bg` / `banner_text_colour` keys when both `bannerDefaults` and `bannerOverride` are undefined.
- **Test 5 specifically guards lazy OpenAI init** — the Backend Implementer MUST move `getOpenAIClient()` out of the route's top-level scope and into the feed-only branch (or wrap it in a lazy getter that's only invoked from the feed branch). The current placement at `route.ts:119` is the bug.
- **Test 4 also requires** that the route still calls `createInstantPost(input)` for stories so the `done` SSE event has `contentItemIds`. It must NOT skip the persistence step just because the OpenAI step is skipped.
- The schema is in place — Backend can read `input.banner` from `InstantPostInput`. Frontend can build the same shape and POST it.
- Bug A fix path: build `InstantBannerOverride` from `input.banner` in `createInstantPost`, pass it through a new `bannerOverride` option to `createCampaignFromPlans`, and spread it into the variant insert payload AFTER the existing `bannerOverride from bannerDefaults` so it wins. See PLAN §Phase 3 for the exact code shape.
- The `bannerInputSchema` is exported from `schema.ts` (`import { bannerInputSchema } from "@/lib/create/schema"`) if the Backend or Frontend Implementer wants its inferred type.
