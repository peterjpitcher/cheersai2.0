# Developer review: Text overlays on stories

**Reviewed specification:** `tasks/SPEC-story-text-overlays.md`  
**Review date:** 2026-07-27  
**Review scope:** Product requirements, current implementation, data flow, security, delivery, testing, operations, accessibility, and current Meta integration constraints  
**Original specification changed:** No

## Executive summary

The core idea is technically sound: the renderer can process a 1080x1920 image, the worker already selects the story derivative, and removing the write-time story guard will allow a typed story overlay to reach the existing render path.

The specification is **not ready for implementation or release approval yet**. The main blockers are:

1. The required behaviour for automatic event-story labels is contradictory.
2. The wizard does not currently have a signed URL for the story derivative, so the promised accurate preview cannot be implemented as described.
3. Story media is not fully validated before rows are written. The UI can select multiple assets or video, while the worker requires exactly one ready image with a story derivative.
4. The mixed feed-and-story journey is not designed even though the proposed persistence change affects it.
5. The rollback SQL is much broader than its description and could erase valid overlay data.
6. Two pre-existing security issues exist in the same story delivery path: media IDs are not checked against the account, and the Facebook story provider logs a URL containing the access token.
7. The test, deployment, monitoring, and live-verification plans do not yet prove the feature safely end to end.

The work is more likely **M/L rather than M** once the preview URL contract, server-side media validation, security fixes, mixed-placement behaviour, and delivery evidence are included.

## Priority and classification

- **Critical:** Must be resolved before release.
- **High:** Required for a reliable implementation or release decision.
- **Medium:** Should be addressed or explicitly accepted as follow-up debt.
- **Low:** Useful improvement with limited release risk.
- **Confirmed issue:** Verified in the current repository or directly contradicted inside the specification.
- **Unconfirmed assumption:** Cannot be proved from the repository and needs an owner or fresh evidence.
- **Optional improvement:** Not required for the basic feature, but would reduce risk or simplify delivery.

## Findings summary

| ID | Finding | Priority | Type | Classification |
|---|---|---:|---|---|
| F-01 | Product approval is still an assumption | High | Product decision | Unconfirmed assumption |
| F-02 | Automatic event-story behaviour is contradictory | Critical | Product / functional | Confirmed issue |
| F-03 | Mixed feed-and-story creation is not designed | High | Functional / UX | Confirmed issue |
| F-04 | The story derivative has no usable URL in the wizard | High | Technical / data | Confirmed issue |
| F-05 | “Preview what will publish” is stronger than the proposed implementation | High | UX / testing | Confirmed issue |
| F-06 | Story media validation does not match worker requirements | Critical | Functional / reliability | Confirmed issue |
| F-07 | Submitted media IDs are not checked for account ownership | Critical | Security / data | Confirmed issue |
| F-08 | Facebook story logging exposes the access token | Critical | Security / operations | Confirmed issue |
| F-09 | Planner edit scope and publish-time race are undefined | High | Functional / concurrency | Confirmed issue |
| F-10 | Draft resume and invalid story states need explicit behaviour | Medium | Functional / UX | Confirmed issue |
| F-11 | The rollback SQL is destructive and incorrectly scoped | Critical | Deployment / data | Confirmed issue |
| F-12 | Production-state claims are time-sensitive and not reproducible | High | Data / migration | Unconfirmed assumption |
| F-13 | The live verification plan lacks a deliverable environment and owner | High | Delivery / integration | Confirmed issue |
| F-14 | The proposed tests do not prove the complete story path | High | Testing | Confirmed issue |
| F-15 | The complexity and file estimates are too low | High | Delivery / planning | Confirmed issue |
| F-16 | Monitoring, performance, and storage impact are not covered | Medium | Observability / performance | Confirmed issue |
| F-17 | Accessibility requirements are incomplete | Medium | Accessibility | Confirmed issue |
| F-18 | Platform eligibility and cross-platform evidence are missing | Medium | Integration / delivery | Optional improvement |
| F-19 | The first release can be simplified | Medium | Scope / delivery | Optional improvement |

