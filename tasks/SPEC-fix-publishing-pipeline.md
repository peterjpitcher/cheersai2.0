# SPEC: Restore Publishing Pipeline

**Date:** 2026-05-20
**Status:** Rewritten after code audit
**Severity:** Critical
**Complexity:** M/L, not S

---

## Executive Summary

Do not ship the previous 2-file cron-only fix as written.

The immediate symptom is real: `vercel.json` calls `/api/cron/publish` every minute, and that route now returns HTTP 410 without doing any work.

The deeper issue is that the repository currently contains two publishing pipelines:

1. **Legacy pipeline:** Vercel Cron -> `/api/cron/publish` -> Supabase Edge Function `publish-queue`.
2. **New QStash pipeline:** `publish_jobs` -> QStash -> `/api/webhooks/qstash-publish`.

The QStash pipeline is only partially wired. Several production paths create rows with `enqueuePublishJob()` but do not dispatch those jobs to QStash. Repointing Vercel Cron to `/api/cron/publish-scheduler` may unstick some future-scheduled rows, but it will not prove the full publishing pipeline is healthy.

The implementation should intentionally complete the QStash migration, or intentionally restore the legacy bridge. Mixing both without a migration plan is the current failure mode.

---

## Evidence Checked

### Current Vercel Cron

`vercel.json` currently registers:

```json
{
  "path": "/api/cron/publish",
  "schedule": "* * * * *"
}
```

It also registers:

```text
/api/cron/purge-trash                15 3 * * *
/api/cron/sync-meta-campaigns        0 6 * * *
/api/cron/optimise-meta-campaigns    30 6 * * *
/api/cron/sync-gbp-reviews           0 * * * *
/api/cron/notify-failures            30 * * * *
/api/cron/notify-expiring-connections 0 8 * * *
```

`30 * * * *` is hourly at minute 30. It is not every 30 minutes.

### Current `/api/cron/publish`

`src/app/api/cron/publish/route.ts` is a tombstone. Both `GET` and `POST` return 410 with:

```text
Use /api/cron/publish-scheduler for scheduled jobs and /api/webhooks/qstash-publish for QStash delivery.
```

Git history shows this route used to invoke the Supabase Edge Function `publish-queue`; commit `84c4c9d` replaced that bridge with the tombstone while adding the QStash scheduler.

### Vercel Cron Method

Vercel Cron invokes cron paths with HTTP `GET`. Routes that only export `POST` will not run from Vercel Cron unless a `GET` handler is added.

