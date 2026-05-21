# Implementation Plan: Restore Publishing Pipeline

**Spec:** `tasks/SPEC-fix-publishing-pipeline.md`
**Date:** 2026-05-20
**Direction:** Finish QStash migration (Phase 0 decision: QStash is the target)

---

## Phase 1: Fix QStash Scheduling Correctly

### Task 1.1: Fix `transitionStatus()` in state-machine.ts

**File:** `src/lib/publishing/state-machine.ts`

**Problem:** Lines 51-56 call `.update(...).eq(...).eq(...).single()` without `.select()`. Supabase does not return rows from update/delete unless `.select()` is chained. The subsequent `!data` check always throws.

**Change:**
```ts
// Before (broken):
const { data, error } = await db
  .from(table)
  .update({ status: to, updated_at: new Date().toISOString() })
  .eq('id', id)
  .eq('status', from)
  .single();

// After (fixed):
const { data, error } = await db
  .from(table)
  .update({ status: to, updated_at: new Date().toISOString() })
  .eq('id', id)
  .eq('status', from)
  .select('id')
  .maybeSingle();
```

Use `.maybeSingle()` not `.single()` — `.single()` throws on 0 rows, `.maybeSingle()` returns `null` so we can provide a clear error message.

### Task 1.2: Add tests for `transitionStatus()`

**File:** `src/lib/publishing/state-machine.test.ts` (new)

Tests:
- `canTransition()` returns true for valid pairs (scheduled→queued, queued→publishing, etc.)
- `canTransition()` returns false for invalid pairs (draft→published, published→queued)
- `transitionStatus()` throws on invalid transition without DB call
- `transitionStatus()` calls Supabase with correct args on valid transition
- `transitionStatus()` throws clear error when no row matches (concurrent modification)
- `transitionStatus()` succeeds when row matches (mock returns data)

Mock: `createServiceSupabaseClient` / SupabaseClient

### Task 1.3: Update `vercel.json`

**File:** `vercel.json`

**Change:** Replace line 5 `/api/cron/publish` with `/api/cron/publish-scheduler`. All other cron entries unchanged. Do NOT add recurring-publish, gbp-metrics, or token-health.

---

## Phase 2: Central Enqueue-and-Dispatch Helper

### Task 2.1: Create `enqueueAndDispatch()` helper

**File:** `src/lib/publishing/queue.ts` (add to existing file)

```ts
const IMMEDIATE_THRESHOLD_MS = 60_000; // 60 seconds

export interface EnqueueAndDispatchOptions {
  contentItemId: string;
  accountId: string;
  platform: Platform;
  scheduledAt: Date;
}

export interface EnqueueAndDispatchResult {
  jobId: string;
  dispatched: boolean;
}

/**
 * Single entry point: create a publish_jobs row and dispatch to QStash
 * if the job is immediate or already due.
 * All production code that wants to publish should call this, not
 * enqueuePublishJob() directly.
 */
export async function enqueueAndDispatch({
  contentItemId,
  accountId,
  platform,
  scheduledAt,
}: EnqueueAndDispatchOptions): Promise<EnqueueAndDispatchResult> {
  const jobId = await enqueuePublishJob({ contentItemId, accountId, platform, scheduledAt });

  const isImmediate = scheduledAt.getTime() <= Date.now() + IMMEDIATE_THRESHOLD_MS;

  if (isImmediate) {
    const idempotencyKey = `${contentItemId}:${platform}:${scheduledAt.toISOString()}`;
    await dispatchToQStash({ jobId, deduplicationId: idempotencyKey });
    return { jobId, dispatched: true };
  }

  return { jobId, dispatched: false };
}
```

Import `dispatchToQStash` from `./dispatch` at the top of the file.

### Task 2.2: Migrate production callers

Each caller replaces `enqueuePublishJob()` with `enqueueAndDispatch()`. The arguments are identical — only the import and function name change, plus each caller now gets `{ jobId, dispatched }` back instead of just `jobId`.

**Files to change:**