## Detailed findings

### F-01 — Product approval is still an assumption

- **Relevant section:** 2.3, 3, 9 question 1
- **Priority:** High
- **Type:** Product decision
- **Classification:** Unconfirmed assumption
- **Description:** The specification assumes that story overlays were excluded accidentally. The repository proves when the guard was added, but not whether it represented a product decision. The document is also marked “Draft, awaiting approval.”
- **Rationale:** This is the authority for the entire change. Technical evidence cannot replace product approval.
- **Impact:** The team could implement behaviour that the product owner intentionally excluded.
- **Recommended action:** Record a named decision owner and answer question 1 before implementation. Change the status only after approval.
- **Open questions:** Who owns the decision? Is approval for typed overlays only, or full feed parity including automatic event labels?
- **Suggested wording:** “Decision: [owner, date] approved user-entered image overlays for story placements. Automatic event-story labels are [included/excluded].”

### F-02 — Automatic event-story behaviour is contradictory

- **Relevant section:** 4.2 A-C, 5 criteria 6 and 9, 9 question 2
- **Priority:** Critical
- **Type:** Product / functional
- **Classification:** Confirmed issue
- **Description:** The proposed code change removes only the typed-text story guard. It leaves `autoOverlayForEvent = placement !== 'story' && contentType === 'event'`. The preview also excludes story auto-labels with `!isStorySchedule`. Acceptance criterion 6 says a story with no typed text must write `banner_enabled = false`, but open question 2 recommends automatic event-story labels, which would require `true`. The planner controls also ignore the automatic label when the override is null.
- **Rationale:** These paths would display, save, and edit different meanings for the same event story.
- **Impact:** A developer cannot implement one behaviour that satisfies the design, acceptance criteria, recommendation, preview, and planner at the same time.
- **Recommended action:** Choose one rule and update all affected places: persistence, generation preview, placeholder/help text, planner display/edit behaviour, acceptance criteria, and tests. The safer first release is typed story overlays only.
- **Open questions:** Are event stories opt-in like other stories, or automatically bannered like event feed posts? If automatic, how does a user explicitly turn the automatic label off?
- **Suggested wording:** “For all story placements, blank text means no overlay, including event stories” **or** “Event stories automatically use the proximity label unless the user explicitly disables or overrides it.”

### F-03 — Mixed feed-and-story creation is not designed

- **Relevant section:** 3 goals 1-2, 4.2 B-C, 4.3, 9 question 3
- **Priority:** High
- **Type:** Functional / UX
- **Classification:** Confirmed issue
- **Description:** A promotion slot can produce both feed and story rows. In `GenerateStep`, a brief containing both placements follows the feed branch, so there is no story card or 9:16 story preview. Removing the persistence guard will apply the one text value to both rows, but the user will see only the feed preview.
- **Rationale:** This is not a rare implementation detail; it is a separate user journey with two publish outputs.
- **Impact:** Users can approve a story overlay they never saw against the story crop. This conflicts with the preview-fidelity goal.
- **Recommended action:** Define the mixed-placement experience. At minimum, show feed and story previews side by side while keeping one shared text field. If this is deferred, explicitly exclude mixed placements from the first release and keep the story write guard for that case.
- **Open questions:** Can feed and story have different text? Can either placement disable the shared overlay independently? Which preview is shown on small screens?

### F-04 — The story derivative has no usable URL in the wizard

