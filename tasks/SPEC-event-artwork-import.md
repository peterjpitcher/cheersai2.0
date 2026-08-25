# SPEC: Import event artwork from the management app

Status: **v2, decisions closed, ready to implement.**
Supersedes v1. Revised after `tasks/DEVELOPER-REVIEW-SPEC-event-artwork-import.md` (2026-08-25).
Repos: `OJ-AnchorManagementTools` (AMS) and `OJ-CheersAI2.0` (CheersAI).
Delivery: two PRs, AMS first. See `tasks/PLAN-event-artwork-import.md`.

---

## 1. Problem

Event artwork is designed once, in AMS, at five sizes. CheersAI's "Import from events"
brings across the name, date, time, CTA links and brief, but no artwork. Every event post
still needs the square and the story downloading from AMS and re-uploading by hand.

There is a second, quieter cost. When CheersAI needs a 9:16 story image it does not have
one, so it makes one: a centre crop of the square, scaled to cover 1080x1920, keeping only
the middle 56% of the width. That cuts the sides off artwork laid out to fit a square. The
purpose-built 9:16 file already in AMS is the file that should publish.

## 2. Verified current state

Checked against both repositories and both production databases on 2026-08-25.

### 2.1 AMS

| Fact | Where |
|---|---|
| Five variants in one config: `square`, `landscape`, `social`, `story`, `print_poster` | `src/lib/events/imageVariants.ts` |
| Cache columns on `events`: `hero_image_url` (square), `landscape_image_url`, `social_image_url`, `story_image_url`, `print_poster_url` | migration `20260812100000_event_image_variants.sql` |
| Per-variant metadata rows in `event_images` with `storage_path`, `mime_type`, `file_size_bytes`, `updated_at`; singleton unique index per `(event_id, image_type)` | same migration |
| `story` and `print_poster` are never emitted by the public API; asserted by test | `src/lib/api/eventImageFields.ts`, `src/lib/api/__tests__/eventImageFields.test.ts` |
| Auth is API key + scope array via `withApiAuth(handler, ['read:events'])` | `src/lib/api/auth.ts` |
| `createApiResponse` sets `public, max-age=60, stale-while-revalidate=120` plus an ETag on every GET, varying only on `Origin` | `src/lib/api/auth.ts` |
| A dedicated key named `cheersai` exists: `read:menu, read:events, payments:capture` | prod `api_keys`, id `f48a6a54` |
| The `event-images` bucket is **public**, 25 MB limit, jpeg/png/webp/gif/pdf | prod `storage.buckets` |
| `docs/guides/api/openapi.yaml` is the declared integration contract | AMS docs |
| The API-key admin UI has a hardcoded permission list that would not include a new scope | `src/app/(authenticated)/settings/api-keys/ApiKeysManager.tsx` |

Production artwork coverage. **Both figures are stated on their own basis; do not mix them.**

| Measure | Basis | Count |
|---|---|---|
| Events with a future date | upcoming | 16 |
| Of those, with any artwork (all five variants present) | upcoming | 4 |
| Of those, with no artwork at all | upcoming | 12 |
| Events with a `square` row, any date | all time | 39 |
| Events with a `story` row, any date | all time | 4 |

The full kit is new and currently exists on four events. **Degradation is the common path,
not the exception.** Source files are PNG at 2 to 3 MB.

Reproduce with `scripts/sql/artwork-coverage.sql`, added by this change. Refresh before
release; the four-event baseline will have moved.

### 2.2 CheersAI

