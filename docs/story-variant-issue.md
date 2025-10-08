# Instagram/Facebook Story Variant Publish Failures

## Updated Summary
Story publish jobs for Instagram and Facebook stories still fail with `"No content variant available"` despite the presence of corresponding `content_variants` rows. After reviewing diagnostics, a senior consultant advised that the problem is unlikely to be eventual consistency on a single Postgres primary. More plausible causes include:

1. The worker is reading from a **read replica** while writes go to the primary.
2. A **transaction race** (publish job committed before the variant insert is visible to the worker’s transaction).
3. **Query semantics / RLS** that legitimately exclude the variant row on first read.
4. **Next.js fetch caching** returning a cached empty response when using `fetch`/PostgREST.

## Current Observations (verified 2025-10-08)
- Failed `publish_jobs` (e.g. `219788da-c9e4-41ad-9153-db7f26382cae`, `55b3523b-e737-4be2-9e63-908f9015a817`) are `placement = 'story'`, `attempt = 1`, and immediately abort with `last_error = "No content variant available"`.
- The associated `content_items` exist with correct metadata and `placement = 'story'`.
- Direct SQL queries confirm the expected `content_variants` rows (single `media_id`) exist for both failing items.
- Production appears to be running the older publish worker (no retry/defer). Our updated local worker adds fallback logic, but it has not been deployed yet.

## Consultant Guidance (Key Points)
- **Avoid discovering variants via joins at publish time.** Instead, store the resolved `variant_id` on the job when scheduling.
- Select/create the variant and enqueue the job **inside a single transaction/RPC** to eliminate read-after-write hazards.
- Keep retries only as a resilience mechanism; use **bounded exponential backoff with jitter**.
- Instrument the worker to log:
  - `pg_is_in_recovery()` (primary vs replica)
  - `current_setting('transaction_isolation')`
  - Details of the variant lookup when empty
- If the worker uses Next.js Route Handlers/Server Actions that call `fetch`, enforce `cache: 'no-store'` and `dynamic = 'force-dynamic'` to avoid cached empty responses.

## Action Plan

### Immediate Hotfix (implemented)
1. **Deploy** the new `publish-queue` function so retry/defer logic runs in production.
2. Set optional env knobs:
   - `VARIANT_RETRY_DELAY_SECONDS` (default 45 seconds)
   - `MAX_VARIANT_RETRIES` (default 3)
3. Log DB surface and isolation level for every variant lookup to confirm whether we hit replicas and to capture empty reads.

### Short-Term Enhancements
1. Convert retry scheduling to **exponential backoff with jitter** and add metrics/alerts for jobs deferred multiple times.
2. Ensure the worker path reads from the **primary** (or pin read-after-write queries to the primary connection).
3. Disable Next.js caching for any worker-side fetches (`cache: 'no-store'`, `revalidate: 0`).

### Structural Fix (in progress)
- `publish_jobs` now stores a `variant_id` FK and enforces a partial uniqueness constraint for story jobs.
- Job creation paths (`create` flows, planner approvals) resolve the variant ID up front and pass it to the queue helper.
- The publish worker retrieves variants by primary key and logs database context via the new `inspect_worker_db_context` RPC.
- Remaining follow-up: consider a Postgres RPC to encapsulate enqueue logic and further instrumentation as needed.

## Diagnostic Checklist
- [ ] Log query context (`pg_is_in_recovery`, isolation, txn id) around variant lookups.
- [ ] Confirm joins or policies aren’t filtering variants (inspect SQL executed under worker role/JWT).
- [ ] Validate that Next.js does not cache the variant fetch path.
- [ ] Measure time deltas between variant insert, job enqueue, and worker read.

## Outstanding Questions for Follow-up
- Are any Supabase/PostgREST requests routed to replicas by default in our environment?
- Should we adopt a transactional outbox / trigger-based approach instead of polling `publish_jobs`?
- Do RLS policies or additional filters (e.g., status/timestamp guards) need revisiting when jobs are created before variants?

## Next Steps
- Deploy the updated worker and gather logs with the new instrumentation.
- Decide on the structural fix: most likely `variant_id` storage + transactional enqueue.
- Re-test story scheduling once the deploy is live and share new telemetry with the senior consultant if issues persist.
