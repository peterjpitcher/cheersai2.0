# Developer Review — Event Artwork Import Specification

**Reviewed document:** `tasks/SPEC-event-artwork-import.md`

**Review date:** 2026-08-25

**Review basis:** The draft specification, the current CheersAI and AMS working trees, relevant migrations, upload and publishing code, current tests and CI, plus the official Next.js and Sharp documentation. Production database counts and configuration in the specification were treated as a supplied snapshot; this review did not re-query production. No source document or application code was changed.

## Executive assessment

**Readiness: Not ready for implementation.**

The main direction is sound: copy AMS artwork into CheersAI, keep one asset with placement-specific variants, and fail softly when artwork is missing. However, the draft still has release-blocking gaps in cache isolation, SSRF and image safety, database/storage consistency, async UI behaviour, and the unresolved banner decision.

The largest delivery risk is silent failure. With the current contract, CheersAI cannot tell the difference between an event with no artwork, an AMS version that does not support artwork, and a key missing the new scope. The current callback design would also select an asset ID without adding the new asset to the wizard's loaded library, so later screens may show no preview even though media is selected.

### Finding totals

| Priority | Confirmed issues | Meaning |
|---|---:|---|
| P0 | 9 | Blocks implementation or safe release |
| P1 | 14 | Required before production release |
| P2 | 4 | Should be decided or specified before build completion |
| P3 | 1 | Low-risk documentation correction |

`Confirmed issue` means the conflict or omission is visible in the specification, repository, or named platform contract. `Optional improvement` means the stated design can be made to work, but a simpler or safer design is available.

## Confirmed issues

### F-01 — Cache isolation is incomplete for a response that changes by API-key scope

- **Priority:** P0
- **Type:** Security / integration correctness
- **Relevant sections:** §4.1, §5, §7
- **Description:** The proposal makes only artwork-bearing responses `private`. AMS currently gives every GET response `public, max-age=60, stale-while-revalidate=120` and only varies on `Origin`. Making the privileged response private prevents that response being stored by a shared cache, but it does not prevent a previously cached unprivileged body being returned to a privileged CheersAI request for the same URL. Authentication and permission error responses also inherit the public GET cache policy. The wording “artwork-bearing” is ambiguous when a scoped response contains an `artwork` object whose values are all null.
- **Rationale:** The representation varies by `X-API-Key` or `Authorization`, but the cache key does not. CheersAI's `fetch(..., { cache: "no-store" })` disables its Next.js fetch cache; it does not repair an upstream shared cache that followed AMS response headers.
- **Impact:** CheersAI can silently receive a website-shaped response with no artwork. Depending on the intermediary, cached auth errors can also be served to valid callers. The proposed test proves a header value, not end-to-end representation isolation.
- **Recommended action:** Prefer a dedicated artwork endpoint requiring `read:events` and `read:events:artwork`, with `Cache-Control: private, no-store` on success and every error. If the existing endpoints are retained, define one route-level cache policy based on caller capability, cover both scoped and unscoped variants, merge the correct `Vary` values, and prove the behaviour with sequential requests using different keys. Do not choose privacy from whether any URL happens to be non-null.
- **Open questions:** Is there a CDN, reverse proxy, browser cache, or Vercel cache in front of these routes in production? Must public website event responses remain cacheable?

### F-02 — “No artwork” cannot be distinguished from missing scope or an old AMS deployment

- **Priority:** P0
- **Type:** Functional correctness / integration versioning
- **Relevant sections:** §4.1, §4.2, §5, §6
- **Description:** The `artwork` block is absent without the scope. It is also absent before the AMS change exists. The CheersAI test plan says absence is not an error, while the UI degradation matrix would tell the user that the event has no artwork. Those states are not equivalent.
- **Rationale:** A silent scope migration miss, key rotation, AMS rollback, or version mismatch would look exactly like a legitimate event with no files.
- **Impact:** The whole feature can fail in production while connection health remains green and users receive a false “no artwork” message.
- **Recommended action:** Define three distinct results: capability unavailable or forbidden; capability available with no artwork; capability available with partial/full artwork. For the proposed inline block, a scoped response should always contain `artwork` with explicit nulls, while an absent block should produce a non-blocking integration warning, not the neutral no-artwork message. A dedicated endpoint can express missing scope as 403 and no artwork as a successful all-null response.
- **Open questions:** Should the Settings connection test fail, warn, or remain green when `read:events` works but `read:events:artwork` does not?

### F-03 — The new scope does not protect the files because the AMS bucket is public

- **Priority:** P1
- **Type:** Security / requirement clarity
- **Relevant sections:** §2.1, §3, §4.1, §7
- **Description:** `read:events:artwork` controls discovery through the AMS API, but the actual Supabase objects are publicly readable by URL. Anyone with a URL can still fetch story and print artwork without the scope.
- **Rationale:** The draft discusses leakage as though the new scope is an access boundary. It is a response-shaping boundary unless the bucket or object delivery model also changes.
- **Impact:** Developers and reviewers may overestimate the protection. If pre-release or print artwork is sensitive, the design does not meet that requirement.
- **Recommended action:** State the threat model clearly. If the goal is only to keep website consumers from choosing these variants, say so. If the files need confidentiality, use a private bucket or an authenticated download endpoint and signed URLs with a defined lifetime.
- **Open questions:** Are story or print files commercially sensitive before an event is published? Is URL discoverability, rather than file confidentiality, the only concern?