| Fact | Where |
|---|---|
| `ManagementEventDetail` declares image fields; the prefill mapper **drops every one** | `src/lib/management-app/client.ts`, `mappers.ts` |
| Import UI sets title, event name, date, time, CTA links, prompt via `setValue` | `src/features/create/forms/event-fields.tsx` |
| Selected media lives in `CreateWizard` state, not the form | `create-wizard.tsx:85` |
| **`setLibraryItems(data.mediaAssets)` replaces the list wholesale when the initial load resolves** | `create-wizard.tsx:186-188` |
| `media_assets`: `storage_path` in the `media` bucket plus `derived_variants` jsonb `{original, square, story, landscape}` | prod schema |
| `media_library` is a separate table; `content_media_attachments` FKs to it | prod schema, `src/app/actions/media.ts` |
| The `media_library` mirror in `finaliseMediaUpload` is **best effort** and swallows failures | `src/app/(app)/library/actions.ts:199-216` |
| Uploads are browser-side: canvas centre-crops to 1080x1350 / 1080x1920 / 1920x1080 | `src/lib/library/client-derivatives.ts` |
| `processed_status = 'ready'` only when `derived_variants.story` exists | `finaliseMediaUpload` |
| The live publish worker signs paths in CheersAI's **own** bucket. Story hard-requires `derived_variants.story` (`STORY_DERIVATIVE_MISSING`). Feed uses `storage_path`, or the bannered render | `supabase/functions/publish-queue/worker.ts:1275-1400` |
| Event posts **always** set `banner_enabled = true` | `src/app/actions/content.ts:976-983` |
| The banner composites a gold `#a57626` strip over 7% of the short side on the right edge, output JPEG | `src/lib/banner/render-server.ts` |
| `media_assets` has **no provenance column** | prod schema |
| `sharp` is a dependency, already used server-side, `serverExternalPackages: ['sharp']` | `package.json`, `next.config.ts` |
| Management-app integration tests **already exist** at `tests/lib/management-app/{client,data,mappers,event-list-cache}.test.ts`, plus `tests/app/create/management-actions.test.ts` | repo |
| Repo rule: library-level tests live under `tests/`, component tests may sit beside source | `vitest.config.ts` include globs |

Two facts drive the whole design:

1. **The artwork must be copied into CheersAI's own storage.** The worker signs paths
   against the CheersAI `media` bucket, so a remote URL in `storage_path` can never sign.
2. **One media asset, not two.** Square in `storage_path`, story in
   `derived_variants.story`. Feed publishes the square, story publishes the designed 9:16,
   with no worker change and no change to the existing story gate.

## 3. Scope

**In scope**

- A new scope-gated AMS endpoint returning square, story and landscape artwork.
- CheersAI copies that artwork into its library as one asset on event import, and
  pre-selects it in the wizard.
- Graceful, diagnosable degradation for partial artwork, no artwork, and an AMS that has
  not been upgraded.
- Suppressing the automatic date banner on posts built from imported artwork.

**Out of scope**

- Any change to the-anchor.pub or to the two existing AMS event routes.
- Changing the publish worker or the derivative model.
- Backfilling artwork onto already-scheduled posts.
- Re-syncing artwork changed in AMS after a CheersAI post was created.
- Social and print-poster variants (no consumer).
- A durable job queue. See section 9; revisit if benchmarks miss target.

## 4. Decisions

Recorded here rather than left open. Every one closes a review finding.