- **Relevant section:** 4.3
- **Priority:** High
- **Type:** Technical / data
- **Classification:** Confirmed issue
- **Description:** `MediaAssetSummary.derivedVariants.story` is a private storage path, not a browser-safe URL. The wizard receives one signed `previewUrl`, currently selected with feed ordering. The story derivative may already be signed inside `listMediaAssets`, but its signed URL is discarded. Fresh uploads also return only one feed-oriented signed preview.
- **Rationale:** Passing `derivedVariants.story` to `<img>` or `BannerOverlay` will not work for a private bucket.
- **Impact:** Acceptance criterion 3 cannot be implemented from the current props. The true file and test scope is larger than stated.
- **Recommended action:** Define a placement-aware preview contract. Preferred options:
  1. Add `previewUrls.feed` and `previewUrls.story` to `MediaAssetSummary` and populate them in `listMediaAssets` and `finaliseMediaUpload`; or
  2. Extend `fetchMediaAssetPreviewUrl(assetId, placement)` and cache on-demand story URLs in `GenerateStep`.

  The first option avoids client loading states and can reuse paths already batch-signed by `listMediaAssets`.
- **Open questions:** What is the signed URL TTL? What should the UI show if the story URL expires during a long wizard session? Should missing story derivatives be a fallback or a blocking error?
- **Suggested wording:** Replace “use `derivedVariants.story`” with “use a signed preview URL resolved for `placement: 'story'`; storage paths must never be sent directly to the image component.”

### F-05 — “Preview what will publish” is stronger than the proposed implementation

- **Relevant section:** 3 goal 2, 4.3, 5 criterion 3
- **Priority:** High
- **Type:** UX / testing
- **Classification:** Confirmed issue
- **Description:** Using the correct crop fixes the largest mismatch, but `BannerOverlay` is still an approximation. The server uses the bundled Noto Sans font, SVG paths, and image-relative 7%/44% geometry. The React preview uses the browser font, CSS writing mode, and a viewport-based `clamp()` font size.
- **Rationale:** On a narrow 9:16 card, text size, spacing, clipping, and glyph shape can differ materially from the published JPEG.
- **Impact:** The central promise that the preview shows “what will actually publish” is not objectively met.
- **Recommended action:** Decide whether the preview is representative or pixel-faithful. For representative fidelity, soften the wording and add a 9:16 visual regression test. For pixel fidelity, generate the preview through the real renderer or share exact font and geometry between server and client.
- **Open questions:** What visual difference is acceptable? Is a screenshot/golden test required? Who signs off the story appearance?
- **Suggested wording:** “The story preview uses the same crop, position, colours, label, and approximate typography as publish output.”

### F-06 — Story media validation does not match worker requirements

- **Relevant section:** 4.2 B-C, 4.3, 5 criteria 3 and 7, 7 video stories
- **Priority:** Critical
- **Type:** Functional / reliability / error handling
- **Classification:** Confirmed issue
- **Description:** `createScheduledBatch` checks only that each story slot has at least one media ID. The per-slot picker can select multiple assets or video. The worker later requires exactly one image and a non-empty `derived_variants.story`. A fallback preview can therefore look acceptable while the scheduled job is guaranteed to fail.
- **Rationale:** Validation at publish time is too late; the user has already been told the story is ready and scheduled.
- **Impact:** Predictable failed jobs, misleading previews, and poor recovery. Typed overlays make the unsupported video state more confusing because the input can be shown but never rendered.
- **Recommended action:** Before any writes, load all unique submitted media IDs and validate:
  - ownership by the current account;
  - exactly one media asset for every story slot;
  - `media_type = 'image'`;
  - ready/usable processing state;
  - a valid story derivative.

  Also restrict the story media picker and replace modal to one ready image and show a clear inline error.
- **Open questions:** Should a missing derivative trigger regeneration, block scheduling, or allow a documented fallback crop? Can users repair a failed derivative from this flow?
- **Suggested wording:** “A story can be scheduled only with exactly one account-owned, ready image that has a story derivative.”

### F-07 — Submitted media IDs are not checked for account ownership