| File | Function | scheduledAt | Notes |
|------|----------|-------------|-------|
| `src/app/actions/content.ts` | `createScheduledBatch` (line ~637) | `new Date(slot.scheduledAt)` | Only called in `queue_now` mode |
| `src/lib/create/service.ts` | `createCampaignFromPlans` (line ~1670) | `variants[index]?.scheduledFor ?? new Date()` | Can be immediate |
| `src/app/actions/tournament.ts` | `publishNowFixture` (line ~599) | `new Date()` | Always immediate |
| `src/lib/tournament/generate.ts` | `generateFixtureContent` (line ~446) | `scheduledFor` (future) | Always future |
| `src/app/(app)/planner/actions.ts` | `approveDraftContent` (line ~169) | `scheduledFor ?? new Date()` | Mixed |
| `src/app/(app)/planner/actions.ts` | `restorePlannerContent` (line ~454) | `scheduledFor ?? new Date()` | Mixed |
| `src/app/(app)/planner/actions.ts` | `updatePlannerContentSchedule` (line ~861) | `new Date(scheduledIso)` | Future (validated) |

For each:
1. Update import: `enqueuePublishJob` → `enqueueAndDispatch`
2. Update call: `await enqueuePublishJob({...})` → `await enqueueAndDispatch({...})`
3. If the caller previously captured the jobId as `const jobId = await enqueuePublishJob(...)`, change to `const { jobId } = await enqueueAndDispatch(...)`

### Task 2.3: Add tests for `enqueueAndDispatch()`

**File:** `src/lib/publishing/queue.test.ts` (new or extend existing)

Tests:
- Immediate scheduledAt (now) → calls `enqueuePublishJob` + `dispatchToQStash`, returns `dispatched: true`
- Future scheduledAt (now + 5 min) → calls `enqueuePublishJob` only, returns `dispatched: false`
- Threshold edge case (now + 59s) → dispatched
- Threshold edge case (now + 61s) → not dispatched
- `dispatchToQStash` failure → error propagates (job row exists but not dispatched — scheduler will pick it up)

Mock: `enqueuePublishJob`, `dispatchToQStash`

---

## Phase 3: Fix Scheduler Failure Recovery

### Task 3.1: Handle dispatch failure in publish-scheduler

**File:** `src/app/api/cron/publish-scheduler/route.ts`

**Problem:** Lines 66-69 transition job `scheduled→queued` and content_item `scheduled→queued` BEFORE dispatching to QStash. If dispatch fails, both are stuck as `queued` with no QStash message.

**Fix:** On dispatch failure, revert the job back to `scheduled` so the next cron run retries it:

```ts
for (const job of jobs) {
  try {
    await transitionStatus(db, 'publish_jobs', job.id, 'scheduled', 'queued');
    await transitionStatus(db, 'content_items', job.content_item_id, 'scheduled', 'queued');

    try {
      await dispatchToQStash({
        jobId: job.id,
        deduplicationId: job.idempotency_key,
      });
      promoted++;
    } catch (dispatchErr) {
      // Revert: queued -> scheduled is not in VALID_TRANSITIONS,
      // so use a direct DB update instead of transitionStatus
      await db.from('publish_jobs')
        .update({ status: 'scheduled', updated_at: new Date().toISOString() })
        .eq('id', job.id);
      await db.from('content_items')
        .update({ status: 'scheduled', updated_at: new Date().toISOString() })
        .eq('id', job.content_item_id);

      logger.error('QStash dispatch failed, reverted to scheduled', 
        dispatchErr instanceof Error ? dispatchErr : new Error(String(dispatchErr)),
        { jobId: job.id });
    }
  } catch (err) {
    logger.error('Failed to promote job',
      err instanceof Error ? err : new Error(String(err)),
      { jobId: job.id });
  }
}
```

**Note:** `queued→scheduled` is not in `VALID_TRANSITIONS` (and shouldn't be — it's a recovery path, not a normal transition). Use direct DB update for the revert, not `transitionStatus()`.