| # | Decision | Closes |
|---|---|---|
| D-01 | **Dedicated endpoint** `GET /api/events/{id}/artwork`, not a conditional block on the existing routes. | F-01, F-16, F-23, O-01 |
| D-02 | `Cache-Control: private, no-store` and **no ETag** on every response from that endpoint, success and error alike. | F-01 |
| D-03 | Missing scope returns **403**. Old AMS returns **404**. Authorised returns **200 with explicit nulls**. Three distinct client outcomes. | F-02 |
| D-04 | The scope stops the website *selecting* story and print artwork. It is **not** confidentiality: the bucket is public and stays public. | F-03 |
| D-05 | Return `square`, `story`, `landscape` only. | O-02 |
| D-06 | Outbound fetch uses a **server-owned exact-origin allowlist**, rejects redirects, sends no credentials. | F-04 |
| D-07 | Image intake: streaming byte cap, magic-byte sniff, JPEG/PNG/WebP only, hard Sharp pixel and frame limits. | F-05 |
| D-08 | Import runs a reserve, work, finalise state machine backed by three SQL functions, with storage compensation on failure. | F-07, F-08 |
| D-09 | `source_key` is a hash of canonical structured JSON including a transform version and every source with explicit nulls. | F-09, F-17 |
| D-10 | Reuse requires a full validity check, not just a provenance match. | F-10 |
| D-11 | Ingest is a **Route Handler**, `runtime = 'nodejs'`, `maxDuration = 60`, internal deadline 45s. | F-18 |
| D-12 | The ingest returns a typed result carrying a complete `MediaAssetSummary`; the wizard **merges** it into `libraryItems` by id, and the initial library load merges rather than replaces. | F-12 |
| D-13 | A request token plus the selected event id guards against out-of-order completion. | F-13 |
| D-14 | Auto-selected artwork is tracked separately from manual choices. Replacement of manual media is explicit only. | F-14 |
| D-15 | **The automatic date banner is suppressed** when every selected asset is imported event artwork. Decided server-side from provenance, not from client input. | F-15 |
| D-16 | The kill switch is the AMS scope grant. Revoke it and CheersAI degrades to today's behaviour with no deploy. | F-23 |
| D-17 | Failed imports are cleaned up immediately. Superseded assets are never deleted (posts may reference them); their `source_key` is cleared so a fresh revision can take it. | F-29 |

## 5. AMS design

### 5.1 New endpoint

```
GET /api/events/{idOrSlug}/artwork
Auth: X-API-Key, requires BOTH read:events and read:events:artwork
```

| Condition | Status | Body |
|---|---|---|
| Key lacks `read:events:artwork` | 403 | `{success:false, error:{code:'FORBIDDEN'}}` |
| Event not found | 404 | `{success:false, error:{code:'NOT_FOUND'}}` |
| Authorised | 200 | envelope below |

```jsonc
{
  "success": true,
  "data": {
    "eventId": "9d03a427-...",
    "slug": "big-sing-friday-karaoke-night",
    "kitUpdatedAt": "2026-08-24T18:16:46.387Z",
    "variants": {
      "square":    { "url": "https://...", "mimeType": "image/png", "sizeBytes": 1974635, "updatedAt": "...", "inherited": false },
      "story":     { "url": "https://...", "mimeType": "image/png", "sizeBytes": 2049388, "updatedAt": "...", "inherited": false },
      "landscape": null
    }
  }
}
```

Normative rules:

1. All three keys of `variants` are **always present** for a 200. A variant is either a
   complete object or `null`. An absent `variants` key cannot happen, because an AMS
   without this change has no route to answer at all.
2. `url` is always an absolute `https://` URL.
3. `inherited: true` means the URL came from the `events` cache column with no matching
   `event_images` row, which happens when an event inherits its category default image. In
   that case `mimeType`, `sizeBytes` and `updatedAt` are `null`.
4. Unknown fields added later must be ignored by clients. Client parsing is
   field-by-field, never exact-shape.
5. Data source: one `event_images` query for the three variant rows, plus the already
   loaded `events` row for the fallback URLs. Two queries total.

### 5.2 Scope and provisioning

- New scope string `read:events:artwork`.
- Migration grants it to the single active key named `cheersai`, following the idempotent
  pattern of `20260814080100_marketing_conversions_api_scope.sql`, **plus a row-count
  assertion** that raises if it did not affect exactly one row (the pattern already used
  in `20260812100000` for the storage bucket update). A silent zero-row update is the
  failure mode that would ship a dead feature.
- Add `{ value: 'read:events:artwork', label: 'Read Event Artwork' }` to
  `PERMISSION_OPTIONS` so a replacement key can be provisioned through the UI on rotation.
- Rotation procedure documented in the plan: create the new key **with** the scope, verify
  with a live 200, update CheersAI settings, deactivate the old key.

### 5.3 What does not change

`buildEventImageFields`, `buildEventImageList`, `/api/events`, `/api/events/[id]` and their
tests are **untouched**. The existing assertion "emits no story or print poster field at
all" keeps passing unchanged, and remains the guard that stops these URLs reaching
`image[]` and `posterImageUrl` where the website and social crawlers would select them.

