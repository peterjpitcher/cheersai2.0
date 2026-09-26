# SPEC: Fix link-in-bio tile reordering

Status: bug fix, 26 September 2026. Complexity 1 (one function, one new test file, no migration).

## Problem

Moving a tile up or down in Settings > Link in bio never saved. `reorderLinkInBioTiles`
(`src/lib/link-in-bio/profile.ts`) sent `.upsert(rows, { onConflict: "id" })` with rows of
`{ id, account_id, position, updated_at }`. On the live table `title`, `cta_label` and `cta_url`
are NOT NULL with no default, and Postgres checks NOT NULL on the proposed row of
`INSERT ... ON CONFLICT DO UPDATE` before it looks at the conflict. Every call failed with
`null value in column "title"`. Reproduced on a local Postgres 17 on 2026-09-25; live columns
re-checked on 2026-09-26.

Both callers go through this one function: `reorderLinkInBioTilesSettings`
(`src/app/(app)/settings/actions.ts`, used by the tile manager) and `reorderTiles`
(`src/app/actions/link-in-bio.ts`).

## Fix

Update each tile's `position` in place with
`.update({ position, updated_at }).eq("id", id).eq("account_id", accountId)`, run in parallel,
and throw the first error. The existing ownership check before the writes stays. The live table
has no unique index on `position`, so the separate updates cannot collide part-way through.

Chosen over an RPC because it needs no migration and deploys with the app alone. Trade-off: the
updates are not one transaction, so a database failure part-way through could save part of the
new order. The user sees the error toast and a retry sets every position again.

## Deploy order and rollback

App-only change; no migration, no settings to flip. Rollback: revert the commit (which restores
the always-failing upsert).

## Tests

`tests/lib/link-in-bio/reorder-tiles.test.ts` uses an in-memory table that enforces the live NOT
NULL columns on upsert, so the old code fails the suite. It covers: the new order saves and tile
content is untouched; every update is filtered by `id` and `account_id`; a tile from another
brand is refused and nothing changes; a database error is thrown to the caller.
