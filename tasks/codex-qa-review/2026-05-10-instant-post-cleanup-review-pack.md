# Review Pack: instant-post-cleanup

**Generated:** 2026-05-10
**Mode:** A (A=Adversarial / B=Code / C=Spec Compliance)
**Project root:** `/Users/peterpitcher/Cursor/OJ-CheersAI2.0`
**Base ref:** `HEAD`
**HEAD:** `252e696`
**Diff range:** `HEAD`

> This pack is the sole input for reviewers. Do NOT read files outside it unless a specific finding requires verification. If a file not in the pack is needed, mark the finding `Needs verification` and describe what would resolve it.

## Changed Files

```
tasks/instant-post-cleanup/SPEC.md
```

## User Concerns

Reviewing a SPEC for two related fixes in the post-creation flow: (Bug A) instant posts get banners silently because the form has no banner picker; (Bug B) story placements waste OpenAI calls generating captions that are never used. No code change exists yet — review the SPEC's proposed approach against the appended source files. The current source files are appended below the auto-generated pack.

## Spec

Source: `/Users/peterpitcher/Cursor/OJ-CheersAI2.0/tasks/instant-post-cleanup/SPEC.md`

```markdown
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

`gpt-4.1-mini` at ~$0.15/M input tokens, ~$0.60/M output tokens. ~400-600 tokens per call. Per story preview: ~$0.10. At 10 active accounts × 3 story posts/week × 2 platforms = ~$300/year of pure waste. Not catastrophic, but trivial to eliminate.

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

1. **Form UI**: insert a "Banner overlay" stage between "Channels & timing" and "Generate & review" (or expand the existing channels stage). UI element:
   - A single primary toggle: **"Add a banner overlay" (off by default)**
   - When ON, expand to show the existing [`BannerDefaultsPicker`](src/features/create/banner-defaults-picker.tsx) (position + bg colour + text colour + optional text override input)
   - When OFF (default), no further fields
2. **Form state shape**: extend the form's local state with `banner: { enabled: boolean; defaults?: BannerDefaults; textOverride?: string }`. Submit it as part of the form payload.
3. **API route**: accept a new optional `banner` field on `/api/create/generate-stream` input. Forward it to `createInstantPost`.
4. **`createInstantPost`/`createCampaignFromPlans`**: instead of leaving banner fields NULL when no UI was provided, **always set `banner_enabled` explicitly** — `true` if user opted in, `false` otherwise. Other banner fields only set when enabled. This eliminates the NULL → silent-default-ON path for instant posts specifically.

The account-level `posting_defaults.banners_enabled` stays as it is — it's still the correct silent default for **campaign-generated** posts where the user has been asked via `BannerDefaultsPicker` and accepted defaults. We are only fixing the instant-post path here. (See §"Out of scope" for the broader architectural change.)

### Bug B — skip OpenAI generation for story placements in the streaming preview

1. In `route.ts:122-152`, before the OpenAI call, branch on `input.placement === "story"`:
   - Skip the OpenAI call entirely
   - Stream a synthetic event to the client indicating "no caption needed for stories" (or just close the stream gracefully — depends what the UI expects)
2. `buildInstantPostPrompt` in `prompts.ts`: add a defensive guard that returns an empty string or throws if called with placement=story. Belt-and-braces in case any other caller exists.
3. Verify the form UI doesn't try to display a "preview caption" for stories. If it does, hide that section when placement=story.

The campaign-side `buildVariants` already handles this correctly (early return at service.ts:1556) so no change there.

---

## Files to change (final list)

1. `src/features/create/instant-post-form.tsx` — add banner stage + state field
2. `src/lib/create/types.ts` (or wherever `InstantPostInput` is defined) — add `banner?` field to input schema
3. `src/app/api/create/generate-stream/route.ts` — (a) skip OpenAI when placement=story; (b) accept and forward the new `banner` input
4. `src/lib/create/service.ts` — `createInstantPost` and `createCampaignFromPlans` always set `banner_enabled` explicitly; thread `bannerDefaults` through from input
5. `src/lib/ai/prompts.ts` — defensive guard, return empty for story placement
6. Tests (see below)

Estimated diff: ~250–400 lines across 5 source files + new tests.

---

## Test plan

### Unit
- `tests/lib/create/service.test.ts` (or new file): `createInstantPost` with `banner.enabled = false` writes `banner_enabled: false` (NOT NULL) to content_variants; with `banner.enabled = true` writes `banner_enabled: true` plus the chosen position/colours.
- `tests/api/generate-stream-route.test.ts` (or similar): POST with placement=story and one platform → no `openai.*` mock call is made; route still returns success; saved variant has `body: ""`.
- `tests/lib/ai/prompts.test.ts`: `buildInstantPostPrompt({ placement: "story", … })` returns empty string (or throws — pick one).
- Existing tests must remain green.

### Integration
- Mock OpenAI; create an instant story post via the API route; assert: zero OpenAI calls, content_variants row has `banner_enabled = false` and `body = ""`.
- Create an instant story post with `banner.enabled = true, defaults: { position: "right", bgColour: "gold", textColour: "white" }`. Assert: zero OpenAI calls, content_variants has `banner_enabled = true, banner_position = "right", banner_bg = "#a57626", banner_text_colour = "#FFFFFF"`.
- Create an instant **feed** post with `banner.enabled = false`. Assert: OpenAI IS called (feed needs caption); content_variants has `banner_enabled = false`.

### Manual smoke (after deploy)
- Open instant-post form → confirm "Add a banner overlay" toggle is OFF by default.
- Submit a story without enabling banner → posts publish to Instagram and Facebook with NO overlay.
- Submit a story with banner enabled → posts publish WITH overlay using chosen colours.
- Submit a feed post without enabling banner → caption is generated, no overlay applied.
- Watch publish-queue logs to confirm zero OpenAI calls during a story-only submission.

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

## Open questions for the user

Two genuinely undecided choices I'd like sign-off on:

1. **What should the banner toggle be labelled?** Options: "Add a banner overlay" / "Show banner over image" / "Apply branded banner" / something else. My recommendation: **"Add a banner overlay"** — matches the existing `BannerDefaultsPicker` heading and is plain English. If you have a preferred phrasing, say so.

2. **Should we also fix the account-level default `banners_enabled` to `false`?** Today, new accounts start with `posting_defaults.banners_enabled = true`. With this fix, instant posts are explicit, but campaign posts still inherit the account default when the user accepts `BannerDefaultsPicker` defaults without changing anything. My recommendation: **leave the account default at `true`**. Reason: the campaign user has been asked (by clicking through `BannerDefaultsPicker`); accepting defaults is an implicit choice. Only the instant-post path was unasked. Changing the account default also affects existing accounts in surprising ways. Out of scope for this fix.

If you have no strong view, my defaults are: "Add a banner overlay" + leave account default alone.
```

## Diff (`HEAD`)

_(no diff output)_

## Changed File Contents

### `tasks/instant-post-cleanup/SPEC.md`

```
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

`gpt-4.1-mini` at ~$0.15/M input tokens, ~$0.60/M output tokens. ~400-600 tokens per call. Per story preview: ~$0.10. At 10 active accounts × 3 story posts/week × 2 platforms = ~$300/year of pure waste. Not catastrophic, but trivial to eliminate.

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

1. **Form UI**: insert a "Banner overlay" stage between "Channels & timing" and "Generate & review" (or expand the existing channels stage). UI element:
   - A single primary toggle: **"Add a banner overlay" (off by default)**
   - When ON, expand to show the existing [`BannerDefaultsPicker`](src/features/create/banner-defaults-picker.tsx) (position + bg colour + text colour + optional text override input)
   - When OFF (default), no further fields
2. **Form state shape**: extend the form's local state with `banner: { enabled: boolean; defaults?: BannerDefaults; textOverride?: string }`. Submit it as part of the form payload.
3. **API route**: accept a new optional `banner` field on `/api/create/generate-stream` input. Forward it to `createInstantPost`.
4. **`createInstantPost`/`createCampaignFromPlans`**: instead of leaving banner fields NULL when no UI was provided, **always set `banner_enabled` explicitly** — `true` if user opted in, `false` otherwise. Other banner fields only set when enabled. This eliminates the NULL → silent-default-ON path for instant posts specifically.

The account-level `posting_defaults.banners_enabled` stays as it is — it's still the correct silent default for **campaign-generated** posts where the user has been asked via `BannerDefaultsPicker` and accepted defaults. We are only fixing the instant-post path here. (See §"Out of scope" for the broader architectural change.)

### Bug B — skip OpenAI generation for story placements in the streaming preview

1. In `route.ts:122-152`, before the OpenAI call, branch on `input.placement === "story"`:
   - Skip the OpenAI call entirely
   - Stream a synthetic event to the client indicating "no caption needed for stories" (or just close the stream gracefully — depends what the UI expects)
2. `buildInstantPostPrompt` in `prompts.ts`: add a defensive guard that returns an empty string or throws if called with placement=story. Belt-and-braces in case any other caller exists.
3. Verify the form UI doesn't try to display a "preview caption" for stories. If it does, hide that section when placement=story.

The campaign-side `buildVariants` already handles this correctly (early return at service.ts:1556) so no change there.

---

## Files to change (final list)

1. `src/features/create/instant-post-form.tsx` — add banner stage + state field
2. `src/lib/create/types.ts` (or wherever `InstantPostInput` is defined) — add `banner?` field to input schema
3. `src/app/api/create/generate-stream/route.ts` — (a) skip OpenAI when placement=story; (b) accept and forward the new `banner` input
4. `src/lib/create/service.ts` — `createInstantPost` and `createCampaignFromPlans` always set `banner_enabled` explicitly; thread `bannerDefaults` through from input
5. `src/lib/ai/prompts.ts` — defensive guard, return empty for story placement
6. Tests (see below)

Estimated diff: ~250–400 lines across 5 source files + new tests.

---

## Test plan

### Unit
- `tests/lib/create/service.test.ts` (or new file): `createInstantPost` with `banner.enabled = false` writes `banner_enabled: false` (NOT NULL) to content_variants; with `banner.enabled = true` writes `banner_enabled: true` plus the chosen position/colours.
- `tests/api/generate-stream-route.test.ts` (or similar): POST with placement=story and one platform → no `openai.*` mock call is made; route still returns success; saved variant has `body: ""`.
- `tests/lib/ai/prompts.test.ts`: `buildInstantPostPrompt({ placement: "story", … })` returns empty string (or throws — pick one).
- Existing tests must remain green.

### Integration
- Mock OpenAI; create an instant story post via the API route; assert: zero OpenAI calls, content_variants row has `banner_enabled = false` and `body = ""`.
- Create an instant story post with `banner.enabled = true, defaults: { position: "right", bgColour: "gold", textColour: "white" }`. Assert: zero OpenAI calls, content_variants has `banner_enabled = true, banner_position = "right", banner_bg = "#a57626", banner_text_colour = "#FFFFFF"`.
- Create an instant **feed** post with `banner.enabled = false`. Assert: OpenAI IS called (feed needs caption); content_variants has `banner_enabled = false`.

### Manual smoke (after deploy)
- Open instant-post form → confirm "Add a banner overlay" toggle is OFF by default.
- Submit a story without enabling banner → posts publish to Instagram and Facebook with NO overlay.
- Submit a story with banner enabled → posts publish WITH overlay using chosen colours.
- Submit a feed post without enabling banner → caption is generated, no overlay applied.
- Watch publish-queue logs to confirm zero OpenAI calls during a story-only submission.

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

## Open questions for the user

Two genuinely undecided choices I'd like sign-off on:

1. **What should the banner toggle be labelled?** Options: "Add a banner overlay" / "Show banner over image" / "Apply branded banner" / something else. My recommendation: **"Add a banner overlay"** — matches the existing `BannerDefaultsPicker` heading and is plain English. If you have a preferred phrasing, say so.

2. **Should we also fix the account-level default `banners_enabled` to `false`?** Today, new accounts start with `posting_defaults.banners_enabled = true`. With this fix, instant posts are explicit, but campaign posts still inherit the account default when the user accepts `BannerDefaultsPicker` defaults without changing anything. My recommendation: **leave the account default at `true`**. Reason: the campaign user has been asked (by clicking through `BannerDefaultsPicker`); accepting defaults is an implicit choice. Only the instant-post path was unasked. Changing the account default also affects existing accounts in surprising ways. Out of scope for this fix.

If you have no strong view, my defaults are: "Add a banner overlay" + leave account default alone.
```