- **Relevant section:** Missing security requirement; affects 4.2 A and 5 criterion 7
- **Priority:** Critical
- **Type:** Security / data
- **Classification:** Confirmed issue, pre-existing
- **Description:** `createScheduledBatch` accepts client-supplied media UUIDs without querying `media_assets` by `account_id`. Attachment RLS checks ownership of the content item, not the media row. The attachment insert is also treated as non-fatal. The worker uses service-role access and resolves media by ID without an account filter.
- **Rationale:** A user who obtains another account’s media UUID may be able to place it in `content_variants.media_ids`; the service worker can then sign and publish that other account’s asset.
- **Impact:** Potential cross-account media disclosure and unauthorised publishing.
- **Recommended action:** Treat this as a release dependency:
  - validate every unique media ID against `media_assets.account_id = accountId` in `createScheduledBatch`;
  - make attachment failures fatal or remove the duplicate source of truth;
  - add `account_id = content.account_id` defense-in-depth checks in worker media queries;
  - add cross-account rejection tests.
- **Open questions:** Are media UUIDs exposed through any shared links, logs, or APIs? Are there other write paths with the same trust gap?

### F-08 — Facebook story logging exposes the access token

- **Relevant section:** 6 manual verification, 8 risk; missing security requirement
- **Priority:** Critical
- **Type:** Security / operations
- **Classification:** Confirmed issue, pre-existing
- **Description:** `providers/facebook.ts` logs `uploadUrl`, and that URL includes `?access_token=${auth.accessToken}`.
- **Rationale:** Application and provider logs commonly have broader access and longer retention than secrets.
- **Impact:** A Facebook Page access token can be copied from logs and used outside the application.
- **Recommended action:** Remove the URL from the log or log only the endpoint path with all query values redacted. Audit existing logs and rotate any exposed token according to the incident process. Add a test or lint rule preventing token-bearing URLs from being logged.
- **Open questions:** How long are Supabase function logs retained, and who can access them? Has a Facebook story already been published through this code in production?

### F-09 — Planner edit scope and publish-time race are undefined

- **Relevant section:** 3 goal 3, 4.2 E, 5 criterion 8
- **Priority:** High
- **Type:** Functional / concurrency
- **Classification:** Confirmed issue
- **Description:** “Existing story” is broader than the actual editable statuses: draft, scheduled, queued, and failed. Published and publishing stories remain read-only. A queued job can also be claimed after the action checks status but before the variant update completes, so the UI may report a successful save while the worker publishes the old value.
- **Rationale:** Editing close to publish time is a normal planner journey and must have a clear cutoff.
- **Impact:** Unexpected read-only controls or a saved value that does not reach the live story.
- **Recommended action:** State the editable statuses in the acceptance criteria. Add an atomic status condition or version check when updating the variant, and return a clear “already publishing” result when the update loses the race.
- **Open questions:** Can failed stories be edited and retried with the new overlay? How close to scheduled time is editing supported? Should edits to campaign siblings stay independent?
- **Suggested wording:** “A story in draft, scheduled, queued, or failed state can edit its overlay until its publish job is claimed.”

### F-10 — Draft resume and invalid story states need explicit behaviour

- **Relevant section:** 4.2 B and D, 5 criteria 2 and 4, 6
- **Priority:** Medium
- **Type:** Functional / UX
- **Classification:** Confirmed issue
- **Description:** Preserving text during media replacement is covered, but saving a draft, closing the wizard, and resuming it is not. Invalid story text shows `aria-invalid`, while the card still says “ready” and the final schedule button remains enabled; only the server rejects the entire batch.
- **Rationale:** Draft resume is an expected path because `DraftState` stores generated copies. A green ready state and enabled submit action conflict with an inline error.
- **Impact:** Users may think the overlay was lost or may repeatedly submit an invalid batch.
- **Recommended action:** Add draft-resume acceptance coverage. Make invalid story overlays block the final action, remove the ready state, or show a clear slot-level error summary. Focus the invalid field after a rejected submission.
- **Open questions:** Should server-side overlength input be rejected or truncated? Should a single invalid slot block all slots, as it does today?

### F-11 — The rollback SQL is destructive and incorrectly scoped