### F-04 — The hostname allowlist is not a complete SSRF defence

- **Priority:** P0
- **Type:** Security
- **Relevant sections:** §4.2, §7
- **Description:** The spec allows the connection `base_url` host and an AMS storage host, but does not define where the storage host comes from or how redirects, ports, DNS resolution, private IP ranges, credentials in URLs, HTTP, IPv6, or DNS rebinding are handled. The connection base URL is user-configurable and currently accepts both HTTP and HTTPS.
- **Rationale:** `fetch` follows redirects by default. An allowlisted host can redirect to a non-allowlisted or private address. A hostname may also resolve to loopback, link-local, RFC1918, or cloud metadata addresses. Deriving the storage host from the returned artwork URL would make the allowlist circular.
- **Impact:** An authenticated user or compromised AMS response could make the CheersAI server request internal services or cloud metadata.
- **Recommended action:** Use an explicit server-side set of approved HTTPS origins. Parse with `URL`, reject userinfo and unexpected ports, resolve and reject private/loopback/link-local/multicast addresses for IPv4 and IPv6, disable redirects or validate every hop, and set separate connect and total timeouts. Never learn an allowed host from the response being validated. Add tests for redirects and encoded or alternate IP forms.
- **Open questions:** Is CheersAI intended to connect only to the production AMS origin, or must staging/custom AMS deployments be supported? What exact Supabase storage origins are approved per environment?

### F-05 — The image safety rules do not prevent memory or CPU exhaustion

- **Priority:** P0
- **Type:** Security / performance
- **Relevant sections:** §4.2, §5, §7
- **Description:** A 10 MB byte limit and `image/*` response header check do not bound decoded pixels, frames, channels, or Sharp CPU. Content-Length can be absent or false, content type can lie, compressed image bombs can be small, and `image/*` admits formats the design has not approved. The spec does not say whether the limit is enforced while streaming or only after buffering.
- **Rationale:** Sharp's default input pixel limit is very high for this use case, and it supports formats including SVG, TIFF, GIF and animated WebP. Its official constructor supports explicit `limitInputPixels`, `limitInputChannels`, `pages`, `failOn`, and auto-orientation controls: [Sharp constructor options](https://sharp.pixelplumbing.com/api-constructor/).
- **Impact:** One import can use excessive memory or CPU, exceed the function duration, or affect concurrent requests in the same runtime.
- **Recommended action:** Stream with an abort once the byte cap is crossed; do not rely on Content-Length. Allow only an agreed magic-byte-verified set such as JPEG, PNG and WebP. Configure strict Sharp input limits close to the largest legitimate AMS image, one page/frame, `failOn: "warning"`, and no unsafe/unlimited mode. Record decoded dimensions before processing and reject outliers.
- **Open questions:** Must animated GIF/WebP or SVG ever be supported? What is the largest legitimate decoded source dimension?

### F-06 — The degradation matrix does not define the actual transformation for all cases

- **Priority:** P1
- **Type:** Functional detail / error handling
- **Relevant sections:** §4.2, §4.3
- **Description:** The transform steps require a square source for `storage_path` and for fallback landscape generation, but the matrix permits story-only input. It does not say how `storage_path` is generated in that case or what landscape uses when square is absent. It also does not define per-file failures: for example, square succeeds but story fetch fails, or AMS landscape fails while square and story succeed. §4.3 says there are two network fetches, while §4.2 can fetch square, story, and landscape.
- **Rationale:** “Artwork failure is a warning” does not tell the implementation whether it should keep useful successful inputs or abandon the whole asset.
- **Impact:** Different developers can produce different media paths, warnings, and ready-state behaviour. A single landscape failure may unnecessarily discard a usable square/story asset.
- **Recommended action:** Add a source-selection table for every output. Define story-only feed generation, landscape fallback order, and independent fetch/transcode failure behaviour. A sensible rule is: keep any valid square or story source; generate missing publish-critical shapes from the valid source; treat landscape failure as a fallback crop; create no row if neither publish-critical source is usable.
- **Open questions:** If AMS supplies landscape but both square and story are absent, should that be enough to create an asset? Should a corrupt designed story fall back to a square crop or block artwork selection?

### F-07 — The unique source key does not make the multi-step import atomic or concurrency-safe

- **Priority:** P0
- **Type:** Data integrity / storage consistency
- **Relevant sections:** §4.2, §5, §6, §7
- **Description:** The action fetches files, creates four outputs, uploads them, writes `media_assets`, and mirrors `media_library`. No transaction, reservation state, conflict algorithm, or compensation path is defined. Two concurrent imports can both miss the source key, upload to different random asset IDs, then race on the unique index. One loses and leaves orphaned files. Any upload or database failure can also leave a partial set.
- **Rationale:** A database unique index only protects the final row. It does not coordinate storage writes, which are outside the database transaction.
- **Impact:** Users can receive false warnings even though another request succeeded. Storage accumulates orphaned objects, and retries may leave inconsistent rows or variants.
- **Recommended action:** Define an idempotent state machine. Reserve or upsert the source identity before expensive work, handle the unique-conflict winner by loading and validating the existing asset, and use deterministic paths or a database-backed import row with `pending/ready/failed`. On failure, delete every object written by that attempt and remove/mark the reserved row. Log cleanup failures for repair. Add a concurrent-import test.
- **Open questions:** Is it acceptable for a second caller to wait for a pending import, or should it return “import in progress” and poll/retry? How long before a pending import is considered abandoned?