### 5.4 Documentation

- `docs/guides/api/openapi.yaml`: new path, new security scope, response schema, null
  semantics, cache behaviour, 403 and 404.
- `docs/guides/api/API_README.md`: scope list and the endpoint.
- Forward `COMMENT ON COLUMN` migration for `events.story_image_url` and
  `events.print_poster_url`, replacing "Never emitted by the public API" with "Not part of
  the website-facing image fields; story is available through the scoped artwork endpoint".
- The `webServed` comment in `imageVariants.ts` reworded to say website-facing.

## 6. CheersAI design

### 6.1 Client

`src/lib/management-app/client.ts` gains `getManagementEventArtwork(config, eventId)`
returning a discriminated union, never throwing for the expected outcomes:

```ts
type ManagementArtworkResult =
  | { status: 'ok'; eventId: string; kitUpdatedAt: string | null; variants: ArtworkVariants }
  | { status: 'unavailable'; reason: 'forbidden' | 'unsupported' | 'not_found' }
  | { status: 'error'; message: string };
```

403 maps to `forbidden`. A 404 from the artwork route maps to `unsupported`, meaning an AMS
that predates this change, because the import flow has already confirmed the event exists
through the detail endpoint it calls first. A genuine missing event maps to `not_found`.

### 6.2 Outbound fetch safety

`src/lib/management-app/artwork-fetch.ts`:

- **Allowlist**: exact origins (scheme, host and port), from `MANAGEMENT_ARTWORK_ORIGINS`
  (comma-separated, added to `src/env.ts` as an optional server var) defaulting to the
  known AMS storage origin. The origin list is **server-owned**; it is never learned from
  the response, which would be circular.
- `https:` only. Reject userinfo in the URL. Reject non-default ports.
- `redirect: 'error'`, so any redirect is a rejection and a hostname check cannot be
  walked past.
- **No credentials**: no API key, no cookies, no `Authorization`, no `Referer`.
- Per-request `AbortController` with a 15s timeout.
- Because the origin list is server-owned and points at Supabase-managed DNS, DNS
  rebinding is not in the threat model. Stated explicitly rather than implied.

### 6.3 Image intake

`src/lib/management-app/artwork-image.ts`:

| Control | Value |
|---|---|
| Byte cap | 12 MB, enforced **while reading the stream**, not from `Content-Length` |
| Format | magic-byte sniff; JPEG, PNG, WebP only. `Content-Type` is advisory, never trusted |
| Sharp constructor | `{ failOn: 'error', limitInputPixels: 40000000, unlimited: false, pages: 1, animated: false }` |
| Minimum source | shortest side at least 540 px, else reject that variant with a warning |
| Maximum source | longest side at most 12000 px |

Transform, identical for every output:

```
sharp(buf, LIMITS)
  .rotate()                                   // honour EXIF, then drop it
  .resize(w, h, { fit: 'cover', position: 'centre', withoutEnlargement: false })
  .flatten({ background: '#ffffff' })         // alpha to white, social is opaque
  .toColourspace('srgb')
  .jpeg({ quality: 90, chromaSubsampling: '4:4:4', mozjpeg: false })
```

`chromaSubsampling: '4:4:4'` because this artwork is text-heavy, and 4:2:0 visibly softens
small type. Metadata is dropped, which is Sharp's default without `withMetadata()`.

Upload metadata: `contentType: 'image/jpeg'`, `cacheControl: '31536000'`, `upsert: true`.

### 6.4 Source-to-output matrix (normative)

Four objects are produced. Fallback order is left to right; the first available source
wins. "Available" means fetched, validated and decoded without error.

| Output | Target | Source order |
|---|---|---|
| `storage_path` (feed) | 1080x1080 | square, then landscape, then story |
| `derived_variants.story` | 1080x1920 | story, then square, then landscape |
| `derived_variants.square` | 1080x1350 | square, then landscape, then story |
| `derived_variants.landscape` | 1920x1080 | landscape, then square, then story |

