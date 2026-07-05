# SPEC — Planned Post Media Replacement Integrity

**Status:** Implemented — full CI pipeline passing (lint, typecheck, 1587 tests, build) on branch `fix/media-replacement-integrity`
**Date:** 2026-07-03
**Author:** Discovery + spec pass
**Supersedes:** "Planned Post Media Replacement Fix Plan" brief

---

## 1. Summary

Make media replacement reliable end-to-end so that replacing an image in `/library`
consistently re-points every planned/scheduled post and config surface, never hides an
old asset while references to it remain, and always reports what changed. Separately,
make the `/planner` media editor usable: render currently-attached media even when it
has been hidden, and fix the modal so a long library scrolls with the Save button always
reachable. Finally, ship a one-off, dry-run-first repair for posts already pointing at
hidden assets.

**Complexity score: 4 (L)** — 6+ files, schema-adjacent (constraint-aware writes, a
repair script), two subsystems (server replacement + planner editor UI), plus a data
repair. Broken into independently deployable parts below.

---

## 2. Discovery findings — brief vs. reality

Discovery **corrected the central premise** of the original brief. The brief assumed the
replacement flow fails to update planned-post references. It does update them. The
dangling references are caused by three distinct defects in `replaceMediaAssetEverywhere`.

| # | Original brief claim | Verified reality (file:line) |
|---|---|---|
| 1 | Replacement doesn't update `content_variants.media_ids` / `content_media_attachments` | **Incorrect.** Both are updated — variants at `src/app/(app)/library/actions.ts:580-604`, attachments at `:618-639`. |
| 2 | Old asset is hidden too early | **Confirmed.** `hidden_at` is set **unconditionally** at `src/app/(app)/library/actions.ts:527-533`, regardless of whether any reference was re-pointed or any remain. |
| 3 | Planner modal can't scroll; list clips; Save unreachable | **Confirmed.** Hand-rolled modal (`createPortal`) with a **double overflow** layout (outer `planner-media-swap-button.tsx:142`, inner `:164`) inside an `overflow-hidden` card (`:149`); the Save button sits **inside** the capped scroll region (`content-media-editor.tsx:185-189`). No pinned footer. |
| 4 | Attached media disappears in the editor when hidden | **Partly.** The preview loader `loadMediaPreviews` is **already hidden-agnostic** (`src/lib/planner/data.ts:677`), so preview data resolves. But the editor's grid renders only the hidden-filtered library (`media-library-picker-grid.tsx:280`) and the selected-chip lookup resolves against that same filtered list (`media-attachment-selector.tsx:325-326`), so a hidden-but-attached asset shows as a **blank placeholder chip** and is absent from the grid. |

**New issues discovery surfaced (not in the brief):**

- **No atomicity.** `replaceMediaAssetEverywhere` is ~9 sequential `await`ed writes with
  no transaction/RPC and no rollback (`src/app/(app)/library/actions.ts:478-533`). Any
  mid-sequence throw leaves posts half-migrated. This is the primary source of the "bad
  data".
- **Unique-constraint hazard.** `content_media_attachments` has `UNIQUE (content_item_id,
  media_id)` (`supabase/migrations/00000000000001_content.sql:123-130`). The replacement
  does a blind `UPDATE ... SET media_id = newAssetId` (`actions.ts:634-639`). If a content
  item already has **both** old and new attached, this throws — aborting the whole
  replacement *after* `content_variants` was already rewritten. (The array path dedupes
  via `replaceMediaIdList` and is safe; the junction path is not.)
- **No affected counts returned.** Return shape is `{ status, oldAssetId, newAssetId }`
  (`actions.ts:539`). The caller cannot detect a partial migration.
- **Save-time rejection risk in the planner editor.** `updatePlannerContentMedia`
  re-validates submitted asset ids against `media_library` and throws "Some media assets
  are not ready for planner attachments" when counts mismatch
  (`src/app/(app)/planner/actions.ts:463-481`), and requires `processed_status === "ready"`
  (`:440-445`). A post that still has a hidden/not-ready asset attached may be **unsaveable**
  until the (invisible) asset is removed. **Needs verification** (see Open Decisions).

**Schema / infra facts confirmed:**

- Visibility column is `media_assets.hidden_at timestamptz` (NULL = visible),
  `supabase/baseline/v1_baseline.sql:286`, indexed `(account_id, hidden_at)` at `:664`.
- `content_variants.media_ids` is `uuid[]` (`v1_baseline.sql:227`).
- **No functions, triggers, or views** reference `media_assets`, `content_variants`, or
  `content_media_attachments` — a repair touching these will not silently break a view or
  trigger. (`link_in_bio_*` carry benign `updated_at` triggers only.)
