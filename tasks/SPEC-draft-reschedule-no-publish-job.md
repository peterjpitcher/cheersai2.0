# SPEC: Rescheduling a draft must never publish it

## The bug (proven 2026-09-27 on the local stack)

`updatePlannerContentSchedule` (`src/app/(app)/planner/actions.ts`) kept a draft's status as `draft`, but when the post had no `publish_jobs` row it called `enqueueAndDispatch`, which in the legacy-bridge schema (production's) inserts a `queued` job with `next_attempt_at` at the new time. The live worker, `supabase/functions/publish-queue/worker.ts`, takes every due `queued` job and `loadContent` never read `content_items.status`, so the unapproved draft was published at that time. Both callers reach it: "Save schedule" on the post page (`src/features/planner/content-schedule-form.tsx`) and the drawer's schedule editor (`src/features/planner/post-drawer.tsx`).

Local reproduction, real app and real worker code (only the Meta call, banner render and media signing stubbed):

1. A seeded draft, moved from 12:00 to 12:30 with "Save schedule". The page said "Post will go out at Tuesday 29 September 2026 · 12:30". The database then held the post as `draft` and a new `queued` job at 12:30.
2. `PublishQueueWorker.processDueJobs` over that queue called the Facebook provider with the draft's copy, marked the job `succeeded` and the post `posted`. Nobody approved it.

A second route to the same outcome: a post sent back to draft keeps a stopped job (`failed` from `invalidateFixtureContent` in `src/lib/tournament/content-freshness.ts`, `held` from `offboardBrand` in `src/lib/admin/offboarding.ts`). Rescheduling that draft put the stopped job back to `queued`.

## Production (read-only, nbkjciurhvkfpcpatbnt, 2026-09-27)

- 9 drafts, 0 publish jobs on any draft.
- 208 `queued` jobs, all on `scheduled`, non-deleted posts (earliest 27 Sep 16:00 UTC, none overdue). No `in_progress`, `failed` or `held` jobs.
- So nothing is exposed today, and the worker guard below refuses none of the live jobs.
- History cannot show whether a draft was ever published this way: once sent, a post is `posted` like any other.

## What changes

1. **Rescheduling a draft only moves it.** `updatePlannerContentSchedule` saves `scheduled_for` and returns without reading, creating or re-arming any publish job. It returns `awaitingApproval: true` for a draft (false otherwise). Scheduled and failed posts behave as before.
2. **Approval arms the job.** `approveDraftContent` reads the post's jobs. No job: enqueue at the post's time (as before). Only `queued`, `failed` or `held` jobs (stopped while it was a draft): re-arm them at the approved time. Any `succeeded` or `in_progress` job: touch nothing, so nothing is sent twice. A failed job lookup now throws instead of being read as "no job" (which could arm a duplicate). The post is set to `scheduled` before its job is re-armed, so the worker never sees a queued job on a draft.
3. **The worker refuses content that may not be published.** `handleJob` loads `status` and `deleted_at` with the post and, before the billing check or any provider call, refuses a post that is deleted or whose status is not `scheduled`, `queued` or `publishing` (so `draft`, `posted` and `failed`). The job is set to `failed` with `error_code` `CONTENT_NOT_PUBLISHABLE`, a plain `error_message` and `last_error`, `next_attempt_at` null and the attempt the lock bumped put back. The post itself is not touched. A warning is logged. The `notify-failures` cron then emails the owner the message (for a draft: "Not published: this post is still a draft. Approve it in the planner to schedule it."), which is the visible signal: after change 1 no job should ever be armed for such a post.
4. **Honest wording.** For a draft, "Save schedule" now says "Draft moved to ..." and the toast "Draft moved. It goes out at ... once you approve it." The drawer says "Draft moved. It goes out at the new time once you approve it."
5. **Re-arming clears the old error.** The shared re-arm fields (`rearmedPublishJobFields`, used by reschedule and approval) now also null `error_message` and `error_code`, as `retryPublishJob` and tournament "publish now" already do. Without this, a re-armed job that later failed for a real reason would be emailed with the earlier reason.

## Decisions

- The allowed statuses are a list (fail closed), not "anything but draft". Each is accounted for: approval, the wizard and tournament "publish now" set `scheduled` or `queued` before arming; retries set `scheduled`; stuck-job recovery leaves `publishing`.
- The refusal uses the existing `failed` status and a new `error_code` value. `resolution_kind` has a CHECK constraint, so a new resolution kind would need a migration; not worth it.
- Tournament "publish now" (`publishNowFixture`) deliberately sends drafts: it is an explicit owner action and sets the post to `queued` first, so the guard does not block it.
- `src/lib/publishing/handler.ts` (the QStash worker) is not changed: it only runs once `publish_jobs` has a `platform` column, which production lacks.
- Readiness checks still run when a draft is moved, as before. Not changed here.
- PR #128 (`publishPlannerContentNow`, open) refuses drafts before delegating to `updatePlannerContentSchedule`, so the two do not conflict in behaviour; its return type picks up `awaitingApproval`.

## Live schema checked (2026-09-27)

- `publish_jobs.status` CHECK: `queued`, `in_progress`, `succeeded`, `failed`, `held`. `attempt` integer NOT NULL default 0. `error_code`, `error_message`, `last_error`, `next_attempt_at`, `hold_reason`, `resolved_at`, `resolution_kind`, `resolution_note` nullable. Only trigger: `updated_at`.
- `content_items.status` NOT NULL default `draft`, no null rows; `deleted_at` nullable.
- No migration.

## Deploy

Two independent deploys; either order is safe, and each closes the hole on its own.

1. The app (Vercel, on merge): stops creating jobs for drafts. This is the root fix.
2. The worker, separately and by name: `npx supabase functions deploy publish-queue` (never a bare deploy-all; see `supabase/config.toml` drift on `media-derivatives`).

Just before the worker deploy, re-run this read-only check; it must return no rows, or the listed jobs would be refused on their next run:

```sql
select c.status, (c.deleted_at is not null) as deleted, count(*)
from publish_jobs j join content_items c on c.id = j.content_item_id
where j.status in ('queued', 'in_progress')
  and (c.status not in ('scheduled', 'queued', 'publishing') or c.deleted_at is not null)
group by 1, 2;
```

## Tests

- `tests/app/planner-actions-draft-schedule.test.ts`: moving a draft never touches `publish_jobs`; a draft's stopped job is left alone; scheduled and failed posts still re-queue or create their job; approval creates a job, re-arms `failed`, `held` and `queued` jobs (clearing the old error) after the post is scheduled, never re-arms `succeeded` or `in_progress`, and throws on a failed lookup. The mock rejects a `publish_jobs.status` outside the live CHECK.
- `tests/publish-queue-content-guard.test.ts`: the status rule; a draft, a deleted post and a posted post are refused with no provider call and no change to the post; a scheduled post goes past the guard.
- Existing worker tests: their post fixtures now carry `status: "scheduled"`, as every real row does.
- Both new suites fail against the old code and pass against the new.

## Rollback

Revert the PR (app). For the worker, deploy `publish-queue` from the previous `main` commit by name. No data or schema to undo. Any job refused in the meantime is `failed` with `CONTENT_NOT_PUBLISHABLE`; approving the draft re-arms it.
