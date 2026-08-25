# PLAN: Import event artwork from the management app

Companion to `tasks/SPEC-event-artwork-import.md` v2. Two PRs, AMS first.
Each PR is independently deployable and changes no behaviour until PR2 lands.

---

## PR1: AMS, scoped artwork endpoint

Repo: `OJ-AnchorManagementTools`. Branch `feat/event-artwork-api`.
Complexity: 3 (M). No behaviour change for any existing caller.

| # | File | Change |
|---|---|---|
| 1.1 | `supabase/migrations/20260825090000_event_artwork_api_scope.sql` | Grant `read:events:artwork` to the active key named `cheersai`, with a row-count assertion that raises on zero. Forward `COMMENT ON COLUMN` for `events.story_image_url` and `events.print_poster_url`. |
| 1.2 | `src/lib/api/auth.ts` | Add a `cacheMode` option so a route can return `private, no-store` with no ETag, on success **and** on the errors `withApiAuth` generates. Default stays `public`, so every existing route is byte-identical. |
| 1.3 | `src/lib/api/eventArtworkFields.ts` | `buildEventArtworkVariants(eventRow, imageRows)`: three keys always present, each a full object or `null`, `inherited` flag, `kitUpdatedAt` as the max. |
| 1.4 | `src/app/api/events/[id]/artwork/route.ts` | The endpoint. `withApiAuth(..., ['read:events'], req, { cacheMode: 'private' })`, then an explicit artwork-scope check returning a private 403. Lookup by uuid or slug, matching the detail route. |
| 1.5 | `src/app/(authenticated)/settings/api-keys/ApiKeysManager.tsx` | Add the scope to `PERMISSION_OPTIONS` so a rotated key can be provisioned through the UI. |
| 1.6 | `src/lib/events/imageVariants.ts` | Reword the `webServed` comment to say website-facing. |
| 1.7 | `docs/guides/api/openapi.yaml`, `docs/guides/api/API_README.md` | New path, scope, schema, null semantics, cache behaviour, 403 and 404. |
| 1.8 | `src/lib/api/__tests__/eventArtworkFields.test.ts` | Builder unit tests. |
| 1.9 | `src/app/api/events/[id]/artwork/route.test.ts` | 403 without the scope, 200 with it, 200 for `*`, 404 missing event, explicit nulls, `inherited: true`, header assertions. |
| 1.10 | `src/lib/api/__tests__/eventImageFields.test.ts` | **Unchanged.** Must stay green. It is the proof the website contract did not move. |

Verify: `npm run lint && npx tsc --noEmit && npm test && npm run build`, then
`npx supabase db push --dry-run`.

## PR2: CheersAI, ingest and wizard

Repo: `OJ-CheersAI2.0`. Branch `feat/event-artwork-import`.
Complexity: 5 (XL) by file count, but a single concern. Built in the order below so each
checkpoint is verifiable on its own.

### Stage A: data layer

| # | File | Change |
|---|---|---|
| 2.1 | `supabase/migrations/20260825090000_media_asset_provenance.sql` | `media_assets.source_key text`, `source_metadata jsonb`, partial unique index, and the three functions `reserve_imported_media_asset`, `finalise_imported_media_asset`, `release_imported_media_asset`. Service-role execute only. |
| 2.2 | `src/lib/library/summary.ts` | Extract `mapToSummary`, `signPreviewFromCandidates`, `signStoryPreview` out of the `'use server'` file so both upload paths sign previews identically. |
| 2.3 | `src/app/(app)/library/actions.ts` | Use the extracted module. No behaviour change. |

### Stage B: fetch and transform

| # | File | Change |
|---|---|---|
| 2.4 | `src/env.ts` | Optional server var `MANAGEMENT_ARTWORK_ORIGINS`. |
| 2.5 | `src/lib/management-app/artwork-fetch.ts` | Exact-origin allowlist, https only, no userinfo, no odd ports, `redirect: 'error'`, no credentials, 15s abort, 12 MB streaming cap. |
| 2.6 | `src/lib/management-app/artwork-image.ts` | Magic-byte sniff, Sharp limits, the shared transform, the four render targets. |
| 2.7 | `src/lib/management-app/client.ts` | `getManagementEventArtwork`, returning the discriminated union. |

### Stage C: orchestration

| # | File | Change |
|---|---|---|
| 2.8 | `src/lib/management-app/artwork-import.ts` | Source key, reuse validity check, reserve, render, upload, finalise, compensating cleanup, structured result. |
| 2.9 | `src/app/api/create/event-artwork/route.ts` | Node runtime, `maxDuration = 60`, 45s internal deadline, auth, structured logging. |

### Stage D: wizard and banner