## Related Files (grep hints)

These files reference the basenames of changed files. They are hints for verification — not included inline. Read them only if a specific finding requires it.

```
tasks/banner-orchestration/proximity-week-fix/PLAN.md
tasks/codex-qa-review/2026-05-09-proximity-label-week-fix-adversarial-review.md
tasks/codex-qa-review/2026-05-09-proximity-label-week-fix-claude-handoff.md
tasks/codex-qa-review/2026-05-09-proximity-label-week-fix-impl-review-pack.md
tasks/codex-qa-review/2026-05-09-proximity-label-week-fix-review-pack.md
```

## Workspace Conventions (`Cursor/CLAUDE.md`)

```markdown
# CLAUDE.md — Workspace Standards

Shared guidance for Claude Code across all projects. Project-level `CLAUDE.md` files take precedence over this one — always read them first.

## Default Stack

Next.js 15 App Router, React 19, TypeScript (strict), Tailwind CSS, Supabase (PostgreSQL + Auth + RLS), deployed on Vercel.

## Workspace Architecture

21 projects across three brands, plus shared tooling:

| Prefix | Brand | Examples |
|--------|-------|----------|
| `OJ-` | Orange Jelly | AnchorManagementTools, CheersAI2.0, Planner2.0, MusicBingo, CashBingo, QuizNight, The-Anchor.pub, DukesHeadLeatherhead.com, OrangeJelly.co.uk, WhatsAppVideoCreator |
| `GMI-` | GMI | MixerAI2.0 (canonical auth reference), TheCookbook, ThePantry |
| `BARONS-` | Barons | CareerHub, EventHub, BrunchLaunchAtTheStar, StPatricksDay, DigitalExperienceMockUp, WebsiteContent |
| (none) | Shared / test | Test, oj-planner-app |

## Core Principles

**How to think:**
- **Simplicity First** — make every change as simple as possible; minimal code impact
- **No Laziness** — find root causes; no temporary fixes; senior developer standards
- **Minimal Impact** — only touch what's necessary; avoid introducing bugs

**How to act:**
1. **Do ONLY what is asked** — no unsolicited improvements
2. **Ask ONE clarifying question maximum** — if unclear, proceed with safest minimal implementation
3. **Record EVERY assumption** — document in PR/commit messages
4. **One concern per changeset** — if a second concern emerges, park it
5. **Fail safely** — when in doubt, stop and request human approval

### Source of Truth Hierarchy

1. Project-level CLAUDE.md
2. Explicit task instructions
3. Existing code patterns in the project
4. This workspace CLAUDE.md
5. Industry best practices / framework defaults

## Ethics & Safety

AI MUST stop and request explicit approval before:
- Any operation that could DELETE user data or drop DB columns/tables
- Disabling authentication/authorisation or removing encryption
- Logging, sending, or storing PII in new locations
- Changes that could cause >1 minute downtime
- Using GPL/AGPL code in proprietary projects

## Communication

- When the user asks to "remove" or "clean up" something, clarify whether they mean a code change or a database/data cleanup before proceeding
- Ask ONE clarifying question maximum — if still unclear, proceed with the safest interpretation

## Debugging & Bug Fixes

- When fixing bugs, check the ENTIRE application for related issues, not just the reported area — ask: "Are there other places this same pattern exists?"
- When given a bug report: just fix it — don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user

## Code Changes

- Before suggesting new environment variables or database columns, check existing ones first — use `grep` to find existing env vars and inspect the current schema before proposing additions
- One logical change per commit; one concern per changeset

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- One task per subagent for focused execution

### 3. Task Tracking
- Write plan to `tasks/todo.md` with checkable items before starting
- Mark items complete as you go; document results when done

### 4. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules that prevent the same mistake; review lessons at session start

### 5. Verification Before Done
- Never mark a task complete without proving it works
- Run tests, check logs, demonstrate correctness
- Ask yourself: "Would a staff engineer approve this?"
- For non-trivial changes: pause and ask "is there a more elegant way?"

### 6. Codex Integration Hook
Uses OpenAI Codex CLI to audit, test and simulate — catches what Claude misses.

```
when: "running tests OR auditing OR simulating"
do:
  - run_skill(codex-review, target=current_task)
  - compare_outputs(claude_result, codex_result)
  - flag_discrepancies(threshold=medium)
  - merge_best_solution()
```

The full multi-specialist QA review skill lives in `~/.claude/skills/codex-qa-review/`. Trigger with "QA review", "codex review", "second opinion", or "check my work". Deploys four specialist agents (Bug Hunter, Security Auditor, Performance Analyst, Standards Enforcer) into a single prioritised report.

## Common Commands

```bash
npm run dev       # Start development server
npm run build     # Production build
npm run lint      # ESLint (zero warnings enforced)
npm test          # Run tests (Vitest unless noted otherwise)
npm run typecheck # TypeScript type checking (npx tsc --noEmit)
npx supabase db push   # Apply pending migrations (Supabase projects)
```

## Coding Standards

### TypeScript
- No `any` types unless absolutely justified with a comment
- Explicit return types on all exported functions
- Props interfaces must be named (not inline anonymous objects for complex props)
- Use `Promise<{ success?: boolean; error?: string }>` for server action return types

### Frontend / Styling
- Use design tokens only — no hardcoded hex colours in components
- Always consider responsive breakpoints (`sm:`, `md:`, `lg:`)
- No conflicting or redundant class combinations
- Design tokens should live in `globals.css` via `@theme inline` (Tailwind v4) or `tailwind.config.ts`
- **Never use dynamic Tailwind class construction** (e.g., `bg-${color}-500`) — always use static, complete class names due to Tailwind's purge behaviour

### Date Handling
- Always use the project's `dateUtils` (typically `src/lib/dateUtils.ts`) for display
- Never use raw `new Date()` or `.toISOString()` for user-facing dates
- Default timezone: Europe/London
- Key utilities: `getTodayIsoDate()`, `toLocalIsoDate()`, `formatDateInLondon()`

### Phone Numbers
- Always normalise to E.164 format (`+44...`) using `libphonenumber-js`

## Server Actions Pattern

All mutations use `'use server'` functions (typically in `src/app/actions/` or `src/actions/`):

```typescript
'use server';
export async function doSomething(params): Promise<{ success?: boolean; error?: string }> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' };
  // ... permission check, business logic, audit log ...
  revalidatePath('/path');
  return { success: true };
}
```

## Database / Supabase

See `.claude/rules/supabase.md` for detailed patterns. Key rules:
- DB columns are `snake_case`; TypeScript types are `camelCase`
- Always wrap DB results with a conversion helper (e.g. `fromDb<T>()`)
- RLS is always on — use service role client only for system/cron operations
- Two client patterns: cookie-based auth client and service-role admin client

### Before Any Database Work
Before making changes to queries, migrations, server actions, or any code that touches the database, query the live schema for all tables involved:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name IN ('relevant_table') ORDER BY ordinal_position;
```
Also check for views referencing those tables — they will break silently if columns change:
```sql
SELECT table_name FROM information_schema.view_table_usage
WHERE table_name IN ('relevant_table');
```

### Migrations
- Always verify migrations don't conflict with existing timestamps
- Test the connection string works before pushing
- PostgreSQL views freeze their column lists — if underlying tables change, views must be recreated
- Never run destructive migrations (DROP COLUMN/TABLE) without explicit approval

## Git Conventions

See `.claude/rules/pr-and-git-standards.md` for full PR templates, branch naming, and reviewer checklists. Key rules:
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- Never force-push to `main`
- One logical change per commit
- Meaningful commit messages explaining "why" not just "what"

## Rules Reference

Core rules (always loaded from `.claude/rules/`):

| File | Read when… |
|------|-----------|
| `ui-patterns.md` | Building or modifying UI components, forms, buttons, navigation, or accessibility |
| `testing.md` | Adding, modifying, or debugging tests; setting up test infrastructure |
| `definition-of-ready.md` | Starting any new feature — check requirements are clear before coding |
| `definition-of-done.md` | Finishing any feature — verify all quality gates pass |
| `complexity-and-incremental-dev.md` | Scoping a task that touches 4+ files or involves schema changes |
| `pr-and-git-standards.md` | Creating branches, writing commit messages, or opening PRs |
| `verification-pipeline.md` | Before pushing — run the full lint → typecheck → test → build pipeline |
| `supabase.md` | Any database query, migration, RLS policy, or client usage |

Domain rules (auto-injected from `.claude/docs/` when you edit relevant files):

| File | Domain |
|------|--------|
| `auth-standard.md` | Auth, sessions, middleware, RBAC, CSRF, password reset, invites |
| `background-jobs.md` | Async job queues, Vercel Cron, retry logic |
| `api-key-auth.md` | External API key generation, validation, rotation |
| `file-export.md` | PDF, DOCX, CSV generation and download |
| `rate-limiting.md` | Upstash rate limiting, 429 responses |
| `qr-codes.md` | QR code generation (client + server) |
| `toast-notifications.md` | Sonner toast patterns |
| `email-notifications.md` | Resend email, templates, audit logging |
| `ai-llm.md` | LLM client, prompts, token tracking, vision |
| `payment-processing.md` | Stripe/PayPal two-phase payment flows |
| `data-tables.md` | TanStack React Table v8 patterns |

## Quality Gates

A feature is only complete when it passes the full Definition of Done checklist (`.claude/rules/definition-of-done.md`). At minimum: builds, lints, type-checks, tests pass, no hardcoded secrets, auth checks in place, code commented where complex.
```

## Project Conventions (`CLAUDE.md`)

```markdown
# CLAUDE.md — CheersAI 2.0

