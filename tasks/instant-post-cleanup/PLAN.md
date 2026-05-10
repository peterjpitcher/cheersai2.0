# Implementation Plan: Instant-post cleanup (banner picker + story OpenAI waste)

**Spec:** [SPEC.md](tasks/instant-post-cleanup/SPEC.md) — revised after Codex review on 2026-05-10.
**Project:** cheersai-app
**Branch:** new feature branch (recommend `fix/instant-post-cleanup`); merge to main after CI green.
**Risk:** Low–Medium. Code-only, no DB migration. UI addition + lazy OpenAI init + new explicit banner override path.
**Approach:** Test-first (TDD). Tests for both bugs added in red phase first, then implementation.

---

## Phases

### Phase 1 — Tests (red phase, all six)

**Goal:** lock the contract before any implementation.

**Files:**
- `tests/lib/create/service.test.ts` (new or extended)
- `tests/api/generate-stream-route.test.ts` (new or extended — find existing tests for this route via `grep -r "generate-stream"`)
- existing tests untouched

**Test cases to add (all RED until Phase 2/3):**

1. **Bug A — `createInstantPost` writes explicit banner_enabled=false by default.** Mock the Supabase client. Call `createInstantPost(input)` with `input.banner` undefined or `{ enabled: false }`. Assert: the variant insert payload contains `banner_enabled: false` (NOT NULL, NOT undefined). Specifically check `banner_enabled === false`.

2. **Bug A — `createInstantPost` with banner enabled writes full appearance fields.** Call with `input.banner = { enabled: true, defaults: { position: "right", bgColour: "gold", textColour: "white" } }`. Assert variant insert payload has `banner_enabled: true, banner_position: "right", banner_bg: "#a57626", banner_text_colour: "#FFFFFF"`.

3. **Bug A — `createCampaignFromPlans` is unaffected for callers that don't pass the new `bannerOverride`.** Call `createCampaignFromPlans` with `bannerDefaults` undefined and `bannerOverride` undefined (mimics today's campaign caller). Assert variant insert payload has NO `banner_enabled` key (i.e. NULL in the DB → falls back to account default at publish time, exactly as today). This is the critical regression-protection test for the shared helper.

4. **Bug B — story-only POST emits `done` with contentItemIds, no OpenAI call.** Mock `getOpenAIClient` and `openai.responses.stream`. POST to the route handler with `placement: "story"`, one platform. Assert: (a) `getOpenAIClient` was NOT called, (b) `openai.responses.stream` was NOT called, (c) the SSE stream contains a `done` event with non-empty `contentItemIds`, (d) the variant row inserted has `body: ""`.

5. **Bug B — story request still succeeds when `getOpenAIClient` throws.** Mock `getOpenAIClient` to throw `new Error("Missing OPENAI_API_KEY")`. POST a story-only request. Assert: route still returns 200, SSE contains `done` with contentItemIds. This locks in the lazy-init guard.

6. **Bug B — feed-only POST behaves as today.** Mock OpenAI to return a fixture caption. POST with `placement: "feed"`, one platform. Assert: OpenAI WAS called, variant row has the fixture body, `done` event emitted with content IDs. Regression protection that we didn't break the feed path.

**Run:** `npx vitest run tests/lib/create tests/api/generate-stream-route` — expect 6 failures, all existing tests green.

**Commit:** `test(create): add instant-post banner + story-OpenAI regression cases (red)`

---

### Phase 2 — Schema + types (extend Zod)

**Goal:** make the new `banner` field accepted by both schemas before any consumer needs it.

**File:** `src/lib/create/schema.ts`

**Changes (around lines 54-176):**

Add to BOTH `instantPostSchema` (line 54) AND `instantPostFormSchema` (line 116) — define a shared `bannerInputSchema`:

```ts
import { BannerDefaultsSchema } from "@/lib/scheduling/banner-config";

const bannerInputSchema = z.object({
  enabled: z.boolean(),
  defaults: BannerDefaultsSchema.optional(),
}).optional();
```

Then add `banner: bannerInputSchema` to both schemas' `.object({...})` blocks. The existing `superRefine` blocks don't need changes (banner is optional and validated separately).

`InstantPostInput` type (line 481) auto-extends since it's `z.infer<typeof instantPostSchema>`.

**File:** `src/app/api/create/generate-stream/route.ts:96`

Where it builds the `input` for `instantPostSchema.parse({...})`, add:

```ts
banner: formValues.banner,
```

**Run unit tests** — schema tests should now pass; the rest still red.

**Commit:** `feat(create): accept optional banner override in instant-post schema`

---

### Phase 3 — Service-layer override (Bug A core)

**Goal:** `createInstantPost` writes explicit `banner_enabled` per the user's choice; `createCampaignFromPlans` accepts (but does not require) a new explicit override.

**File:** `src/lib/create/service.ts`

**Step 3a — new type, near line 56:**

Add a separate type for the new override path. Keep `BannerOverrideRow` exactly as it is (campaign callers depend on it).

