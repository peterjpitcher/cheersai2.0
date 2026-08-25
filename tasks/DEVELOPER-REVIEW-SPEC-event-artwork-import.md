# Developer review: event artwork import specification

**Reviewed specification:** `tasks/SPEC-event-artwork-import.md`  
**Review date:** 2026-08-25  
**Review scope:** Technical design, functional behaviour, security, data integrity, user journeys, delivery, deployment, operations, accessibility, and testing.

## Review basis and limits

This review checked the current CheersAI repository and the sibling `OJ-AnchorManagementTools` repository, including the event API, API-key handling, event image upload flow, management client, create wizard, media library, publishing worker, migrations, and tests. It also checked the official Next.js, Vercel, and Sharp documentation where platform behaviour matters.

Production database counts and configuration stated in the specification were treated as supplied evidence. They were not re-queried during this review.

An existing untracked file named `tasks/REVIEW-SPEC-event-artwork-import.md` was present before this review. It was not changed. The original specification was also not changed.

## Overall assessment

**Readiness: Not ready for implementation.**

The main direction is good. Copying AMS artwork into CheersAI, keeping the feed and story versions in one asset, and allowing field import to succeed when artwork fails are all sensible choices.

The specification still has release-blocking gaps. The most serious are cache separation by API-key scope, incomplete SSRF and image safety controls, non-atomic storage/database writes, stale async UI results, incomplete wizard state updates, and the unresolved banner behaviour. The fail-soft design also needs stronger monitoring because a user can see a successful field import while artwork fails silently.

### Priority definitions

| Priority | Meaning |
|---|---|
| P0 | Must be resolved before implementation or safe release. |
| P1 | Required before production release. |
| P2 | Should be decided or specified before build completion. |
| P3 | Low-risk correction or maintainability issue. |

### Confirmed finding totals

| Priority | Count |
|---|---:|
| P0 | 9 |
| P1 | 18 |
| P2 | 3 |
| P3 | 1 |

“Confirmed issue” means the gap or conflict is visible in the specification, repository, or documented platform contract. “Optional improvement” means the stated design could work, but there is a simpler or safer approach worth considering.

## Confirmed issues

### F-01 — Cache separation is incomplete for scope-dependent responses

- **Priority:** P0
- **Type:** Security / integration correctness
- **Relevant section:** §4.1, §5, §7
- **Status:** Confirmed issue
- **Description:** The same event URL will return different bodies depending on the API key. The proposal makes only artwork-bearing responses private. A public response already cached for the website key can still be returned to CheersAI before the cache sees the private response. AMS also gives authentication and permission errors the normal public GET cache policy.
- **Rationale:** `createApiResponse` currently sets `public, max-age=60, stale-while-revalidate=120` and varies only on `Origin`. CheersAI's `cache: "no-store"` controls its own fetch cache; it cannot repair an upstream shared cache.
- **Impact:** CheersAI can receive a valid but website-shaped response without artwork. This would look like a normal no-artwork case and could disable the feature without an obvious error.
- **Recommended action:** Prefer a dedicated artwork endpoint with `private, no-store` on every success and error. If existing event routes are retained, every representation must use a consistent cache key or `Vary` policy across scoped and unscoped callers, including empty artwork and errors. Add a sequential cross-key cache test, not only header assertions.
- **Open questions:** Is a CDN or reverse proxy caching these routes in production? Must website event responses remain publicly cacheable?

### F-02 — No artwork, missing scope, and an old AMS version are indistinguishable

- **Priority:** P0
- **Type:** Functional correctness / integration versioning
- **Relevant section:** §4.1, §4.2, §5, §6
- **Status:** Confirmed issue
- **Description:** The `artwork` block is absent without the new scope. It is also absent before the AMS API change exists. The proposed client treats absence as valid, while the UI would tell the user the event has no artwork.
- **Rationale:** A missed migration, key rotation, AMS rollback, or old deployment produces the same shape as a real no-artwork event.
- **Impact:** The complete feature can fail silently while connection health remains green.
- **Recommended action:** Define separate results for capability unavailable, authorised with no artwork, partial artwork, and full artwork. An authorised response should always carry an explicit artwork object with nulls, or a dedicated endpoint should return 403 for missing scope and 200 for an all-null result.
- **Open questions:** Should the management connection test fail or warn when event reads work but artwork permission does not?

### F-03 — The scope is response shaping, not file access control

- **Priority:** P1
- **Type:** Security / requirement clarity
- **Relevant section:** §2.1, §3, §4.1, §7
- **Status:** Confirmed issue
- **Description:** The AMS storage bucket is public. The scope controls whether URLs appear in the API, but anyone who already has a URL can fetch the object. The phrase “CheersAI API key only” is also not exact because wildcard keys receive the block and future keys can be granted the scope.
- **Rationale:** A public object URL cannot be made confidential by hiding it from one API representation.
- **Impact:** Reviewers may assume stronger protection than the design provides. This matters if story or print artwork is commercially sensitive before launch.
- **Recommended action:** State the threat model. If the aim is only to stop the website selecting these variants, say that clearly. If confidentiality is required, use private storage or an authenticated download endpoint with short-lived signed URLs.
- **Open questions:** Are pre-release story or print files sensitive? Is protection from accidental website use the only requirement?