Source: [Vercel Cron Jobs docs](https://vercel.com/docs/cron-jobs).

### Cron Routes On Disk

Current route method support:

| Route | Methods | Registered in `vercel.json` | Notes |
|---|---:|---:|---|
| `/api/cron/publish` | GET, POST | yes | Returns 410 tombstone. |
| `/api/cron/publish-scheduler` | GET, POST | no | Intended QStash scheduler. |
| `/api/cron/recurring-publish` | POST only | no | Comment says every 15 minutes, but Vercel would call GET. |
| `/api/cron/gbp-metrics` | POST only | no | Comment says 02:00 UTC, but Vercel would call GET. |
| `/api/cron/token-health` | GET | no | Comment says nightly. |
| `/api/cron/notify-failures` | GET, POST | yes | Registered hourly, not every 30 minutes. |
| `/api/cron/purge-trash` | GET, POST | yes | Registered daily. |
| `/api/cron/sync-meta-campaigns` | GET, POST | yes | Registered daily. |
| `/api/cron/optimise-meta-campaigns` | GET, POST | yes | Registered daily. |
| `/api/cron/sync-gbp-reviews` | GET, POST | yes | Registered hourly. |
| `/api/cron/notify-expiring-connections` | GET, POST | yes | Registered daily. |

### QStash Dispatch Coverage

`dispatchToQStash()` is called from:

```text
src/lib/publishing/approve-and-schedule.ts
src/app/api/cron/publish-scheduler/route.ts
src/lib/publishing/recurring-dispatch.ts
src/app/actions/publish.ts
```

But `approveAndSchedule()` is not called by production code. It is only referenced by its own tests.

Production code calls `enqueuePublishJob()` directly from:

```text
src/app/actions/content.ts
src/lib/create/service.ts
src/app/actions/tournament.ts
src/lib/tournament/generate.ts
src/app/(app)/planner/actions.ts
```

Those paths create `publish_jobs` rows but do not dispatch them to QStash. Immediate or already-due jobs can therefore remain `queued` unless another worker processes them.

### Database Field Reality

The repository contains both v2 migrations and legacy v1 bridge code. Be explicit about which schema the implementation targets.

The v2 publishing migration defines `publish_jobs` with:

```text
id
account_id
content_item_id
platform
idempotency_key
status
scheduled_at
started_at
completed_at
error_message
error_code
retry_count
max_retries
platform_post_id
created_at
updated_at
```

The legacy Supabase `publish-queue` worker expects legacy fields and statuses including:

```text
variant_id
next_attempt_at
attempt
placement
last_error
provider_response
queued
in_progress
succeeded
posted
```

The new QStash handler uses v2-ish fields (`scheduled_at`, `retry_count`, `max_retries`, `error_message`, `platform_post_id`) and writes `published`.

The codebase still has legacy `posted`, `in_progress`, and `succeeded` references. It also mixes `social_connections.provider` and `social_connections.platform` across publishing/cron code. Do not claim the production database enum/status model is clean until the live schema is verified.

---

## Corrected Problem Statement

Scheduled publishing is broken because the only every-minute Vercel Cron entry calls a tombstone route.

However, the publishing pipeline is not fixed by changing `vercel.json` alone. The codebase has an incomplete migration from the Supabase `publish-queue` worker to the QStash pipeline:

- The old cron bridge no longer invokes `publish-queue`.
- The new scheduler route is not registered.
- Normal content creation/planner/tournament paths enqueue jobs without QStash dispatch.
- Some route/spec comments still describe the old worker model.
- Some database field references are v1-only, while others are v2-only.

This means the implementation must either:

1. finish the QStash migration, or
2. restore the old `/api/cron/publish` bridge and make `enqueuePublishJob()` compatible with the old worker schema.

Recommended direction: finish the QStash migration. The current route comments and new files clearly point that way, but the migration must be completed rather than papered over with a cron path change.

---

## Critical Corrections To The Previous Draft

### 1. Complexity Is Understated

The previous draft says `S (2-3 files changed, no schema changes)`.

That is not safe. At minimum, the implementation needs code changes beyond `vercel.json` because direct `enqueuePublishJob()` callers do not dispatch immediate/due jobs to QStash.

### 2. Do Not Add `/api/cron/recurring-publish` To Vercel Yet

`/api/cron/recurring-publish` currently exports `POST` only. Vercel Cron calls `GET`, so adding this path to `vercel.json` without adding a `GET` handler will not work.

If this cron is added, first add:

```ts
export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}
```

and move the existing `POST` logic behind a shared `handle()`.

### 3. Do Not Delete The Tombstone Route Yet

Deleting `/api/cron/publish` is not the first fix. It is still the route registered in `vercel.json`, and older docs/runbooks describe it as the primary bridge.

Either:

- keep it as a tombstone until all docs/config are updated and Vercel is confirmed to call `/api/cron/publish-scheduler`, or
- restore it as a compatibility bridge that delegates to the chosen active pipeline.

### 4. The Pipeline Overview Was Too Confident

The previous spec says `approve-and-schedule.ts` is stage 1 of the flow. In current code, `approveAndSchedule()` has no production callers.

Use `enqueuePublishJob()` callers as the source of truth unless a separate task wires `approveAndSchedule()` into the app.

### 5. The Failure Notification Description Is Not Accurate

The previous draft says `/api/cron/notify-failures` runs every 30 minutes. `vercel.json` schedules it hourly at minute 30.

Also, `notify-failures` selects `publish_jobs.last_error`, while the v2/QStash handler writes `publish_jobs.error_message` and `error_code`. If the target schema is v2, this route needs correction before relying on it for QStash failures.

### 6. Exact QStash Retry Timing Is Not Proven In Code

`dispatchToQStash()` sets `retries: 3`, but it does not configure retry delays. Do not state exact retry intervals such as `5m/15m/45m` unless they are verified against the current QStash defaults or explicitly configured.

### 7. `transitionStatus()` Is Suspicious In Real Supabase

`transitionStatus()` calls:

```ts
.update(...)
.eq(...)
.eq(...)
.single()
```

without `.select()`. Supabase update/delete calls do not return modified rows unless `.select()` is chained. The helper then checks `!data` and throws. This needs a fix and an integration-style test because the QStash scheduler and handler depend on this helper.

Expected shape:

```ts
const { data, error } = await db
  .from(table)
  .update({ status: to, updated_at: new Date().toISOString() })
  .eq('id', id)
  .eq('status', from)
  .select('id')
  .maybeSingle();
```

Then throw if `error` or `!data`.

### 8. QStash Handler Must Be Checked Against The Chosen Schema

The QStash handler currently looks up connections with `social_connections.provider`, while the v2 baseline schema defines `social_connections.platform`. Other cron code uses `platform`.

That may be fine in a production database migrated from v1 if `provider` still exists, but it is not safe to describe as a clean v2 pipeline without verification.

---

## Recommended Implementation Plan

### Phase 0: Confirm The Target Runtime Path

Before changing code, decide which publishing path is authoritative:

- **QStash path:** `publish_jobs` are dispatched to `/api/webhooks/qstash-publish`.
- **Legacy path:** Vercel/Supabase scheduler invokes `supabase/functions/publish-queue`.

This spec assumes QStash is the target.

If production must be restored immediately before the QStash work is complete, a separate hotfix can restore the old `/api/cron/publish` bridge from git history, but only after verifying the live `publish_jobs` table still has the legacy columns required by `publish-queue`.

### Phase 1: Fix QStash Scheduling Correctly

1. Update `transitionStatus()` to return rows with `.select('id')`.
2. Add tests for successful transition and no-row optimistic concurrency.
3. Update `vercel.json` to replace `/api/cron/publish` with `/api/cron/publish-scheduler`.
4. Keep the already-registered crons unchanged unless they are directly part of this incident.
5. Do not add `/api/cron/recurring-publish`, `/api/cron/gbp-metrics`, or `/api/cron/token-health` in this task unless method support and intended schedules are fixed at the same time.

### Phase 2: Fix Immediate/Due Job Dispatch

Create one authoritative enqueue-and-dispatch path.

Acceptable approaches:

1. **Central helper:** add a helper that calls `enqueuePublishJob()` and dispatches to QStash when `scheduledAt <= now + immediate threshold`; migrate every production caller to it.
2. **Route-level dispatch:** keep `enqueuePublishJob()` pure, but add a registered dispatcher that safely processes due `queued` jobs without duplicate dispatch. This probably needs a durable `dispatched_at`/`dispatch_attempted_at` field or equivalent locking mechanism.

Prefer the central helper unless there is a strong reason to add schema.

Production callers to audit and migrate:

```text
src/app/actions/content.ts
src/lib/create/service.ts
src/app/actions/tournament.ts
src/lib/tournament/generate.ts
src/app/(app)/planner/actions.ts
```

### Phase 3: Fix Scheduler Failure Semantics

Current `publish-scheduler` transitions a job to `queued` before dispatching to QStash. If dispatch fails, the job can remain `queued` with no QStash message.

Make dispatch failure recoverable. Options:

- revert the job to `scheduled` and record `error_message`, so the next cron run retries;
- add a durable dispatch-tracking field and have a dispatcher retry undelivered queued jobs;
- make the transition and dispatch behavior idempotent with tests proving duplicate cron invocations do not publish twice.

Do not leave a path where QStash outage turns `scheduled` jobs into permanently undelivered `queued` jobs.

### Phase 4: Align Failure Reporting

If QStash is the target path:

- update `/api/cron/notify-failures` to read `error_message` / `error_code`, not `last_error`;
- decide whether the QStash failure webhook should be used;
- if using the failure webhook, configure it in `dispatchToQStash()` and add tests;
- if not using it, remove or clearly document the unused route.

### Phase 5: Clean Up Legacy Status/Schema Drift

Do this after publishing is restored:

- reconcile `posted` vs `published`;
- reconcile `in_progress` vs `publishing`;
- reconcile `succeeded` vs `published`;
- remove or isolate legacy Supabase `publish-queue` code if QStash fully replaces it;
- update `docs/runbook.md`, `AGENTS.md`, and any handoff docs that still say `/api/cron/publish` is the active bridge.

---

## Minimal `vercel.json` Change For Phase 1

Only replace the broken cron target:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/cron/publish-scheduler",
      "schedule": "* * * * *"
    },
    {
      "path": "/api/cron/purge-trash",
      "schedule": "15 3 * * *"
    },
    {
      "path": "/api/cron/sync-meta-campaigns",
      "schedule": "0 6 * * *"
    },
    {
      "path": "/api/cron/optimise-meta-campaigns",
      "schedule": "30 6 * * *"
    },
    {
      "path": "/api/cron/sync-gbp-reviews",
      "schedule": "0 * * * *"
    },
    {
      "path": "/api/cron/notify-failures",
      "schedule": "30 * * * *"
    },
    {
      "path": "/api/cron/notify-expiring-connections",
      "schedule": "0 8 * * *"
    }
  ]
}
```

Do not include `/api/cron/recurring-publish` in this change unless a `GET` handler is added and tested.

---

## Manual Recovery Plan

After deploying the Phase 1/2 fixes:

1. Check current backlog by status:

```sql
select status, count(*)
from publish_jobs
group by status
order by status;
```

2. Check overdue scheduled jobs:

```sql
select id, content_item_id, platform, status, scheduled_at, updated_at
from publish_jobs
where status = 'scheduled'
  and scheduled_at <= now()
