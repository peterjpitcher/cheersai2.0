# SPEC: in-app notification helper never inserts (missing `message`)

## Problem

`insertNotification` (`src/lib/notifications/insert.ts`) inserts
`{account_id, urgency, title, body, category, resource_type, resource_id}` and never sets `message`.
Live `public.notifications.message` is NOT NULL with no default and no trigger fills it
(checked with `information_schema.columns`, `pg_constraint` and `pg_trigger` on project
`nbkjciurhvkfpcpatbnt`, 2026-09-26). Live has 0 rows with `resource_type` set, and this helper is
the only writer that sets it, so it has never inserted a row since it was added (2026-05-19).

The callers read the result as "already notified":

- `/api/cron/notify-expiring-connections` (daily 08:00) read only `inserted`, got `false`, counted a
  skip and moved on: no in-app alert, no expiry email, no error logged.
- `/api/cron/notify-failures` (hourly) still emails, but the in-app `publish_failed` alert is never written.
- `/api/cron/token-health` (not in `vercel.json`; run by hand or an external schedule) never emails
  for an expired or disconnected connection.

The callers' tests mocked `insertNotification`, so none of this showed.

## What existing rows and readers use `message` for

- Every other writer (planner actions, connections actions, the QStash failure webhook,
  `notify-failures`' sent-email record, the `publish-queue` and `media-derivatives` edge functions)
  sets `message` to a one-line headline.
- Live rows: wherever `title` is set, `message = title` (2,000+ rows, every category); `body` is never set.
- `listPlannerNotifications` shows `message ?? title`; the planner activity feed shows `message` only.

## Change

1. `insertNotification` sets `message` to the headline (`title`), matching every other writer and
   what the UI displays. `body` keeps the longer text. Header comment corrected to the live columns.
2. The helper returns `{ status: 'inserted' | 'duplicate' | 'failed' }` instead of
   `{ inserted: boolean; error? }`, so a caller cannot read a failure as a duplicate. A failed
   duplicate check is also reported as `failed` (it used to be ignored and the insert tried anyway).
3. Callers treat `failed` as a failure: log it, count it in a new `errors` field, and return HTTP 500
   so the cron run shows as failed in Vercel. When the in-app alert could not be recorded,
   `notify-expiring-connections` and `token-health` still send the email, so the owner hears about
   the connection problem. An exception in a per-item loop (for example a Resend error) now also
   counts as an error, not a skip.
4. Tests use an in-memory `notifications` table that enforces the live NOT NULL, uuid and column
   rules, plus failing-dependency tests for each caller.

## Deploy and rollback

- No migration. No setting to flip.
- On deploy, the crons start writing in-app alerts and sending the expiry emails they were meant to.
  Checked live on 2026-09-26: neither connection has an expiry date and no publish job has failed in
  30 days, so nothing fires immediately.
- Rollback: revert the PR. The rows written in the meantime are ordinary notifications.

## Decisions

- `message` = `title` (the headline), not `body`: matches all existing rows and writers.
- On a failed insert the email is still sent (the owner is told; the run reports the failure). The
  dedup window (24h) matches the daily cadence, so this does not add emails in normal running.