- **Relevant section:** 8 rollback
- **Priority:** Critical
- **Type:** Deployment / data
- **Classification:** Confirmed issue
- **Description:** The prose says to clear rows “written in the interim” and “still pending,” but the supplied SQL has no deployment-time, status, account, campaign, or content-ID filter. It updates every story variant, including published history, failed rows, intentional planner edits, and stories created by other paths.
- **Rationale:** Rollback instructions are likely to be used under pressure and must be safe as written.
- **Impact:** Irreversible loss of valid overlay text and audit history.
- **Recommended action:** Remove the broad SQL. Capture the exact content IDs created after rollout, or use a deployment timestamp plus explicit editable statuses and a reviewed account scope. Take a count and backup/export before updating. Prefer a story-specific feature flag so code rollback does not need data mutation.
- **Open questions:** Must published history retain the overlay config for audit? Who approves and executes production data rollback?
- **Suggested wording:** “Code rollback does not alter data. If data rollback is required, update only an explicitly reviewed list of affected, unpublished content IDs captured during the rollout.”

### F-12 — Production-state claims are time-sensitive and not reproducible

- **Relevant section:** 2.5, 8
- **Priority:** High
- **Type:** Data / migration / deployment
- **Classification:** Unconfirmed assumption
- **Description:** The document gives production counts but not the query, timestamp with time zone, environment proof, or saved result. The statement that zero pending story rows are affected can become false between review and deployment.
- **Rationale:** A “no migration/backfill impact” decision depends on fresh data.
- **Impact:** The migration and rollback assessment may rely on stale counts, and rows created during the rollout window may be omitted from the operational plan.
- **Recommended action:** Add the read-only verification SQL to the report or release checklist, rerun it immediately before deploy, and save the result. Include all relevant statuses and accounts.
- **Open questions:** Is production still a single account at deploy time? Can any automation create new null story variants before release?

### F-13 — The live verification plan lacks a deliverable environment and owner

- **Relevant section:** 6 manual verification, 8 risk
- **Priority:** High
- **Type:** Delivery / integration
- **Classification:** Confirmed issue
- **Description:** “Publish one real story before merge” does not say how unmerged Next.js code will be reached by the deployed Supabase worker, which URL and secret it will use, which Meta account is safe, who approves the public story, or how the result is recorded.
- **Rationale:** A PR preview alone may not be enough because rendering crosses Vercel, Supabase Storage, the Edge worker, and Meta.
- **Impact:** The release gate may be skipped, performed directly in production without controls, or block the PR late.
- **Recommended action:** Define one of:
  - a complete staging path with test Meta accounts and matching secrets; or
  - a guarded production canary after merge but before general UI exposure.

  Name the owner, account, planned publish time, cleanup, evidence artifact, and pass/fail criteria.
- **Open questions:** Is there an Instagram Business test account and Facebook test Page? Can the feature be hidden until the canary passes? Where will screenshots and job IDs be stored?

### F-14 — The proposed tests do not prove the complete story path

- **Relevant section:** 6
- **Priority:** High
- **Type:** Testing
- **Classification:** Confirmed issue
- **Description:** The existing 9:16 renderer test proves only JPEG dimensions. The proposed tests do not prove that the worker selects the story derivative, calls the render route, uploads the rendered JPEG, and gives that rendered asset to each story provider. They also omit mixed placements, automatic-event decision coverage, story-specific preview URL resolution, draft resume, invalid submit state, media eligibility, ownership rejection, and planner action concurrency.
- **Rationale:** The failures most likely to escape are at boundaries, not inside the already-tested Sharp function.
- **Impact:** Unit tests can pass while the live story still uses the wrong source, publishes without the overlay, or fails at the provider.
- **Recommended action:** Add a test matrix covering:
  - standalone story, story-only campaign, and mixed feed/story;
  - blank, valid, invalid, and automatic event text according to the final decision;
  - story derivative selection and missing derivative;
  - exactly-one-image and account ownership checks;
  - worker-to-render-to-bannered-storage flow;
  - Facebook and Instagram provider receipt of the bannered URL;
  - planner editable and non-editable statuses;
  - draft save/resume and media replacement.

  Run `lint:ci`, `typecheck`, the full Vitest suite, and `build`, not only the named tests.