order by scheduled_at asc;
```

3. Check due queued jobs that may never have been dispatched:

```sql
select id, content_item_id, platform, status, scheduled_at, updated_at
from publish_jobs
where status = 'queued'
  and scheduled_at <= now()
order by scheduled_at asc;
```

4. Manually trigger the scheduler with a header, not a query string:

```bash
curl -X GET "https://<app-url>/api/cron/publish-scheduler" \
  -H "Authorization: Bearer <CRON_SECRET>"
```

5. Verify QStash delivers messages to `/api/webhooks/qstash-publish`.

Do not rely on the scheduler manual trigger to process already-queued jobs unless Phase 2 explicitly implements that behavior.

---

## Acceptance Criteria

- Vercel Cron no longer receives HTTP 410 from the every-minute publishing cron.
- A future-scheduled post transitions from `scheduled` to `queued` and receives exactly one QStash dispatch.
- An immediate/queue-now post receives QStash dispatch without waiting for the scheduler.
- If QStash dispatch fails during scheduler promotion, the job remains recoverable and is retried by a later cron run.
- A failed publish records errors in the fields read by the failure notification path.
- Tests cover:
  - `transitionStatus()` success and no-row concurrency failure;
  - `publish-scheduler` auth, no-op, due-job promotion, dispatch failure;
  - at least one production enqueue caller dispatching immediate jobs;
  - `recurring-publish` GET behavior if it is added to `vercel.json`.

---

## Explicit Non-Goals For The First Fix

- Do not register every unregistered cron route just because it exists.
- Do not delete `/api/cron/publish` until configs and docs no longer point at it.
- Do not claim production database enum/status facts from one migration file only; verify the live schema first.
- Do not rely on comments that say "QStash scheduled trigger" or "every 30 minutes" without checking route methods and `vercel.json`.