This file provides project-specific guidance. See the workspace-level `CLAUDE.md` one directory up for shared conventions.

## Quick Profile

- **Framework**: Next.js 16.1, React 19.2
- **Test runner**: Vitest
- **Database**: Supabase (PostgreSQL + RLS)
- **Key integrations**: OpenAI, Resend Email, Framer Motion animations, React Query, Social media APIs (Instagram, Facebook, Google My Business)
- **Size**: ~158 files in src/

## Commands

```bash
npm run dev              # Start development server
npm run build            # Production build
npm run start            # Start production server
npm run lint             # ESLint check (max-warnings=0 in CI)
npm run test             # Vitest run (single pass)
npm run test:watch       # Vitest watch mode
npm run typecheck        # TypeScript check (tsc --noEmit)
npm run ci:verify        # Full CI pipeline: lint + typecheck + test + build
npm run ops:*            # Operational scripts (backfill, link-auth, regenerate derivatives)
```

## Architecture

**Route Structure**: App Router with next.js 16 conventions. Key sections:
- `/auth` — Sign in, sign up, password reset (Supabase JWT + cookies)
- `/dashboard` — Main workspace for authenticated users
- `/api/` — Webhooks and integrations (Instagram, Facebook callbacks)

**Auth**: Supabase Auth with JWT + HTTP-only cookies. Auth context in `src/lib/auth/` provides user state and permissions. All server actions re-verify auth server-side.

**Database**: Supabase PostgreSQL with RLS enabled. Service-role operations for system tasks only (backfills, crons). Client operations use anon-key client.

**Key Integrations**:
- **OpenAI**: `src/lib/` — content generation and AI features
- **Social APIs**: Instagram (webhooks), Facebook (Graph API), Google My Business integrations
- **Resend**: Email notifications and transactional email
- **React Query**: Data fetching with custom hooks in `src/lib/`
- **Framer Motion**: Page transitions and animations

**Data Flow**: Server actions handle mutations (auth, content operations). Client components use React Query for fetching. All responses validated with Zod.

## Key Files

| Path | Purpose |
|------|---------|
| `src/types/` | TypeScript definitions (database, API contracts) |
| `src/lib/auth/` | Authentication, server-side auth helpers, rate limiting |
| `src/lib/publishing/` | Publishing queue and preflight checks |
| `src/lib/scheduling/` | Event conflict detection, scheduling logic |
| `src/lib/planner/` | Data fetching for planner features |
| `src/lib/settings/` | Settings data and user preferences |
| `src/env.ts` | Environment variable validation (Zod) |
| `src/app/api/` | Webhooks (Instagram, Facebook, email) |
| `src/features/` | Feature-specific components and logic |
| `supabase/migrations/` | Database schema migrations |
| `vitest.config.ts` | Vitest configuration |

## Environment Variables

| Var | Purpose |
|-----|---------|
| `OPENAI_API_KEY` | OpenAI API key for content generation |
| `RESEND_API_KEY` | Resend email service key |
| `RESEND_FROM` | Email sender address |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server-only) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public) |
| `NEXT_PUBLIC_SITE_URL` | App base URL for redirects/links |
| `FACEBOOK_APP_ID` | Facebook app ID (public) |
| `FACEBOOK_APP_SECRET` | Facebook app secret (server-only) |
| `INSTAGRAM_APP_ID` | Instagram app ID (public) |
| `INSTAGRAM_APP_SECRET` | Instagram app secret (server-only) |
| `INSTAGRAM_VERIFY_TOKEN` | Instagram webhook verification token |
| `GOOGLE_MY_BUSINESS_CLIENT_ID` | Google My Business OAuth client ID |
| `GOOGLE_MY_BUSINESS_CLIENT_SECRET` | Google My Business OAuth secret |
| `ALERTS_SECRET` | Internal webhook secret for alerts |
| `CRON_SECRET` | Internal webhook secret for cron jobs |
| `ENABLE_CONNECTION_DIAGNOSTICS` | Enable debug logging for integrations |
| `VERCEL_OIDC_TOKEN` | Vercel deployment OIDC (for Vercel functions) |

## Project-Specific Rules / Gotchas

### Env Validation
- `src/env.ts` uses Zod to validate all environment variables at startup
- Missing required vars will throw at build/start time
- Always add new vars to `src/env.ts` before using in code

### Social Media Integrations
- Instagram, Facebook, Google My Business require OAuth tokens and refresh logic
- Webhook verification tokens must match config exactly
- Rate limits enforced per platform — check `src/lib/auth/rate-limit.ts`

### Publishing Queue
- `src/lib/publishing/preflight.ts` validates posts before scheduling
- `src/lib/publishing/queue.ts` manages async publishing
- Always check preflight results before queuing posts

### Scheduling Logic
- `src/lib/scheduling/conflicts.ts` prevents double-booking
- `src/lib/scheduling/materialise.ts` expands recurring events
- Timezone handling uses Luxon library (see workspace CLAUDE.md)

### Testing with Vitest
- Test files coexist with source: `src/**/*.test.ts(x)`
- Mock external services (OpenAI, Resend, Supabase)
- Use factories for test data, not inline object literals
- Minimum 80% coverage on business logic

### Framer Motion Usage
- Used for page transitions and micro-interactions
- Keep animations performant (prefer transform, opacity)
- Test animations disabled in unit tests

### Supabase RLS
- All queries respect RLS — use service-role only for system operations
- Service-role operations documented with comments: `// admin operation: [reason]`
- Never disable RLS "temporarily"

### Resend Email
- All transactional email goes through Resend
- Email templates should be tested with `RESEND_API_KEY` set
- From address format: `"Name (email@domain)"`

### Operational Scripts
- `ops:backfill-connections` — sync social connections
- `ops:backfill-link-in-bio-url` — update profile links
- `ops:link-auth-user` — link Supabase auth to business profile
- `ops:regenerate-story-derivatives` — rebuild cached story variants
- Run in test environment first, then production with caution

### CI Pipeline
- `npm run ci:verify` runs full suite: lint → typecheck → test → build
- All four steps must pass before merge
- No console warnings allowed in CI

### Next.js 16 Specifics
- Using latest App Router patterns
- Server actions with 'use server' directive
- Streaming responses supported but not heavily used
- Build optimization enabled by default
```

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/definition-of-done.md`

```markdown
# Definition of Done (DoD)

A feature is ONLY complete when ALL applicable items pass. This extends the Quality Gates in the root CLAUDE.md.

## Code Quality

- [ ] Builds successfully — `npm run build` with zero errors
- [ ] Linting passes — `npm run lint` with zero warnings
- [ ] Type checks pass — `npx tsc --noEmit` clean (or project equivalent)
- [ ] No `any` types unless justified with a comment
- [ ] No hardcoded secrets or API keys
- [ ] No hardcoded hex colours — use design tokens
- [ ] Server action return types explicitly typed

## Testing

- [ ] All existing tests pass
- [ ] New tests written for business logic (happy path + at least 1 error case)
- [ ] Coverage meets project minimum (default: 80% on business logic)
- [ ] External services mocked — never hit real APIs in tests
- [ ] If no test suite exists yet, note this in the PR as tech debt

## Security

- [ ] Auth checks in place — server actions re-verify server-side
- [ ] Permission checks present — RBAC enforced on both UI and server
- [ ] Input validation complete — all user inputs sanitised (Zod or equivalent)
- [ ] No new PII logging, sending, or storing without approval
- [ ] RLS verified (Supabase projects) — queries respect row-level security

## Accessibility

- [ ] Interactive elements have visible focus styles
- [ ] Colour is not the sole indicator of state
- [ ] Modal dialogs trap focus and close on Escape
- [ ] Tables have proper `<thead>`, `<th scope>` markup
- [ ] Images have meaningful `alt` text
- [ ] Keyboard navigation works for all interactive elements

## Documentation

- [ ] Complex logic commented — future developers can understand "why"
- [ ] README updated if new setup, config, or env vars are needed
- [ ] Environment variables documented in `.env.example`
- [ ] Breaking changes noted in PR description

## Deployment

- [ ] Database migrations tested locally before pushing
- [ ] Rollback plan documented for schema changes
- [ ] No console.log or debug statements left in production code
- [ ] Verification pipeline passes (see `verification-pipeline.md`)
```

---

_End of pack._

---

## Appended: Current Source Files (target of the SPEC)

Reviewers should reason about the SPEC's proposed approach against these actual files, not assume.

### `src/features/create/instant-post-form.tsx` (full)