```ts
/**
 * Per-variant banner override for the INSTANT-POST path only.
 *
 * Differs from BannerOverrideRow in that it ALWAYS includes an explicit
 * banner_enabled (true or false). This forces instant posts off the silent
 * "NULL means inherit account default" path that surprised users with
 * unwanted banners.
 *
 * Campaign callers continue to use BannerOverrideRow + computeBannerOverride
 * and inherit account defaults — unchanged behaviour.
 */
export type InstantBannerOverride = {
  banner_enabled: boolean;
  banner_position?: BannerDefaults["position"];
  banner_bg?: string;
  banner_text_colour?: string;
};

export function buildInstantBannerOverride(
  banner: { enabled: boolean; defaults?: BannerDefaults } | undefined,
): InstantBannerOverride {
  if (!banner || !banner.enabled) {
    return { banner_enabled: false };
  }
  const override: InstantBannerOverride = { banner_enabled: true };
  const d = banner.defaults;
  if (d) {
    override.banner_position = d.position;
    const bgHex = BANNER_COLOUR_HEX[d.bgColour];
    if (bgHex) override.banner_bg = bgHex;
    const textHex = BANNER_COLOUR_HEX[d.textColour];
    if (textHex) override.banner_text_colour = textHex;
  }
  return override;
}
```

**Step 3b — `createCampaignFromPlans`, around line 1368:**

Add `bannerOverride?: InstantBannerOverride` to the options parameter. Where the variant insert payload is built (around line 1438), spread it AFTER `bannerOverride from bannerDefaults` so it wins:

```ts
const sharedBannerFields = computeBannerOverride(bannerDefaults);

const variantPayloads = (insertedContent ?? []).map((content, index) => {
  const variant = variants[index];
  return {
    content_item_id: content.id,
    body: variant?.body ?? "",
    media_ids: variant?.mediaIds.length ? variant?.mediaIds : null,
    validation: variant?.validation ?? null,
    ...(sharedBannerFields ?? {}),
    ...(bannerOverride ?? {}),  // NEW — instant-only override wins
  };
});
```

**Step 3c — `createInstantPost`, around line 604-670:**

Build the `InstantBannerOverride` from `input.banner` and pass it through:

```ts
const bannerOverride = buildInstantBannerOverride(input.banner);

return createCampaignFromPlans(supabase, {
  // … existing fields …
  options: {
    autoSchedule: false,
    bannerOverride,  // NEW
  },
});
```

(Adjust the exact name of the options field to match the existing convention.)

**Run unit tests** — Bug A tests (1, 2, 3) should now pass. Bug B tests still red.

**Commit:** `fix(create): instant posts always write explicit banner_enabled`

---

### Phase 4 — Route-layer story branch (Bug B core)

**Goal:** story-only requests skip OpenAI entirely (including client init) and still emit `done` with contentItemIds.

**File:** `src/app/api/create/generate-stream/route.ts`

**Step 4a — lazy OpenAI client init.** Around line 111, do NOT call `getOpenAIClient()` at the top. Instead, declare a lazy getter:

```ts
let openaiClient: ReturnType<typeof getOpenAIClient> | undefined;
function ensureOpenAIClient() {
  if (!openaiClient) openaiClient = getOpenAIClient();
  return openaiClient;
}
```