- **Open questions:** Is there a Playwright create-wizard test harness? Will a visual snapshot be stable across CI environments?

### F-15 — The complexity and file estimates are too low

- **Relevant section:** Header complexity, 4.2, 4.3, 6
- **Priority:** High
- **Type:** Delivery / planning
- **Classification:** Confirmed issue
- **Description:** The listed A-F changes already touch four source files. Accurate derivative preview needs at least the library preview contract and fresh-upload path. Reliable validation adds server queries and worker defense. Required tests extend beyond the three named files.
- **Rationale:** Underestimated scope causes incomplete implementation and rushed verification.
- **Impact:** Delivery dates and review capacity will be unreliable.
- **Recommended action:** Re-estimate after decisions F-02 and F-03. Track preview URL work, validation/security work, UI work, worker/provider tests, and release verification as separate tasks. Treat the current estimate as a best-case code-unlock estimate only.
- **Open questions:** Are F-07 and F-08 fixed in this change or as blocking prerequisite tickets?

### F-16 — Monitoring, performance, and storage impact are not covered

- **Relevant section:** 6, 8
- **Priority:** Medium
- **Type:** Observability / performance
- **Classification:** Confirmed issue
- **Description:** Story rendering downloads and re-encodes a 1080x1920 image through the Next.js route, then uploads another JPEG. The worker fetch has no explicit timeout around the render route. No requirement records duration, source/output bytes, placement, failure rate, or banner object growth.
- **Rationale:** Story images are larger than many feed images and add another external request before a time-sensitive publish.
- **Impact:** Slow rendering can miss story schedules or consume worker/function resources without a clear signal.
- **Recommended action:** Add safe structured telemetry for render duration, placement, source dimensions/bytes, output bytes, and stable error category. Never log signed URLs or secrets. Define a canary monitoring window and alert/query for `BANNER_RENDER_FAILED`. Add a worker fetch timeout and review storage retention for `banners/`.
- **Open questions:** What are the Edge worker and Vercel time/memory limits in the target environments? What failure rate or latency triggers rollback?

### F-17 — Accessibility requirements are incomplete

- **Relevant section:** 4.2 B-C, 5 criteria 1-3
- **Priority:** Medium
- **Type:** Accessibility
- **Classification:** Confirmed issue
- **Description:** The new input has a label and proposed invalid state, which is good. However, replacing the story `<img alt={fileName}>` with `BannerOverlay` changes the image to `alt=""`. The gold `#a57626` and white text combination is about 4.02:1, below the WCAG AA 4.5:1 threshold for small preview text. The preview text can render well below large-text size.
- **Rationale:** The selected media and overlay state should remain understandable without vision, and visible helper text should meet contrast requirements.
- **Impact:** Screen-reader users lose the selected image name; low-vision users may struggle to read the preview.
- **Recommended action:** Let `BannerOverlay` accept meaningful `alt` text where the image is not decorative. Add an accessibility test for label, described error, focus, and enabled state. Record the contrast issue as existing design debt if changing the fixed colour is outside scope.
- **Open questions:** Is the preview image considered meaningful content or decorative because the filename appears elsewhere? Is WCAG 2.2 AA a project requirement?

### F-18 — Platform eligibility and cross-platform evidence are missing

- **Relevant section:** 5 criterion 7, 6 manual verification
- **Priority:** Medium
- **Type:** Integration / delivery
- **Classification:** Optional improvement
- **Description:** The flow supports both Facebook and Instagram, but the manual check mentions only Instagram. Meta’s official Instagram API documentation states that API Story publishing is limited to Instagram Business accounts. Facebook uses a separate multipart upload and `photo_stories` flow.
- **Rationale:** A successful Instagram publish does not verify the Facebook provider or account prerequisites.
- **Impact:** The feature may be approved with only half of its supported platform path exercised.
- **Recommended action:** Document the required account type and connection metadata. Add automated provider coverage for both platforms and perform a live smoke test on each supported platform when safe.
- **Open questions:** Are Creator accounts intentionally unsupported for stories? Does onboarding clearly report story eligibility?
- **External reference:** [Meta Instagram API documentation](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-b628c95f-9319-432e-a58c-c99e96a05670)