- `content_media_attachments.media_id` FKs to `media_library(id)`, **not** `media_assets`.
  The replacement keeps the two id-spaces aligned only because
  `syncReplacementAssetToMediaLibrary` upserts the new asset into `media_library` with the
  **same id first** (`actions.ts:478`). Any repair MUST replicate this ordering or violate
  the FK.
- No `fromDb<T>()` helper exists — conversion is manual/inline. Ops scripts use a direct
  `createClient` service-role client with `.env.local`, dry-run-by-default + `--apply`
  (canonical template: `scripts/ops/backfill-opt-in-overlays.ts`).

---

## 3. Scope

**In scope**
- Harden `replaceMediaAssetEverywhere`: collision-safe junction re-point, gated hide,
  affected counts, and surfacing counts in the replace UI.
- Planner editor: render currently-attached media even when hidden; make save tolerate
  already-attached hidden/not-ready assets.
- Planner swap modal: bounded height, single scroll body, pinned footer.
- One-off dry-run-first repair script for posts referencing hidden assets.
- Tests for all of the above.

**Out of scope**
- Multi-asset "replace all similar images" — replacement stays exact-asset-id based.
- Changing already-published external social posts (Facebook/Instagram/GBP) — untouched.
- Reworking the whole media pipeline or migrating `media_assets` ↔ `media_library`.
- Converting the replacement to a Postgres RPC (see Open Decision D-1 — deferred unless chosen).

---

## 4. Open decisions — RESOLVED during implementation

- **D-1 → hardened sequential JS** (not an RPC). Implemented: collision-safe junction re-point,
  gated hide, affected counts. Residual partial-failure risk mitigated by the gated hide
  (old asset stays visible) + repair script.
- **D-2 → detect-and-report + explicit mapping.** Confirmed `replaceMediaAssetEverywhere`
  writes no old→new audit event, so the repair cannot auto-derive a mapping and never guesses.
- **D-3 → allow-list already-attached ids.** Implemented in `updatePlannerContentMedia`:
  currently-attached assets pass the ready/library checks even when hidden; new assets still
  require `ready`. Verified `loadMediaPreviews` is hidden-agnostic so previews resolve.

Original reasoning retained below for the record.

- **D-1 — Atomicity approach.** *Recommendation: hardened sequential JS (not an RPC), for
  this change.* True atomicity requires moving the whole flow into a single plpgsql
  transaction (RPC). That is the textbook fix but a large rewrite that moves array logic to
  SQL, breaks the existing mock-based test harness, and doesn't match any existing pattern
  (the codebase's plpgsql functions are all tiny helpers). Instead: fix the collision, gate
  the hide, return counts, and rely on the gated hide (old asset stays visible on partial
  failure) plus the repair script for recovery. Residual risk: a mid-sequence failure can
  still leave *some* surfaces re-pointed and others not — but the old asset remains findable
  and the counts expose it. **If you want zero half-migrated state ever, choose the RPC and
  I'll re-scope.**

- **D-2 — Repair mapping source.** The brief says the repair should "swap [hidden attached
  assets] to the visible replacement", but **there is no stored old→new replacement mapping**
  (no replacement column, no mapping table found). To auto-remediate, the repair needs to
  know which new asset replaced each old one. *Recommendation:* first verify whether
  `replaceMediaAssetEverywhere` writes an audit event capturing old→new (audit logging in
  this project is `logPublishAuditEvent`). If it does, reconstruct the mapping from audit
  history. If it doesn't, ship the repair in two modes: **(a) detect-and-report** all posts
  referencing any hidden asset, and **(b) remediate** given an explicit old→new mapping
  (CSV/args) — do not guess. **I'll default to detect-and-report + explicit-mapping unless
  you confirm an audit trail exists.**