`derived_variants.original` is set to `storage_path`, matching `normaliseDerivedVariants`.

**Minimum to create an asset: at least one source fetched and validated.** Every output is
then produced from whatever is available, so the asset is always publishable to both
placements.

Per-source failure table:

| Situation | Result | User sees |
|---|---|---|
| All three sources present and valid | `imported` | "Square and story artwork imported." |
| Square only | `imported` | "No designed story artwork in the management app, so the story crop was generated from the square." |
| Story only | `imported` | "No square artwork, so the feed image was cropped from the story." |
| Landscape only | `imported` | Warning naming what was cropped from what. |
| Story present but fetch or decode fails, square valid | `partial` | "The story artwork could not be read, so the story crop was generated from the square." |
| Every source fails | `failed` | "Event artwork could not be imported. Add media in the next step." Field prefill is unaffected. |
| No variants at all | `none` | "This event has no artwork in the management app." |
| 403, or 404 from the artwork route | `unavailable` | "Artwork import is not available for this management app connection." |
| Variants' `updatedAt` differ by more than 10 minutes | appended to the warning | "The management app artwork may have been part-updated; check the preview." |

The mixed-kit case (F-17) is **accepted as eventual consistency**, detected and warned
about rather than prevented. Preventing it would need atomic multi-file publishing in AMS,
which is out of scope.

### 6.5 Import state machine

Three SQL functions, so the two media tables can never disagree. Section 2.2 shows the
current mirror is best effort, which is not good enough when the foreign key is mandatory.

```
reserve_imported_media_asset(p_account_id, p_source_key, p_asset_id, p_storage_path,
                             p_file_name, p_tags, p_stale_after interval)
  returns (asset_id uuid, outcome text)   -- 'reserved' | 'reused' | 'in_progress'
```

Inserts a `media_assets` row (`processed_status='processing'`) **and** its `media_library`
mirror in one transaction. On `source_key` conflict it inspects the winner: `ready` gives
`reused`; `processing` newer than `p_stale_after` gives `in_progress`; `processing` older
than that is taken over and gives `reserved`.

```
finalise_imported_media_asset(p_account_id, p_asset_id, p_mime_type, p_size_bytes,
                              p_derived_variants, p_aspect_class, p_width, p_height)
release_imported_media_asset(p_account_id, p_asset_id)   -- deletes both rows
```

Sequence:

1. Resolve artwork from AMS. No sources means return `none` or `unavailable` and do nothing.
2. Compute `source_key`. Look for an existing asset and run the 6.6 validity check.
3. Call `reserve_...`. `reused` returns it. `in_progress` returns `in_progress`, and the
   client retries once after 3s. `reserved` continues.
4. Fetch, validate, transform, upload all four objects.
5. Call `finalise_...`.
6. **On any failure between 3 and 5**: delete every object uploaded in this attempt, then
   call `release_...`. Cleanup failures are logged at error with the paths, never
   swallowed, so a later audit can find them.

`processing` rows show in the library as "Processing" and cannot be selected for a story,
because the existing gate requires `ready` plus a story derivative. A half-finished import
can never be attached to a post.

### 6.6 Provenance, idempotency and reuse

New columns on `media_assets`, both nullable and additive:

```sql
source_key      text     -- canonical provenance, unique per account when set
source_metadata jsonb    -- { provider, entityType, eventId, variants, transformVersion }
```

```sql
create unique index media_assets_account_source_key_uniq
  on media_assets (account_id, source_key) where source_key is not null;
```

```
source_key = 'ams:event:' || eventId || ':' || sha256(canonicalJson({
  v: TRANSFORM_VERSION,
  eventId,
  square:    url or null,
  story:     url or null,
  landscape: url or null,
  updatedAt: { square, story, landscape }
})).slice(0, 32)
```

`TRANSFORM_VERSION` is bumped whenever crop, quality or colour handling changes, so old
assets are not wrongly reused after a rendering change. A single encoded key plus a
structured `source_metadata` column gives both the cheap unique index and the queryable
detail, without the four-column spread of O-03.