### F-19 — The first release can be simplified

- **Relevant section:** 4, 7, 9
- **Priority:** Medium
- **Type:** Scope / delivery
- **Classification:** Optional improvement
- **Description:** Full “parity” combines three separable changes: typed story overlays, automatic event-story labels, and mixed-placement behaviour.
- **Rationale:** The typed overlay unlock has a clear user action and explicit off state. Automatic labels and shared mixed-placement editing introduce most of the ambiguity.
- **Impact:** Shipping all three together increases decision, preview, planner, and test complexity.
- **Recommended action:** Consider a first release with:
  - typed overlays only;
  - story-only placements;
  - accurate story derivative preview;
  - strict story media validation;
  - planner editing for documented statuses.

  Keep automatic event-story labels and mixed-placement overlay controls behind separate approved requirements. If mixed placements cannot be excluded safely, show both previews but retain one shared text value.
- **Open questions:** Is the user need specifically “let me type on a story,” or is true feed parity required in the same release?

## Required changes before implementation

1. Approve the product intent and choose typed-only versus automatic event-story overlays.
2. Define the mixed feed/story behaviour.
3. Specify a placement-aware signed preview URL contract.
4. Add exact story media and ownership validation before database writes.
5. Remove token-bearing Facebook logs.
6. Replace the rollback SQL with an ID-scoped, reviewed procedure.
7. Expand acceptance criteria for editable statuses, draft resume, errors, and the final automatic-label decision.
8. Re-estimate the work and update the test matrix.

## Unresolved decisions

- Whether story overlays were intentionally excluded.
- Whether event stories receive automatic proximity labels.
- Whether blank means off for every story type.
- Whether mixed feed/story rows share one text value and how both outputs are previewed.
- Whether the preview is representative or pixel-faithful.
- Whether missing story derivatives block scheduling or trigger repair.
- Which planner statuses and publish-time cutoff allow editing.
- Whether security fixes F-07 and F-08 are in this change or blocking prerequisites.
- Which environment and accounts are used for live verification.

## Major risks

1. Cross-account media use through unvalidated UUIDs.
2. Access-token exposure in Facebook story logs.
3. Guaranteed publish failures from video, multiple media, or missing derivatives.
4. Users approving a mixed-placement story they never previewed.
5. Broad rollback SQL destroying valid overlay history.
6. A saved planner edit losing a race with the publish worker.
7. Slow or failed rendering delaying a time-sensitive story without enough telemetry.

## Recommended next steps

1. Hold a short product decision review for F-01, F-02, F-03, and F-19.
2. Fix or formally block on the two security findings before live Facebook story testing.
3. Add a small technical design for placement-aware preview URLs and server-side media validation.
4. Revise the specification’s acceptance criteria, rollback, test matrix, and estimate.
5. Implement in slices: data/security validation, preview contract, story UI/persistence, planner edit, integration tests.
6. Run full CI and capture a rendered 9:16 artifact.
7. Use a defined staging test or guarded production canary, then monitor banner failures and latency before general release.

## Verification performed for this review

- Inspected the specification and the relevant create, planner, banner, library, worker, provider, migration, and test code.
- Confirmed the story guard history with `git blame`.
- Confirmed the wizard receives only one feed-oriented signed preview URL.
- Confirmed the worker requires exactly one image and a story derivative.
- Confirmed the missing account filter in create and worker media resolution.
- Confirmed the Facebook story log includes a token-bearing URL.
- Ran the current relevant baseline:

```text
Test Files  5 passed (5)
Tests       48 passed (48)
```

The passing baseline supports the specification’s claim that the existing renderer works, but it does not close the release gaps listed above.