```tsx
"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useForm, type Resolver, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { DateTime } from "luxon";

import {
  fetchGeneratedContentDetails,
} from "@/app/(app)/create/actions";
import {
  instantPostFormSchema,
  type InstantPostFormValues,
  type InstantPostInput,
  type MediaAssetInput,
} from "@/lib/create/schema";
import { DEFAULT_POST_TIME, STORY_POST_TIME } from "@/lib/constants";
import { formatStoryScheduleInputValue } from "@/lib/create/story-schedule";
import type { MediaAssetSummary } from "@/lib/library/data";
import type { PlannerContentDetail } from "@/lib/planner/data";
import { GeneratedContentReviewList } from "@/features/create/generated-content-review-list";
import { GenerationProgress } from "@/features/create/generation-progress";
import { StreamingPreview } from "@/features/create/streaming-preview";
import { MediaAttachmentSelector } from "@/features/create/media-attachment-selector";
import { StageAccordion, type StageAccordionControls } from "@/features/create/stage-accordion";
import { TemplateSelector } from "@/features/create/template-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PLATFORM_LABELS: Record<InstantPostInput["platforms"][number], string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  gbp: "Google Business Profile",
};

const LINK_GOAL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Learn more (default)" },
  { value: "Find out more", label: "Find out more" },
  { value: "Book now", label: "Book now" },
  { value: "Reserve a table", label: "Reserve a table" },
  { value: "View menu", label: "View menu" },
  { value: "Call now", label: "Call now" },
];

interface InstantPostFormProps {
  mediaLibrary: MediaAssetSummary[];
  ownerTimezone: string;
  onLibraryUpdate?: Dispatch<SetStateAction<MediaAssetSummary[]>>;
  initialDate?: Date;
  initialMedia?: MediaAssetSummary[];
  onSuccess?: () => void;
}

// Shape of SSE events emitted by POST /api/create/generate-stream
interface StreamEvent {
  type: string;
  platform?: string;
  text?: string;
  contentItemIds?: string[];
  message?: string;
}

export function InstantPostForm({ mediaLibrary, ownerTimezone, onLibraryUpdate, initialDate, initialMedia, onSuccess }: InstantPostFormProps) {
  const [isPending, setIsPending] = useState(false);
  const [result, setResult] = useState<{ status: string; scheduledFor: string | null } | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [progressActive, setProgressActive] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");
  // Streaming preview state: accumulated text per platform key
  const [streamingText, setStreamingText] = useState<Record<string, string>>({});
  const [streamingPlatforms, setStreamingPlatforms] = useState<string[]>([]);
  // AbortController for the in-flight SSE fetch
  const abortControllerRef = useRef<AbortController | null>(null);
  const [generatedItems, setGeneratedItems] = useState<PlannerContentDetail[]>([]);
  const [library, setLibrary] = useState<MediaAssetSummary[]>(mediaLibrary);

  useEffect(() => {
    setLibrary(mediaLibrary);
  }, [mediaLibrary]);

  useEffect(() => () => {
    // Abort any in-flight stream on unmount
    abortControllerRef.current?.abort();
  }, []);

  const handleLibraryUpdate: Dispatch<SetStateAction<MediaAssetSummary[]>> = (updater) => {
    setLibrary((prev) => (typeof updater === "function" ? (updater as (value: MediaAssetSummary[]) => MediaAssetSummary[])(prev) : updater));
    if (onLibraryUpdate) {
      onLibraryUpdate(updater);
    }
  };

  const form = useForm<InstantPostFormValues>({
    resolver: zodResolver(instantPostFormSchema) as Resolver<InstantPostFormValues>,
    defaultValues: {
      title: "",
      prompt: "",
      publishMode: initialDate ? "schedule" : "now",
      scheduledFor: initialDate
        ? DateTime.fromJSDate(initialDate)
            .setZone(ownerTimezone)
            .toFormat("yyyy-MM-dd'T'HH:mm")
        : undefined,
      platforms: ["facebook", "instagram"],
      media: initialMedia?.map(m => ({
        assetId: m.id,
        mediaType: m.mediaType,
        fileName: m.fileName
      })) ?? [],
      ctaUrl: "",
      ctaLabel: "",
      linkInBioUrl: "",
      toneAdjust: "default",
      lengthPreference: "standard",
      includeHashtags: true,
      includeEmojis: true,
      ctaStyle: "default",
      placement: "feed",
      proofPointMode: "off",
      proofPointsSelected: [],
      proofPointIntentTags: [],
    },
  });

  const publishMode = form.watch("publishMode");
  const selectedMedia = form.watch("media") ?? [];
  const placement = form.watch("placement");
  const scheduledForValue = form.watch("scheduledFor");
  const storyDateValue = scheduledForValue?.slice(0, 10) ?? "";

  const setStoryScheduledDate = useCallback((value: string | Date | null | undefined) => {
    const resolved = formatStoryScheduleInputValue(value ?? new Date(), ownerTimezone);
    if (!resolved) return;
    form.setValue("scheduledFor", resolved, { shouldDirty: true, shouldValidate: true });
  }, [form, ownerTimezone]);

  useEffect(() => {
    if (publishMode !== "schedule") return;
    const current = form.getValues("scheduledFor");
    if (current) return;

    const now = DateTime.now().setZone(ownerTimezone);
    let next = now.set({
      hour: Number(DEFAULT_POST_TIME.split(":")[0]),
      minute: Number(DEFAULT_POST_TIME.split(":")[1]),
      second: 0,
      millisecond: 0,
    });
    if (next <= now) {
      next = next.plus({ days: 1 });
    }
    form.setValue("scheduledFor", next.toFormat("yyyy-MM-dd'T'HH:mm"), { shouldDirty: true });
  }, [form, ownerTimezone, publishMode]);

  useEffect(() => {
    if (placement === "story") {
      if (form.getValues("publishMode") !== "schedule") {
        form.setValue("publishMode", "schedule", { shouldDirty: true });
      }
      setStoryScheduledDate(form.getValues("scheduledFor") ?? new Date());

      const currentPlatforms = form.getValues("platforms") ?? [];
      const filtered = currentPlatforms.filter(
        (platform): platform is InstantPostInput["platforms"][number] => platform !== "gbp",
      );
      const nextPlatforms: InstantPostInput["platforms"] = filtered.length ? filtered : ["instagram"];
      if (filtered.length !== currentPlatforms.length || filtered.length === 0) {
        form.setValue("platforms", nextPlatforms, { shouldDirty: true });
      }
    }
  }, [placement, form, setStoryScheduledDate]);

  const startProgress = (message: string) => {
    setProgressMessage(message);
    setProgressActive(true);
  };

  const stopProgress = () => {
    setProgressActive(false);
    setProgressMessage("");
  };

  const refreshGeneratedItem = async (contentId: string) => {
    const details = await fetchGeneratedContentDetails({ contentIds: [contentId] });
    const detail = details[0];
    if (!detail) return;
    setGeneratedItems((prev) => prev.map((item) => (item.id === contentId ? detail : item)));
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setGenerationError(null);
    setGeneratedItems([]);
    setStreamingText({});
    setStreamingPlatforms(values.platforms ?? []);
    setResult(null);

    const progressLabel = placement === "story" ? "Creating story…" : "Generating post variants…";
    startProgress(progressLabel);
    setIsPending(true);

    // Abort any previous in-flight stream before starting a new one
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch("/api/create/generate-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(errorBody.error ?? `Request failed (${response.status})`);
      }

      if (!response.body) {
        throw new Error("No response body received.");
      }

      const reader = response.body.getReader();
      const textDecoder = new TextDecoder();
      let sseBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += textDecoder.decode(value, { stream: true });

        // Process complete SSE lines; keep any incomplete trailing line in the buffer
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          let event: StreamEvent;
          try {
            event = JSON.parse(jsonStr) as StreamEvent;
          } catch {
            continue;
          }

          if (event.type === "platform_start" && event.platform) {
            const label =
              event.platform === "gbp"
                ? "Google Business Profile"
                : event.platform.charAt(0).toUpperCase() + event.platform.slice(1);
            setProgressMessage(`Generating ${label} copy…`);
          } else if (event.type === "chunk" && event.platform && event.text) {
            const platform = event.platform;
            const chunk = event.text;
            setStreamingText((prev) => ({
              ...prev,
              [platform]: (prev[platform] ?? "") + chunk,
            }));
          } else if (event.type === "done" && event.contentItemIds?.length) {
            setProgressMessage("Preparing review…");
            const details = await fetchGeneratedContentDetails({ contentIds: event.contentItemIds });
            setGeneratedItems(details);
            setResult({ status: "draft", scheduledFor: null });
          } else if (event.type === "error") {
            throw new Error(event.message ?? "Content generation failed.");
          }
        }
      }

      const resetPlacement = values.placement ?? "feed";
      form.reset({
        title: "",
        prompt: "",
        publishMode: "now",
        platforms: ["facebook", "instagram"],
        media: [],
        ctaUrl: "",
        ctaLabel: "",
        linkInBioUrl: "",
        scheduledFor: undefined,
        toneAdjust: "default",
        lengthPreference: "standard",
        includeHashtags: true,
        includeEmojis: true,
        ctaStyle: "default",
        placement: resetPlacement,
        proofPointMode: "off",
        proofPointsSelected: [],
        proofPointIntentTags: [],
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        // User navigated away or re-submitted; silently ignore
        return;
      }
      const message = error instanceof Error ? error.message : "Failed to generate content.";
      setGenerationError(message);
    } finally {
      stopProgress();
      setIsPending(false);
    }
  });

  const handleMediaAttachmentsChange = (next: MediaAssetInput[]) => {
    if (placement !== "story") {
      form.clearErrors("media");
      form.setValue("media", next, { shouldDirty: true });
      return;
    }

    const previous = form.getValues("media") ?? [];
    const imagesOnly = next.filter((item) => item.mediaType === "image");
    let finalSelection = imagesOnly;

    if (imagesOnly.length !== next.length) {
      form.setError("media", { type: "manual", message: "Stories support images only." });
    }

    if (imagesOnly.length > 1) {
      const added = imagesOnly.find((item) => !previous.some((prevItem) => prevItem.assetId === item.assetId));
      finalSelection = added ? [added] : imagesOnly.slice(0, 1);
      form.setError("media", { type: "manual", message: "Stories can only include one image." });
    } else if (imagesOnly.length === 1) {
      form.clearErrors("media");
    } else {
      form.setError("media", { type: "manual", message: "Attach one image for this story." });
    }

    form.setValue("media", finalSelection, { shouldDirty: true });
  };

  const goToNextWhenValid = async (
    controls: StageAccordionControls,
    stageId: string,
    fields: (keyof InstantPostFormValues)[],
  ) => {
    if (!fields.length) {
      controls.goToNext();
      return;
    }

    const isValid = await form.trigger(fields, { shouldFocus: true });
    if (isValid) {
      controls.goToNext();
    } else {
      controls.openStage(stageId, { exclusive: true });
    }
  };

  const stages = [
    {
      id: "basics",
      title: "Post basics",
      description: "Set the essentials for this instant post.",
      content: (controls: StageAccordionControls) => {
        const handleNext = async () => {
          const fields: (keyof InstantPostFormValues)[] = ["title"];
          if (form.getValues("placement") !== "story") {
            fields.push("prompt");
          }
          await goToNextWhenValid(controls, "basics", fields);
        };

        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="instant-title">Title</Label>
              <Input
                id="instant-title"
                type="text"
                placeholder="e.g. Friday Night Hype"
                {...form.register("title")}
              />
              {form.formState.errors.title ? (
                <p className="text-xs text-rose-500">{form.formState.errors.title.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-900">Placement</p>
              <div className="flex flex-wrap gap-2">
                {([
                  { id: "feed", label: "Feed post" },
                  { id: "story", label: "Story" },
                ] as const).map((option) => (
                  <Button
                    key={option.id}
                    type="button"
                    variant={placement === option.id ? "default" : "outline"}
                    onClick={() => form.setValue("placement", option.id, { shouldDirty: true })}
                    className={placement !== option.id ? "bg-white shadow-sm" : ""}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              {placement === "story" ? (
                <p className="text-xs text-slate-500">Stories schedule a single 9:16 image for {STORY_POST_TIME} without copy.</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="instant-prompt">What should we post?</Label>
              <textarea
                id="instant-prompt"
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none disabled:bg-slate-100"
                rows={4}
                placeholder={
                  placement === "story"
                    ? "Stories publish without captions."
                    : "Give us the context, vibe, and anything we must mention"
                }
                disabled={placement === "story"}
                {...form.register("prompt")}
              />
              {placement !== "story" && form.formState.errors.prompt ? (
                <p className="text-xs text-rose-500">{form.formState.errors.prompt.message}</p>
              ) : null}
            </div>

            {placement !== "story" ? (
              <TemplateSelector
                currentPrompt={form.watch("prompt")}
                currentPlatforms={form.watch("platforms")}
                currentToneAdjust={form.watch("toneAdjust")}
                onSelect={(template) => {
                  form.setValue("prompt", template.prompt, { shouldDirty: true });
                  if (template.platforms.length) {
                    form.setValue("platforms", template.platforms as InstantPostInput["platforms"], { shouldDirty: true });
                  }
                }}
              />
            ) : null}

            <div className="flex justify-end pt-2">
              <Button
                type="button"
                onClick={() => void handleNext()}
              >
                Next
              </Button>
            </div>
          </>
        );
      },
    },
    {
      id: "channels",
      title: "Channels & timing",
      description: "Choose platforms, scheduling, and optional links.",
      content: (controls: StageAccordionControls) => {
        const handleNext = async () => {
          const fields: (keyof InstantPostFormValues)[] = ["platforms", "ctaUrl", "linkInBioUrl"];
          if (form.getValues("publishMode") === "schedule") {
            fields.push("scheduledFor");
          }
          await goToNextWhenValid(controls, "channels", fields);
        };

        return (
          <>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-900">Platforms</p>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(PLATFORM_LABELS) as Array<InstantPostInput["platforms"][number]>).map((platform) => {
                  const selected = (form.watch("platforms") ?? []).includes(platform);
                  const disabled = placement === "story" && platform === "gbp";
                  return (
                    <Button
                      key={platform}
                      type="button"
                      variant={selected ? "default" : "outline"}
                      onClick={() => !disabled && togglePlatform(form, platform)}
                      disabled={disabled}
                      className={!selected ? "bg-white shadow-sm" : ""}
                    >
                      {PLATFORM_LABELS[platform]}
                    </Button>
                  );
                })}
              </div>
              {placement === "story" ? (
                <p className="text-xs text-slate-500">Stories are available on Facebook and Instagram only.</p>
              ) : null}
              {form.formState.errors.platforms ? (
                <p className="text-xs text-rose-500">{form.formState.errors.platforms.message}</p>
              ) : null}
            </div>

            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-900">When should it publish?</p>
              {placement === "story" ? (
                <div className="space-y-2">
                  <Input
                    type="date"
                    value={storyDateValue}
                    onChange={(event) => setStoryScheduledDate(event.target.value)}
                  />
                  <p className="text-xs text-slate-500">
                    Stories are scheduled for {STORY_POST_TIME}. Timezone: {ownerTimezone.replace(/_/g, " ")}
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex gap-3">
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        value="now"
                        checked={publishMode === "now"}
                        onChange={() => form.setValue("publishMode", "now")}
                      />
                      Publish now
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        value="schedule"
                        checked={publishMode === "schedule"}
                        onChange={() => form.setValue("publishMode", "schedule")}
                      />
                      Schedule for later
                    </label>
                  </div>
                  {publishMode === "schedule" ? (
                    <div className="space-y-2">
                      <Input
                        type="datetime-local"
                        {...form.register("scheduledFor")}
                      />
                      <p className="text-xs text-slate-500">Timezone: {ownerTimezone.replace(/_/g, " ")}</p>
                    </div>
                  ) : null}
                </>
              )}
              {form.formState.errors.scheduledFor ? (
                <p className="text-xs text-rose-500">
                  {form.formState.errors.scheduledFor.message as string}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="instant-cta-url">
                Optional CTA link
              </Label>
              <Input
                id="instant-cta-url"
                type="url"
                placeholder="https://example.com/booking"
                disabled={placement === "story"}
                {...form.register("ctaUrl")}
              />
              <p className="text-xs text-slate-500">Included on Facebook posts as the primary call to action.</p>
              {form.formState.errors.ctaUrl ? (
                <p className="text-xs text-rose-500">{form.formState.errors.ctaUrl.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="instant-cta-label">Link goal</Label>
              <select
                id="instant-cta-label"
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none disabled:opacity-60"
                disabled={placement === "story"}
                {...form.register("ctaLabel")}
              >
                {LINK_GOAL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500">
                Guides the call-to-action language (and the label next to the Facebook link, if provided).
              </p>
              {form.formState.errors.ctaLabel ? (
                <p className="text-xs text-rose-500">{form.formState.errors.ctaLabel.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="instant-link-in-bio-url">
                Link in bio destination
              </Label>
              <p className="text-xs text-slate-500">
                Guests land here when they tap the tile on your link-in-bio page.
              </p>
              <Input
                id="instant-link-in-bio-url"
                type="url"
                placeholder="https://www.the-anchor.pub/book"
                disabled={placement === "story"}
                {...form.register("linkInBioUrl")}
              />
              {form.formState.errors.linkInBioUrl ? (
                <p className="text-xs text-rose-500">{form.formState.errors.linkInBioUrl.message}</p>
              ) : null}
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="button"
                onClick={() => void handleNext()}
              >
                Next
              </Button>
            </div>
          </>
        );
      },
    },
    {
      id: "creative",
      title: "Creative choices",
      description: "Attach the media to pair with this post.",
      content: (controls: StageAccordionControls) => {
        const handleNext = async () => {
          await goToNextWhenValid(controls, "creative", ["media"]);
        };

        return (
          <>
            <MediaAttachmentSelector
              assets={library}
              selected={selectedMedia}
              onChange={handleMediaAttachmentsChange}
              label="Media attachments"
              description={
                placement === "story"
                  ? "Stories publish a single processed 9:16 image from your Library."
                  : "Pick processed images or video from your Library. We’ll automatically use the right rendition per platform."
              }
              onLibraryUpdate={handleLibraryUpdate}
            />
            {form.formState.errors.media ? (
              <p className="text-xs text-rose-500">{form.formState.errors.media.message as string}</p>
            ) : null}

            <div className="flex justify-end pt-2">
              <Button
                type="button"
                onClick={() => void handleNext()}
              >
                Next
              </Button>
            </div>
          </>
        );
      },
    },
    {
      id: "generate",
      title: "Generate & review",
      description: "Create draft posts, then review and approve them.",
      defaultOpen: true,
      content: (
        <>
          <Button
            type="submit"
            disabled={isPending}
          >
            {isPending
              ? placement === "story" ? "Creating story…" : "Generating post…"
              : placement === "story" ? "Create story" : "Generate post"}
          </Button>

          {/* Real-time streaming preview — visible while generation is active */}
          <StreamingPreview
            platforms={streamingPlatforms}
            streamingText={streamingText}
            active={progressActive}
          />

          {/* Status bar — shows current stage message while generating */}
          {progressActive ? (
            <GenerationProgress active={progressActive} value={0} message={progressMessage} />
          ) : null}

          {generationError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {generationError}
            </div>
          ) : null}

          {result ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              Draft posts created. Review the generated content below and approve when you&apos;re ready.
            </div>
          ) : null}

          {generatedItems.length ? (
            <section className="space-y-4">
              <h3 className="text-lg font-semibold text-slate-900">Review & approve</h3>
              <p className="text-sm text-slate-500">
                Update attachments, then approve each post to schedule it automatically.
              </p>
              <GeneratedContentReviewList
                items={generatedItems}
                ownerTimezone={ownerTimezone}
                mediaLibrary={library}
                onLibraryUpdate={handleLibraryUpdate}
                onRefreshItem={refreshGeneratedItem}
              />
              {onSuccess ? (
                <div className="flex justify-end pt-4 border-t border-slate-100">
                  <Button variant="outline" onClick={onSuccess}>
                    Done
                  </Button>
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      ),
    },
  ];

  return (
    <form onSubmit={onSubmit}>
      <StageAccordion stages={stages} />
    </form>
  );
}

function togglePlatform(
  form: UseFormReturn<InstantPostFormValues>,
  platform: InstantPostInput["platforms"][number],
) {
  const current = form.getValues("platforms") ?? [];
  if (current.includes(platform)) {
    form.setValue(
      "platforms",
      current.filter((item) => item !== platform),
    );
  } else {
    form.setValue("platforms", [...current, platform]);
  }
}
```