### F-08 — “Mirror exactly as finaliseMediaUpload” does not guarantee the required FK row

- **Priority:** P0
- **Type:** Data integrity / contradiction
- **Relevant sections:** §2.2, §4.2, §5
- **Description:** The spec says to mirror into `media_library` exactly as `finaliseMediaUpload` does so `content_media_attachments` FKs are satisfied. The current finaliser treats that sync as non-blocking and does not inspect the returned Supabase error. A normal Supabase error result will not be caught by its `try/catch` unless explicitly thrown.
- **Rationale:** The stated requirement is “FK row must exist”; the referenced implementation provides best-effort sync.
- **Impact:** The imported asset can look ready in `media_assets` but fail later when attached to content, or planner/library references can disagree.
- **Recommended action:** Make both database writes one required database transaction or RPC. If that is not immediately possible, check and throw on both writes, compensate on failure, and repair the mirror when reusing an existing source key. Do not copy the current best-effort behaviour for this path.
- **Open questions:** Can `media_library` now be treated as guaranteed in every supported environment, allowing the old compatibility catch to be removed?

### F-09 — The source fingerprint omits an input that changes the generated asset

- **Priority:** P1
- **Type:** Data model / idempotency
- **Relevant sections:** §4.2
- **Description:** `source_key` hashes only square and story URLs, but `derived_variants.landscape` uses the AMS landscape URL when present. If only landscape changes, re-import reuses the old asset and old landscape.
- **Rationale:** An idempotency fingerprint must include every source that affects the result, plus any transform version that changes output bytes.
- **Impact:** The media library can silently keep stale artwork after an AMS update.
- **Recommended action:** Hash canonical structured input such as `{eventId, square, story, landscape, transformVersion}` with explicit nulls. Include a transform version so later quality, crop, colour, or dimension changes can intentionally create a new asset.
- **Open questions:** Should social ever be a source for any CheersAI derivative? Does a quality-only implementation change require a new asset or reuse?

### F-10 — Reuse semantics ignore hidden, replaced, missing, or broken local assets

- **Priority:** P1
- **Type:** Data lifecycle / edge cases
- **Relevant sections:** §3, §4.2, §6
- **Description:** A row found by `source_key` may be hidden, have failed processing, be missing one or more storage objects, lack its `media_library` mirror, or have been replaced locally while retaining the source key. The spec says it is reused without defining validation or repair.
- **Rationale:** CheersAI supports hiding and replacing media. A provenance key describes origin, not the current integrity of the row and files.
- **Impact:** Re-import can select an invisible, modified, or unpublishable asset. A user may believe they restored AMS artwork but receive a locally replaced image.
- **Recommended action:** Define the reusable state: account-owned, not hidden, `ready`, required variant paths present, all objects signable, mirror present, and not locally replaced unless replacement intentionally clears provenance. Repair safe omissions or create a new asset. Define whether hiding an imported asset suppresses future auto-reuse.
- **Open questions:** May users edit/replace imported assets? Should local replacement clear `source_key`, preserve it with a revision marker, or be blocked?

### F-11 — Returning only asset IDs leaves the wizard's media library stale

- **Priority:** P0
- **Type:** Functional correctness / UI state
- **Relevant sections:** §2.2, §4.3, §5
- **Description:** The proposed prop callback is `onArtworkImported(assetIds)`. The wizard separately owns `libraryItems`, loaded before the import. `MediaPicker` resolves selected thumbnails by finding IDs in its local copy of those items, and later previews resolve against the wizard list. A newly inserted ID is not in either list.
- **Rationale:** Existing upload code explicitly updates both local and parent library lists to avoid the later “No media attached” failure.
- **Impact:** The imported ID may count as selected but show no thumbnail, be unremovable from the visible selected strip, and render as no media in later previews.
- **Recommended action:** Return a complete `MediaAssetSummary` with signed feed and story previews, update `libraryItems` before selecting it, and pass both callbacks through `BriefStep`. Reused assets must also return or refresh a current summary. Add a test that moves through Media and Generate after import and sees the correct preview.
- **Open questions:** Should the import action sign previews itself, or should a small account-scoped summary action load the asset after import?

### F-12 — Async event changes can attach the wrong event's artwork

- **Priority:** P0
- **Type:** User journey / concurrency
- **Relevant sections:** §4.3, §5
- **Description:** Artwork processing is deliberately slower and separate from field prefill, but the spec does not define stale-result handling. A user can select event A, then event B, change content type, choose media, close the wizard, or move to the next step while A is still processing. The overwrite decision must also use the latest selection, not a value captured when the request began.
- **Rationale:** React transitions do not cancel server work. Slow results can arrive out of order.
- **Impact:** The wizard can attach artwork from the wrong event or overwrite a selection made while processing. That can lead to publishing incorrect promotional content.
- **Recommended action:** Track an import request token and selected event ID. Ignore stale completions, check current media state at completion, and define what happens when the component unmounts or the user advances. Disable only the controls that must be stable, show a clear independent artwork status, and provide retry. Add out-of-order action tests.
- **Open questions:** May the user proceed while artwork imports? If yes, where is completion shown after the Brief step unmounts?