(Or, simpler: just delete the top-level call and call `getOpenAIClient()` inline inside the feed branch where it's used.)

**Step 4b — story branch in the platform loop.** Around line 122-152:

```ts
for (const platform of input.platforms) {
  if (input.placement === "story") {
    // Stories don't use a caption — image is the post.
    // Emit a small UI message so the form can show "no caption needed".
    sendEvent({ type: "story_no_caption", platform });
    continue;
  }

  const openai = ensureOpenAIClient();  // or getOpenAIClient() inline
  const prompt = buildInstantPostPrompt({ ...input, platform });
  const responseStream = openai.responses.stream({ /* … as today … */ });
  // … existing streaming logic …
}
```

**Step 4c — final `done` event.** Around line 156, the existing `createInstantPost(input)` call MUST run for both story and feed flows. The existing `done` emission already happens after that call — verify it's outside the per-platform loop. Do not move it into the feed branch.

**Run unit tests** — Bug B tests (4, 5, 6) should now pass. Phase 1's full set should be 6/6 green.

**Commit:** `fix(create): skip OpenAI for story placements, lazy-init client`

---

### Phase 5 — Form UI (Bug A user-facing)

**Goal:** add the banner picker stage. Default OFF.

**File:** `src/features/create/instant-post-form.tsx`

**Step 5a — local state.** Add to the form's state model:

```ts
const [banner, setBanner] = useState<{ enabled: boolean; defaults?: BannerDefaults }>({ enabled: false });
```

**Step 5b — new stage between "Channels & timing" and "Generate & review".** Insert a stage labelled e.g. **"Banner"** (or similar). UI:

- Heading: "Banner overlay"
- Toggle: **"Add a banner overlay"** (off by default). Use the existing toggle component used elsewhere in the form for consistency.
- When ON, render `<BannerDefaultsPicker value={banner.defaults ?? DEFAULT_BANNER_DEFAULTS} onChange={(d) => setBanner({ enabled: true, defaults: d })} />`.
- When OFF, render nothing extra.
- "Continue" / "Back" buttons matching the rest of the form's stage navigation.

**Step 5c — story caption preview.** If the form currently shows a "preview caption" panel for stories, hide it conditionally:

```tsx
{input.placement !== "story" && <CaptionPreview ... />}
{input.placement === "story" && (
  <p className="text-sm text-muted-foreground">
    Stories don't need a caption — your image is the post.
  </p>
)}
```

(The exact placeholder element depends on what the form currently renders; locate via grep for the streaming preview consumer.)

**Step 5d — submit payload.** Where the form POSTs to `/api/create/generate-stream`, include `banner` in the body:

```ts
body: JSON.stringify({ ...formValues, banner }),
```

**Commit:** `feat(create): add banner overlay picker stage to instant post form`

---

### Phase 6 — Verify + clean up

1. Run full test suite: `CI=1 npx vitest run` — all green.
2. Run `npm run lint:ci` — zero warnings.
3. Run `npm run typecheck` — clean.
4. Run `npm run build` (with placeholder env vars per the proximity-fix pattern) — successful build.
5. **Smoke test (manual, in dev):**
   - Open instant-post form → confirm "Add a banner overlay" toggle is OFF by default.
   - Submit a story without enabling banner → posts publish to FB & IG with NO overlay.
   - Submit a story with banner enabled (e.g. position=right, bgColour=gold) → posts publish WITH overlay using chosen colours.
   - Submit a feed post without enabling banner → caption is generated, no overlay.
   - Watch `/api/create/generate-stream` route logs (or OpenAI usage dashboard) → zero OpenAI calls during a story-only submission.
6. Push branch + open PR.

---

## Acceptance Summary

A reviewer should sign off when ALL of:

- [ ] All 6 new tests in Phase 1 pass
- [ ] All previously-existing tests still pass
- [ ] `lint:ci`, `typecheck`, `test:ci`, `build` all green
- [ ] Manual smoke confirms no banner without opt-in, no OpenAI calls for stories
- [ ] No code outside the listed files is touched
- [ ] `createCampaignFromPlans` behaviour for existing campaign callers is provably unchanged (Phase 1 test #3)

## Files Touched (final list)

1. `src/lib/create/schema.ts` — add `banner` to both Zod schemas
2. `src/lib/create/service.ts` — new `InstantBannerOverride` type + `buildInstantBannerOverride` helper; `createCampaignFromPlans` accepts new optional `bannerOverride` param; `createInstantPost` builds and passes it
3. `src/app/api/create/generate-stream/route.ts` — lazy OpenAI init; story branch in platform loop; ensure `done` event still emits for stories; forward `banner` from formValues to `createInstantPost`
4. `src/features/create/instant-post-form.tsx` — new banner stage with toggle + `BannerDefaultsPicker`; conditional story caption-preview message; banner in submit payload
5. `tests/lib/create/service.test.ts` — Bug A tests (3 cases)
6. `tests/api/generate-stream-route.test.ts` — Bug B tests (3 cases)

Total: 4 source files + 2 test files. Estimated diff: ~300–450 lines.

## What This Plan Deliberately Does NOT Touch

- `src/lib/ai/prompts.ts` — no defensive guard. Skip the call site instead. (Codex review confirmed this is cleaner than breaking the function's return type.)
- `BannerDefaultsPicker` — used as-is. No new text-override input. Users edit override text via planner banner-controls if needed.
- Account-level `posting_defaults.banners_enabled` default — still `true`. Out of scope (separate ticket if you want).
- Any campaign creation flow — provably untouched (Phase 1 test #3 is the regression guard).
- DB migrations — none.

## Failure Modes To Watch For

- **Phase 3 succeeds but Phase 5 lags** → service writes correct data but form doesn't send `banner` → variant always gets `banner_enabled: false`. Mitigated by Phase 1 test #2 failing in CI until Phase 5 lands.
- **Lazy OpenAI init misplaced** → some unrelated codepath still calls `getOpenAIClient()` at module load → story-only request still fails when credentials missing. Phase 1 test #5 (mock `getOpenAIClient` to throw) is the guard.
- **`done` event accidentally moved into feed branch** → story flow completes server-side but UI never updates. Phase 1 test #4 asserts `done` is emitted for stories.
- **Zod `.passthrough()` vs strict mode** → if either schema is implicitly `strict()`, the new `banner` field gets stripped at parse. Phase 2 fixes this by adding the field; if Phase 2 misses one of the two schemas, Phase 1 tests would still fail intermittently. Belt-and-braces: explicitly add to BOTH schemas.

## Commits (6 total)

1. `test(create): add instant-post banner + story-OpenAI regression cases (red)` — Phase 1
2. `feat(create): accept optional banner override in instant-post schema` — Phase 2
3. `fix(create): instant posts always write explicit banner_enabled` — Phase 3
4. `fix(create): skip OpenAI for story placements, lazy-init client` — Phase 4
5. `feat(create): add banner overlay picker stage to instant post form` — Phase 5
6. (No code commit for Phase 6 — verification + smoke only.)