### F-04 — The proposed host allowlist is not a complete SSRF control

- **Priority:** P0
- **Type:** Security
- **Relevant section:** §4.2, §7
- **Status:** Confirmed issue
- **Description:** The specification does not define redirect handling, schemes, ports, user information in URLs, DNS resolution, private IP ranges, IPv6, DNS rebinding, or where the AMS storage origin is configured. The management base URL is user-configurable and currently accepts HTTP.
- **Rationale:** `fetch` follows redirects by default. A hostname-only check can be bypassed by a redirect or by resolution to loopback, private, link-local, or metadata addresses. Learning an allowed storage host from the returned URL would make the check circular.
- **Impact:** An authenticated user or compromised AMS response could make the CheersAI server request internal services. Reusing API headers for image fetches could also leak credentials.
- **Recommended action:** Use a server-owned list of exact approved HTTPS origins. Reject userinfo and unexpected ports, disable redirects or validate every hop, and block private and special-use IPv4/IPv6 destinations. Send no API key, cookies, authorization header, or referrer to image hosts. Add redirect and alternate-IP tests.
- **Open questions:** Must staging or custom AMS installations be supported? What exact management and storage origins are valid in each environment?

### F-05 — The image checks do not bound decoded memory or CPU

- **Priority:** P0
- **Type:** Security / performance
- **Relevant section:** §4.2, §5, §7
- **Status:** Confirmed issue
- **Description:** A 10 MB response cap and `image/*` header check do not limit decoded pixels, frames, channels, or processing cost. The specification does not say whether the byte cap is enforced while streaming. It also accepts a broad media type instead of an explicit file format list.
- **Rationale:** Content length and content type can be absent or false. A small compressed file can decode to a very large image. Sharp supports explicit input pixel, channel, frame, orientation, and failure controls in its [constructor options](https://sharp.pixelplumbing.com/api-constructor/).
- **Impact:** A single import can exhaust memory or CPU, time out, or affect concurrent requests on the same instance.
- **Recommended action:** Enforce the byte cap while reading the stream, verify magic bytes, allow only agreed formats, set strict Sharp pixel/channel/frame limits, keep `unlimited: false`, process one frame, and reject extreme or too-small dimensions before rendering.
- **Open questions:** Which formats are required: JPEG, PNG, and WebP only? What are the minimum and maximum legitimate source dimensions?

### F-06 — The degradation matrix does not define every output or partial failure

- **Priority:** P1
- **Type:** Functional detail / error handling
- **Relevant section:** §4.2, §4.3
- **Status:** Confirmed issue
- **Description:** The steps require a square source for `storage_path` and landscape fallback, but the matrix permits story-only input. There is no exact rule for a corrupt or failed story fetch when square succeeds, a failed landscape fetch, or landscape-only input. §4.3 says two image fetches, while §4.2 can require three.
- **Rationale:** “Artwork failure is a warning” does not say whether successful files should still create a degraded asset.
- **Impact:** Implementations can differ in crop source, ready state, warnings, and whether useful artwork is discarded.
- **Recommended action:** Add a normative source-to-output table and per-source failure table. State fallback order for all four local outputs and the minimum valid input needed to create a ready asset.
- **Open questions:** Is landscape-only enough to create an asset? If designed story artwork is corrupt, should the importer fall back to a square crop?

### F-07 — The unique source key does not make the import atomic or concurrency-safe

- **Priority:** P0
- **Type:** Data integrity / storage consistency
- **Relevant section:** §4.2, §5, §6, §7
- **Status:** Confirmed issue
- **Description:** The action downloads files, renders outputs, uploads four objects, writes `media_assets`, and writes `media_library`. There is no reservation, state machine, transaction boundary, conflict algorithm, or compensation flow. Two concurrent imports can both upload and then race on the unique index.
- **Rationale:** A database unique index protects only the final row. It does not coordinate Supabase Storage writes.
- **Impact:** Failed or duplicate imports can leave orphaned objects, incomplete variants, misleading warnings, or inconsistent rows.
- **Recommended action:** Define a pending/ready/failed import state or deterministic reservation step before expensive work. Handle unique conflicts by loading the winner. Delete every object written by a failed attempt and record cleanup failures for repair. Add concurrent and failure-injection tests.
- **Open questions:** Should a second caller wait for an in-progress import or return a retryable status? When is a pending import considered abandoned?

### F-08 — Copying `finaliseMediaUpload` does not guarantee the required mirror row

- **Priority:** P0
- **Type:** Data integrity / contradiction
- **Relevant section:** §2.2, §4.2, §5
- **Status:** Confirmed issue
- **Description:** The specification requires a matching `media_library` row for the attachment foreign key, but says to mirror exactly as `finaliseMediaUpload` does. That function treats the mirror as non-blocking and does not throw on a normal Supabase error result.
- **Rationale:** The referenced implementation is best effort, while the new requirement is mandatory.
- **Impact:** An asset can look ready in `media_assets` but fail when attached to content.
- **Recommended action:** Create both database rows in one required transaction or RPC. If that is not possible, explicitly inspect both results, compensate on failure, and repair the mirror when reusing an existing asset.
- **Open questions:** Can `media_library` now be treated as present in every supported environment so the old compatibility behaviour can be removed?

### F-09 — The source fingerprint does not fully describe the generated asset

- **Priority:** P1
- **Type:** Data model / idempotency
- **Relevant section:** §4.2
- **Status:** Confirmed issue
- **Description:** The hash includes square and story URLs, but landscape affects the output. It also omits a transform version. URL identity is tied to the current AMS storage naming behaviour rather than an explicit artwork revision. Reuse also keeps old file names and tags if the event name changes without new artwork.
- **Rationale:** An idempotency key must include every input that changes output bytes and should have deliberate versioning.
- **Impact:** Re-import can reuse a stale landscape or stale library metadata. Future changes to crop, colour, quality, or URL signing can create wrong reuse behaviour.
- **Recommended action:** Hash canonical structured data containing event ID, all used source revisions or URLs with explicit nulls, and a transform version. Prefer an AMS-provided artwork revision over full signed URLs. Define whether reused asset display metadata is refreshed.
- **Open questions:** Can AMS provide a stable revision or per-variant update value? Should event renames update the imported asset's file name and tags?

### F-10 — Reuse rules ignore hidden, replaced, failed, or missing local assets

- **Priority:** P1
- **Type:** Data lifecycle / edge cases
- **Relevant section:** §3, §4.2, §6
- **Status:** Confirmed issue
- **Description:** A matching row can be hidden, locally replaced, not ready, missing a derivative, missing storage objects, or missing its `media_library` mirror. The specification says only that it is reused.
- **Rationale:** Provenance proves origin, not current integrity or visibility.
- **Impact:** Re-import can select an invisible, modified, or unpublishable asset.
- **Recommended action:** Define a reusable-state check: correct account, visible, ready, required paths present and signable, mirror present, and not locally replaced unless that is intended. Repair safe omissions or create a new revision.
- **Open questions:** Should local replacement clear provenance? Does hiding imported artwork prevent future automatic reuse?

### F-11 — The Server Action trust boundary and result contract are incomplete

- **Priority:** P1
- **Type:** Security / functional contract
- **Relevant section:** §4.2, §4.3
- **Status:** Confirmed issue
- **Description:** The action is named but its trusted inputs and typed outcomes are not defined. It does not explicitly require authentication, server-side connection loading, an AMS refetch, response ID validation, or account-scoped queries. Existing management error text also does not mention the new artwork scope.
- **Rationale:** A Server Action is an externally callable mutation boundary. Client-supplied URLs, account IDs, storage paths, or source keys must not be trusted.
- **Impact:** An implementation could permit cross-account access, unsafe fetches, or misleading error handling.
- **Recommended action:** Accept only a validated event ID and optional known slug. Derive account and connection server-side, fetch the event through the authenticated management client, validate the returned identity, and return a typed result such as `imported`, `reused`, `partial`, `none`, `unavailable`, or `failed`, plus a safe warning and optional `MediaAssetSummary`.
- **Open questions:** Is a second AMS detail request acceptable, or should prefill return a short-lived server-verifiable import token?

### F-12 — Returning only IDs leaves wizard library state stale

- **Priority:** P0
- **Type:** Functional correctness / UI state
- **Relevant section:** §2.2, §4.3, §5
- **Status:** Confirmed issue
- **Description:** The proposed callback returns asset IDs, but the wizard separately stores `libraryItems`. Media and Generate resolve selected IDs against that list. A newly inserted ID will have no thumbnail or story preview. There is also a race where the initial `getCreateModalData` result can overwrite an imported summary added while the library is still loading.
- **Rationale:** Existing upload code updates both the local picker and parent library for this reason.
- **Impact:** The UI can report media selected while later screens show no media, no preview, or incorrect story readiness.
- **Recommended action:** Return a complete current `MediaAssetSummary`, merge it into `libraryItems` by ID before selecting it, and merge rather than replace when the initial library load finishes. Test both completion orders.
- **Open questions:** Should the import action sign previews directly, or should it call a shared account-scoped summary loader?

### F-13 — Slow artwork results can attach the wrong event or overwrite later user work

- **Priority:** P0
- **Type:** User journey / concurrency
- **Relevant section:** §4.3, §5
- **Status:** Confirmed issue
- **Description:** A user can choose event A, then event B, move to another step, change content type, choose media, close the wizard, or resume editing while A is still processing. React transitions do not cancel server work, and the overwrite check must use the latest state at completion.
- **Rationale:** The new action is deliberately slower and separate from field prefill, so out-of-order completion is expected.
- **Impact:** Artwork from the wrong event can be selected and published. Stale imports can also create unused library assets.
- **Recommended action:** Track a request token and selected event ID, ignore stale completions, check current media state at completion, and define behaviour after unmount or step change. Use a separate artwork pending state and provide retry.
- **Open questions:** May users continue to the Media step while import is running? Where is completion shown if the Brief step is no longer mounted?

### F-14 — Event switching and “Use event artwork” semantics are undefined

- **Priority:** P1
- **Type:** Functional / UX ambiguity
- **Relevant section:** §4.3
- **Status:** Confirmed issue
- **Description:** Previously auto-selected event A artwork is treated the same as a manual choice when event B is selected. The button does not say whether it replaces all media, replaces the first item, or appends. For story placement only the first asset publishes, so appending may do nothing.
- **Rationale:** Automatic and manual selection need separate provenance in client state.
- **Impact:** Event B can keep event A artwork, feed carousels can change unexpectedly, or story posts can use the wrong first asset.
- **Recommended action:** Track whether the current selection was auto-imported and untouched. Allow replacement only in that narrow case; otherwise use an explicit action such as “Replace current media with event artwork.” Define whether ingestion happens before or after the click.
- **Open questions:** Should event artwork ever be appended to feed media? Should unused artwork from the previous event be hidden or retained?

### F-15 — Banner behaviour is an unresolved release decision

- **Priority:** P0
- **Type:** Product decision / content correctness
- **Relevant section:** §4.4, §8
- **Status:** Confirmed issue
- **Description:** The specification says the interaction is still to decide, refers to a missing “question 1,” and leaves the decisions section empty. Event scheduling currently forces the dynamic banner for both feed and story. Designed artwork may already contain a date or place important content under the right strip.
- **Rationale:** This affects the final published image, not only import UX. Disabling the banner only for imported artwork would also require a new explicit input to `createScheduledBatch`; the current code always enables it for events.
- **Impact:** Published content can show duplicate dates or cover text and logos. A late decision can expand implementation scope.
- **Recommended action:** Decide before coding whether imported artwork keeps the banner, disables it by default, or receives an explicit user control with an accurate preview. Specify the data flow and acceptance tests for feed and story.
- **Open questions:** Is the date always present on AMS artwork? Is the dynamic proximity label valuable enough to keep?

### F-16 — The artwork API schema is not normative enough

- **Priority:** P1
- **Type:** API contract / ambiguity
- **Relevant section:** §4.1, §5
- **Status:** Confirmed issue
- **Description:** The JSON example shows strings, while tests mention nulls, blanks, and absent columns. It does not define key presence, null normalisation, unknown fields, URL rules, casing, capability versioning, or whether list and detail change together.
- **Rationale:** Independent implementations need exact wire semantics, especially to distinguish no artwork from unavailable capability.
- **Impact:** AMS and CheersAI can pass separate unit tests while disagreeing in production.
- **Recommended action:** Add a small normative schema and shared fixture. State that authorised empty artwork is explicit, define valid URL schemes, and define compatibility with unknown fields.
- **Open questions:** Is `print_poster` intentionally snake_case? Is a schema or capability version required?

### F-17 — AMS cannot provide a consistent artwork-kit snapshot during replacement

- **Priority:** P1
- **Type:** Integration consistency / edge case
- **Relevant section:** §2.1, §4.1, §4.2
- **Status:** Confirmed issue
- **Description:** AMS uploads and confirms each variant separately. The API reads current cache columns from the event row. During a five-file replacement, an import can receive a mixture of old and new variants with no kit revision or completeness marker.
- **Rationale:** The proposed source hash records whatever combination happened to be visible at one moment, but cannot tell whether that combination represents one designed kit.
- **Impact:** A feed post and story can use mismatched artwork even though both files imported successfully.
- **Recommended action:** Either expose a kit revision/updated status and publish variants atomically, or explicitly accept eventual consistency and add a clear operational rule not to import while AMS artwork is being replaced. Per-variant update times can at least detect a mixed set.
- **Open questions:** Are all variants normally uploaded in one staff session? Is mixed-version artwork acceptable for this release?

### F-18 — `maxDuration` and Node runtime placement are not specified

- **Priority:** P1
- **Type:** Technical feasibility / deployment configuration
- **Relevant section:** §4.3, §6, §7
- **Status:** Confirmed issue
- **Description:** The specification gives no duration value or exact file. For Server Actions, Next.js documents page-level `maxDuration`; adding it to a general actions module is not the documented mechanism. Sharp also requires the Node runtime.
- **Rationale:** The create page currently has no duration or runtime export. Official guidance says Server Action duration should be set at the page level in [Next.js route segment configuration](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config#maxduration). Vercel limits vary by plan and Fluid Compute settings in [Vercel function duration documentation](https://vercel.com/docs/functions/configuring-functions/duration).
- **Impact:** A configuration can compile but have no effect, or change the budget for every Server Action on the page.
- **Recommended action:** Benchmark first, choose a numeric platform limit plus a shorter internal deadline, and configure the exact page or a dedicated Node route handler. Confirm production plan, Fluid Compute, memory, and CPU settings.
- **Open questions:** Which Vercel plan and compute settings are active? What p95 and worst-case duration are acceptable?

### F-19 — Performance, concurrency, and rate budgets are absent

- **Priority:** P1
- **Type:** Performance / capacity
- **Relevant section:** §2, §4.2, §4.3, §7
- **Status:** Confirmed issue
- **Description:** One selection can cause another AMS detail call, up to three image downloads, several Sharp operations, four uploads, database writes, and preview signing. No target latency, memory ceiling, concurrency limit, retry count, source rate limit, or regional placement is stated.
- **Rationale:** Separating field prefill improves perceived speed but does not reduce the work. Fluid Compute can run concurrent invocations in one instance.
- **Impact:** Imports can throttle AMS, time out, slow other work, or create unpredictable cost.
- **Recommended action:** Define expected volume, maximum simultaneous imports, p50/p95 target, hard deadline, memory target, retry rules, and AMS rate limit. Bound internal concurrency and instrument each stage.
- **Open questions:** How many users can import at once? What is the `cheersai` key's rate limit? Which deployment region is closest to both Supabase projects?

### F-20 — Image quality and storage metadata rules are incomplete

- **Priority:** P1
- **Type:** Media quality / storage contract
- **Relevant section:** §4.2, §5, §7
- **Status:** Confirmed issue
- **Description:** The specification defines dimensions and JPEG quality but not EXIF orientation, colour space, alpha flattening, metadata stripping, chroma settings, upscaling policy, or minimum source size. It also does not require Supabase objects to be uploaded with `contentType: image/jpeg` and clear cache metadata.
- **Rationale:** Sharp and browser canvas can produce visibly different output. AMS currently permits a width or height of zero when the browser cannot read dimensions, so the API URL is not proof of adequate resolution.
- **Impact:** Output can be rotated, blurry, colour-shifted, have an unwanted transparency background, or be served with an incorrect MIME type.
- **Recommended action:** Specify auto-orientation, sRGB output, metadata policy, alpha background, approved JPEG options, minimum dimensions, enlargement behaviour, and storage upload metadata. Test rotated, transparent, wide-gamut, small, malformed, and high-detail samples.
- **Open questions:** What background should replace transparency? Must metadata be retained? Should undersized artwork fail or warn?

### F-21 — The required media row mapping is incomplete

- **Priority:** P1
- **Type:** Data model / functional detail
- **Relevant section:** §4.2
- **Status:** Confirmed issue
- **Description:** The insert step names status, aspect, tags, and source key, but not the required `file_name`, `media_type`, or `storage_path` values and does not define `mime_type` or `size_bytes`. It also does not say whether size means the original local JPEG or all four objects.
- **Rationale:** These fields drive library display, preview behaviour, and the compatibility mirror.
- **Impact:** Developers can write inconsistent rows, misleading sizes, or unsafe file names.
- **Recommended action:** Add an explicit row mapping for both media tables, including sanitised file name, `media_type: image`, `mime_type: image/jpeg`, actual feed-file byte size, paths, tags, timestamps, and null/default behaviour. Keep total storage bytes as monitoring data rather than overloading `size_bytes`.
- **Open questions:** What user-facing file name should imported artwork have? Should reused assets refresh their metadata?

### F-22 — Scope provisioning and key rotation can silently fail

- **Priority:** P1
- **Type:** Migration / operations
- **Relevant section:** §4.1, §6
- **Status:** Confirmed issue
- **Description:** The migration targets an active key by name. A missing, renamed, duplicate, inactive, or rotated key can make the update affect zero or the wrong number of rows. The AMS API-key editor does not list `read:events:artwork`, so a least-privilege replacement key cannot be created through the current UI.
- **Rationale:** A one-time name-based update is not a durable key-provisioning process.
- **Impact:** Deployment and later key rotation can silently disable artwork import.
- **Recommended action:** Add preflight and post-deploy assertions for the intended key, update or deliberately restrict the key-management UI, and document a rotation procedure that verifies the new scope before cutover.
- **Open questions:** Is the key ID stable across environments? Should staff be able to grant this scope through the UI?

### F-23 — Deployment and rollback claims are too strong

- **Priority:** P1
- **Type:** Delivery / deployment
- **Relevant section:** Opening metadata, §6, §7
- **Status:** Confirmed issue
- **Description:** CheersAI already calls the event detail endpoint with the same key, so the AMS deploy changes response body size, cache policy, and ETag before the UI feature deploy. Reverting CheersAI code does not remove assets, partial objects, or failed import state created during the release.
- **Rationale:** Independent deployment requires every old/new application and database combination to be tested and observable.
- **Impact:** An intermediate cache regression can affect today's field import, and a bad final release can leave persistent debris.
- **Recommended action:** Add an explicit compatibility matrix, staging smoke test, feature flag or account allowlist, watch window, abort thresholds, and cleanup/repair procedure. Describe rollback as disabling new imports while preserving or repairing created data.
- **Open questions:** Who owns go/no-go and rollback? Can both repositories be deployed in one controlled window?

### F-24 — Fail-soft behaviour has no monitoring or support contract

- **Priority:** P1
- **Type:** Monitoring / operations
- **Relevant section:** §6, §7
- **Status:** Confirmed issue
- **Description:** “Needs watching” is not converted into structured events, metrics, alerts, or support queries. The design does not distinguish imported, reused, partial, none, unavailable capability, download failure, transform failure, upload failure, conflict, database failure, timeout, or cleanup failure.
- **Rationale:** Field import can succeed while artwork fails, so normal user success metrics will hide the failure.
- **Impact:** Production failures can remain unnoticed and support cannot isolate the failing stage.
- **Recommended action:** Log a correlation ID, account ID, event ID, result, stage timings, byte counts, and safe error class. Do not log keys, cookies, signed query strings, or full sensitive URLs. Add failure-rate and cleanup alerts plus a short runbook.
- **Open questions:** Which logging and alerting system is used? What error rate or timeout rate triggers rollback?

### F-25 — The test plan does not prove the main integration risks

- **Priority:** P1
- **Type:** Testing / delivery assurance
- **Relevant section:** §5, §6, §7
- **Status:** Confirmed issue
- **Description:** The proposed tests are mostly unit and component tests. They do not require real database/storage behaviour, concurrent imports, cross-key cache sequencing, storage cleanup, real migration application, library-load races, mixed kit versions, key-rotation behaviour, or an end-to-end publish-path check.
- **Rationale:** Mocks cannot prove unique-index races, object metadata, foreign-key mirroring, signing, or actual worker compatibility.
- **Impact:** All planned tests can pass while production creates orphaned objects, fails attachment, or publishes the wrong image.
- **Recommended action:** Add database and Storage integration tests, cross-key AMS tests, concurrent and failure-injection tests, browser tests for out-of-order completion and manual media, a real import-to-feed/story signing test, banner output tests, and an image corpus with security and quality cases. Verify the production build contains Sharp correctly.
- **Open questions:** Can CI run local Supabase Storage, or is a protected staging integration job required?

### F-26 — Accessibility acceptance criteria are missing

- **Priority:** P1
- **Type:** Accessibility / UX
- **Relevant section:** §4.3, §5
- **Status:** Confirmed issue
- **Description:** The feature adds async progress, warnings, neutral status, retry, and a replacement action without keyboard, focus, live-region, disabled-state, or screen-reader requirements. The current event search input also relies on placeholder text rather than a visible or programmatic label.
- **Rationale:** Artwork can finish after the selection panel closes, so visual text alone may not be announced.
- **Impact:** Keyboard and assistive-technology users may not know that import is running, failed, or changed media.
- **Recommended action:** Add WCAG 2.2 AA criteria: labelled search and status, polite or assertive announcements as appropriate, focus preservation, full keyboard operation, non-colour warnings, clear button names, and visible pending state. Include automated checks and manual keyboard/screen-reader QA.
- **Open questions:** Which browser and assistive-technology combinations are required for release?

### F-27 — The statement about management-app tests is false

- **Priority:** P2
- **Type:** Factual contradiction / testing
- **Relevant section:** §5
- **Status:** Confirmed issue
- **Description:** The repository already contains management client, mapper, data, cache, and create-action tests.
- **Rationale:** Test planning should extend the current suite rather than assume no coverage exists.
- **Impact:** A developer may duplicate fixtures or miss existing regression coverage.
- **Recommended action:** Replace the statement with a precise note that artwork import and image-processing coverage are new, while management integration coverage already exists.
- **Open questions:** Should all new library-level tests follow the repository rule and live under `tests/lib/management-app/`?

### F-28 — Production counts and cost claims are not reproducible inputs

- **Priority:** P2
- **Type:** Assumptions / delivery validation
- **Relevant section:** §2, §7
- **Status:** Confirmed issue
- **Description:** The production counts have no checked-in query or launch refresh step. “Square only (35 events today)” mixes an all-time count with the upcoming-events table. “Roughly 1 MB” and “artwork is opaque” are not measured in the verified section.
- **Rationale:** Coverage, transparency, and output size affect UX, capacity, and quality decisions and can change before launch.
- **Impact:** Acceptance data and storage forecasts may be wrong at release time.
- **Recommended action:** Record safe aggregate queries, label all-time and upcoming counts clearly, refresh them before launch, and measure representative source/output size and alpha usage. Move unverified claims into an assumptions table with owner and date.
- **Open questions:** What are p50/p95 input and output sizes? Is the four-kit launch baseline still current?

### F-29 — Retention and cleanup rules are absent

- **Priority:** P2
- **Type:** Data lifecycle / operations
- **Relevant section:** §3, §4.2, §6, §7
- **Status:** Confirmed issue
- **Description:** URL changes create new assets, stale UI requests can complete after the user leaves, and failed imports can create partial objects. The specification does not define retention for unused, superseded, hidden, abandoned, or failed imports.
- **Rationale:** Old assets may still be referenced by scheduled or published content, so cleanup cannot simply delete the previous revision.
- **Impact:** Storage and library clutter grow, while operators lack a safe deletion rule.
- **Recommended action:** Define retention by age and reference count, never remove referenced media, and provide orphan audit and repair tooling. Forecast 12- and 24-month growth using measured sizes.
- **Open questions:** Should unused imports be auto-hidden or removed after a period? How long must published artwork be retained?

### F-30 — The API documentation update is missing from scope

- **Priority:** P1
- **Type:** Documentation / integration delivery
- **Relevant section:** §3, §4.1, §5
- **Status:** Confirmed issue
- **Description:** AMS declares `docs/guides/api/openapi.yaml` as its integration contract and says it must be regenerated when response models change. The specification does not include that file or the API overview in the change list.
- **Rationale:** A new scope and conditional response object are externally visible contract changes even when only one client uses them.
- **Impact:** Generated clients, future maintainers, and operations guidance can remain wrong.
- **Recommended action:** Update OpenAPI with the endpoint or conditional artwork schema, authentication scopes, null semantics, cache behaviour, and errors. Update the API overview and add schema validation to CI if it is not already present.
- **Open questions:** Is OpenAPI currently published or used to generate any client?

### F-31 — Existing database and code comments will become inaccurate

- **Priority:** P3
- **Type:** Documentation / maintainability
- **Relevant section:** §4.1
- **Status:** Confirmed issue
- **Description:** The specification updates one `imageVariants.ts` comment, but migration-installed comments still say story and print URLs are never emitted by the public API. `eventImageFields.ts` also uses wording that can be read as a system-wide rule.
- **Rationale:** These comments are likely to guide future API work.
- **Impact:** Later changes can reintroduce wrong assumptions about exposure.
- **Recommended action:** Add forward `COMMENT ON COLUMN` changes and make code comments say these fields are excluded from website-facing image fields but may be available through the scoped artwork contract.
- **Open questions:** Are database comments used in generated schema documentation?

## Optional improvements

### O-01 — Use a dedicated detail artwork endpoint

- **Priority:** P1
- **Type:** Optional improvement / simplification
- **Relevant section:** §3, §4.1, §6
- **Status:** Optional improvement
- **Description:** Add `GET /api/events/{id}/artwork` requiring both event-read and artwork scopes.
- **Rationale:** It avoids scope-shaped variants on website endpoints, makes missing permission a real 403, and gives the route one consistent `private, no-store` policy.
- **Impact:** One small route removes substantial cache, capability, and compatibility complexity from two existing routes.
- **Recommended action:** Prefer this unless a confirmed consumer needs artwork inline with list results.
- **Open questions:** Does any planned consumer need artwork on the list endpoint?

### O-02 — Return only the variants CheersAI consumes

- **Priority:** P2
- **Type:** Optional improvement / scope reduction
- **Relevant section:** §3, §4.1, §4.2
- **Status:** Optional improvement
- **Description:** CheersAI uses square, story, and optionally landscape. Social and print poster are not used by the ingest design.
- **Rationale:** Exposing unused fields increases contract and security surface without delivery value.
- **Impact:** A smaller response and schema are easier to validate and maintain.
- **Recommended action:** Keep social and print out until a real consumer exists, or state why completeness is worth the extra contract.
- **Open questions:** Is another scoped consumer already planned?

### O-03 — Use explicit provenance columns

- **Priority:** P2
- **Type:** Optional improvement / data-model clarity
- **Relevant section:** §4.2
- **Status:** Optional improvement
- **Description:** One encoded `source_key` combines provider, entity type, event ID, and revision.
- **Rationale:** Separate `source_type`, `source_id`, and `source_revision` fields are easier to query, validate, support, and extend.
- **Impact:** It adds columns now but avoids string parsing and ambiguous future integrations.
- **Recommended action:** Use explicit fields if Canva or other import sources are likely; otherwise keep a well-documented canonical key.
- **Open questions:** Are other remote media sources on the roadmap?

### O-04 — Extract a required transactional media finaliser

- **Priority:** P1
- **Type:** Optional improvement / maintainability
- **Relevant section:** §4.2
- **Status:** Optional improvement
- **Description:** The import and browser upload paths need the same row mapping, mirror creation, and summary signing, but the new path requires stronger failure rules.
- **Rationale:** Copying the existing finaliser will repeat weak behaviour and drift over time.
- **Impact:** A shared server-only finaliser or RPC can improve both paths and reduce duplicate logic.
- **Recommended action:** Extract a tested required finalisation primitive. Keep browser upload and AMS download/render logic outside it.
- **Open questions:** Can the existing upload path safely switch to it in the same release?

### O-05 — Import lazily when manual media already exists

- **Priority:** P2
- **Type:** Optional improvement / performance
- **Relevant section:** §4.3
- **Status:** Optional improvement
- **Description:** The current design may complete all image work before showing a button that the user never clicks.
- **Rationale:** Manual media already requires explicit replacement consent.
- **Impact:** Eager work creates unused assets and avoidable compute/storage cost.
- **Recommended action:** Fetch availability first and ingest only when the replacement action is clicked. Keep eager import for an empty selection.
- **Open questions:** Is instant button response more valuable than avoiding unused imports?

### O-06 — Keep the first release synchronous only if benchmarks support it

- **Priority:** P2
- **Type:** Optional improvement / delivery scope
- **Relevant section:** §4.3, §6
- **Status:** Optional improvement
- **Description:** A durable job queue could handle retries and timeouts but adds state, polling, cleanup, and deployment complexity.
- **Rationale:** Current volume is low, and a bounded synchronous action may be enough after the safety limits are fixed.
- **Impact:** Avoids prematurely expanding a cross-repository feature.
- **Recommended action:** Benchmark the safe synchronous path on a preview deployment. Add a queue only if agreed p95 duration or failure targets are missed.
- **Open questions:** What benchmark threshold triggers a queued design?

## Specific wording changes recommended

These are targeted corrections, not a rewrite of the specification.

1. **§4.1 cache rule:** Replace “Artwork-bearing responses must return `private, max-age=60`” with wording that applies `private, no-store` to every capability-dependent success and error, including empty artwork.
2. **§4.1 empty result:** Add: “For an authorised caller, the artwork contract is always present with every agreed key set to a valid URL or `null`. An absent contract means capability unavailable, not no artwork.”
3. **§4.1 access claim:** Replace “CheersAI API key only” with the exact intended rule: named-key-only, scope-holder, or scope-holder including wildcard keys.
4. **§4.2 source key:** Replace the two-URL concatenation with a canonical structured revision containing every used source and a transform version.
5. **§4.2 SSRF:** Replace hostname-only wording with exact approved HTTPS origins, redirect validation, special-use IP blocking, and no credential forwarding.
6. **§4.2 file safety:** Add streaming byte enforcement, magic-byte validation, decoded pixel/channel/frame limits, minimum dimensions, and an explicit format list.
7. **§4.2 finalisation:** Replace “Mirror exactly as `finaliseMediaUpload` does” with a required transactional operation plus storage compensation.
8. **§4.2 row mapping:** Add the full `media_assets` and `media_library` field mapping and storage object MIME metadata.
9. **§4.3 callback:** Replace `onArtworkImported(assetIds)` with a typed result carrying status, warning, and a complete `MediaAssetSummary`; require merge-before-select behaviour.
10. **§4.3 duration:** Replace “needs an explicit `maxDuration`” with a measured numeric value and the exact page or route location.
11. **§5 tests:** Replace “there are currently no tests for `src/lib/management-app/*`” with a statement that artwork processing coverage is new but management integration coverage exists.
12. **§6 deployment:** Replace “No consumer requests it yet” with wording acknowledging that the existing CheersAI detail call will receive and ignore the new block before the UI deploy.
13. **§7 transparency:** Replace the opacity assertion with measured evidence or mark the alpha background as an unresolved assumption.
14. **§8 decisions:** Record banner behaviour, manual-media replacement, stale-result handling, asset reuse rules, and mixed-kit consistency before changing the status from draft.

## Unresolved decisions

1. Dedicated artwork endpoint or conditional block on existing event routes.
2. Whether the new scope protects only discovery or must protect the files themselves.
3. Exact capability, empty, partial, and unsupported response semantics.
4. Exact approved production and staging origins.
5. Supported input formats, size and pixel limits, alpha background, colour handling, and minimum dimensions.
6. Output source and fallback order for every degradation case.
7. Whether partial download failure creates a degraded asset.
8. Whether a mixed old/new AMS artwork kit is acceptable.
9. Banner behaviour for imported feed and story artwork.
10. Replace, append, or first-item behaviour when manual media exists.
11. Behaviour when a second event replaces untouched auto-selected artwork.
12. Reuse policy for hidden, replaced, failed, or missing assets.
13. Synchronous action budget and queue trigger.
14. API-key provisioning and rotation ownership.
15. Retention, monitoring, canary, rollback, and support ownership.

## Key required changes before implementation

1. Choose a cache-safe and diagnosable AMS contract.
2. Separate no artwork from missing capability or scope.
3. Define a complete outbound fetch and image safety policy.
4. Define an atomic, concurrent, and compensating import state machine.
5. Make both media rows required and return a complete media summary.
6. Define stale-result, event-switch, initial-library-load, and manual-media behaviour.
7. Decide the banner outcome and its data flow.
8. Correct the source fingerprint and asset reuse rules.
9. Set measured runtime, memory, concurrency, and rate budgets.
10. Complete the image output and storage metadata contract.
11. Add migration assertions, key-rotation support, monitoring, cleanup, and a feature flag.
12. Add real cache, database, Storage, browser, image-corpus, and publish-path tests.
13. Update OpenAPI and nearby schema/code comments.

## Major risks

- A shared cache silently returns the website-shaped body to CheersAI.
- A missing scope or old AMS deployment is reported as a genuine no-artwork event.
- Redirect or DNS behaviour bypasses the hostname allowlist.
- A small malicious image exhausts memory or CPU.
- Concurrent or failed imports leave orphaned files or incomplete media rows.
- The wizard selects an ID it cannot render or later library loading removes it.
- A late response attaches artwork from the wrong event.
- A hidden, replaced, or broken asset is reused.
- Feed and story are imported from different AMS artwork revisions.
- The automatic date strip covers designed content or duplicates its date.
- Unit tests pass while real cache, Storage, foreign-key, and publishing behaviour fails.

## Recommended next steps

1. Hold a short design decision review for the P0 items: endpoint/cache model, capability signalling, outbound image safety, import atomicity, async state, and banner behaviour.
2. Update the specification with the targeted wording and complete source/output and error matrices.
3. Prototype the safe synchronous ingest with representative and hostile images, then measure duration, memory, and output size on a preview deployment.
4. Design the database reservation, required finalisation, and cleanup flow before UI work.
5. Add shared API fixtures and the cross-repository integration test plan.
6. Re-review the revised specification. Implementation should not start until every P0 is closed and every P1 has an accepted requirement or delivery task.
