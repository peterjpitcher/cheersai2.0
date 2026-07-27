# SPEC: Text overlays on stories

**Status:** Approved in principle, ready for planning
**Date:** 2026-07-27 (revised after developer review `tasks/REVIEW-story-text-overlays.md`)
**Related:** PR #16 (opt-in per-post image overlays, 2 July 2026)

**Delivery:** three sequential PRs. Complexity 4 (L) for the programme, 3 (M) for the overlay PR alone.

| PR | Scope | Blocking? |
|---|---|---|
| 1 | Redact Facebook access tokens from logs, rotate exposed tokens | Yes, before the live story check in section 8 |
| 2 | Server-side media validation in `createScheduledBatch`: ownership + story eligibility | Recommended first, not a hard blocker |
| 3 | Story text overlays (this spec's feature) | The deliverable |

PRs 1 and 2 fix pre-existing defects on the story publish path. Neither is caused by this feature.

PR 1 genuinely blocks, on two counts: section 8 requires publishing a real Facebook story, which would write another Page token to the logs, and the existing leak needs rotating regardless.

PR 2 does not strictly block. Acceptance criterion 4 handles the missing-derivative case in the wizard, and a story with unpublishable media already fails today in exactly the same way. The argument for doing it first is quality, not correctness: overlays make people use stories more, and a user who types overlay text, sees a good preview and schedules it deserves not to discover at publish time that the media was never eligible. Sequencing is your call.

---

## 1. Decisions

Recorded from Peter, 2026-07-27:

1. **Stories were not deliberately excluded.** The guard was an implementation default. Unlocking it is the intent. This closes review finding F-01.
2. **Event stories get the automatic date label** (TONIGHT, THIS FRIDAY), exactly as event feed posts do. Full parity.
3. **A promotion targeting both feed and story shares one overlay text** across both rows.

Decision 2 resolves review finding F-02, which correctly identified that the original spec contradicted itself: acceptance criterion 6 required `banner_enabled = false` for blank text, while open question 2 recommended automatic event labels, which need `true`. Section 4 now states one rule.

The review recommended (F-19) shipping typed overlays only and deferring automatic labels and mixed placements. Declined: decisions 2 and 3 above are explicit. The rule in section 4.1 is single and testable, so the ambiguity F-19 was guarding against no longer exists.

---

## 2. Summary

Text overlays do not appear on stories because the app switches them off when the post is saved, not because anything is broken. One ternary in `createScheduledBatch` forces `banner_enabled: false` for every story row, and the create wizard hides the overlay text input on story cards.

The render and publish pipeline already supports stories end to end. This spec removes the guard, gives story cards the same overlay control feed cards have, adds the story-cropped preview that control needs, and fixes two defects that would otherwise make the feature unreliable.

---

## 3. Findings

### 3.1 The render and publish pipeline is already story-capable

| Component | Story-ready? | Evidence |
|---|---|---|
| Renderer | Yes | `src/lib/banner/render-server.ts:88` reads width/height off the source image via `sharp().metadata()`. Nothing is hardcoded to 1080x1080. |
| Geometry | Yes | `render-server.ts:44` derives everything from `Math.min(width, height)`. On 1080x1920: strip 76px wide, full height, 33px text. |
| Repeated label | Yes, by design | `src/lib/banner/palette.ts:31` states the repeat count of 21 is "large enough that even a 1920px-tall story strip is fully covered after rotation". |
| Test coverage | Yes | `src/lib/banner/render-server.test.ts:42` "produces a JPEG for 9:16 story" passes today. |
| Render API | Yes | `src/app/api/internal/render-banner/route.ts` takes `{sourceMediaUrl, config, label}`. No placement input needed. |
| Publish worker | Yes | `supabase/functions/publish-queue/worker.ts:237` `resolveAndRenderBanner` has no placement branch. |
| Story source image | Yes | `worker.ts:1277` selects `derived_variants.story` (1080x1920) when `placement === 'story'`. |

### 3.2 The gate

```ts
// src/app/actions/content.ts:884
const overlay = placement === 'story' ? null : normaliseBannerText(slot.bannerTextOverride);
// :889
const autoOverlayForEvent = placement !== 'story' && contentType === 'event';
```

Line 896 writes an explicit `banner_enabled: false`, so the account-default fallback in `bannerConfigResolver` cannot re-enable it.

The second gate is UI. `src/features/create/steps/generate-step.tsx:928` opens the branch holding the overlay input and preview, gated on `!isStorySchedule`. Story cards (876 to 925) get a bare image, a Replace/Add button, platform badges, and a static "Story media ready to schedule" message.

### 3.3 No documented reason for the exclusion

Introduced 2 July 2026 inside PR #16. That PR's discovery document raised "include the overlay input for stories, or feed posts only?" and never answered it. It also silently reversed two earlier decisions: 7 May 2026 ("stories vs feed posts: same rules everywhere") and 27 April 2026 (remove the placement gate on banner controls). Neither was marked superseded. Decision 1 in section 1 settles this.

### 3.4 The rule is enforced in only one of four write paths

No story guard exists in the database, in `updatePlannerBannerConfig`, in the instant-post path `buildInstantBannerOverride`, or in the worker. Only `createScheduledBatch` enforces it, plus the wizard UI.

### 3.5 Production state

Verified 2026-07-27 against project `nbkjciurhvkfpcpatbnt`. **Rerun this immediately before deploy and save the output** (review finding F-12): counts are time-sensitive and the "nothing pending is affected" conclusion can expire.

```sql
select ci.placement,
       count(*)                                                   as rows,
       count(*) filter (where cv.banner_enabled)                   as banner_on,
       count(*) filter (where cv.banner_text_override is not null) as has_text,
       count(*) filter (where cv.banner_enabled is null)           as banner_null,
       count(*) filter (where cv.banner_enabled is null
                          and ci.campaign_id is not null
                          and ci.status in ('scheduled','queued')) as null_campaign_pending
from content_variants cv
join content_items ci on ci.id = cv.content_item_id
group by ci.placement order by ci.placement;
```

Result on 2026-07-27:

| Placement | Rows | banner_on | has_text | banner_null | null + campaign + pending |
|---|---|---|---|---|---|
| feed | 674 | 63 | 14 | 590 | 0 |
| story | 378 | 0 | 0 | 310 | 0 |

No story has ever carried an overlay. The single account has `posting_defaults.banners_enabled = true`, which is why writing an explicit `false` matters: a NULL story row attached to a campaign would otherwise inherit the account default and render the proximity label.

### 3.6 What parity with posts actually means

Posts expose one control: free text, max 20 characters, uppercased, letters, numbers, spaces, `£` and basic punctuation (`src/lib/banner/text.ts`).

Position and colour are **not** customisable for any placement. `bannerConfigResolver` (`src/lib/banner/config.ts:44-48`) discards the stored `banner_position`, `banner_bg` and `banner_text_colour` columns and returns fixed values: right edge, `#a57626`, white. The AA-compliant green in `BANNER_PALETTES` is unreachable dead code. Parity therefore means the text field and the automatic event label, and nothing more.

### 3.7 Preview URLs are feed-only (review finding F-04, confirmed)

`MediaAssetSummary` (`src/lib/library/data.ts:16-30`) carries exactly one URL field, `previewUrl`, plus a `previewShape` hint. `derivedVariants` is a map of **storage paths**, not URLs, and the media bucket is private (`src/app/(app)/library/actions.ts:1165`), so `derivedVariants.story` cannot be used as an `<img src>`.

Worse, `previewUrl` is resolved with `placement: "feed"` hardcoded (`data.ts:154-160`), and feed ordering hoists the **original upload** ahead of any derivative (`data.ts:240-246`). So the wizard preview today is the raw upload, not even the square crop.

One useful fact: `listMediaAssets` already batch-signs every candidate path including `derivedVariants.story` (`data.ts:162-172`), then discards all but the first hit (`data.ts:190-197`). Exposing the story URL from the list path costs no extra storage round trip.

This means the original spec's "preview the story crop" could not be implemented from the props the wizard has. Section 5.3 adds the contract.

---

## 4. Design

### 4.1 The overlay rule (single, for all placements)

> An overlay is enabled when the user has typed overlay text, **or** the content type is `event`. Typed text wins over the automatic label. Blank text on a non-event post means no overlay. This rule is identical for feed and story.

Concretely, `createScheduledBatch` becomes:

```ts
const overlay = normaliseBannerText(slot.bannerTextOverride);
const autoOverlayForEvent = contentType === 'event';
// banner_enabled: overlay !== null || autoOverlayForEvent
// banner_text_override: overlay
```

Both changes are deletions of the `placement` clause. Nothing else in that block changes.

Turning the automatic label off for a specific event story is not possible today and is not possible for event feed posts either. That asymmetry does not exist, so nothing new is introduced. If per-post suppression is wanted later it is a separate change affecting both placements.

### 4.2 Chosen visual approach: reuse the existing strip unchanged

No renderer, resolver, route or worker changes.

**Why.** The strip renders a label repeated 21 times along its length, so clipping the ends loses no information. That makes it tolerant of Instagram story UI chrome at the top and bottom. The repeat count was sized for a 1920px story strip deliberately. The 9:16 render path is built, wired, and covered by a passing test.

**Rejected: story-specific safe-zone geometry.** Requires un-fixing `buildBannerSvg` to read the config it currently ignores, adding placement to the render route contract, threading it through the worker, and mirroring it in the React preview. It also needs Instagram safe-zone insets, which are not defined anywhere in this repo. The commonly cited figures are roughly 250px top and bottom on a 1080x1920 canvas; nothing here verifies them and this spec does not treat them as established. Guessing geometry before seeing a real story render is the wrong order.

**Rejected: a satori-based story renderer** modelled on `src/lib/tournament/overlay.ts`. Adds a second visual language and a new publish-time dependency for a 20-character label.

If the strip looks wrong on a real story, geometry becomes a follow-up with evidence.

### 4.3 Preview fidelity: representative, not pixel-faithful

Review finding F-05 is accepted. The React preview uses the browser font and a viewport-based `clamp()` size; the server uses bundled Noto Sans, SVG paths and image-relative geometry. These will not match exactly.

The spec claims only this, and acceptance criterion 3 is worded to match:

> The story preview uses the same crop, strip position, colours and label text as the published image, with approximate typography.

Getting the **crop** right is the part that matters and the part section 5.3 delivers. Pixel fidelity would mean rendering previews through the real renderer, which is out of scope.

---

## 5. Changes (PR 3)

**A. Remove the write-time guard.** `src/app/actions/content.ts:884` and `:889`, per section 4.1. Update the comments at 879 to 888 that assert "Stories never carry an overlay".

**B. Show the overlay input on story cards.** `src/features/create/steps/generate-step.tsx`

Extract the input at 1037 to 1070 into a local helper, call it from both the story branch and the feed branch. Two traps:
- Story slots are force-approved (`approved: true`, line 253) and have no Approve button. The feed call site passes `disabled={isApproved || isBusy}`, which on a story card renders the input permanently read-only. The story call site must pass `disabled={isBusy}`.
- Remove `!isStorySchedule` from the `autoOverlayLabel` computation at line 748, so event story cards show the `Auto: THIS FRIDAY` placeholder that matches what the worker will print.

**C. Preview the overlay on story cards.** `src/features/create/steps/generate-step.tsx:884`

Replace the bare `<img>` with the same conditional used at 969 to 983. `BannerOverlay` is already imported (line 38); `slotBannerConfig` and `slotOverlayText` are already in scope from 763 to 775, computed outside any story gate.

**D. Preserve overlay text on story slots.** `src/features/create/steps/generate-step.tsx:244`

The story auto-seed effect rebuilds slot copies and omits `bannerTextOverride`. Typing alone is safe because the signature at 109 to 122 also omits it, so the effect early-returns. But when any other signature field changes, typically when the user replaces the slot's media, the rebuild silently discards typed text.

Add `bannerTextOverride: existing?.bannerTextOverride` to `nextCopies`, and add the field to `storyCopySignature`.

**E. Allow editing a story's overlay in the planner.** `src/features/planner/post-drawer.tsx:326`

Drop the `content.placement !== 'story'` clause from `canEdit`. `updatePlannerBannerConfig` already has no story guard.

Editable statuses are already `draft`, `scheduled`, `queued`, `failed` (`BANNER_EDITABLE_STATUSES`, `src/lib/scheduling/banner-config.ts:158`), enforced client-side at `banner-controls.tsx:37` and server-side at `planner/actions.ts:1306`. Acceptance criterion 8 states them explicitly rather than saying "an existing story".

**F. Correct the type comment.** `src/types/content.ts:78`. "Stories never carry an overlay" is now false.

**G. Mixed feed-and-story placements.** `src/features/create/steps/generate-step.tsx:186-194`

A brief with `placements: ['feed','story']` currently resolves `contentPlacement` to null and takes the feed branch, so the user never sees a story preview for rows that will be created. Per decision 3 the text is shared; the preview must not be.

Show both previews on the card for mixed placements: the existing feed preview column plus one 9:16 story preview, sharing the single overlay text field. On narrow viewports stack them, feed first.

**H. Alt text on BannerOverlay.** `src/features/planner/banner-overlay.tsx:14-19` and `:61-66`

`BannerOverlay` hardcodes `alt=""` with no way to override. Whenever an overlay is present, the filename is already lost on the **feed** path too (`generate-step.tsx:968-983`), so this is pre-existing and not a story regression. Add an optional `alt?: string` prop defaulting to `""` so existing call sites are unchanged, and pass a meaningful value from the wizard. Use a stable description such as `"Post media"` (matching `planner-calendar.tsx:394`), not the raw filename, which is poor alt text.

### 5.3 Story preview URL contract (required by change C)

Add a story-cropped signed URL to the wizard's asset payload:

1. **`MediaAssetSummary`** (`src/lib/library/data.ts:16-30`): add `storyPreviewUrl?: string`.
2. **`listMediaAssets`** (`data.ts:167-204`): keep the story-ordered first signed hit instead of discarding it. The path is already in the batch at `data.ts:162-164`, so this adds no storage call.
3. **`finaliseMediaUpload`** and **`updateMediaAsset`** (`src/app/(app)/library/actions.ts:228-238`, `:308-318`): `signPreviewFromCandidates` returns on first success (`actions.ts:1187-1205`) and so never signs story. Sign both orderings, or switch to one batch `createSignedUrls` call. `mapToSummary` (`actions.ts:1208-1240`) must carry the new field.
4. **`fetchMediaAssetPreviewUrl`** (`actions.ts:1242-1272`): accept a `placement` argument; it is currently feed-hardcoded and is what `media-attachment-selector.tsx:105` calls for lazily loaded assets.
5. **`generate-step.tsx:884` and `:968-979`**: use the story URL when the slot renders at story placement.

**Fallback, stated explicitly:** when `derivedVariants.story` is absent, show a "Story crop not ready" state on the card. Do not silently draw the overlay on the feed image. A missing story derivative already marks the asset `failed` (`actions.ts:165-167`) and PR 2 will block scheduling it, so this state should be rare and must not look normal.

---

## 6. Prerequisite PRs

### PR 1: Facebook access token in logs (review finding F-08, confirmed, more sites than reported)

`supabase/functions/publish-queue/providers/facebook.ts` logs a URL containing the Page access token, at **two** unconditional sites, not one:

```
:62   const uploadUrl = `${GRAPH_BASE}/${pageId}/photos?access_token=${auth.accessToken}`;
:73   console.info("[facebook] story upload payload", { uploadUrl, ... });
:108  console.info(... , { publishUrl, ... });
```

Both are on the story publish path.

Required:
1. Remove `uploadUrl` and `publishUrl` from both `console.info` calls. Log status, traceId and truncated body only.
2. Move the token out of the query string into the FormData body, as the feed path already does at `facebook.ts:146-151`, so no future log or error handler can re-leak it.
3. Add a test asserting no story-path log argument contains `access_token`.
4. **Human action:** treat Page tokens already written to Supabase logs as compromised. Reconnect or rotate affected Page connections. Scrub `docs/facebook-story-issue.md:8` and `:27`, which also contain tokens.

This must land before any live Facebook story test.

### PR 2: Server-side media validation in `createScheduledBatch` (review findings F-06 and F-07, both confirmed)

These are one code change: load the submitted media rows once, validate them, then write.

**Ownership (F-07).** There is no `account_id` check on client-supplied media UUIDs anywhere in the write path. `createScheduledBatch`'s input is a plain TypeScript interface with no Zod validation. `content_variants.media_ids` is what drives publishing (`worker.ts:819`, `worker.ts:1250`), independently of the RLS-protected attachments table, and the worker resolves media by ID with service-role and no account filter (`worker.ts:1265`). A user who obtains another account's media UUID can get that asset published from their own account.

Exploitability requires knowing a UUID, which is not enumerable through the API, so this is IDOR-class rather than trivially exploitable. It matters more now the product is multi-brand.

**Story eligibility (F-06).** The only story media check is a count-of-zero test (`content.ts:725-732`). The worker requires exactly one asset, `media_type = 'image'`, and a non-empty `derived_variants.story`. A story with two images, or a video, or a missing derivative can be scheduled today and is guaranteed to fail at publish, after the UI has said "Story media ready to schedule".

Required, as one pre-write all-or-nothing gate alongside the existing overlay-text loop at `content.ts:690-695`:
- Load every unique submitted media ID and reject any not owned by `accountId`.
- For story placements, reuse the story branch of `getPublishReadinessIssues` (`src/lib/publishing/preflight.ts:117-155`), which already has the plain-English messages, or inline the same three checks.
- Constrain the wizard's per-slot media modal for story placement: pass an `isAssetSelectable` predicate (image, `processedStatus === 'ready'`, `derivedVariants.story` present) and cap selection at one, replacing the current `() => true`.
- Stop the story card showing "Story media ready to schedule" when the attached media cannot publish.
- Make the attachment insert failure fatal, or remove it as a duplicate source of truth.
- Add `account_id` defence-in-depth filters to the worker's media queries.
- Tests: cross-account media ID rejected; two-image story rejected; video story rejected; missing story derivative rejected.

---

## 7. Acceptance criteria (PR 3)

1. A story slot in the generation flow shows an "Image overlay (optional)" input with the same 20-character limit, charset rules and helper text as a feed post.
2. The input is editable on a story card, not disabled by the forced-approved state.
3. Typing overlay text updates the story card preview live, drawn over the **story-cropped** image at 9:16, with the same strip position, colours and label text as the published image and approximate typography.
4. When the selected media has no story derivative, the story card shows "Story crop not ready" rather than previewing over the feed image.
5. Replacing the media on a story slot preserves typed overlay text.
6. Scheduling a story with overlay text writes `banner_enabled = true` and the normalised `banner_text_override`.
7. Scheduling a **non-event** story with blank overlay text writes an explicit `banner_enabled = false`, never NULL, and a NULL `banner_text_override`.
8. Scheduling an **event** story with blank overlay text writes `banner_enabled = true` and a NULL `banner_text_override`, so the worker prints the computed proximity label. This matches event feed posts exactly.
9. An event story card shows the `Auto: <label>` placeholder in the overlay input.
10. Publishing a story with an overlay produces an image with the strip composited onto the 1080x1920 derivative, and that image is what the provider receives.
11. A story in `draft`, `scheduled`, `queued` or `failed` state can have its overlay edited from the planner drawer. Other statuses remain read-only.
12. For a brief with both feed and story placements, the card shows a feed preview and a 9:16 story preview, both driven by one shared overlay text field, and both rows are written with that text.
13. Feed post overlay behaviour is unchanged: same strip, same colours, same automatic event label.
14. `BANNER_OVERLAY_DISABLED` bypasses the overlay for stories exactly as for feed posts.

---

## 8. Testing

Review finding F-14 is accepted: the existing 9:16 renderer test proves only that a JPEG comes out. The boundaries are where failures will hide.

**Must update:**
- `tests/app/actions/content.test.ts:509` "forces banner off on story placements even when overlay text is supplied". Invert.

**Must add, by area:**

*Persistence* (`tests/app/actions/content.test.ts`): story with typed text; non-event story with blank text writes explicit `false`; event story with blank text writes `true` + NULL override; mixed feed/story writes the same text to both rows.

*Wizard* (`src/features/create/generate-step.test.tsx`, whose fixture at line 41 has `derivedVariants: {}` and will need a story variant): overlay input renders and is enabled on a story slot; typing propagates `bannerTextOverride`; story slot with text renders `BannerOverlay`; story slot uses the story preview URL; missing story derivative shows the not-ready state; media replacement preserves text; event story shows the auto placeholder; draft save and resume preserves text; invalid text blocks the final action.

*Preview URL* (`src/lib/library/data.test.ts`): the story-signed URL survives `listMediaAssets`; fresh upload returns one.

*Worker to provider* (`tests/publish-queue.test.ts`): a story variant with `banner_enabled` selects `derived_variants.story` as the render source, calls the render route, uploads to `banners/{contentId}/{variantId}.jpg`, and passes that path to both the Instagram and Facebook story providers.

*Planner* (`src/features/planner/post-drawer.test.tsx`): banner controls editable for a story in each editable status, read-only otherwise.

**Must still pass unchanged:** `src/lib/banner/render-server.test.ts`, `src/lib/banner/config.test.ts`, `tests/publish-queue-banner-label.test.ts`.

**Full gate:** `npm run ci:verify` (lint, typecheck, test, build), not just the named files.

**Live verification** (review finding F-13). Before merge, name in the PR: the environment, the Meta account, the owner, the planned publish time, cleanup, and where evidence is stored. Preferred route is a guarded production canary after PR 3 merges but before the control is generally exposed, because the render path crosses Vercel, Supabase Storage, the edge worker and Meta, and a PR preview alone does not exercise it. Publish one Instagram story **and** one Facebook story (review finding F-18: the two providers use different upload flows, so Instagram success does not verify Facebook). Capture screenshots and job IDs. Confirm the strip is legible, the middle of the repeated label sits clear of the top and bottom UI chrome, and the published asset is the 9:16 derivative.

---

## 9. Out of scope

- Overlay position, colour, size or font customisation, for any placement.
- Story-specific safe-zone geometry. Revisit only if the live check shows a problem.
- Per-post suppression of the automatic event label. Does not exist for feed posts either.
- Pixel-faithful previews (section 4.3).
- Removing the dead `banner_position`, `banner_bg`, `banner_text_colour` columns.
- Video stories. Overlays apply to image posts only (`worker.ts:1278`).

**Deferred to separate non-blocking tickets:**

*Banner contrast.* White on `#a57626` measures 4.02:1, failing WCAG AA for normal text (4.5:1); the preview text is at most 13.12px bold, so the 3:1 large-text allowance does not apply. White on `#005131` measures 9.45:1 and passes, but green is unreachable because `bannerConfigResolver` hardcodes the gold. Pre-existing on five surfaces plus every published image, including all 63 live feed posts. The fix is a brand decision: darken the gold (roughly `#7d5a1d` or darker reaches 4.5:1) or re-enable palette selection.

*Planner edit race.* The reviewer's stated mechanism (F-09) is wrong: the cutoff is not the job claim at `worker.ts:669` but the variant re-read at `worker.ts:705`. An edit landing between those two is honoured. The genuine lossy window is between `loadVariant` (`:705`) and `markContentStatus("publishing")` (`:792`), during which the action returns success while the worker renders a stale value. That window contains one or two same-region Postgres round trips, so roughly 10 to 100ms. The cheap fix is a worker one-liner: move `markContentStatus` to immediately after `lockJob` succeeds, checking that the early-return paths between them reset status correctly. Pre-existing, shared with feed posts and with the media-swap action.

*Worker fetch hardening.* The render fetch at `worker.ts:345` has no `AbortSignal`, and the route has no `maxDuration`. The reviewer's causal concern (F-16, story render pushing a story past its 5-minute grace window) is refuted by ordering: the grace check at `worker.ts:685` runs **before** the render at `worker.ts:798`, on a clock captured at `worker.ts:665`, so a story is never made late by its own render, and a render failure is `retryable: false` and surfaces as `BANNER_RENDER_FAILED`, not "Story missed its scheduled window". The real residual risk is that `worker.ts:523` processes up to 20 jobs serially, so one hung render delays later jobs head-of-line, and `recoverStuckJobs` only re-queues after 15 minutes. Pre-existing and already carried by every feed post with an overlay. Fix repo-wide: all three worker fetches (`:345`, `:965`, `:1106`) are untimed.

*Render telemetry.* No structured record of render duration, placement, source and output bytes, or failure category. Add safe telemetry (never log signed URLs or secrets) and an alert on `BANNER_RENDER_FAILED` rate before general release.

---

## 10. Risk and rollback

| Risk | Likelihood | Mitigation |
|---|---|---|
| Strip looks wrong on a real 9:16 story | Medium | Live canary in section 8 before general exposure. The repeated label tolerates clipping by design. |
| Regression to the 63 live feed posts with overlays | Low | No renderer, resolver, route or worker changes. Existing tests pin the feed path. |
| Event stories get an unwanted date strip | Medium | Explicit decision 2. Visible as the `Auto:` placeholder before scheduling, and overridable by typing. |
| Preview does not match published output | Medium | Crop is corrected (section 5.3); typography is explicitly approximate (section 4.3). |
| Story scheduled that cannot publish | Medium, pre-existing | Unchanged by this work, but more likely to be hit as story use grows. Criterion 4 stops the wizard previewing over ineligible media. PR 2 removes it at write time. |
| Hung render delays later jobs | Low, pre-existing | Unchanged by this work. Tracked as a separate hardening ticket. |

**Rollback.** Review finding F-11 is accepted: the original rollback SQL had no status, date or ID filter and would have wiped valid overlay history across all 378 story rows, including published ones.

Code rollback does not require data changes. Reverting PR 3 restores the write-time guard, so no new story rows get overlays. Story rows written during the window keep their flag, which is harmless for published rows and simply means a pending story publishes with the overlay the user asked for.

If data rollback is genuinely required:
1. Capture the affected content IDs during rollout. Do not infer them later.
2. Update only that reviewed list, and only rows still in a pre-publish status.
3. Count and export before updating.

```sql
-- Review this list before running anything. Substitute real IDs.
select cv.content_item_id, ci.status, cv.banner_enabled, cv.banner_text_override
from content_variants cv join content_items ci on ci.id = cv.content_item_id
where cv.content_item_id in (:captured_ids) and ci.status in ('draft','scheduled','queued');
```

Never run an unscoped update against `content_variants`.

**Kill switch.** `BANNER_OVERLAY_DISABLED=true` on Supabase disables overlays everywhere, stories included, without a deploy. This is the preferred first response to a live problem.

---

## 11. Review findings disposition

| ID | Verdict after verification | Disposition |
|---|---|---|
| F-01 | Resolved | Decision 1 |
| F-02 | Confirmed, real contradiction | Fixed by decision 2 and section 4.1 |
| F-03 | Confirmed | Change G, criterion 12 |
| F-04 | Confirmed | Section 5.3 |
| F-05 | Confirmed | Section 4.3, criterion 3 reworded |
| F-06 | Confirmed, pre-existing | PR 2 |
| F-07 | Confirmed, pre-existing, IDOR-class | PR 2 |
| F-08 | Confirmed, two log sites not one, pre-existing | PR 1 |
| F-09 | Partly confirmed, mechanism misidentified | Deferred ticket, section 9 |
| F-10 | Confirmed | Draft-resume and invalid-submit tests, section 8 |
| F-11 | Confirmed, spec error | Section 10 rewritten |
| F-12 | Confirmed | Query added, section 3.5 |
| F-13 | Confirmed | Section 8 live verification |
| F-14 | Confirmed | Section 8 test matrix |
| F-15 | Confirmed | Three PRs, L for the programme |
| F-16 | Partly confirmed, causal risk refuted by ordering | Deferred ticket, section 9 |
| F-17 | Confirmed, both halves, both pre-existing | Alt in change H; contrast deferred |
| F-18 | Confirmed | Both providers in the live check |
| F-19 | Declined | Decisions 2 and 3 are explicit |