| # | File | Change |
|---|---|---|
| 2.10 | `src/features/create/create-wizard.tsx` | Merge the initial library load instead of replacing it; artwork state; stale-result guard; selection rules. |
| 2.11 | `src/features/create/steps/brief-step.tsx` | Pass the artwork callback through. |
| 2.12 | `src/features/create/forms/event-fields.tsx` | Trigger the import, render status and warnings in an `aria-live` region, add the replace button, label the search input. |
| 2.13 | `src/app/actions/content.ts` | Suppress the automatic event banner when every selected asset carries `ams:event:` provenance. |

### Stage E: tests and tooling

| # | File | Change |
|---|---|---|
| 2.14 | `tests/lib/management-app/artwork-fetch.test.ts` | Security matrix. |
| 2.15 | `tests/lib/management-app/artwork-image.test.ts` | Hostile and awkward image corpus, generated in-test with Sharp so no binary fixtures are committed. |
| 2.16 | `tests/lib/management-app/artwork-import.test.ts` | Every row of the source-to-output matrix, reuse validity, cleanup. |
| 2.17 | `tests/lib/management-app/client-artwork.test.ts` | 200, 403, 404, malformed payloads. |
| 2.18 | `tests/app/create/event-artwork-route.test.ts` | Auth, deadline, result mapping. |
| 2.19 | `tests/features/create/artwork-selection.test.ts` | Merge and stale-guard logic, extracted pure so it is testable without mounting the wizard. |
| 2.20 | `tests/app/content-banner-suppression.test.ts` | Provenance-driven banner suppression. |
| 2.21 | `scripts/sql/artwork-coverage.sql` | The two coverage queries, labelled by basis. |

Verify at every stage: `npm run lint && npm run typecheck && npm test`.
Full gate before the PR: `npm run ci:verify`.

## Benchmark gate

Before merging PR2, run one real import against a production event that has the full kit
and record: wall clock, peak memory, output bytes per variant, and whether any source has
an alpha channel (assumption A-1). If p95 exceeds 30s, drop `maxDuration` handling to a
queued design before release rather than after.

## API key rotation procedure

1. Create the replacement key in AMS settings **with** `read:events:artwork` selected.
2. Verify with a live call to `/api/events/{knownId}/artwork`, expecting 200.
3. Update the key in CheersAI settings and run the connection test.
4. Deactivate the old key.

Step 2 exists because a key created without the scope produces a feature that looks healthy
(the connection test only exercises `/api/events`) while artwork silently reports
`unavailable`.

---

## Delivery status (2026-08-25)

**Code complete in both repos. Nothing committed, nothing deployed, no migration applied.**

### PR1, AMS

| Item | State |
|---|---|
| `supabase/migrations/20260825090000_event_artwork_api_scope.sql` | Written, **not applied** |
| `src/lib/api/auth.ts` (cacheMode) | Done |
| `src/lib/api/eventArtworkFields.ts` | Done |
| `src/app/api/events/[id]/artwork/route.ts` | Done |
| `ApiKeysManager.tsx` scope option | Done |
| `imageVariants.ts` comment | Done |
| OpenAPI + API_README | Done, YAML validated |
| Tests | 8 builder, 9 route, 5 cache policy |
| Gate | lint clean, `tsc --noEmit` clean, **687 files / 5721 tests pass** |

`eventImageFields.test.ts` is untouched and still green, which is the evidence the
website contract did not move.

### PR2, CheersAI

| Item | State |
|---|---|
| `supabase/migrations/20260825090000_media_asset_provenance.sql` | Written, **not applied** |
| `src/lib/library/summary.ts` + actions refactor | Done |
| `src/env.ts` `MANAGEMENT_ARTWORK_ORIGINS` | Done |
| `artwork-fetch.ts`, `artwork-image.ts`, `artwork-import.ts`, `artwork-provenance.ts` | Done |
| `client.ts` `getManagementEventArtwork` | Done |
| `POST /api/create/event-artwork` | Done |
| Wizard, brief step, event fields | Done |
| Banner suppression in `content.ts` | Done |
| `scripts/sql/artwork-coverage.sql` | Done |
| Tests | 17 fetch security, 13 image, 31 import, 11 client, 15 selection, 14 route, 6 banner |
| Gate | `npm run ci:verify` passes: lint, typecheck, **1909 tests**, build |

### Not done, and why

1. **Migrations are not applied.** Both write to production (the AMS one grants a
   scope to a live API key). Column and constraint references were verified
   read-only against both production databases, so they will apply cleanly, but
   applying them is Peter's call.
2. **The three SQL functions have no test against a real database.** Their
   callers are covered by a fake that asserts the reserve, finalise, release and
   compensation sequence, but concurrent reserve, stale takeover and the unique
   index itself are only proven once the migration exists somewhere to run
   against. This is the one item from the review's F-25 that is still open, and
   it should be closed on a Supabase branch or staging before production.
3. **The benchmark gate has not been run.** It needs a preview deployment and a
   real event with the full kit. Assumptions A-1, A-3 and A-5 stay unverified
   until it is.
4. **The orphan-object audit script is deferred**, as stated in the spec.