**Reuse is only permitted when every one of these holds**: same `account_id`;
`hidden_at is null`; `processed_status = 'ready'`; `derived_variants.story` non-empty; and
all four storage paths sign successfully, since a failed sign means the object is gone. If
any check fails, the existing row's `source_key` is set to `null`, leaving the asset itself
alone because scheduled posts may reference it, and a fresh import proceeds.

Reused assets **do not** have their file name or tags refreshed. Renaming an event must not
silently rename a library asset the user may have since renamed themselves.

### 6.7 Row mapping (normative)

| `media_assets` | Value |
|---|---|
| `id` | generated uuid, used in every storage path |
| `account_id` | from the authenticated session, never from the client |
| `storage_path` | `{accountId}/{assetId}/{slug}.jpg` |
| `file_name` | `{slugified event name}-artwork.jpg`, max 80 chars, via the existing `sanitiseFileName` |
| `media_type` | `'image'` |
| `mime_type` | `'image/jpeg'` |
| `size_bytes` | byte length of the **feed** JPEG only. Total bytes across all four go to logs, not this column |
| `tags` | `[slugified event name, 'event-artwork']`, through `normaliseTags` |
| `processed_status` | `'processing'` at reserve, `'ready'` at finalise |
| `processed_at` | `now()` at finalise |
| `derived_variants` | `{ original, square, story, landscape }`, all bucket-relative |
| `aspect_class` | `'square'` |
| `hidden_at` | `null` |
| `source_key`, `source_metadata` | section 6.6 |

| `media_library` | Value |
|---|---|
| `id` | same uuid |
| `account_id`, `file_name`, `tags` | as above |
| `file_url` | the `storage_path`, matching what `finaliseMediaUpload` writes today |
| `file_type` | `'image/jpeg'` |
| `file_size_bytes` | feed JPEG bytes |
| `width`, `height` | 1080, 1080 |

### 6.8 Transport and contract

**Route handler**, not a Server Action, because Sharp needs the Node runtime and this work
needs its own time budget rather than raising it for every action on the `/create` page.
Precedent: `src/app/api/create/generate-stream/route.ts`.

```
POST /api/create/event-artwork
export const runtime = 'nodejs'
export const maxDuration = 60      // internal deadline 45s, leaving room to clean up
Body: { eventId: string, eventSlug?: string }   // the only trusted inputs
```

Auth: `getCurrentUser()` plus `activeAccountId`, mirroring `generate-stream`. Account,
connection and every URL are derived server-side. Nothing about the media row, storage
path, account or source key is ever accepted from the client.

Result:

```ts
type ImportEventArtworkResult =
  | { status: 'imported' | 'reused' | 'partial'; asset: MediaAssetSummary; warning?: string }
  | { status: 'in_progress' }
  | { status: 'none' | 'unavailable' | 'failed'; warning: string };
```

`MediaAssetSummary` is built by a new shared module `src/lib/library/summary.ts`, extracted
from the private `mapToSummary`, `signPreviewFromCandidates` and `signStoryPreview` helpers
in `library/actions.ts` so both paths sign previews identically. A `'use server'` file can
only export async functions, which is why the sync mapper has to move out.

### 6.9 Wizard behaviour

- `CreateWizard` gains `artworkState: { status, warning, requestToken, eventId }` and
  `autoSelectedFrom: { eventId, assetId } | null`.
- The initial library load **merges** by id instead of replacing (`create-wizard.tsx:188`),
  so an import that lands first is not wiped.
- A completed import merges its `MediaAssetSummary` into `libraryItems` **before**
  selecting the id, so Media and Generate can render it immediately.
- **Stale-result guard**: each import carries a token, and a result is applied only if its
  token is still current and its `eventId` still matches the chosen event.
- **Selection rules**:
  - Nothing selected: auto-select.
  - Selection is exactly the previous auto-import and untouched: replace it.
  - Anything else: do not touch it, and show a "Replace media with event artwork" button.
    Ingestion has already happened, so the button is instant. A stale unused asset is
    accepted and covered by 6.11.
