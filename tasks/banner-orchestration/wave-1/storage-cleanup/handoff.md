# Wave 1 / Storage cleanup — Handoff

## Outputs
- scripts/ops/cleanup-banner-storage.ts
- Commit: `cedfb98` — `chore(ops): add cleanup-banner-storage.ts`

## Bucket name used
`media` (with `banners/` prefix)

The plan (Task 14) suggested a dedicated bucket called `banners`, but the
codebase actually stores the bannered JPEGs inside the shared `media`
bucket under a `banners/{contentId}/{variantId}.jpg` prefix. Verified via:

- `src/lib/constants.ts` → `export const MEDIA_BUCKET = "media";`
- `src/app/(app)/planner/actions.ts:173` validates paths start with
  `` `banners/${contentId}/` `` and removes them via
  `supabase.storage.from(MEDIA_BUCKET).remove([parsed.bannerStoragePath])`.
- `src/lib/scheduling/banner-renderer.server.ts` writes banner output to
  the same `MEDIA_BUCKET` (`"media"`) under the `banners/` prefix.

The script therefore lists and deletes everything under
`media`/`banners/` recursively. This is the correct target for the cached
bannered JPEGs the plan wants cleaned up.

## Assumptions
- Supabase Storage `list()` returns folders with `id === null` and files
  with a non-null `id`. The script uses that to recurse into subfolders.
  This matches the supabase-js v2 contract used elsewhere in the repo.
- `dotenv` loaded the same way as the sibling `repair-banner-overlays.ts`
  script (explicit `.env`/`.env.local` lookup, `override: false`) rather
  than `dotenv/config` from the plan, to match existing ops-script style.
- `npm run typecheck` was not run for the whole repo; instead the file
  was type-checked in isolation with strict mode + ES2022 + node types
  (exit 0). The script is self-contained and pulls only from `dotenv`,
  `@supabase/supabase-js`, and Node built-ins, all already in
  `package.json`.

## Issues
- None. Script not executed against any environment per the brief
  ("Do NOT actually run the script against any production environment").

## Downstream notes
- Operator runs this script after Wave 3 (Migration 2 + dead-code
  commit) ships to all environments. Idempotent — re-running on an
  empty `media/banners/` prefix prints `Deleted ~0 objects` and exits 0.
- Exit codes: `0` success, `1` fatal error (missing env / list failure),
  `2` partial failure (some files could not be deleted; re-run is safe).
- Task 13 will remove the older `ops:repair-banner-overlays` package
  script entry. This task did **not** touch `package.json`. There is no
  corresponding `ops:cleanup-banner-storage` entry yet — operators run
  the script directly with `npx tsx scripts/ops/cleanup-banner-storage.ts`,
  matching the way `diagnose-publishing.ts` and `remove-slot-language.ts`
  are run today (they also have no `ops:*` registry entry).
