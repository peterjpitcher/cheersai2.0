# Performance Analyst Report: Smart Scheduling & Copy Improvements

**Date:** 2026-04-10
**Spec:** `docs/superpowers/specs/2026-04-10-smart-scheduling-and-copy-improvements-design.md`
**Scope:** Existing code + proposed changes across scheduling and content generation

---

## Findings

### PERF-001: Sequential OpenAI API calls per platform in generateVariants
- **File:** `src/lib/create/service.ts`:1197
- **Severity:** Critical
- **Category:** Network
- **Impact:** Each platform adds ~1-3s of latency. A 3-platform campaign with 4 schedule slots = 12 sequential OpenAI calls = 12-36 seconds of wall-clock time. Users wait on a spinner the entire duration.
- **Description:** `generateVariants()` iterates `input.platforms` with a `for...of` loop (line 1197) and `await`s each OpenAI API call sequentially. Each call to `client.responses.create()` (line 1207) is independent -- the output for Instagram does not depend on the output for Facebook. Yet they are serialised.
- **Suggested fix:** Use `Promise.all()` (or `Promise.allSettled()` for partial-failure tolerance) to fire all platform calls in parallel within a single plan. The platforms array is always small (max 3), so concurrency is bounded naturally. This alone would cut generation time by ~60-70%.

### PERF-002: Sequential plan processing in buildVariants creates O(plans x platforms) serial awaits
- **File:** `src/lib/create/service.ts`:1059
- **Severity:** High
- **Category:** Network
- **Impact:** A weekly campaign with `weeksAhead=4` and 3 platforms generates 12 variants sequentially. Combined with PERF-001, this is 12 serial OpenAI round-trips. The proposed spread algorithm could increase `plans` further (e.g. 3 posts/week x 4 weeks = 12 plans x 3 platforms = 36 serial calls).
- **Description:** `buildVariants()` uses `for (const plan of plans)` with `await generateVariants()` inside the loop body (line 1142). Each plan waits for the previous to complete before starting. Plans are independent -- they have different titles, prompts, and schedule dates.
- **Suggested fix:** Batch plans into parallel groups. Since each plan is independent, parallelise with a concurrency limiter (e.g. `p-limit` with concurrency 4-6) to avoid overwhelming the OpenAI rate limit while still running multiple plans concurrently. Combined with PERF-001, this would reduce a 36-call campaign from ~36-108s to ~6-18s.

### PERF-003: Proposed spread algorithm fetches all posts across entire multi-week window per campaign creation
- **File:** `src/lib/create/service.ts`:237 (existing pattern that spread would extend)
- **Severity:** Medium
- **Category:** Database
- **Impact:** For a 4-week spread window, the query returns all content_items for the account in that 28-day range. Currently manageable for single-venue pubs with ~50-100 posts/month, but the query has no pagination or column-level index guarantee on `(account_id, scheduled_for)`.
- **Description:** The existing `resolveScheduleConflicts()` already queries `content_items` filtered by `account_id` + date range (lines 237-243). The proposed spread algorithm would need to do the same but across a wider window (multi-week instead of just the days the current batch targets). The spec says "for each week in the window, fetch all existing scheduled feed posts." If implemented naively as one query per week, this creates N+1-style queries. If implemented as a single wide query, the result set could be large but is likely acceptable for this use case.
- **Suggested fix:** Use a single query for the entire window (not per-week), add a composite index on `content_items(account_id, scheduled_for)` if one does not already exist, and select only the columns needed (`scheduled_for, platform, placement`). This keeps it to one round-trip regardless of window size.

### PERF-004: Proposed hook selection queries last 3 hooks per account -- potential N+1 if called per-plan
- **File:** `src/lib/create/service.ts` (proposed change in spec Part 2)
- **Severity:** Medium
- **Category:** Database
- **Impact:** If hook selection fires once per plan in `buildVariants()`, a 12-plan campaign triggers 12 identical queries to fetch the last 3 `hook_strategy` values. Each query is small but the repetition is wasteful.
- **Description:** The spec defines hook selection as: "Fetch the last 3 hook strategies used for this account." If this is naively placed inside `generateVariants()` or the per-plan loop, it fires for every plan. The result is the same for all plans in the same campaign creation call -- the account's last 3 hooks do not change mid-batch.
- **Suggested fix:** Hoist the hook history query to `createCampaignFromPlans()` and pass the result down into `buildVariants()`. Execute it once, then track which hooks are selected within the batch to ensure intra-batch variety as well. This reduces N queries to 1.

