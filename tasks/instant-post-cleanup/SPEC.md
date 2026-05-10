# Instant-post cleanup — discovery + spec

**Date:** 2026-05-10
**Severity:** High — silent customer-facing UX (unwanted banner) + ongoing OpenAI cost waste
**Affects:** All instant-post creations and any story-placement creation
**Owner:** TBD

Two related bugs in the post-creation flow, fixed together because they share files and the same review/test cycle.

---

## Bug A — Instant posts get a banner overlay without ever asking the user

### Reproducible

Create an instant post (image, "publish now"), choosing Feed and Story placements. Submit. Both posts publish to Facebook/Instagram with a banner overlay reading e.g. `TODAY`. The creation form never asked anything about banners.

### Root cause

Pure silent default. Trace:

1. `src/features/create/instant-post-form.tsx` (lines 71–735) has no banner UI at all — title, placement, channels/timing, media, generate. Nothing about banners.
2. `src/app/api/create/generate-stream/route.ts:156` calls `createInstantPost(input)` with no banner config.
3. `src/lib/create/service.ts:665` passes `autoSchedule: false`, no `bannerDefaults`.
4. `createCampaignFromPlans` (service.ts:1341–1482) → at line 1398–1401 calls `computeBannerOverride(bannerDefaults)`. Since `bannerDefaults` is `undefined`, `bannerOverride` is `null`.
5. Variant insert at line 1438 spreads `(bannerOverride ?? {})`, so `banner_enabled`, `banner_position`, `banner_bg`, `banner_text_colour`, `banner_text_override` are all left **NULL** in `content_variants`.
6. At publish time, [`worker.ts:194-209`](supabase/functions/publish-queue/worker.ts:194) resolves NULL via `bannerConfigResolver`: `enabled: postOverrides.banner_enabled ?? accountDefaults.banners_enabled`. The account default from `posting_defaults.banners_enabled` is **`true`** (per migration `20260507100000_banner_overlay_add_columns.sql`).
7. Banner gets rendered with a computed proximity label.

In short: **NULL on the variant means "use the account default"**, and the account default is `true`. The instant-post flow has no way to express "I don't want a banner" because it never asks.

For comparison, the **campaign** flows (event/promotion/weekly) DO ask via [`BannerDefaultsPicker`](src/features/create/banner-defaults-picker.tsx), and the user's choice flows through `bannerDefaults` to `computeBannerOverride`. Instant posts are the only public creation path that lacks this UI.

---

## Bug B — Story placements waste OpenAI calls generating body text that's never used

### Reproducible

Create any post with `placement = "story"` (instant or campaign). The streaming preview at `/api/create/generate-stream` calls `gpt-4.1-mini` once per platform to generate caption text. The text is streamed to the UI, then on submission discarded — story content_variants are persisted with `body = ""`. At publish time, the worker passes empty body to the providers ([`worker.ts:639`](supabase/functions/publish-queue/worker.ts:639)) and the providers omit caption entirely for stories ([`instagram.ts:37`](supabase/functions/publish-queue/providers/instagram.ts:37); facebook story flow uploads photo then publishes via `/photo_stories` with no caption).

Stories are image-only on both platforms. The caption is genuinely never seen.

### Root cause

The streaming preview at `src/app/api/create/generate-stream/route.ts:122-152` loops over every platform and calls `openai.responses.stream()` regardless of `input.placement`. The prompt builder `buildInstantPostPrompt` in `src/lib/ai/prompts.ts:31-79` has no placement check either — it generates the same caption-writing prompt for stories and feed posts.

The non-streaming path in `service.ts:1537-1583` does correctly skip generation for story plans (returns early with `body: ""`), so the waste is exclusively in the **streaming preview** path.

### Cost estimate

`gpt-4.1-mini` at ~$0.15/M input tokens, ~$0.60/M output tokens. ~400-600 tokens per call. Per story preview: roughly **$0.0003** (3 hundredths of a cent). At 10 active accounts × 3 story posts/week × 2 platforms = ~3,000 calls/year × $0.0003 = **~$1/year**. Not a cost issue at this scale; the real motivation is eliminating a code path that does work that's discarded — that's an engineering smell worth fixing alongside Bug A. (Earlier draft of this spec quoted ~$300/year by getting the per-call cost wrong by 3 orders of magnitude — corrected here.)

---

## Surfaces affected

| Surface | Bug A | Bug B |
|---------|:-----:|:-----:|
| `src/features/create/instant-post-form.tsx` | yes (add picker UI) | no |
| `src/app/api/create/generate-stream/route.ts` | yes (accept new input field) | yes (skip OpenAI for story platforms) |
| `src/lib/create/service.ts` | yes (thread bannerDefaults from form to createInstantPost) | no (already correct — story plans skip generation) |
| `src/lib/create/types.ts` (or wherever `InstantPostInput` lives) | yes (add `bannerDefaults?` field) | no |
| `src/lib/ai/prompts.ts` | no | optional (defensive guard) |