- **D-3 — Save-time validation for hidden attachments.** Needs a 1-line verification: does
  `media_library` retain rows for hidden assets? *Recommendation regardless:* the planner
  save must **never reject an asset that is already attached to the post** (allow-list the
  post's current attachments through validation), so a user can always keep or remove a
  hidden attachment. New attachments still require `ready`.

---

## 5. Detailed design

### Part A — Harden `replaceMediaAssetEverywhere` (server)

File: `src/app/(app)/library/actions.ts`

**A1. Collision-safe junction re-point** (`replaceContentMediaAttachments`, `:607-639`)
Replace the blind bulk `UPDATE media_id = new` with per-item logic:
1. Select attachment rows for `oldAssetId` → set of `content_item_id`.
2. Select which of those content items already have `newAssetId` attached.
3. For content items that **already have new**: `DELETE` the old-id attachment row
   (would otherwise violate `UNIQUE (content_item_id, media_id)`).
4. For the rest: `UPDATE media_id = newAssetId`.
Return `{ updated, deduped }` counts.

**A2. Gate the hide** (`:527-533`)
After all reference updates, run a verification query for **remaining** references to
`oldAssetId` across the tracked surfaces (`content_variants.media_ids` via `.contains`,
`content_media_attachments.media_id`, and the config columns in Part-A table below). Only
set `hidden_at` if the count is **zero**. If any remain, skip the hide and include the
remaining count in the return value so the UI can warn.

**A3. Affected counts + return shape** (`:539`)
Each helper returns its affected-row count. New return:
```ts
{
  status: "replaced" | "replaced_with_remaining_references",
  oldAssetId, newAssetId,
  counts: {
    variants: number, attachments: number, attachmentsDeduped: number,
    campaigns: number, linkInBioProfiles: number, linkInBioTiles: number,
    tournamentsSquare: number, tournamentsStory: number,
    adSets: number, ads: number,
  },
  hidden: boolean,            // whether the old asset was hidden
  remainingReferences: number // 0 unless hide was skipped
}
```

**A4. Surface counts in the UI**
`src/features/library/media-replace-button.tsx` (call site `:123`) — show a summary toast
("Re-pointed N posts, M campaigns…") and, if `remainingReferences > 0` / `hidden === false`,
a clear warning that the old image was kept visible because references remain.

**Reference surfaces re-pointed (unchanged set, all in `library/actions.ts`):**
`content_variants.media_ids`, `content_media_attachments.media_id`, `campaigns.hero_media_id`,
`link_in_bio_profiles.hero_media_id`, `link_in_bio_tiles.media_asset_id`,
`tournaments.base_image_square_id`, `tournaments.base_image_story_id`,
`ad_sets.adset_media_asset_id`, `ads.media_asset_id`.

**Cache scoping:** keep existing `revalidatePath` targets; ensure `/library` and `/planner`
are both revalidated after a successful replacement (verify current calls cover both).

### Part B — Planner editor renders hidden-but-attached media (client + save)

**B1. Chip/grid preview resolves for attached-hidden assets**
Files: `src/features/planner/content-media-editor.tsx`,
`src/features/create/media-attachment-selector.tsx`.
The editor already receives `initialMedia` (seeded from `content.media`, which carries
preview data via the hidden-agnostic `loadMediaPreviews`). Build a merged lookup =
`library assets ∪ initiallyAttachedMedia`, and resolve the selected-chip preview
(`media-attachment-selector.tsx:325-326`) from the merged map so an attached-hidden asset
renders its real thumbnail. Optionally show attached-hidden assets in a distinct
"Currently attached" affordance so they remain removable even though they're not in the
selectable grid.

**B2. Save tolerates already-attached hidden/not-ready assets**
File: `src/app/(app)/planner/actions.ts:440-481` (`updatePlannerContentMedia`).
Change validation to allow-list asset ids that are **already attached to this content
item** (fetch current attachments first), so those pass regardless of hidden/`ready` state.
Newly-added asset ids keep the existing `ready` requirement. Preserves the "≥1 asset"
rule (`:40-49`).

### Part C — Planner swap modal scroll fix (client)

File: `src/features/planner/planner-media-swap-button.tsx`.
Convert the modal card (`:149`) to a flex column with bounded height and a **single**
scroll body + pinned footer:
- Card: `flex flex-col max-h-[90vh]` (remove the `overflow-hidden`/double-overflow conflict).
- Header (`:150`): `shrink-0`.
- Body: the one scroller — `flex-1 min-h-0 overflow-y-auto`.
- Footer: new `shrink-0` region holding the Save button, moved **out** of the scroll body
  (currently `content-media-editor.tsx:185-189`).
- Remove the inner `max-h-[80vh] overflow-y-auto` (`:164`) and the outer container's
  competing `overflow-y-auto` (`:142`) once the card owns bounded height.
Matches the app convention (`create-modal.tsx:19`, `FixtureModal.tsx:170` use
`max-h-[90vh] overflow-y-auto`); sticky-footer reference at `ImportFixturesModal.tsx:212-219`.

### Part D — One-off repair script (dry-run first)

New file: `scripts/ops/repair-hidden-media-references.ts`, registered as
`ops:repair-hidden-media-references` in `package.json`. Follow
`scripts/ops/backfill-opt-in-overlays.ts` exactly: direct `createClient` service-role
client, `.env.local`, **dry-run by default**, `--apply` to write, paginated reads
(PAGE_SIZE 1000), chunked writes (200), print affected count + first-10 sample.

Modes (per D-2):
- **Detect/report (default):** find every `content_variants.media_ids` and
  `content_media_attachments` row whose asset id maps to a `media_assets` row with
  `hidden_at IS NOT NULL`; report count + samples grouped by asset.
- **Remediate (`--apply` + mapping):** for each old→new pair, re-point references using the
  same collision-safe logic as Part A (dedupe on the `UNIQUE` constraint), replicating the
  `media_library` id alignment ordering. Never invent a mapping.

---

## 6. Testing

Extend `tests/app/library-actions-replace.test.ts` and add editor/UI tests. All external
services mocked (Supabase, etc.), factories not inline literals.

**Server (Part A):**
- Replacement updates both `content_variants.media_ids` and `content_media_attachments`
  (already covered — keep).
- **Collision:** content item already has both old+new attached → old-id attachment row is
  DELETED (not UPDATE-throwing), new stays, no unique-constraint error. *(new — gap today)*
- **Gated hide:** old asset is **not** hidden when references remain / zero rows updated;
  return reports `hidden: false` + `remainingReferences > 0`. *(new — gap today)*
- Affected counts returned correctly per surface. *(new)*
- Existing error cases (cross-account, video rejected, not-ready rejected) still pass.

**Planner editor (Parts B/C):**
- Hidden-but-attached asset renders its real preview chip in the editor (not a blank
  placeholder). *(new)*
- Saving a post that keeps an already-attached hidden asset succeeds (no "not ready"
  throw); adding a new not-ready asset still rejected. *(new)*
- Long library: body scrolls and the Save button stays reachable (pinned footer) —
  component/interaction test. *(new)*

**Repair (Part D):**
- Dry-run reports danglers and writes nothing.
- `--apply` with mapping re-points references and dedupes on collision.

**Pipeline:** `npm run ci:verify` (lint → typecheck → test → build) must pass.

---

## 7. Deployment safety & rollback

- **No schema migration required** for Parts A–C (behavioural code changes only). Part D is
  a script, not a migration. If a migration is later added, note: `hidden_at`,
  `content_variants`, `media_ids` live in the **v1 baseline**, not the numbered chain — any
  migration referencing them must account for the committed baseline (see project memory
  `cheersai_migration_baseline`).
- **Order:** ship Part A (server hardening) first — it stops *new* bad data. Then Parts B/C
  (editor). Then run Part D (repair) against existing data, **dry-run first**, review the
  report, then `--apply`.
- **Rollback:** Parts A–C are revertible code changes. Part D writes are re-pointing updates;
  the dry-run report is the pre-image record. Take a DB snapshot / export the affected
  `content_media_attachments` + `content_variants` rows before `--apply` for a manual undo path.
- **Auth/RLS:** replacement and repair use the service-role client (documented system
  operations); account scoping stays manual via `.eq("account_id", …)`. No RLS disabled.
- **No new PII** stored or logged.

---

## 8. Assumptions

- Replacement stays **exact-asset-id** based, not "all similar images". *(confirmed)*
- Already-published external social posts are **not** modified. *(confirmed — replacement
  only touches planned content + config tables)*
- Existing bad data needs a one-off repair after the code fix. *(confirmed)* — but the
  repair cannot auto-derive old→new without a mapping source (D-2).
- The `media_library` ↔ `media_assets` id alignment invariant (same id) holds and must be
  preserved by any write path.

---

## 9. Files touched (estimate)

| File | Part | Change |
|---|---|---|
| `src/app/(app)/library/actions.ts` | A | collision-safe junction, gated hide, counts, return shape |
| `src/features/library/media-replace-button.tsx` | A | surface counts + remaining-refs warning |
| `src/features/planner/content-media-editor.tsx` | B/C | merged preview lookup, footer move |
| `src/features/create/media-attachment-selector.tsx` | B | chip preview from merged map |
| `src/app/(app)/planner/actions.ts` | B | allow-list already-attached ids in save validation |
| `src/features/planner/planner-media-swap-button.tsx` | C | flex-column modal, single scroll, pinned footer |
| `scripts/ops/repair-hidden-media-references.ts` (new) | D | dry-run-first repair |
| `package.json` | D | register `ops:repair-hidden-media-references` |
| `tests/app/library-actions-replace.test.ts` (+ new editor tests) | A/B/C | coverage above |

---

## 10. Acceptance criteria

1. Replacing an asset re-points every referenced surface; if a post already has both old+new
   attached, the old attachment is de-duped (no unique-constraint error).
2. The old asset is hidden **only** when zero references to it remain; otherwise it stays
   visible and the UI warns.
3. The replace UI shows how many posts/surfaces were re-pointed.
4. In the planner editor, a currently-attached asset renders its real preview even when
   hidden, and the post can be saved while keeping it.
5. The planner swap modal scrolls with a long library and the Save button is always reachable.
6. The repair script reports danglers in dry-run and, given a mapping, fixes them on `--apply`.
7. `npm run ci:verify` passes.