### PERF-005: Proposed pillar inference scans title/prompt against keyword lists -- negligible cost but regex compilation is repeated
- **File:** `src/lib/create/service.ts` (proposed change in spec Part 3)
- **Severity:** Low
- **Category:** Bundle
- **Impact:** Negligible per-call (microseconds), but if keyword matching uses dynamically-constructed RegExp objects inside a hot loop, the regex compilation adds up across many plans.
- **Description:** The spec defines 6 pillars with ~80 total keywords. Scanning a title (typically 5-15 words) against these lists is fast. However, if implemented by constructing `new RegExp()` for each keyword on each call, the compilation overhead is unnecessary.
- **Suggested fix:** Pre-compile keyword patterns as module-level constants (similar to how `CLAIM_PATTERNS` in `content-rules.ts` are defined at module scope). Use a single combined regex per pillar (e.g. `/\b(?:food|menu|dish|burger)\b/i`) rather than individual word checks.

### PERF-006: content-rules applyChannelRules runs ~20 regex operations sequentially on every generated variant
- **File:** `src/lib/ai/content-rules.ts`:154-323
- **Severity:** Low
- **Category:** Network (indirect -- adds to total response time)
- **Impact:** Each call processes ~15-20 regex replacements/scans. On short text (~80-150 words), individual regex cost is negligible (<1ms each). Cumulative cost per variant is ~5-15ms. For 12 variants, total is ~60-180ms -- not a bottleneck.
- **Description:** `applyChannelRules()` runs a pipeline of: blocked token scan, claim stripping (26 patterns), banned phrase scrub, hype reduction, day-name normalization, proof point application, URL removal, link-in-bio handling, punctuation normalization, word deduplication, hashtag extraction, emoji trimming, word limit enforcement, and final punctuation. Each step is a regex pass over the full text. Additionally, `lintContent()` repeats many of the same regex scans for validation purposes. In `generateVariants()`, `finaliseCopy()` (which calls `applyChannelRules`) can be called twice per variant if the first lint fails (lines 1238-1274).
- **Suggested fix:** No immediate action needed. The cumulative cost is acceptable for the text lengths involved. If future changes increase text length or variant count significantly, consider combining related regex passes (e.g. merge blocked-token and banned-phrase scanning into a single pass). The double `finaliseCopy()` call on lint failure (lines 1257-1263) is a reasonable retry pattern but could be optimised by passing the specific failing issues to a targeted repair function rather than re-running the entire pipeline.

### PERF-007: resolveScheduleConflicts uses O(n^2) conflict detection via linear scan of occupied array
- **File:** `src/lib/scheduling/conflicts.ts`:24
- **Severity:** Low
- **Category:** Database (in-memory processing)
- **Impact:** With typical campaign sizes (3-20 slots), this is negligible. At 100+ slots it becomes measurable but still sub-millisecond. Not a practical concern for current usage.
- **Description:** `resolveConflicts()` maintains an `occupied` array and uses `occupied.find()` (line 24) for each incoming slot to check for time conflicts. This is O(n) per slot, giving O(n^2) overall. For the proposed spread algorithm, which may generate more slots per campaign, the occupied list grows.
- **Suggested fix:** No action needed at current scale. If slot counts grow significantly (100+), consider using a Map keyed by `platform|day` with sorted minute arrays for O(log n) conflict checks.

### PERF-008: materialiseRecurringCampaigns processes campaigns sequentially with individual DB round-trips
- **File:** `src/lib/scheduling/materialise.ts`:36-40
- **Severity:** Medium
- **Category:** Database
- **Impact:** Each campaign requires 2 DB calls (one SELECT for existing items, one INSERT for new ones). With 10 weekly campaigns, that is 20 sequential DB round-trips. On a Vercel serverless function with ~50-100ms Supabase latency per call, this is 1-2 seconds.
- **Description:** The `for...of` loop at line 36 processes each campaign sequentially: `await materialiseCampaign()` makes its own Supabase queries. Campaigns are independent -- materialising campaign A does not affect campaign B's scheduling window or cadence.
- **Suggested fix:** Use `Promise.all()` to materialise campaigns in parallel, with a concurrency limit (e.g. 5) to avoid overwhelming Supabase connection pool. Also consider batching the INSERT operations -- collect all `rowsToInsert` from all campaigns, then do a single bulk insert.

### PERF-009: materialise creates a new Supabase service client per campaign
- **File:** `src/lib/scheduling/materialise.ts`:59
- **Severity:** Low
- **Category:** Network
- **Impact:** Each `tryCreateServiceSupabaseClient()` call at line 59 creates a new client instance. While the Supabase JS client is lightweight, it may establish a new HTTP/2 connection each time. With 10 campaigns, this is 10 unnecessary client instantiations.
- **Description:** `materialiseCampaign()` calls `tryCreateServiceSupabaseClient()` at line 59, despite the parent function `materialiseRecurringCampaigns()` already creating one at line 18. The parent's client instance is not passed down.
- **Suggested fix:** Pass the Supabase client from `materialiseRecurringCampaigns()` into `materialiseCampaign()` as a parameter instead of creating a new one.