---

## The fix

### Bug A — add a banner picker to the instant post form, default OFF

1. **Form UI**: insert a "Banner overlay" stage between "Channels & timing" and "Generate & review". UI element:
   - A single primary toggle: **"Add a banner overlay" (off by default)**
   - When ON, expand to show the existing [`BannerDefaultsPicker`](src/features/create/banner-defaults-picker.tsx) (position + bg colour + text colour). The picker as it stands does NOT include a text override input — that's fine; users who want custom banner text can use the planner's banner-controls after creation.
   - When OFF (default), no further fields.
2. **Form state shape**: extend the form's local state with `banner: { enabled: boolean; defaults?: BannerDefaults }`. (No `textOverride` here — out of scope for this change.) Submit it as part of the form payload.
3. **Zod schemas**: update BOTH `instantPostFormSchema` (the form-side schema) AND `instantPostSchema` (the route-side, used by the API) to accept the new `banner` object. Without updating both, Zod will strip the field at the boundary and the user's choice is silently lost. Ref: [`src/app/api/create/generate-stream/route.ts:80, 96`](src/app/api/create/generate-stream/route.ts:80).
4. **API route**: forward `input.banner` to `createInstantPost`.
5. **Service-layer change — instant-only override, NOT a shared helper change.** The previous draft said "change `createCampaignFromPlans` so undefined `bannerDefaults` writes false". That would silently break campaign callers that omit `bannerDefaults` (they'd lose account-default inheritance). Instead:
   - `createInstantPost` is the only function that needs new behaviour. It computes a `BannerOverride` object that ALWAYS includes an explicit `banner_enabled` (true or false, never NULL).
   - When the user opted in, the override carries position + bg + text colour from their picker choice.
   - When the user opted out (default), the override is `{ banner_enabled: false }` and no other fields are set.
   - This override is passed to `createCampaignFromPlans` via a new explicit parameter — call it `bannerOverride: PerVariantBannerOverride | undefined` (separate from `bannerDefaults`). The shared helper's existing behaviour for `bannerDefaults = undefined` (campaigns inherit account defaults) is **preserved**, so campaign flows are genuinely untouched.

The account-level `posting_defaults.banners_enabled` stays as it is — still the correct silent default for **campaign-generated** posts where the user has been asked via `BannerDefaultsPicker`. We are only fixing the instant-post path. (See §"Out of scope" for the broader architectural change.)

### Bug B — skip OpenAI generation for story placements in the streaming preview

1. **Lazy OpenAI client init.** Currently [`route.ts:111`](src/app/api/create/generate-stream/route.ts:111) calls `getOpenAIClient()` BEFORE the platform loop. If OpenAI credentials are missing or the client throws, story-only requests fail even though no OpenAI call is needed. Move `getOpenAIClient()` inside the feed-only branch so a story-only submission never touches the OpenAI client at all.
2. **Story branch in the platform loop.** When `input.placement === "story"`:
   - Do NOT call `buildInstantPostPrompt` — skip the prompt builder entirely. (The previous draft suggested making `buildInstantPostPrompt` "return empty string" but that breaks its `PromptMessages = { system, user }` type contract. Cleanest: don't call it for stories.)
   - Do NOT call `openai.responses.stream()`.
   - Optionally emit a single SSE event the UI can recognise as "no caption needed for stories" (event type `"story_no_caption"` with no payload), so the client can render a small message.
3. **SSE contract — must still emit `done` event for stories.** The form at [`instant-post-form.tsx:249`](src/features/create/instant-post-form.tsx:249) only sets the result on `event.type === "done" && event.contentItemIds?.length`. The route MUST still call `createInstantPost(input)` and emit a final `done` event with `contentItemIds` for story submissions, exactly as it does for feed submissions today. Otherwise the user sees no review items even though drafts have been created. Specifically: route must emit, in order, `[story_no_caption]` (optional) → `done({ contentItemIds })`.
4. **Form UI**: confirm the form doesn't render a "preview caption" panel for stories. If it does, hide that panel when `placement === "story"`. (Quick read of the form should confirm; if there is one, a small CSS/conditional render change covers it.)

The campaign-side `buildVariants` already handles stories correctly (early return at [`service.ts:1556`](src/lib/create/service.ts:1556) sets `body: ""`) so no service-layer change for Bug B.

---

## Files to change (final list)

1. `src/features/create/instant-post-form.tsx` — add banner stage + state field; conditionally hide caption-preview panel when placement=story.
2. `src/lib/create/types.ts` (or wherever `InstantPostInput` and the Zod schemas live) — add `banner?: { enabled: boolean; defaults?: BannerDefaults }` field to **both** `instantPostFormSchema` AND `instantPostSchema`.
3. `src/app/api/create/generate-stream/route.ts` — (a) move `getOpenAIClient()` inside the feed-only branch (lazy init); (b) skip `buildInstantPostPrompt` and `openai.responses.stream()` when placement=story; (c) optional SSE event `story_no_caption`; (d) **always emit final `done` event with `contentItemIds`** regardless of placement; (e) accept and forward the new `banner` input.
4. `src/lib/create/service.ts` — add a new `bannerOverride?: PerVariantBannerOverride` parameter to `createCampaignFromPlans` (separate from existing `bannerDefaults`). When provided, it carries explicit `banner_enabled` and (if enabled) the colour/position fields. Spread it into the variant insert payload AFTER `bannerOverride from bannerDefaults` so it wins. `createInstantPost` builds this override from `input.banner` (defaulting to `{ banner_enabled: false }` when input.banner is undefined or `enabled: false`) and passes it through. **No changes to `createCampaignFromPlans`'s existing behaviour for callers that don't pass `bannerOverride` — campaigns continue to work as today.**
5. `src/lib/ai/prompts.ts` — no change. (Earlier draft proposed a "return empty for story" guard; reviewers correctly noted this would break the `PromptMessages` return type. Cleaner to skip the call from the route, which §"Bug B" already specifies.)
6. Tests (see below).

Estimated diff: ~250–400 lines across 4 source files + new tests.

---

## Test plan

### Unit
- `tests/lib/create/service.test.ts` (or new file): `createInstantPost` with `banner.enabled = false` writes `banner_enabled: false` (NOT NULL) to content_variants; with `banner.enabled = true` writes `banner_enabled: true` plus the chosen position/colours.
- `tests/api/generate-stream-route.test.ts` (or similar): POST with placement=story and one platform → (a) no `openai.*` mock call is made, (b) `getOpenAIClient` is NOT called either (lazy-init guard), (c) the SSE stream emits `done` with `contentItemIds`, (d) saved variant has `body: ""`.
- **Critical regression test:** mock `getOpenAIClient` to throw; submit a story-only request; assert it still succeeds and returns `done` with content IDs. This locks in the lazy-init guard from Bug B.
- **Critical regression test for Bug A:** submit a story with `banner.enabled = true`; assert variant has `banner_enabled: true, banner_position, banner_bg, banner_text_colour` matching the picker payload.
- **Critical regression test for the shared helper:** call `createCampaignFromPlans` (campaign path) without `bannerOverride`; assert variants get NULL banner fields exactly as today (i.e. the change is genuinely instant-only and campaigns are not affected).
- Existing tests must remain green.

### Integration
- Mock OpenAI; create an instant story post via the API route with `banner.enabled = false`; assert: zero OpenAI calls, content_variants row has `banner_enabled = false` and `body = ""`, route emits `done` with content IDs.
- Create an instant story post with `banner.enabled = true, defaults: { position: "right", bgColour: "gold", textColour: "white" }`. Assert: zero OpenAI calls, content_variants has `banner_enabled = true, banner_position = "right", banner_bg = "#a57626", banner_text_colour = "#FFFFFF"`.
- Create an instant **feed** post with `banner.enabled = false`. Assert: OpenAI IS called (feed needs caption); content_variants has `banner_enabled = false`.

### Manual smoke (after deploy)
- Open instant-post form → confirm "Add a banner overlay" toggle is OFF by default.
- Submit a story without enabling banner → posts publish to Instagram and Facebook with NO overlay.
- Submit a story with banner enabled → posts publish WITH overlay using chosen colours.
- Submit a feed post without enabling banner → caption is generated, no overlay applied.
- Watch the **`/api/create/generate-stream` route logs** (or the OpenAI usage dashboard for the time window) to confirm zero OpenAI calls during a story-only submission. (The waste is in the create API route, not in publish-queue — earlier draft of this spec misstated where to look.)

---

## Rollout & risk

- **Reversible:** yes, code-only. No DB migration. No data backfill.
- **Existing scheduled content:** unaffected. Banner fields on existing variants stay as they are. The fix only changes how *new* instant posts are written.
- **Existing campaign flows:** untouched. The `BannerDefaultsPicker` and `createCampaignFromPlans` paths work as today; the only change inside `createCampaignFromPlans` is that when `bannerDefaults` is undefined (instant-post path) the variant gets `banner_enabled: false` instead of NULL. Campaign callers always pass `bannerDefaults`, so they are unaffected.
- **Risk of regression:**
  - Low for Bug A — UI addition + one explicit DB column write.
  - Very low for Bug B — adding a placement guard before an existing call.
- **Cost reduction visible immediately** in OpenAI usage dashboard once deployed.

---

## Out of scope (separate tickets)

1. **Globally remove the silent-default-ON behaviour.** The bigger architectural fix would change the resolver so `NULL` means "no banner" (not "use account default"), and add an explicit `banner_enabled = true/false` to every variant on creation across every flow (campaigns, materialised weeklies, anything else). Migration to backfill existing NULLs. Worth doing eventually; not in scope for this fix because (a) we'd need to audit every creation path, (b) we'd need a migration, (c) the fix here addresses the user-reported case without touching working flows.
2. **Account-level posting_defaults UI** — should the user be able to flip the account-wide default for `banners_enabled` to false? Probably already exists in settings; not investigated.
3. **Other AI cost audits** — there may be other prompt paths generating text that's discarded (e.g. preview regenerations on the planner). Worth a sweep in a separate ticket if cost matters.
4. **Banner preview in instant-post form** — could show a live preview of how the overlay would look on the chosen image. Nice-to-have, not required for this fix.

---

## Decisions (resolved with my recommendations)

These were open during discovery; my recommendations are inline so we can move forward — flag any you disagree with before I plan it.

1. **Banner picker default state for instant posts: OFF.** The user just complained about a silent ON; the conservative fix is to make the safe choice silent and the dangerous choice explicit. Campaign flows can keep their existing default.
2. **Where to put the banner picker in the form:** as its own stage between "Channels & timing" and "Generate & review", so the user has to consciously click past it. Inline with channels would risk being missed.
3. **Story body field on the variant: keep storing `""`.** Don't migrate to NULL — the column is NOT NULL in some setups and changing the contract is more risk than reward. Empty string is fine.
4. **Streaming preview UX for stories:** when the user is on the story tab and clicks generate, show a small UI message "stories don't need a caption — your image is the post" and skip the OpenAI call entirely. No streamed text, no spinner.
5. **`buildInstantPostPrompt` for story:** return empty string. Don't throw — empty string is a clearer "nothing to generate" signal and avoids a try/catch in callers.

---

## Open questions for the user — RESOLVED

All five open decisions confirmed by Peter on 2026-05-10:

1. Banner default for instant posts: **OFF**.
2. Banner picker placement: **its own form stage**, between channels & timing and generate.
3. Toggle label: **"Add a banner overlay"**.
4. Story preview UX: **show "Stories don't need a caption — your image is the post" message, skip OpenAI entirely**.
5. Account-level `banners_enabled` default: **leave at `true`** (out of scope for this fix).

## Codex adversarial review record

This spec was reviewed on 2026-05-10 by three Codex specialist agents (Assumption Breaker, Workflow & Failure-Path, Integration & Architecture). Six blocking findings, all addressed in this revision:

| Finding | Reviewers | Where addressed |
|---------|-----------|-----------------|
| AB-001 / WF-005 / ARCH-001: changing the shared `createCampaignFromPlans` helper would silently break campaign callers that omit `bannerDefaults` | All three | §"Bug A — fix" point 5 + §"Files to change" item 4 — now uses an explicit instant-only `bannerOverride` param; shared helper's existing behaviour preserved |
| AB-002 / WF-001: closing the SSE stream "gracefully" without a `done` event leaves the form stuck | AB + WF | §"Bug B — fix" point 3 + §"Test plan — Unit" — route MUST emit `done({contentItemIds})` for stories too |
| AB-003 / WF-002: `getOpenAIClient()` is called BEFORE the platform loop, so story-only requests fail without OpenAI credentials | AB + WF | §"Bug B — fix" point 1 + new regression test — lazy-init guard required |
| AB-004 / WF-003: `buildInstantPostPrompt` returning empty string breaks its `PromptMessages` return type | AB + WF | §"Bug B — fix" point 2 + §"Files to change" item 5 — don't call it for stories at all (instead of returning empty) |
| WF-004: Zod schemas would strip the new `banner` field if not updated | WF | §"Bug A — fix" point 3 + §"Files to change" item 2 — both `instantPostFormSchema` AND `instantPostSchema` must be updated |
| AB-005 / ARCH-002: `BannerDefaultsPicker` has no text-override input; spec assumed it did | AB + ARCH | §"Bug A — fix" point 1 — text override dropped from this spec; users edit via planner banner-controls if needed |

Two non-blocking corrections applied:

- **AB-006**: cost estimate corrected from ~$300/year to ~$1/year (3 orders of magnitude error in original — see §"Cost estimate"). Engineering motivation stays — eliminating discarded work.
- **AB-007**: smoke test wording corrected (watch `/api/create/generate-stream` route logs / OpenAI dashboard, not publish-queue).

One out-of-scope flag preserved:

- **WF-006**: double-submit / aborted-request idempotency. Pre-existing limitation, not caused by this change. Tracked separately if you want a follow-up ticket.

Full review at [tasks/codex-qa-review/2026-05-10-instant-post-cleanup-*](tasks/codex-qa-review/).