- Accessibility (F-26): the status line is an `aria-live="polite"` region; failures use
  `role="status"` with text, never colour alone; the event search input gets a real
  `<Label>`; focus is preserved when the panel closes; retry is a keyboard-reachable
  button. Target WCAG 2.2 AA.

### 6.10 Banner suppression (D-15)

`createScheduledBatch` currently forces `banner_enabled: true` for every event. Designed
artwork usually carries its own date and has content under the right-hand strip.

Change: before building variant payloads, load `source_key` for the selected media ids. If
**every** selected asset has a `source_key` starting `ams:event:`, the automatic event
overlay is not applied, so `autoOverlayForEvent` becomes false. A typed banner override
still switches it on, so nothing is taken away from the user.

Decided from the database, not from a client flag, so it cannot be spoofed and cannot drift
out of sync with what was actually attached.

### 6.11 Retention

- Failed attempts are cleaned up inline, per 6.5 step 6.
- Superseded assets are **never** deleted, because scheduled and published posts reference
  them. Their `source_key` is cleared so the new revision can claim it.
- Unused imports that were never attached to content stay in the library, where the
  existing hide and bulk-delete tooling already applies.
- An orphan-object audit script is **deferred** to a follow-up and named as such rather
  than implied. At the current volume, single figures per week and roughly 500 KB per event
  after JPEG conversion, it is not needed for this release.

### 6.12 Observability

One structured line per import from the route handler, carrying `correlationId`,
`accountId`, `eventId`, `result`, `sourceCounts`, `stageMs` for resolve, fetch, transform,
upload and db, plus `bytesIn`, `bytesOut` and `errorClass`. Never logged: API keys,
cookies, signed URLs, full storage query strings.

Failure classes are distinct and greppable: `unavailable_forbidden`, `unavailable_route`,
`fetch_rejected_origin`, `fetch_redirect`, `fetch_timeout`, `image_too_large`,
`image_bad_format`, `transform_failed`, `upload_failed`, `db_failed`, `cleanup_failed`,
`deadline_exceeded`.

## 7. Testing

This extends an existing suite. `tests/lib/management-app/` already holds client, data,
mappers and event-list-cache tests, and `tests/app/create/management-actions.test.ts`
covers the import actions. **New** coverage is artwork resolution, image processing, the
import state machine and the wizard behaviour.

**AMS**

- `eventImageFields.test.ts` unchanged and still green. This is the regression proof that
  the website contract did not move.
- New artwork route tests: 403 without the scope, 200 with it, 200 for `*`, 404 for a
  missing event, explicit nulls for an event with no artwork, `inherited: true` for a
  category-default square, `kitUpdatedAt` as the max of the three.
- Header test: `private, no-store` and **no ETag** on 200, 403 and 404 alike.
- Cross-key sequencing test: website key then CheersAI key against the *existing* routes,
  asserting neither body changed at all.
- Migration: idempotent, affects exactly one row, raises on zero.
- OpenAPI parses and contains the new path and scope.

**CheersAI**

- `artwork-fetch`: off-allowlist origin, `http:`, userinfo, odd port, redirect, timeout,
  and a check that no `X-API-Key`, `Authorization` or `Cookie` header is sent.
- `artwork-image`: oversize stream cut off mid-read, false `Content-Type` with wrong magic
  bytes, animated WebP, a 100 MP decompression-bomb PNG, an EXIF-rotated JPEG, a
  transparent PNG, an undersized image, and a text-heavy sample checked for output
  dimensions and JPEG magic bytes.
- Source-to-output matrix: **every row** of 6.4 as a table-driven test.
- State machine, against a real database under `tests/integration`: concurrent reserve
  returns one `reserved` and one `in_progress`; stale takeover works; the failure path
  removes both rows and every uploaded object; finalise writes both tables.
- Reuse validity: hidden, not-ready, missing story derivative, and missing storage object
  each force a new revision and clear the old `source_key`.