### Task 3.2: Add tests for scheduler dispatch failure

**File:** `src/app/api/cron/publish-scheduler/route.test.ts` (new)

Tests:
- Auth: rejects missing/wrong CRON_SECRET (401)
- No jobs: returns `{ promoted: 0 }`
- Happy path: transitions + dispatches, returns `{ promoted: N }`
- Dispatch failure: reverts status to `scheduled`, continues to next job, promoted count excludes failed
- Transition failure: logged and skipped, doesn't abort batch

Mock: `createServiceSupabaseClient`, `transitionStatus`, `dispatchToQStash`, `createLogger`

---

## Phase 4: Align Failure Reporting

### Task 4.1: Fix `notify-failures` column references

**File:** `src/app/api/cron/notify-failures/route.ts`

**Problem:** The `FailedJobRow` type reads `last_error` but the QStash handler writes to `error_message` and `error_code`.

**Changes:**
1. Update `FailedJobRow` interface: replace `last_error` with `error_message` and add `error_code`
2. Update the `.select()` call to request `error_message, error_code` instead of `last_error`
3. Update the email body template to use `error_message` (with `error_code` if present)

### Task 4.2: Add tests for notify-failures

**File:** `src/app/api/cron/notify-failures/route.test.ts` (new)

Tests:
- Auth: rejects missing/wrong CRON_SECRET
- No failed jobs: returns `{ processed: 0, emailed: 0, skipped: 0 }`
- Failed job with error_message: sends email with correct content
- Already-notified job: skipped (idempotency via notifications table)
- Notification preference disabled: skipped

---

## Execution Order & Dependencies

```
Phase 1 (no dependencies)
  ├── Task 1.1: Fix transitionStatus
  ├── Task 1.2: Tests for transitionStatus
  └── Task 1.3: Update vercel.json

Phase 2 (depends on Phase 1 — uses fixed transitionStatus indirectly)
  ├── Task 2.1: Create enqueueAndDispatch helper
  ├── Task 2.2: Migrate 7 call sites across 5 files
  └── Task 2.3: Tests for enqueueAndDispatch

Phase 3 (depends on Phase 1 — modifies publish-scheduler)
  ├── Task 3.1: Add dispatch failure recovery
  └── Task 3.2: Tests for scheduler

Phase 4 (independent of Phases 2/3)
  ├── Task 4.1: Fix notify-failures columns
  └── Task 4.2: Tests for notify-failures
```

Phase 2, 3, and 4 can be parallelised after Phase 1 completes.

---

## Verification

After all phases:
```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Manual post-deploy verification per the spec's Manual Recovery Plan.

---

## Files Changed Summary

| File | Phase | Change |
|------|-------|--------|
| `src/lib/publishing/state-machine.ts` | 1 | Fix `.select('id').maybeSingle()` |
| `src/lib/publishing/state-machine.test.ts` | 1 | New test file |
| `vercel.json` | 1 | Cron target: publish → publish-scheduler |
| `src/lib/publishing/queue.ts` | 2 | Add `enqueueAndDispatch()` + import dispatch |
| `src/lib/publishing/queue.test.ts` | 2 | New test file |
| `src/app/actions/content.ts` | 2 | Migrate to enqueueAndDispatch |
| `src/lib/create/service.ts` | 2 | Migrate to enqueueAndDispatch |
| `src/app/actions/tournament.ts` | 2 | Migrate to enqueueAndDispatch |
| `src/lib/tournament/generate.ts` | 2 | Migrate to enqueueAndDispatch |
| `src/app/(app)/planner/actions.ts` | 2 | Migrate 3 call sites |
| `src/app/api/cron/publish-scheduler/route.ts` | 3 | Dispatch failure recovery |
| `src/app/api/cron/publish-scheduler/route.test.ts` | 3 | New test file |
| `src/app/api/cron/notify-failures/route.ts` | 4 | Fix column references |
| `src/app/api/cron/notify-failures/route.test.ts` | 4 | New test file |
