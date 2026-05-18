# Implementation Plan — Tournament Asset Filter + Event Import Performance

**Spec:** [tasks/fix-spec.md](fix-spec.md)
**Branch:** `fix/create-tournament-assets-event-latency`
**Complexity:** S (score 2) — 6 files changed, no schema changes, no breaking changes

---

## Task 1: Verify and apply tournament backfill

**Goal:** Tag all 116 untagged tournament media assets in production.

1. Confirm the Supabase MCP is connected to project `nbkjciurhvkfpcpatbnt`.
2. Run the verification query to confirm untagged count.
3. Apply the backfill SQL directly via the Supabase MCP `execute_sql` tool (not `db push`):
   ```sql
   UPDATE media_assets
   SET tags = CASE
     WHEN tags IS NULL THEN ARRAY['Tournament']::text[]
     WHEN NOT tags @> ARRAY['Tournament']::text[] THEN array_append(tags, 'Tournament')
     ELSE tags
   END
   WHERE storage_path LIKE 'tournaments/%';
   ```
4. Re-run verification query — expect 0 untagged rows.

**Files:** None (data-only fix).

---

## Task 2: Add path-based fallback filter for tournament exclusion

**Goal:** When `excludeTags` includes `"Tournament"`, also exclude `storage_path LIKE 'tournaments/%'` so untagged tournament assets can't leak through.

1. Edit `src/lib/library/data.ts` — add `.not("storage_path", "like", "tournaments/%")` when `excludeTags` includes `"Tournament"`.

**Files:** `src/lib/library/data.ts`

---

## Task 3: Add tests for tournament filter

**Goal:** Verify both tag-based and path-based exclusion, and that the Library path (no excludeTags) doesn't filter.

1. Find or create test file for `listMediaAssets`.
2. Mock the Supabase query builder chain including `.not()`.
3. Test: `listMediaAssets({ excludeTags: ["Tournament"] })` applies both `not("tags", ...)` and `not("storage_path", ...)`.
4. Test: `listMediaAssets()` without excludeTags does NOT apply the tournament path filter.

**Files:** `src/lib/library/data.test.ts` (new or existing)

---

## Task 4: Add timing instrumentation to management import actions

**Goal:** Log elapsed time for each external call so we can diagnose the actual latency breakdown.

1. Edit `src/app/(app)/create/actions.ts`.
2. In `listManagementEventOptions`: wrap `getManagementConnectionConfig()` and `listManagementEvents()` with `performance.now()` timing. Log with `console.info("[management-import] ...")`.
3. In `getManagementEventPrefill`: wrap `getManagementConnectionConfig()` and `getManagementEventDetail()` with timing. Log similarly.
4. Use structured objects in log output (elapsedMs, queryPresent, limit). No API keys or full payloads.

**Files:** `src/app/(app)/create/actions.ts`

---

## Task 5: Add scoped event-list cache

**Goal:** Cache `listManagementEvents` results for 30s so repeated "Load events" clicks don't re-hit the external API.

1. Create a small cache helper (in-memory Map with TTL) scoped by: accountId + baseUrl + limit + query + non-secret API key fingerprint.
2. Wrap the `listManagementEvents` call in `listManagementEventOptions` with this cache.
3. Do NOT cache event detail, menu specials, booking conversions, or POST calls.

**Files:** `src/app/(app)/create/actions.ts` or `src/lib/management-app/event-list-cache.ts` (new)

---

## Task 6: Narrow management config query

**Goal:** `getManagementConnectionConfig()` should only select the 3 columns it needs.

1. Edit `src/lib/management-app/data.ts` — change `.select(...)` to `"base_url, api_key, enabled"`.
2. Update or add a narrower row type for the config query (leave `ManagementConnectionRow` for summary).

**Files:** `src/lib/management-app/data.ts`

---

## Task 7: Add tests for event-list cache and config query

**Goal:** Cover cache scoping and config query narrowing.

1. Test: repeated calls with same account/baseUrl/query/limit return cached result.
2. Test: different account, baseUrl, query, limit, or API key fingerprint get separate cache entries.
3. Test: event detail calls are NOT cached by the event-list cache.
4. Test: `getManagementConnectionConfig()` selects only `base_url, api_key, enabled`.

**Files:** `src/lib/management-app/event-list-cache.test.ts` (new), update existing `tests/lib/management-app/*.test.ts`

---

## Task 8: Run verification pipeline

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm test`
4. `npm run build`

All four must pass.

**Files:** None.

---

## Parallel execution opportunities

- Tasks 2+3 (tournament filter + tests) are independent of Tasks 4+5+6+7 (event import).
- Task 1 (data backfill) has no code dependencies and can run first.
- Task 8 runs last after all code changes.