### F-13 — The overwrite rule does not cover event switching or the “Use event artwork” action

- **Priority:** P1
- **Type:** Functional / UX ambiguity
- **Relevant sections:** §4.3
- **Description:** “Only when nothing is currently selected” treats previously auto-selected event A artwork as a protected user selection when the user switches to event B. It also does not say whether “Use event artwork” replaces all media, replaces only the first item, or appends to a feed carousel. It is unclear whether artwork is imported before the button is clicked.
- **Rationale:** Auto-selection and deliberate manual selection need different client provenance. The existing `findOverwriteConflicts` principle does not define media-array semantics.
- **Impact:** Event B can keep event A artwork, unused assets may be created, or feed media can be changed unexpectedly.
- **Recommended action:** Track whether the current selection was auto-imported and untouched. Permit event B to replace event A in that narrow case; otherwise ask explicitly. Define the button as a concrete operation, such as “Replace current media with event artwork,” and say whether it triggers ingestion or only selection.
- **Open questions:** Should event artwork ever be appended to existing feed media? Should switching events remove an unused auto-imported asset from the library?

### F-14 — The banner overlay is an unresolved release decision

- **Priority:** P0
- **Type:** Product decision / content correctness
- **Relevant sections:** §4.4, §8
- **Description:** The draft says “Interaction to decide,” refers to “question 1,” and leaves Decisions Recorded empty, but no numbered questions appear in the document. Event banners apply to feed and story artwork. The imported designs may already contain the date and may place important content under the right strip.
- **Rationale:** This changes the visible published image, not just the import experience. It cannot be safely left to implementation judgment.
- **Impact:** Published artwork can show duplicate dates or have text/logos covered.
- **Recommended action:** Decide before coding whether imported event artwork keeps the automatic banner, disables it by default, or gets a user-visible per-post toggle and accurate preview. Add acceptance tests for both feed and story output using purpose-designed artwork.
- **Open questions:** Is the date always already printed on AMS artwork? Is the dynamic “TONIGHT/THIS FRIDAY” label valuable enough to keep when a fixed date is present?

### F-15 — The server action's trust and result contract are missing

- **Priority:** P1
- **Type:** Security / functional detail
- **Relevant sections:** §4.2, §4.3
- **Description:** `importManagementEventArtwork({ eventId })` is named but its steps are not. The spec does not explicitly require account authentication, loading the connection server-side, refetching the event from AMS, validating the response event ID, or preventing the client from supplying URLs, paths, account IDs, or source keys. Its success and warning result shape is also absent.
- **Rationale:** A Server Action is still an externally callable mutation boundary. All tenant and remote-source facts must be derived or verified server-side.
- **Impact:** An implementation may accept unsafe client input or return inconsistent messages that the UI cannot handle reliably.
- **Recommended action:** Define an input schema containing only event ID and optional known slug. Derive account and connection from `requireAuthContext`, fetch the detail through the authenticated management client, and build source paths internally. Return a typed state such as `imported`, `reused`, `partial`, `none`, `unavailable`, or `failed`, plus an optional `MediaAssetSummary` and user-safe warning. Never return raw secrets or internal error details.
- **Open questions:** Is the extra AMS detail request per selection acceptable, or should the first action return a server-verifiable short-lived import token to avoid it?

### F-16 — `maxDuration` is not located or sized correctly in the specification