### `src/app/api/create/generate-stream/route.ts` (full)

```ts
/**
 * POST /api/create/generate-stream
 *
 * Streaming route handler for instant post generation.
 *
 * Design: OpenAI is called once per platform for the streaming preview, then
 * `createInstantPost()` is called once at the end to do the real save. This
 * results in two OpenAI API calls per generation (one for preview, one for
 * save). We accept that trade-off because replicating the full generate+save
 * pipeline here would duplicate a large amount of complex business logic that
 * lives in service.ts, and the UX improvement from real streaming is
 * significant.
 */

import { NextRequest } from "next/server";
import { DateTime } from "luxon";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolveAccountId } from "@/lib/auth/server";
import { getOpenAIClient } from "@/lib/ai/client";
import { buildInstantPostPrompt } from "@/lib/ai/prompts";
import { getOwnerSettings } from "@/lib/settings/data";
import { createInstantPost } from "@/lib/create/service";
import { resolveStoryScheduledFor } from "@/lib/create/story-schedule";
import {
  instantPostFormSchema,
  instantPostSchema,
  type InstantPostInput,
} from "@/lib/create/schema";
import { DEFAULT_TIMEZONE } from "@/lib/constants";

export const dynamic = "force-dynamic";

// SSE event types emitted by this handler
type StreamEvent =
  | { type: "platform_start"; platform: string }
  | { type: "chunk"; platform: string; text: string }
  | { type: "platform_done"; platform: string }
  | { type: "done"; contentItemIds: string[] }
  | { type: "error"; message: string };

function encode(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(request: NextRequest): Promise<Response> {
  // --- Auth ---
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const accountId = resolveAccountId(user);
  if (!accountId) {
    return new Response(JSON.stringify({ error: "Account not found" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // --- Parse body ---
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let formValues: ReturnType<typeof instantPostFormSchema.parse>;
  try {
    formValues = instantPostFormSchema.parse(rawBody);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid request";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Resolve to the domain input type (same transform as the server action)
  const storyScheduledFor =
    formValues.placement === "story"
      ? resolveStoryScheduledFor(formValues.scheduledFor ?? new Date(), DEFAULT_TIMEZONE)
      : null;
  const input: InstantPostInput = instantPostSchema.parse({
    ...formValues,
    publishMode: storyScheduledFor ? "schedule" : formValues.publishMode,
    scheduledFor:
      storyScheduledFor ??
      (formValues.publishMode === "schedule" && formValues.scheduledFor
        ? DateTime.fromISO(formValues.scheduledFor, { zone: DEFAULT_TIMEZONE }).toJSDate()
        : undefined),
  });

  // --- Build the SSE stream ---
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(encode(event)));
      };

      try {
        // Load settings once — needed to build prompts
        const { brand, venueName } = await getOwnerSettings();

        const openai = getOpenAIClient();

        // Stream a preview for each platform (OpenAI call #1 per platform)
        for (const platform of input.platforms) {
          send({ type: "platform_start", platform });

          const prompt = buildInstantPostPrompt({
            brand,
            venueName,
            input,
            platform,
            scheduledFor: input.scheduledFor ?? null,
          });

          const responseStream = openai.responses.stream({
            model: "gpt-4.1-mini",
            input: [
              { role: "system", content: prompt.system },
              { role: "user", content: prompt.user },
            ],
            temperature: 0.7,
          });

          for await (const event of responseStream) {
            if (
              event.type === "response.output_text.delta" &&
              typeof event.delta === "string" &&
              event.delta.length > 0
            ) {
              send({ type: "chunk", platform, text: event.delta });
            }
          }

          send({ type: "platform_done", platform });
        }

        // Persist (OpenAI call #2 — full generation + save via existing service)
        const result = await createInstantPost(input);

        send({ type: "done", contentItemIds: result.contentItemIds });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Content generation failed.";
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

### `src/features/create/banner-defaults-picker.tsx` (full — pattern to reuse)

```tsx
"use client";

