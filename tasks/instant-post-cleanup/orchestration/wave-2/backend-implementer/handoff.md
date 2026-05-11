# Wave 2 Handoff: Backend Implementer

Date: 2026-05-10
Branch: `main` (no worktree)

## Files Modified

- `src/lib/create/service.ts`
  - Added `InstantBannerOverride` type at line 99 (immediately after the existing `BannerOverrideRow` type — that type is left untouched).
  - Added `buildInstantBannerOverride` helper at line 117. Returns `{ banner_enabled: false }` when `banner` is undefined or `banner.enabled === false`; otherwise returns `{ banner_enabled: true, banner_position, banner_bg, banner_text_colour }` derived from `banner.defaults` via `BANNER_COLOUR_HEX`.
  - `createCampaignFromPlans` options object now accepts a new optional `bannerOverride?: InstantBannerOverride` parameter (added at line 1404 in the destructured options, line 1426 in the type annotation). Renamed the local `bannerOverride` derived from `bannerDefaults` to `sharedBannerFields` so the new override can keep the natural name.
  - Variant insert payload at line 1501 now spreads `(bannerOverride ?? {})` AFTER `(sharedBannerFields ?? {})` so the instant-only override wins. Campaign callers that omit `bannerOverride` get behaviour identical to before.
  - `createInstantPost` builds the override at line 690 (`buildInstantBannerOverride(input.banner)`) and passes it through at line 718 in the call to `createCampaignFromPlans`.

- `src/app/api/create/generate-stream/route.ts`
  - Added `story_no_caption` to the `StreamEvent` union at line 39.
  - Forwarded `banner: formValues.banner` through the `instantPostSchema.parse({...})` call at line 107 so the new `banner` field reaches `createInstantPost`.
  - Removed the top-level `const openai = getOpenAIClient();` call. `getOpenAIClient()` is now called inline at line 145 only inside the feed branch's `responses.stream(...)` call.
  - Added a story short-circuit at the top of the platform loop (line 130). When `input.placement === "story"` it sends a `story_no_caption` SSE event for the platform and `continue`s — no prompt build, no OpenAI client touch.
  - The final `done` SSE event still emits for both story and feed flows because `createInstantPost(input)` runs after the platform loop in both cases.

## Commits

1. `1dab6cb` — `fix(create): instant posts always write explicit banner_enabled` (service.ts)
2. `65cbc9f` — `fix(create): skip OpenAI for story placements, lazy-init client` (route.ts)

## Test Results

Command: `CI=1 npx vitest run tests/lib/create/service.test.ts tests/api/generate-stream-route.test.ts`

- `tests/lib/create/service.test.ts` — **18 / 18 PASS**.
  - Tests 1 + 2 (banner_enabled defaults to false) — RED → GREEN.
  - Test 3 (campaign caller regression guard, no banner_* keys when override + defaults are both undefined) — still GREEN.
- `tests/api/generate-stream-route.test.ts` — **3 / 3 PASS**.
  - Tests 4 + 5 (story skips OpenAI; lazy-init guard) — RED → GREEN.
  - Test 6 (feed path still calls OpenAI) — still GREEN.

Combined run: 21 / 21 pass across the two files. All RED tests from Wave 1 are now GREEN; both regression guards (Tests 3 + 6) remain GREEN.

`npx tsc --noEmit` exits 0 — clean.

## Assumptions Made

- **Variable rename inside `createCampaignFromPlans`.** The function previously used a local `const bannerOverride = computeBannerOverride(bannerDefaults);` derived from the campaign-flow `bannerDefaults`. To avoid shadowing the new `bannerOverride` parameter, I renamed the local to `sharedBannerFields`. Both fields still flow into the variant payload via two ordered spreads (shared first, then the new override). This is internal to `createCampaignFromPlans`; no caller is affected.
- **`getOpenAIClient()` placement (lazy-init).** Per the brief's preferred shape, I went with the simplest one-line change: call `getOpenAIClient()` inline at the `responses.stream(...)` call site inside the feed branch (line 145). No module-level lazy getter helper is needed because the call already happens once per feed-platform iteration; story platforms never reach the call.
- **`story_no_caption` event type.** Added to the existing `StreamEvent` union with shape `{ type: "story_no_caption"; platform: string }` so the form can react to it later if it wants to render "stories don't need a caption". The route emits one per story platform before `continue`-ing the loop. The Frontend Implementer can choose to consume it or ignore it; nothing in the contract requires the form to handle it.
- **Banner field forwarding from form values.** `formValues.banner` is forwarded explicitly through `instantPostSchema.parse({...})` rather than relying on the `...formValues` spread, because Zod can strip unknown keys depending on the schema mode. Belt-and-braces — the field is named explicitly so a later schema tweak cannot silently drop it.

## Issues Encountered

None. The PLAN's exact code shape worked first try after applying the Wave-1 signature correction (the actual `createCampaignFromPlans` takes a single options object, not two positional args). All three test groups passed on the first run after each commit.

## Diff Stats

- `src/lib/create/service.ts`: +64 -1 (one line replaced where the local was renamed; the remainder are additions for the type, helper, options field, and variant-spread comment)
- `src/app/api/create/generate-stream/route.ts`: +19 -5

Total: +83 -6 across the two source files.

## What The Orchestrator Should Verify

- Run all 6 contract tests after the Frontend Implementer's changes land. The form changes touch `instant-post-form.tsx` only and shouldn't affect either of these test files, but it's worth a sanity check.
- Run the full `npm run ci:verify` pipeline (lint → typecheck → test → build) once both Wave 2 implementers have committed.
- Confirm the Frontend Implementer's submit payload includes `banner: { enabled: boolean; defaults?: BannerDefaults }` so the new field actually arrives at the route. Without it, the variant will always get `banner_enabled: false` (which is the correct safe default — but the user's opt-in won't take effect).