- **Priority:** P1
- **Type:** Technical feasibility / deployment configuration
- **Relevant sections:** §4.3, §6, §7
- **Description:** The spec says the action needs an explicit `maxDuration` but gives no value or file. In Next.js App Router, Server Action duration is configured at the page level; exporting it from a general `actions.ts` module is not the documented mechanism. The current create page has no duration export and `vercel.json` has no function duration entry.
- **Rationale:** Official Next.js guidance says: “If using Server Actions, set the `maxDuration` at the page level”: [Next.js route segment config](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config#maxduration). The allowed value also depends on the Vercel plan and Fluid Compute configuration.
- **Impact:** The implementation may compile but still use the platform default, or it may place a config export where it has no effect.
- **Recommended action:** Measure a worst-case import, choose a numeric limit with margin and an internal shorter deadline, and place the configuration in `src/app/(app)/create/page.tsx` or use a dedicated route handler with its own limit. Confirm the production plan's duration and memory settings before release.
- **Open questions:** Which Vercel plan and Fluid Compute settings are active? What p95 and worst-case duration are acceptable to a user?

### F-17 — Performance and dependency budgets are not defined

- **Priority:** P1
- **Type:** Performance / capacity
- **Relevant sections:** §2, §4.2, §4.3, §7
- **Description:** The action can make a second AMS detail request, up to three image downloads, multiple Sharp decodes/renders, four storage uploads, database writes, and preview signing. No latency, memory, concurrency, AMS rate-limit, or storage-operation budget is stated. The connection key's rate limit is not recorded.
- **Rationale:** Separating prefill improves perceived speed but does not make the artwork action cheap. Concurrent imports share server resources, especially under Fluid Compute.
- **Impact:** Imports may time out, throttle AMS, slow other requests, or become expensive. The chosen 10 MB cap may be incompatible with the real function memory budget.
- **Recommended action:** State expected daily and concurrent volume, AMS rate limit, p50/p95 target, hard timeout, memory ceiling, and maximum retries. Fetch independent sources with bounded concurrency, reuse a decoded source where possible, and instrument time spent in AMS, download, Sharp, upload, and database stages.
- **Open questions:** How many staff can import at once? What is the current `cheersai` key rate limit? Which deployment region is closest to both Supabase projects?

### F-18 — Image output rules omit orientation, colour, alpha and exact format validation

- **Priority:** P1
- **Type:** Media quality / unconfirmed assumption
- **Relevant sections:** §4.2, §7
- **Description:** The spec fixes dimensions and JPEG quality but does not define EXIF orientation, colour-space conversion, ICC metadata, chroma subsampling, alpha flattening colour, or metadata stripping. The risk table asserts “Social artwork is opaque,” but that is not established in Verified Current State. JPEG conversion of transparent PNGs can produce unexpected backgrounds.
- **Rationale:** Server Sharp output can differ from browser canvas output in these details even when dimensions match.
- **Impact:** Images can be rotated, have colour shifts, show black/incorrect transparent areas, or differ visibly from AMS designs.
- **Recommended action:** Add output acceptance rules: auto-orient, convert to sRGB, strip unneeded metadata, flatten alpha against an approved background, reject unsupported animation, and verify exact JPEG MIME/dimensions. Test with rotated, transparent, wide-gamut, malformed, and high-detail samples. Validate the opaque-artwork assumption or remove it.
- **Open questions:** What background colour should replace transparency? Must embedded colour profiles or copyright metadata be retained?

### F-19 — The artwork API schema is not precise enough for independent implementations

- **Priority:** P1
- **Type:** API contract / ambiguity
- **Relevant sections:** §4.1, §5
- **Description:** The example shows five strings but the tests mention nulls, blanks, and absent columns. It does not state whether keys are always present, whether blank database values become null, whether unknown fields are allowed, or whether list and detail are versioned together. The print field uses snake_case while the surrounding public contract mainly uses camelCase.
- **Rationale:** The no-artwork/capability distinction depends on exact presence and null semantics.
- **Impact:** AMS and CheersAI can both pass their own unit tests while disagreeing on wire shape.
- **Recommended action:** Add a small normative schema with required/optional status for the block and each key, null normalization, casing, URL requirements, and compatibility behaviour for unknown fields. Add a contract fixture consumed in both repos or an integration test against a representative AMS response.
- **Open questions:** Is `print_poster` intentionally snake_case on the wire? Should the block contain a schema/version or capability marker?

### F-20 — The scope migration can silently affect zero rows and does not cover key rotation

- **Priority:** P1
- **Type:** Migration / operations
- **Relevant sections:** §4.1, §6
- **Description:** The migration targets the active key named `cheersai`. In an environment where that key is absent, renamed, duplicated, inactive, or later rotated into a new row, an idempotent `UPDATE` can succeed while granting nothing or the wrong number of rows. The deployment plan has no preflight or assertion.
- **Rationale:** Name-based one-time grants are configuration changes, not permanent provisioning rules.
- **Impact:** Step 2 can deploy successfully while step 4 silently receives no artwork capability. A future key rotation can break the feature.
- **Recommended action:** Add preflight and post-deploy SQL that assert exactly the intended key ID and scope in each environment. Document key rotation so the new key receives all required scopes before cutover. Decide whether zero affected rows abort the migration or are handled by an explicit ops step.
- **Open questions:** Is the key ID stable across staging and production? Who owns key rotation and scope verification?

### F-21 — The deployment and rollback claims are too strong

- **Priority:** P1
- **Type:** Delivery / deployment
- **Relevant sections:** Opening metadata, §6, §7
- **Description:** Step 2 says no consumer requests artwork yet, but CheersAI already calls the same detail endpoint with the scoped key; after step 1 and 2 it will receive and ignore the new block. That changes response size, cache policy and ETag before the CheersAI deploy. Step 4 has no feature flag, canary, abort thresholds, or storage/database cleanup plan. Reverting code does not remove assets or partial objects created during a bad release.
- **Rationale:** “Independently deployable” should mean every intermediate app/API/database combination is explicitly compatible and observable.
- **Impact:** A response-cache regression can affect the existing import before the new UI ships. A flawed final deploy may create persistent debris before rollback.
- **Recommended action:** Add an old/new compatibility matrix for both repos, a staging smoke test, a feature flag or account allowlist for the first user-visible release, pre/post-deploy checks, watch metrics, and a cleanup/repair procedure. Describe rollback as disabling new imports while preserving or repairing already-created assets.
- **Open questions:** Can AMS and CheersAI releases be coordinated on the same day? Who has go/no-go authority and how long is the watch window?

### F-22 — Monitoring and support requirements are absent

- **Priority:** P1
- **Type:** Monitoring / operations
- **Relevant sections:** §6, §7
- **Description:** “Needs watching” is not translated into events, metrics, alerts, dashboards, or support queries. There is no distinction between imported, reused, partial, no artwork, capability missing, download failure, transform failure, upload failure, unique conflict, database failure, cleanup failure, or timeout.
- **Rationale:** The feature is intentionally fail-soft, so user-visible success does not reveal backend artwork failures.
- **Impact:** Failures can remain hidden for weeks, and support cannot tell whether AMS, networking, Sharp, storage, scope, or the database caused the warning.
- **Recommended action:** Add structured stage/result logs with correlation ID, account ID, event ID, result, duration, byte counts, and safe error class. Do not log API keys, signed URLs, or full remote URLs with sensitive query strings. Add counters and alerts for capability failures, import failure rate, timeout rate, cleanup failures, and orphan growth, plus a short support runbook.
- **Open questions:** Will Axiom receive these events? What failure percentage or duration triggers rollback?

### F-23 — The test plan is mostly unit-level and cannot prove the main failure modes

- **Priority:** P1
- **Type:** Testing / delivery assurance
- **Relevant sections:** §5, §6, §7
- **Description:** The listed tests do not require a real database/storage integration, concurrent import, cross-key cache sequence, real migration application, storage cleanup, UI out-of-order completion, hidden/replaced asset reuse, connection-scope diagnostics, or a publish smoke test. CheersAI CI lints migrations but does not run Storage and does not exercise this data path.
- **Rationale:** Mocks cannot prove unique-index races, Supabase upload semantics, object existence, FK mirroring, or the publish worker's signing of the imported paths.
- **Impact:** All planned tests can pass while production creates orphaned files, fails attachments, serves the wrong cached representation, or publishes the wrong media.
- **Recommended action:** Add: AMS cross-key integration tests; a real Postgres migration/index test; Supabase Storage or a faithful storage integration test; concurrent and failure-injection ingest tests; browser tests for event switching, manual media and warnings; a full test that imports then resolves feed and story paths through the worker contract; and an image corpus covering malicious and quality edge cases. Run build output to confirm Sharp is included in the deployed function.
- **Open questions:** Can CI start Supabase Storage for this suite, or will a protected staging job provide the integration gate?

### F-24 — Accessibility acceptance criteria are missing

- **Priority:** P2
- **Type:** Accessibility / UX
- **Relevant sections:** §4.3, §5
- **Description:** The spec adds async progress, warnings, neutral status, and a new “Use event artwork” action without keyboard, focus, live-region, disabled-state, or screen-reader requirements. The existing event picker already uses custom controls rather than a named accessible combobox/listbox primitive.
- **Rationale:** Artwork can finish after the selection panel closes, so visual text alone may not be announced.
- **Impact:** Keyboard and assistive-technology users may not know that import is running, failed, or changed the media selection.
- **Recommended action:** Add WCAG 2.2 AA acceptance criteria: labelled status, polite/assertive live announcements as appropriate, focus preservation, full keyboard operation, non-colour warning cues, clear button names, and visible pending/disabled state. Include automated checks plus keyboard and screen-reader manual QA.
- **Open questions:** Which browsers and assistive technologies are supported for release testing?

### F-25 — The specification incorrectly says there are no management-app tests

- **Priority:** P2
- **Type:** Factual contradiction / testing
- **Relevant sections:** §5
- **Description:** The repository contains management-app tests for `client.ts`, `mappers.ts`, `data.ts`, `event-list-cache.ts`, and create management actions. The claim that there are currently no tests for `src/lib/management-app/*` is false.
- **Rationale:** Test impact and placement should be based on the actual suite.
- **Impact:** A developer may create duplicate coverage, put tests in the wrong layer, or miss the existing fixtures that must be extended.
- **Recommended action:** Replace the sentence with a precise statement that artwork import has no existing coverage and list the current tests to extend.
- **Open questions:** Should the new ingest tests live under `tests/lib/management-app/` to match repository guidance, with only component-specific tests co-located?

### F-26 — Production counts and several risk claims are not reproducible acceptance inputs

- **Priority:** P2
- **Type:** Assumptions / delivery validation
- **Relevant sections:** §2, §7
- **Description:** The database counts are a dated snapshot with no checked-in query or pre-deploy refresh step. “Square only (35 events today)” mixes all-time counts with the upcoming-event table and can be read as an upcoming count. “Roughly 1 MB per event” and “social artwork is opaque” are stated without measurements in the verified section.
- **Rationale:** Coverage and file characteristics drive degradation, capacity and quality decisions and can change before release.
- **Impact:** Test data and operational estimates may not reflect launch conditions.
- **Recommended action:** Check in or record the safe aggregate queries, label all-time versus upcoming counts, refresh them before release, and measure representative output sizes and transparency. Move unverified statements into an Assumptions section with owners and validation dates.
- **Open questions:** Is four full kits still the launch baseline? What are p50/p95 source and converted sizes?

### F-27 — Storage lifecycle and cost are underspecified

- **Priority:** P2
- **Type:** Data lifecycle / operations
- **Relevant sections:** §3, §4.2, §6, §7
- **Description:** The design creates a new asset whenever source URLs change and intentionally never syncs or backfills. It does not define retention for unused imports, superseded event versions, abandoned wizard sessions, hidden assets, or cleanup of failed attempts. “Negligible” storage growth is not tied to event volume or a retention period.
- **Rationale:** Version-preserving imports are useful, but every re-import and abandoned selection can persist four files.
- **Impact:** Storage and library clutter grow over time, and operators lack a safe deletion rule because scheduled posts may still reference old assets.
- **Recommended action:** Define retention and deletion by reference count and age, never delete media referenced by content or jobs, and provide an orphan audit/repair task. Forecast 12- and 24-month storage using measured output sizes and expected imports.
- **Open questions:** Should unused imports be auto-hidden or deleted after a period? What retention is required for published and scheduled content?

### F-28 — Database and code comments will become false after the change

- **Priority:** P3
- **Type:** Documentation / maintainability
- **Relevant sections:** §4.1
- **Description:** The draft updates the `imageVariants.ts` comment, but the migration-installed database comments for `story_image_url` and `print_poster_url` still say “Never emitted by the public API.” The existing `eventImageFields.ts` comment also says they are AMS-only, which will only remain true for that helper, not for all API output.
- **Rationale:** Schema comments and nearby code comments are used as future implementation guidance.
- **Impact:** Later work can reintroduce wrong assumptions about exposure and access control.
- **Recommended action:** Add new `COMMENT ON COLUMN` statements in the forward migration and make code comments precise: not emitted to website-facing image fields, but available through the scoped artwork contract.
- **Open questions:** Is generated API/schema documentation built from these database comments?

## Optional improvements

### O-01 — Use a dedicated detail artwork endpoint

- **Priority:** P1
- **Type:** Optional improvement / simplification
- **Relevant sections:** §3, §4.1, §6
- **Description:** `GET /api/events/{id}/artwork` can require both scopes, return only the three variants CheersAI uses, and always use `private, no-store`.
- **Rationale:** It removes scope-shaped variants from the website endpoints, avoids adding unused artwork to every list result, gives missing scope a real 403, and makes connection diagnostics straightforward.
- **Impact:** It adds one small AMS route but removes cache and compatibility complexity from two large routes.
- **Recommended action:** Prefer this unless another consumer has a confirmed need for inline list artwork. Keep print and social out until a consumer exists.
- **Open questions:** Is any planned consumer expected to need artwork in the list route?

### O-02 — Store provenance as explicit fields rather than one encoded string

- **Priority:** P2
- **Type:** Optional improvement / data-model clarity
- **Relevant sections:** §4.2
- **Description:** A single `source_key` encodes provider, entity type, ID and revision fingerprint into one text value.
- **Rationale:** Separate `source_type`, `source_id`, and `source_revision` fields are easier to query, validate, migrate and use for support. The unique index can still cover the three values per account.
- **Impact:** One column is simpler today, but encoded keys encourage string parsing and make future integrations less clear.
- **Recommended action:** Consider explicit provenance columns if other import sources are likely. Keep a canonical source key only if this is expected to remain the sole use.
- **Open questions:** Are Canva, other venue systems, or direct remote imports planned?

### O-03 — Extract a required transactional media finaliser

- **Priority:** P1
- **Type:** Optional improvement / maintainability
- **Relevant sections:** §4.2
- **Description:** The import needs the same row mapping, preview signing and mirror creation as browser uploads, but with stronger error handling.
- **Rationale:** Copying `finaliseMediaUpload` risks permanent drift and repeats an already weak mirror path.
- **Impact:** A shared server-only finaliser reduces duplicate behaviour and can improve normal uploads too.
- **Recommended action:** Extract a tested function or database RPC that creates/updates both media tables and returns a `MediaAssetSummary`; keep browser and AMS-specific upload logic outside it.
- **Open questions:** Can changing the existing upload finaliser safely be included in this feature, or should the shared function be introduced without switching old callers in the first PR?

### O-04 — Delay ingestion when the user already has manual media

- **Priority:** P2
- **Type:** Optional improvement / performance
- **Relevant sections:** §4.3
- **Description:** When media is already selected, the design may still do all download/render/upload work just to show a button the user might never click.
- **Rationale:** The action is expensive and the overwrite rule already requires explicit consent.
- **Impact:** Eager import creates unused assets and increases latency/cost.
- **Recommended action:** Fetch only artwork availability first, then ingest when the user clicks the clearly labelled replacement action. Keep eager import only for the empty-selection path.
- **Open questions:** Is instant button response more valuable than avoiding unused work at expected volume?

### O-05 — Keep the first version synchronous unless measurements prove a queue is needed

- **Priority:** P2
- **Type:** Optional improvement / delivery scope
- **Relevant sections:** §4.3, §6
- **Description:** A durable queue would solve some timeout and retry problems but adds job state, polling and cleanup complexity.
- **Rationale:** Current event volume is low and bounded image sizes may fit a measured Server Action budget.
- **Impact:** Premature queuing would enlarge this already cross-repository change.
- **Recommended action:** First close the safety, atomicity and observability gaps and benchmark the synchronous action. Introduce a queue only if p95 duration or failure rates miss the agreed target.
- **Open questions:** What benchmark result would trigger a queued design?

## Specific wording changes recommended

These are targeted corrections, not a rewrite of the specification.

1. **§4.1, cache rule**

   Replace “Artwork-bearing responses must return `private, max-age=60`” with: “Any response whose representation depends on `read:events:artwork`, including empty artwork and all error responses on the artwork contract, must not be stored by shared caches. Use `private, no-store`; capability, not URL presence, selects the policy.”

2. **§4.1, wire contract**

   Add: “For an authorised caller, `artwork` is always present and contains all agreed keys with a string URL or `null`. An absent block means the capability is unavailable and must not be presented as an event with no artwork.”

3. **§4.2, source key**

   Replace the two-URL hash with a canonical hash of event ID, square, story, landscape, explicit nulls, and a transform-version constant.

4. **§4.2, SSRF rule**

   Replace the hostname-only rule with explicit approved HTTPS origins, redirect-hop validation, private/loopback/link-local IP blocking for IPv4 and IPv6, port restrictions, and server-owned configuration.

5. **§4.2, file validation**

   Add streaming byte enforcement, magic-byte format validation, decoded-pixel/channel/frame limits, auto-orientation, sRGB conversion, and an approved alpha background.

6. **§4.2, database consistency**

   Replace “Mirror into `media_library` exactly as `finaliseMediaUpload` does” with: “Creation of `media_assets` and `media_library` is one required transactional operation. Any failure leaves no ready row and triggers cleanup of files written by that attempt.”

7. **§4.3, result callback**

   Replace `onArtworkImported(assetIds)` with a typed result carrying status, warning and a complete `MediaAssetSummary`, and require updating the wizard library before selection.

8. **§4.3, duration**

   Replace “The action needs an explicit `maxDuration`” with a measured numeric value and the exact page or route file where it is configured.

9. **§5, current test coverage**

   Replace “there are currently no tests for `src/lib/management-app/*`” with: “There is existing management client, mapper, data, cache and create-action coverage; artwork import and image-processing coverage is new.”

10. **§6, deployment claim**

    Replace “No consumer requests it yet” with: “The existing CheersAI client already calls the scoped detail endpoint and will receive but ignore the additive block. Verify response size, cache policy and ETag compatibility before the CheersAI feature deploy.”

11. **§7, transparency risk**

    Replace “Social artwork is opaque” with either verified production evidence or: “Transparency handling is unconfirmed; define and test the JPEG flattening background.”

12. **§8, decisions**

    Add the banner outcome, manual-media replacement behaviour, stale import behaviour, and hidden/replaced asset reuse policy before changing status from draft.

## Unconfirmed assumptions and decisions still required

1. Whether the scope is only response shaping or must protect the actual files.
2. Whether to use a dedicated artwork endpoint or scope-shaped existing routes.
3. Exact wire semantics for authorised empty artwork and unsupported capability.
4. Approved production/staging management and storage origins.
5. Supported source formats, decoded dimension limit, alpha background and colour rules.
6. Whether landscape-only input is sufficient and the fallback order for every output.
7. Whether partial source failure creates a degraded asset or no asset.
8. Banner behaviour for imported feed and story artwork.
9. Whether “Use event artwork” replaces or appends, and whether it ingests lazily.
10. Whether a second event replaces untouched auto-selected artwork from the first.
11. Reuse policy for hidden, replaced, failed or storage-missing assets.
12. Required duration, memory, concurrency and latency budgets on the production Vercel plan.
13. Scope provisioning and verification during key rotation.
14. Retention for unused, superseded and failed imports.
15. Staging, canary, feature-flag, monitoring and rollback owners.

## Key required changes before implementation

1. Choose a cache-safe and diagnosable AMS contract, preferably a dedicated no-store endpoint.
2. Distinguish no artwork from missing capability or scope.
3. Replace the hostname-only SSRF check with a complete outbound-fetch policy.
4. Add streaming, decoded-image and format safety limits.
5. Define an atomic, concurrent and compensating import state machine.
6. Make both media table writes required and repairable.
7. Return and insert a complete media summary into wizard state before selecting it.
8. Define stale-result, event-switch and manual-media behaviour.
9. Decide the banner overlay outcome.
10. Correct the source fingerprint and reuse rules.
11. Set measured runtime budgets and the actual page/route duration configuration.
12. Add real cache, database, storage, image-corpus, browser and publish-contract tests.
13. Add deployment checks, canary controls, monitoring, cleanup and support procedures.

## Major risks

- A shared cache returns the website-shaped body to CheersAI, silently removing artwork.
- Missing scope or an old AMS deployment is misreported as “this event has no artwork.”
- Redirect or DNS behaviour bypasses the proposed SSRF allowlist.
- A small malicious image exhausts memory or CPU during Sharp processing.
- Concurrent or failed imports leave orphaned files and incomplete media rows.
- The wizard selects an ID it cannot render because its loaded library is stale.
- A late action result attaches artwork from the wrong event.
- A hidden, locally replaced or broken asset is incorrectly reused.
- The automatic date strip covers designed content or duplicates the printed date.
- The Server Action times out because `maxDuration` was configured in the wrong place or not measured.
- Unit tests pass while real storage, FK, cache and publish behaviour is broken.

## Recommended next steps

1. Hold a short decision review for the five P0 design choices: endpoint/cache model, capability signalling, import atomicity, async selection rules, and banner behaviour.
2. Update the specification with the targeted wording and complete degradation/output tables.
3. Prototype the ingest against a small safe image corpus and measure duration, memory and output size on a preview deployment.
4. Design the database/storage reservation and cleanup flow before writing UI wiring.
5. Add the cross-repository contract fixture and integration test plan.
6. Re-review the revised specification. Implementation should not start until every P0 is closed and each P1 has an accepted requirement or delivery task.