import {
  BANNER_POSITIONS,
  BANNER_COLOURS,
  BANNER_COLOUR_HEX,
  type BannerDefaults,
  type BannerPosition,
  type BannerColourId,
} from "@/lib/scheduling/banner-config";

interface BannerDefaultsPickerProps {
  value: BannerDefaults;
  onChange: (value: BannerDefaults) => void;
}

const POSITION_LABELS: Record<BannerPosition, string> = {
  top: "Top", bottom: "Bottom", left: "Left", right: "Right",
};

export function BannerDefaultsPicker({ value, onChange }: BannerDefaultsPickerProps): React.ReactElement {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-sm font-medium">Banner Position</label>
        <div className="mt-1 flex gap-1">
          {BANNER_POSITIONS.map((pos) => (
            <button
              key={pos}
              type="button"
              className={`rounded px-3 py-1 text-xs font-medium ${
                value.position === pos ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
              onClick={() => onChange({ ...value, position: pos })}
            >
              {POSITION_LABELS[pos]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-sm font-medium">Background Colour</label>
        <div className="mt-1 flex gap-1">
          {BANNER_COLOURS.map((colour) => (
            <button
              key={colour.id}
              type="button"
              className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                value.bgColour === colour.id ? "ring-2 ring-primary ring-offset-1" : ""
              }`}
              style={{
                backgroundColor: colour.hex,
                borderColor: colour.id === "white" ? "#d1d5db" : colour.hex,
              }}
              title={colour.label}
              onClick={() => onChange({ ...value, bgColour: colour.id as BannerColourId })}
            />
          ))}
        </div>
      </div>
      <div>
        <label className="text-sm font-medium">Text Colour</label>
        <div className="mt-1 flex gap-1">
          {BANNER_COLOURS.map((colour) => (
            <button
              key={colour.id}
              type="button"
              className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                value.textColour === colour.id ? "ring-2 ring-primary ring-offset-1" : ""
              }`}
              style={{
                backgroundColor: colour.hex,
                borderColor: colour.id === "white" ? "#d1d5db" : colour.hex,
              }}
              title={colour.label}
              onClick={() => onChange({ ...value, textColour: colour.id as BannerColourId })}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Preview</span>
        <div
          className="flex h-6 items-center rounded px-3 text-[10px] font-bold uppercase tracking-wider"
          style={{
            backgroundColor: BANNER_COLOUR_HEX[value.bgColour],
            color: BANNER_COLOUR_HEX[value.textColour],
          }}
        >
          SAMPLE TEXT
        </div>
      </div>
    </div>
  );
}
```

### `src/lib/ai/prompts.ts` (full)

```ts
import { DateTime } from "luxon";

import { BANNED_PHRASES, PREFERRED_PHRASES, TONE_PROFILE } from "@/lib/ai/voice";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import type { InstantPostInput } from "@/lib/create/schema";
import type { BrandProfile } from "@/lib/settings/data";
import { formatFriendlyTimeFromZoned } from "@/lib/utils/date";

function mergedBannedPhrases(brandPhrases: string[]): string[] {
  const system = BANNED_PHRASES;
  const user = brandPhrases.map((p) => p.trim()).filter(Boolean);
  const seen = new Set(system.map((p) => p.toLowerCase()));
  const unique = user.filter((p) => !seen.has(p.toLowerCase()));
  return [...system, ...unique];
}

interface PromptContext {
  brand: BrandProfile;
  input: InstantPostInput;
  platform: "facebook" | "instagram" | "gbp";
  scheduledFor?: Date | null;
  context?: Record<string, unknown>;
  venueName?: string;
}

interface PromptMessages {
  system: string;
  user: string;
}

export function buildInstantPostPrompt({ brand, input, platform, scheduledFor, context, venueName }: PromptContext): PromptMessages {
  const systemLines = [
    "You are CheersAI, writing social media copy on behalf of a single-owner British pub team.",
    "Use British English throughout.",
    'Write as the pub team in first-person plural. Use "we" as the subject ("We\'re serving..."), "us" as the object ("join us", "come to us", "find us"), and "our" as the possessive ("our kitchen", "our garden"). Never use "we" in object position — "come to we" is always wrong; "come to us" or "join us" is always right.',
    'Third-party subject sentences about guests are allowed and natural: "Kids are welcome", "Everyone\'s invited", "All ages welcome", "Bring the whole family" — these do not need to be rewritten into first person.',
    'The venue name may appear in ONLY these three positions: (1) an opening hook where the name reads as an invitation (e.g. "Join us at The Anchor this Sunday"), (2) a location reference where the name is the clearest way to direct someone (e.g. "Find us at The Anchor"), (3) a sign-off or closing tag if a signature is provided.',
    'Never open a body copy sentence with the venue name as the grammatical subject. WRONG: "The Anchor is serving roast beef this Sunday." RIGHT: "We\'re serving roast beef this Sunday."',
    venueName
      ? `The venue is called "${venueName}". Use this name only in the three permitted positions above — never as the subject of a body copy sentence.`
      : "Do not name the venue.",
    "Keep copy warm, human, and helpful.",
    `Tone profile: ${TONE_PROFILE}`,
    "Output only the final caption text. No labels, no quotes, no commentary.",
    "If a price, cost, or specific offer detail is provided, you MUST include it in the final copy.",
    describeToneTargets(brand),
    formatListLine("Do not mention", brand.bannedTopics),
    formatListLine("Avoid these phrases", mergedBannedPhrases(brand.bannedPhrases ?? [])),
  ].filter(isNonEmptyString);

  const brandLines = [
    formatListLine("Key phrases to weave in if natural", brand.keyPhrases),
    formatListLine("Preferred phrases when natural", PREFERRED_PHRASES),
    input.includeHashtags && platform !== "instagram" && platform !== "gbp"
      ? formatListLine("Default hashtags", brand.defaultHashtags, " ")
      : null,
    input.includeEmojis ? formatListLine("Preferred emojis", brand.defaultEmojis, " ") : null,
  ].filter(isNonEmptyString);

  const pillarNudge =
    typeof context?.pillarNudge === "string" ? context.pillarNudge.trim() : null;

  const sections: string[] = [
    input.title?.trim() ? `Title (for context only — do not copy verbatim or use as sentence subject): ${input.title.trim()}` : null,
    input.prompt?.trim() ? `Request: ${input.prompt.trim()}` : null,
    brandLines.length ? `Brand voice:\n${brandLines.join("\n")}` : null,
    buildMediaLine(input),
    buildContextBlock({ scheduledFor, context }),
    pillarNudge ? `Content angle advisory:\n${pillarNudge}` : null,
    `Platform guidance:\n${buildPlatformGuidance(platform, brand, input, { venueName, context })}`,
    `Adjustments:\n${describeAdjustments(platform, input, context)}`,
    `Examples of good style (British English, warm, no hashtags in body):\n${getFewShotExamples()}`,
  ].filter(isNonEmptyString);

  return {
    system: systemLines.join("\n"),
    user: sections.join("\n\n"),
  };
}

function buildPlatformGuidance(
  platform: "facebook" | "instagram" | "gbp",
  brand: BrandProfile,
  input: InstantPostInput,
  options?: { venueName?: string; context?: Record<string, unknown> },
) {
  switch (platform) {
    case "facebook":
      return [
        "Keep it concise, but feel free to write up to 120 words if the story needs it.",
        input.includeHashtags
          ? "Include a CTA and 2-3 relevant hashtags if it feels natural."
          : "Include a CTA and keep copy hashtag-free.",
        "Where natural, close with a question or opinion prompt that invites comments (e.g., 'What's your order?', 'Who's joining us?'). Facebook rewards posts that generate replies.",
        "Write as if talking to a regular — conversational, not announcement-style.",
        formatOptionalLine("Append this exact signature verbatim at the end if it fits naturally (do not rephrase it)", brand.facebookSignature),
      ]
        .filter(Boolean)
        .join("\n");
    case "instagram": {
      const hasLink = Boolean(input.linkInBioUrl || input.ctaUrl);
      return [
        "The first line must stop the scroll. Front-load the hook — only the first 125 characters show before 'more'.",
        "Aim for 60-80 words with line breaks.",
        "Use line breaks to create scannable structure. One thought per line.",
        "Do not include URLs.",
        hasLink
          ? "Finish with a natural link-in-bio line (e.g. 'Link in bio to book', 'Check the link in our bio', 'Details in bio')."
          : "Do not mention link in bio unless a link is provided.",
        input.includeHashtags
          ? formatHashtagGuidance(brand)
          : "Do not add hashtags; rely on copy only.",
        formatOptionalLine("Append this exact signature verbatim at the end if it fits naturally (do not rephrase it)", brand.instagramSignature),
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "gbp": {
      const lines = [
        "Write a concise Google Business Profile update. Keep it under 150 words (hard limit: 900 characters).",
        'Write in first-person plural — "we", "our", "us" — exactly as you would for Facebook or Instagram. GBP copy must also follow the first-person rule.',
        `Include CTA action: ${brand.gbpCta ?? "LEARN_MORE"}.`,
        "Avoid hashtags. Avoid exclamation-heavy hype language. Write as if speaking directly to a local who already knows the pub.",
        "Write for someone searching Google for a local pub. Include natural local keywords (e.g., the town name, 'pub near [area]').",
        "Lead with the most important fact — what, when, and how to act. No preamble.",
      ];

      const venueName = options?.venueName;
      const venueLocationValue =
        typeof options?.context?.venueLocation === "string"
          ? options.context.venueLocation.trim()
          : null;

      if (venueName) {
        lines.push(`Venue name: <venue_name>${venueName}</venue_name>`);
      }
      if (venueLocationValue) {
        lines.push(`Venue location: <venue_location>${venueLocationValue}</venue_location>`);
      }

      return lines.join("\n");
    }
    default:
      return "";
  }
}

function describeAdjustments(
  platform: "facebook" | "instagram" | "gbp",
  input: InstantPostInput,
  context?: Record<string, unknown>,
) {
  const lines: string[] = [];

  switch (input.toneAdjust) {
    case "more_formal":
      lines.push("Lean more formal than usual while staying warm and welcoming.");
      break;
    case "more_casual":
      lines.push("Use extra casual phrasing and relaxed contractions.");
      break;
    case "more_serious":
      lines.push("Dial down jokes or slang; focus on trust and credibility.");
      break;
    case "more_playful":
      lines.push("Amp up playful wording and energy without sounding forced.");
      break;
  }

  switch (input.lengthPreference) {
    case "short":
      lines.push("Keep it to one or two punchy sentences.");
      break;
    case "detailed":
      lines.push("Offer a richer description with specific details that help guests imagine the experience.");
      break;
  }

  if (!input.includeEmojis) {
    lines.push("Avoid emojis entirely.");
  } else {
    lines.push("Use emojis sparingly and only where they enhance the message.");
  }

  if (!input.includeHashtags || platform === "gbp") {
    lines.push("Do not include hashtags in the copy.");
  }

  switch (input.ctaStyle) {
    case "direct":
      if (platform !== "instagram") {
        lines.push("Close with a clear, direct call to action (e.g. Book now, Reserve your table).");
      }
      break;
    case "urgent":
      if (platform !== "instagram") {
        lines.push("Close with an urgent CTA highlighting limited availability or time.");
      }
      break;
  }

  lines.push("Format any times like 6pm or 7:30pm (no spaces, lowercase am/pm).");

  if (platform === "facebook") {
    if (input.ctaUrl) {
      lines.push(
        "If a CTA URL is provided, include a clear call to action aligned with the CTA label/objective, but do not include the URL—our system appends it.",
      );
    } else {
      lines.push("Include a clear CTA suited to the venue (link optional).");
    }
  } else if (platform === "instagram") {
    if (input.linkInBioUrl || input.ctaUrl) {
      lines.push("Do not include any URLs—reference our link in bio instead.");
      lines.push("If a CTA label is provided, align the final link-in-bio line with it (e.g. Book now, Find out more).");
    } else {
      lines.push("Do not include URLs or link-in-bio language.");
    }
  }

  // Hook instruction from Copy Intelligence service
  const hookStrategy = extractContextString(context, "hookStrategy");
  if (hookStrategy) {
    const hookInstruction = extractContextString(context, "hookInstruction");
    if (hookInstruction) {
      lines.push(`Hook style: ${hookInstruction}`);
    }
  }

  if (!lines.length) {
    lines.push("Follow the brand defaults for tone, pacing, and CTA style.");
  }

  return lines.join("\n");
}

function describeToneTargets(brand: BrandProfile) {
  const formal = describeSlider(brand.toneFormal, "very casual", "balanced", "formal");
  const playful = describeSlider(brand.tonePlayful, "straightforward", "lightly playful", "playful and lively");
  return `Tone targets: Formality is ${formal}; Playfulness is ${playful}.`;
}

function describeSlider(value: number, low: string, mid: string, high: string) {
  const normalized = clamp01(value);
  if (normalized >= 0.7) return high;
  if (normalized <= 0.3) return low;
  return mid;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function isNonEmptyString(value: string | null | undefined | false): value is string {
  return Boolean(value);
}

function formatListLine(label: string, items: string[], joiner = ", ") {
  const cleaned = items.map((item) => item.trim()).filter(Boolean);
  if (!cleaned.length) return null;
  return `${label}: ${cleaned.join(joiner)}.`;
}

function formatOptionalLine(label: string, value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const withPunctuation = /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  return `${label}: ${withPunctuation}`;
}

function formatHashtagGuidance(brand: BrandProfile) {
  const defaults = brand.defaultHashtags.map((tag) => tag.trim()).filter(Boolean);
  if (!defaults.length) {
    return "Include up to 10 relevant hashtags.";
  }
  return `Include up to 10 hashtags. Prefer these defaults: ${defaults.join(" ")}.`;
}

function buildMediaLine(input: InstantPostInput) {
  if (!input.media?.length) {
    return "Media: none provided.";
  }
  const entries = input.media.map((asset) => {
    const label = asset.mediaType === "video" ? "Video" : "Image";
    const fileName = asset.fileName?.trim();
    return fileName ? `${label}: ${fileName}` : `${label}: attached`;
  });
  return `Media: ${entries.join("; ")}.`;
}

function buildContextBlock({
  scheduledFor,
  context,
}: {
  scheduledFor?: Date | null;
  context?: Record<string, unknown>;
}) {
  const lines: string[] = [];

  if (scheduledFor) {
    lines.push(`Post scheduled for ${formatDateTime(scheduledFor)} (local time).`);
  }

  const eventStart = parseIsoDate(context?.eventStart);
  if (eventStart) {
    lines.push(`Event starts ${formatDateTime(eventStart)}.`);
  }

  const promotionStart = parseIsoDate(context?.promotionStart);
  const promotionEnd = parseIsoDate(context?.promotionEnd);
  const promotionDateMode = extractContextString(context, "promotionDateMode");
  if (promotionEnd && promotionDateMode === "ends_on") {
    lines.push(`Promotion ends ${formatDate(promotionEnd)}.`);
  } else if (promotionStart && promotionEnd) {
    lines.push(`Promotion runs ${formatDate(promotionStart)} to ${formatDate(promotionEnd)}.`);
  } else if (promotionEnd) {
    lines.push(`Promotion ends ${formatDate(promotionEnd)}.`);
  }

  const toneCue = extractContextString(context, "temporalProximity");
  if (toneCue) {
    lines.push(`Timing tone: ${toneCue}`);
  }

  const ctaLabel = extractContextString(context, "ctaLabel");
  if (ctaLabel) {
    lines.push(`CTA label to use: ${ctaLabel}.`);
  }

  const phase = extractContextString(context, "phase");
  if (phase && phase !== "custom") {
    lines.push(`Campaign phase: ${phase}.`);
  }

  const slot = extractContextString(context, "slot");
  if (slot && !/^manual-\d+$/i.test(slot) && !/^custom-\d+$/i.test(slot)) {
    lines.push(`Campaign timing phase (internal guidance only — never use the word "slot" or this label verbatim in the copy): ${slot}.`);
  }

  if (!lines.length) return null;
  return `Timing and context:\n${lines.join("\n")}`;
}

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extractContextString(context: Record<string, unknown> | undefined, key: string) {
  if (!context) return null;
  const value = context[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function formatDateTime(date: Date) {
  const zoned = DateTime.fromJSDate(date, { zone: DEFAULT_TIMEZONE });
  return `${zoned.setLocale("en-GB").toFormat("cccc d LLLL")} at ${formatFriendlyTimeFromZoned(zoned)}`;
}

function formatDate(date: Date) {
  return DateTime.fromJSDate(date, { zone: DEFAULT_TIMEZONE }).setLocale("en-GB").toFormat("cccc d LLLL");
}

function getFewShotExamples() {
  return `
Example 1 (Facebook, Sunday roast event):
Join us for a proper Sunday roast this weekend. We're serving up slow-roasted beef with all the trimmings, including our massive Yorkies. It's the perfect way to gather the family before the week starts again. Book your table now to avoid missing out.

Example 2 (Instagram, sport):
The Six Nations is back on our screens. We'll be showing every match live — grab a pint and settle in for the action. Who are you backing this year?

Example 3 (Facebook, casual midweek):
Looking for the perfect spot for a midweek catch-up? Our burger and pint night is just the ticket. Great food, cold drinks, and even better company. See you at the bar!

Example 4 (GBP, lunch deal):
We're running a two-course lunch deal every weekday — £12.50 per person. Soup, a main from our kitchen, and tea or coffee included. Walk-ins welcome or book ahead for a table.

Grammar rules — strictly follow these:
- "we" is a SUBJECT pronoun: "We're serving...", "We'll be showing..."
- "us" is an OBJECT pronoun: "Join us", "Come to us", "Find us", "See you with us"
- NEVER write "come to we" or "join we" — these are always grammatically wrong
- Third-party subjects about guests are fine: "Kids are welcome", "Bring the whole crew", "All ages welcome"

POV guidance — wrong vs right:
WRONG: "Come to we this Friday for quiz night. The Anchor is hosting a great event. The Anchor welcomes everyone."
RIGHT: "Come to us this Friday for quiz night. We're hosting a great night — everyone's welcome, bring the whole crew."
`.trim();
}
```

### `src/lib/create/service.ts` — relevant excerpts

#### createInstantPost (lines 580-700)

```ts
    return `Make it crystal clear it ends in just hours (tonight by ${endTime})—push a final rush.`;
  }

  if (hoursUntilEnd <= 24) {
    return `Say it ends today (${endWeekday} ${endDayMonth}) and drive last-chance urgency.`;
  }

  const daysUntilEnd = Math.ceil(hoursUntilEnd / 24);
  if (daysUntilEnd <= 2) {
    return `Stress that it wraps in ${daysUntilEnd === 1 ? "one day" : "two days"} (by ${endWeekday} ${endDayMonth}).`;
  }

  if (daysUntilEnd <= 6) {
    return `Keep momentum going and remind guests it ends on ${endWeekday} ${endDayMonth}.`;
  }

  return `Reinforce the value while reminding followers it finishes on ${endWeekday} ${endDayMonth}.`;
}

function buildPromotionFocusLine(label: string, scheduledFor: Date | null, end: Date) {
  const cue = describePromotionTimingCue(scheduledFor, end);
  return `Focus: ${formatFocusLabel(label)} ${cue}`;
}

export async function createInstantPost(input: InstantPostInput) {
  const { accountId, supabase } = await requireAuthContext();
  const { brand, venueName, venueLocation } = await getOwnerSettings();

  const isScheduled = input.publishMode === "schedule" && Boolean(input.scheduledFor);
  const scheduledForDate = isScheduled ? ensureFutureDate(input.scheduledFor ?? new Date()) : null;
  if (isScheduled && (!input.media || input.media.length === 0)) {
    throw new Error("Scheduled posts require at least one media asset.");
  }
  const advancedOptions = extractAdvancedOptions(input);
  const resolvedCtaLabel = resolveDefaultCtaLabel("instant", input.ctaUrl, input.ctaLabel);

  const plans: VariantPlan[] = [
    {
      title: input.title,
      prompt: input.prompt,
      scheduledFor: scheduledForDate,
      platforms: input.platforms,
      media: input.media,
      promptContext: {
        title: input.title,
        publishMode: input.publishMode,
        useCase: "instant",
        proofPointMode: input.proofPointMode,
        proofPointsSelected: input.proofPointsSelected ?? [],
        proofPointIntentTags: input.proofPointIntentTags ?? [],
        ctaUrl: input.ctaUrl ?? null,
        ctaLabel: resolvedCtaLabel,
        linkInBioUrl: input.linkInBioUrl ?? null,
        placement: input.placement,
      },
      options: advancedOptions,
      ctaUrl: input.ctaUrl ?? null,
      linkInBioUrl: input.linkInBioUrl ?? null,
      placement: input.placement ?? "feed",
      planIndex: 0,
    },
  ];

  return createCampaignFromPlans({
    supabase,
    accountId,
    brand,
    venueName,
    venueLocation,
    name: input.title,
    type: "instant",
    metadata: {
      prompt: input.prompt,
      createdWith: "instant-post",
      publishMode: input.publishMode,
      advanced: advancedOptions,
      proofPointMode: input.proofPointMode,
      proofPointsSelected: input.proofPointsSelected ?? [],
      proofPointIntentTags: input.proofPointIntentTags ?? [],
      ctaUrl: input.ctaUrl ?? null,
      ctaLabel: resolvedCtaLabel,
      linkInBioUrl: input.linkInBioUrl ?? null,
      placement: input.placement ?? "feed",
    },
    plans,
    options: {
      autoSchedule: false,
    },
    linkInBioUrl: input.linkInBioUrl ?? null,
  });
}

/**
 * Pure helper: builds VariantPlan[] for an event campaign given the resolved
 * inputs. Extracted so the plan-building logic can be unit-tested without
 * mocking auth/Supabase/OpenAI.
 *
 * Story-placement plans are scheduled at 07:00 in DEFAULT_TIMEZONE on the
 * same calendar day as the resolved feed slot (via resolveStoryScheduledFor).
 */
export function buildEventCampaignPlans({
  input,
  eventStart,
  minimumTime,
  advancedOptions,
  basePrompt,
  eventCtaLabel,
  defaultPostingTime,
}: {
  input: EventCampaignInput;
  eventStart: Date;
  minimumTime: number;
  advancedOptions: InstantPostAdvancedOptions;
  basePrompt: string;
  eventCtaLabel: string | null;
  defaultPostingTime: string | null;
}): VariantPlan[] {
  const manualSchedule = input.customSchedule ?? [];
  const usingManualSchedule = manualSchedule.length > 0;

  return usingManualSchedule
```

#### createCampaignFromPlans + variant insert (lines 1340-1485)

```ts

async function createCampaignFromPlans({
  supabase,
  accountId,
  brand,
  venueName,
  venueLocation,
  name,
  type,
  metadata,
  plans,
  options,
  linkInBioUrl,
  bannerDefaults,
}: {
  supabase: SupabaseClient;
  accountId: string;
  brand: Awaited<ReturnType<typeof getOwnerSettings>>["brand"];
  venueName?: string;
  venueLocation?: string;
  name: string;
  type: string;
  metadata: Record<string, unknown>;
  plans: VariantPlan[];
  options?: {
    autoSchedule?: boolean;
  };
  linkInBioUrl?: string | null;
  bannerDefaults?: BannerDefaults;
}) {
  if (!plans.length) {
    throw new Error("Cannot create campaign without plans");
  }

  // Hoisted copy history — runs ONCE per campaign, not per plan
  const engagement = await fetchRecentCopyHistory(supabase, accountId);

  const variants = await buildVariants({ brand, venueName, venueLocation, plans, engagement });
  const shouldAutoSchedule = options?.autoSchedule ?? true;
  await resolveScheduleConflicts({ supabase, accountId, variants });

  const { data: campaignRow, error: campaignError } = await supabase
    .from("campaigns")
    .insert({
      account_id: accountId,
      name,
      campaign_type: type,
      status: "scheduled",
      metadata,
      link_in_bio_url: linkInBioUrl ?? null,
    })
    .select("id")
    .single();

  if (campaignError) throw campaignError;

  const nowIso = new Date().toISOString();

  // Per-campaign banner overrides written directly to content_variants.
  // Banners are rendered at publish time by the publish-queue worker; no
  // pre-render or banner_state lifecycle is needed.
  const bannerOverride = computeBannerOverride(bannerDefaults);

  const contentRows = variants.map((variant) => {
    const baseContext = { ...variant.promptContext, planIndex: variant.planIndex };
    return {
      campaign_id: campaignRow.id,
      account_id: accountId,
      platform: variant.platform,
      placement: variant.placement,
      scheduled_for: variant.scheduledFor ? variant.scheduledFor.toISOString() : nowIso,
      status: shouldAutoSchedule
        ? variant.scheduledFor
          ? "scheduled"
          : "queued"
        : "draft",
      prompt_context: baseContext,
      auto_generated: true,
      hook_strategy: variant.hookStrategy ?? null,
      content_pillar: variant.contentPillar ?? null,
    };
  });

  const { data: insertedContent, error: contentError } = await supabase
    .from("content_items")
    .insert(contentRows)
    .select("id, platform");

  if (contentError) throw contentError;

  const variantPayloads = (insertedContent ?? []).map((content, index) => {
    const variant = variants[index];

    return {
      content_item_id: content.id,
      body: variant?.body ?? "",
      media_ids: variant?.mediaIds.length ? variant?.mediaIds : null,
      validation: variant?.validation ?? null,
      ...(bannerOverride ?? {}),
    };
  });

  const { data: upsertedVariants, error: variantError } = await supabase
    .from("content_variants")
    .upsert(variantPayloads, { onConflict: "content_item_id" })
    .select("id, content_item_id");

  if (variantError) throw variantError;

  const variantIdByContent = new Map<string, string>();
  for (const row of upsertedVariants ?? []) {
    variantIdByContent.set(row.content_item_id, row.id);
  }

  for (const [index, content] of (insertedContent ?? []).entries()) {
    if (!shouldAutoSchedule) continue;
    const variantId = variantIdByContent.get(content.id);
    if (!variantId) {
      throw new Error(`Variant id missing for content ${content.id}`);
    }

    await enqueuePublishJob({
      contentItemId: content.id,
      variantId,
      placement: variants[index]?.placement ?? "feed",
      scheduledFor: variants[index]?.scheduledFor ?? null,
    });
  }

  const hasImmediate = variants.some((variant) => !variant.scheduledFor);
  const status = shouldAutoSchedule ? (hasImmediate ? "queued" : "scheduled") : "draft";
  const scheduledDates = variants
    .map((variant) => variant.scheduledFor?.getTime())
    .filter((timestamp): timestamp is number => Boolean(timestamp));
  const earliest = scheduledDates.length ? new Date(Math.min(...scheduledDates)).toISOString() : null;

  return {
    campaignId: campaignRow.id,
    contentItemIds: insertedContent?.map((row) => row.id) ?? [],
    status,
    scheduledFor: earliest,
  } as const;
}

async function buildVariants({
  brand,
```

#### buildVariants — story early return (lines 1530-1700)

```ts
        engagement.recentHooks.push(hookStrategy);

        contentPillar = inferContentPillar(plan.title, plan.prompt);
        pillarNudge = buildPillarNudge(contentPillar, engagement.recentPillars);
        engagement.recentPillars.push(contentPillar);
      }

      if (placement === "story") {
        const mediaIds = plan.media?.map((asset) => asset.assetId) ?? [];
        for (const platform of plan.platforms) {
          const lint = lintContent({
            body: "",
            platform,
            placement,
            context: {
              ...(plan.promptContext ?? {}),
              advanced: options,
              ctaUrl: planCta ?? null,
              linkInBioUrl: plan.linkInBioUrl ?? null,
            },
            advanced: options,
            scheduledFor: plan.scheduledFor ?? null,
          });
          if (!lint.pass) {
            throw new Error(`Generated content failed lint for ${platform}.`);
          }
          planVariants.push({
            platform,
            body: "",
            scheduledFor: plan.scheduledFor,
            promptContext: {
              ...(plan.promptContext ?? {}),
              advanced: options,
              ctaUrl: planCta ?? null,
              linkInBioUrl: plan.linkInBioUrl ?? null,
            },
            options,
            mediaIds,
            linkInBioUrl: plan.linkInBioUrl ?? null,
            placement,
            planIndex: plan.planIndex,
            validation: {
              lintPass: lint.pass,
              issues: lint.issues,
              repairsApplied: ["story_no_caption"],
              metrics: {
                ...lint.metrics,
                proofPointUsed: false,
                proofPointId: null,
                proofPointSource: null,
              },
              timestamp: new Date().toISOString(),
            },
          });
        }
        return planVariants;
      }

      const instantInput: InstantPostInput = {
        title: plan.title,
        prompt: plan.prompt,
        publishMode: plan.scheduledFor ? "schedule" : "now",
        scheduledFor: plan.scheduledFor ?? undefined,
        platforms: plan.platforms,
        media: plan.media,
        toneAdjust: options.toneAdjust,
        lengthPreference: options.lengthPreference,
        includeHashtags: options.includeHashtags,
        includeEmojis: options.includeEmojis,
        ctaStyle: options.ctaStyle,
        ctaUrl: planCta,
        linkInBioUrl: plan.linkInBioUrl ?? undefined,
        placement,
        proofPointMode: typeof plan.promptContext?.proofPointMode === "string"
          ? (plan.promptContext.proofPointMode as InstantPostInput["proofPointMode"])
          : "off",
        proofPointsSelected: Array.isArray(plan.promptContext?.proofPointsSelected)
          ? (plan.promptContext.proofPointsSelected as string[])
          : [],
        proofPointIntentTags: Array.isArray(plan.promptContext?.proofPointIntentTags)
          ? (plan.promptContext.proofPointIntentTags as string[])
          : [],
      };

      // Merge hook/pillar engagement into prompt context for prompts.ts to read
      const enrichedContext: Record<string, unknown> = {
        ...(plan.promptContext ?? {}),
        ...(hookStrategy ? { hookStrategy, hookInstruction } : {}),
        ...(pillarNudge ? { pillarNudge } : {}),
        ...(venueLocation ? { venueLocation } : {}),
      };

      const generated = await generateVariants({
        brand,
        venueName,
        input: instantInput,
        scheduledFor: plan.scheduledFor ?? null,
        context: enrichedContext,
      });
      for (const variant of generated) {
        planVariants.push({
          platform: variant.platform,
          body: variant.body,
          scheduledFor: plan.scheduledFor,
          promptContext: {
            ...(plan.promptContext ?? {}),
            advanced: options,
            ctaUrl: planCta ?? null,
            linkInBioUrl: plan.linkInBioUrl ?? null,
          },
          options,
          mediaIds: plan.media?.map((asset) => asset.assetId) ?? [],
          linkInBioUrl: plan.linkInBioUrl ?? null,
          planIndex: plan.planIndex,
          hookStrategy,
          contentPillar,
          placement,
          validation: variant.validation,
        });
      }
      return planVariants;
    })),
  );

  for (const planVariants of planResults) {
    variants.push(...planVariants);
  }

  return variants;
}

async function generateVariants({
  brand,
  venueName,
  input,
  scheduledFor,
  context,
}: {
  brand: Awaited<ReturnType<typeof getOwnerSettings>>["brand"];
  venueName?: string;
  input: InstantPostInput;
  scheduledFor?: Date | null;
  context?: Record<string, unknown>;
}): Promise<GeneratedVariantResult[]> {
  let client: ReturnType<typeof getOpenAIClient> | null = null;
  try {
    client = getOpenAIClient();
  } catch (error) {
    if (error instanceof Error && error.message.includes("OPENAI")) {
      throw new Error("Content generation is unavailable (missing OpenAI credentials).");
    }
    throw error;
  }

  const platformResults = await Promise.allSettled(
    input.platforms.map(async (platform): Promise<GeneratedVariantResult> => {
      try {
        const prompt = buildInstantPostPrompt({ brand, venueName, input, platform, scheduledFor, context });
        if (DEBUG_CONTENT_GENERATION) {
          console.debug("[create] openai prompt", {
            platform,
            title: input.title,
            prompt,
          });
        }
        const response = await client.responses.create({
          model: "gpt-4.1-mini",
          input: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
```

---

_End of appended source files._