### PERF-010: resolveConflicts findResolution always returns the first candidate even when it does not actually avoid the conflict
- **File:** `src/lib/scheduling/conflicts.ts`:50-65
- **Severity:** Medium
- **Category:** Database (scheduling correctness, indirect perf impact via retry)
- **Impact:** The resolution function checks if the candidate is within the resolution window of the *conflicting* slot, but does not verify that the candidate itself avoids conflict with *all* occupied slots. This can produce incorrect resolutions, causing downstream failures or content clustering that the spread algorithm tries to prevent.
- **Description:** `findResolution()` at line 50 iterates offset candidates (+/- 15/30/45/60 minutes) and returns the first one whose absolute distance from the conflict is within `RESOLUTION_WINDOW_MINUTES`. However, it does not check whether the candidate time conflicts with any *other* occupied slot. Additionally, the check `Math.abs(candidate - conflict) <= RESOLUTION_WINDOW_MINUTES * 60 * 1000` is always true for the given offsets (max 60 min offset vs 120 min window), so every candidate passes -- the function always returns the first offset (+15 min) regardless of actual conflicts.
- **Suggested fix:** Pass the full `occupied` array into `findResolution()` and verify each candidate does not conflict with any existing slot (same platform, within 30 minutes). This is both a correctness fix and prevents the proposed spread algorithm from producing double-booked slots that require additional conflict resolution passes.

### PERF-011: Proposed content pillar nudge queries last 5 posts' pillar values -- same N+1 risk as hook selection
- **File:** `src/lib/create/service.ts` (proposed change in spec Part 3)
- **Severity:** Medium
- **Category:** Database
- **Impact:** Same pattern as PERF-004. If called per-plan, a 12-plan campaign fires 12 identical queries.
- **Description:** The spec says: "Fetch the last 5 posts' content_pillar values for this account." Like hook selection, this should be fetched once per campaign creation, not once per plan.
- **Suggested fix:** Combine with PERF-004. Fetch both `hook_strategy` and `content_pillar` from the last N posts in a single query at the `createCampaignFromPlans()` level. One query returning `SELECT hook_strategy, content_pillar FROM content_items WHERE account_id = ? ORDER BY created_at DESC LIMIT 5` covers both needs.

### PERF-012: resolveScheduleConflicts query lacks index awareness for proposed wider date windows
- **File:** `src/lib/create/service.ts`:237-243
- **Severity:** Medium
- **Category:** Database
- **Impact:** The existing query filters on `account_id` + `scheduled_for` range. Without a composite index, Supabase/Postgres falls back to a sequential scan filtered by account_id (if that index exists) then a filter on scheduled_for. For the proposed spread algorithm with multi-week windows, the number of rows scanned increases.
- **Description:** The query at lines 237-243 selects from `content_items` with `.eq("account_id", accountId).gte("scheduled_for", windowStartIso).lte("scheduled_for", windowEndIso)`. The proposed spread algorithm expands this window from a few days to potentially 4+ weeks. The query only selects 3 narrow columns (`scheduled_for, platform, placement`), which is good, but index coverage determines whether this is an index-only scan or requires heap access.
- **Suggested fix:** Ensure a composite index exists: `CREATE INDEX idx_content_items_account_schedule ON content_items(account_id, scheduled_for)`. This makes both the existing conflict resolution and the proposed spread algorithm efficient regardless of window size.

---

## Summary by Severity

| Severity | Count | Key Theme |
|----------|-------|-----------|
| Critical | 1 | Sequential OpenAI API calls (PERF-001) |
| High | 1 | Sequential plan processing (PERF-002) |
| Medium | 5 | DB query patterns, conflict resolution correctness (PERF-003, 004, 008, 010, 011, 012) |
| Low | 4 | Regex compilation, in-memory algorithms, client reuse (PERF-005, 006, 007, 009) |

## Priority Recommendations

1. **Parallelise OpenAI calls** (PERF-001 + PERF-002): Biggest user-facing win. Transform 12-36s campaign creation into 3-9s.
2. **Hoist hook + pillar queries** (PERF-004 + PERF-011): Prevents N+1 queries before they are introduced. Single combined query at campaign level.
3. **Add composite index** (PERF-003 + PERF-012): Prerequisite for the spread algorithm to perform well.
4. **Fix conflict resolution correctness** (PERF-010): Prevents the spread algorithm from producing incorrect schedules.
5. **Parallelise materialisation** (PERF-008 + PERF-009): Improves cron job performance for recurring campaigns.