- Wizard: import-then-library-load and library-load-then-import both end with the asset
  present and selected; a stale event-A result is discarded after switching to event B;
  manual media is never overwritten; the `aria-live` region is present.
- Banner: a batch whose media are all `ams:event:` provenance writes `banner_enabled:
  false`; a mixed batch keeps `true`; a typed override always wins.
- Publish path: an imported asset signs for both feed and story through the real preflight
  and `resolveMediaUrls`.
- `npm run build` succeeds with the new Node-runtime route.

## 8. Delivery and rollback

| # | Step | Changes behaviour? |
|---|---|---|
| 1 | AMS: comment migration plus scope grant migration | No |
| 2 | AMS: artwork endpoint, key UI option, OpenAPI | No. **New route only.** The two existing event routes are untouched, so the response CheersAI already receives is byte-identical |
| 3 | CheersAI: migration (`source_key`, `source_metadata`, index, three functions) | No |
| 4 | CheersAI: client, fetch, image, state machine, route, wizard, banner | **Yes.** The only user-visible step |

Compatibility matrix, all four combinations verified before step 4:

| AMS | CheersAI | Expected |
|---|---|---|
| old | old | today's behaviour |
| new | old | today's behaviour, new route simply unused |
| old | new | `unavailable`, fields still import, no errors |
| new | new | full feature |

**Kill switch (D-16):** revoke `read:events:artwork` from the `cheersai` key. CheersAI gets
403, reports `unavailable`, and every other path is unchanged. No deploy needed.

**Rollback:** revert the CheersAI deploy. Imports stop; assets already created stay in the
library and remain publishable, because they are ordinary `media_assets` rows. Rollback is
"stop new imports and keep what exists", not "undo". The migrations are additive and stay.

Watch window: the first 24 hours. Abort if the import failure rate exceeds 25% of attempts,
or if any `cleanup_failed` appears.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Shared cache cross-serves scope-dependent bodies | Dedicated endpoint, `private, no-store`, no ETag. The existing routes stay single-shaped |
| Missing scope reads as "no artwork" | 403, 404 and 200-with-nulls are three distinct outcomes with distinct UI copy |
| Redirect or DNS walks past the host check | Exact-origin allowlist, `redirect: 'error'`, server-owned origin list |
| Decompression bomb exhausts memory | Streaming byte cap, magic bytes, `limitInputPixels`, min and max dimensions |
| Concurrent or failed imports leave debris | Reservation state machine plus inline compensation, integration-tested |
| Mandatory foreign-key row missing | Both rows written in one SQL function, not best effort |
| Wizard shows a media id it cannot render | Summary returned and merged before selection; initial load merges |
| Late result attaches the wrong event's artwork | Request token plus event-id check at completion |
| Mixed old and new AMS artwork kit | Accepted, detected via per-variant `updatedAt`, warned in the UI |
| Date printed twice, or artwork covered | Automatic banner suppressed for imported artwork (D-15) |
| Unit tests pass while production fails | Integration tests against a real database and storage; publish-path signing test |
| Key rotation silently drops the scope | Row-count assertion in the migration, scope in the admin UI, documented procedure |
| Synchronous ingest too slow | 45s internal deadline, benchmark gate in the plan. A queue is deferred, with the trigger stated |

## 10. Assumptions

| # | Assumption | Owner | Verify by |
|---|---|---|---|
| A-1 | Source artwork is opaque, so flattening alpha to white is invisible | Peter | Measured during the benchmark step. If wrong, the background becomes a decision |
| A-2 | AMS artwork is normally uploaded in one staff session, so mixed kits are rare | Peter | Warning copy covers the exception |
| A-3 | Output is roughly 500 KB per event, so storage growth is negligible | Dev | Measured during the benchmark step |
| A-4 | The `cheersai` API key's 1000 per hour limit is ample | Dev | One extra call per import |
| A-5 | Vercel allows `maxDuration = 60` on Node functions for this plan | Dev | Confirmed at the first preview deploy. Drop to 30s with a 25s deadline if not |
