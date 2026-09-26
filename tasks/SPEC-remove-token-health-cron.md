# SPEC: remove the unscheduled token-health cron

## Problem

`src/app/api/cron/token-health/route.ts` marks red-health connections as `expired`, then falls
back to `needs_action` when that write fails. The live CHECK `social_connections_status_check`
allows only `active`, `expiring` and `needs_action` (checked on project `nbkjciurhvkfpcpatbnt`
on 2026-09-26), so the first write always fails. The route also compares against `expired` and
`disconnected`, which can never be stored. The same bug in `disconnectProvider` was fixed in
PR #105.

## Evidence the route is dead (2026-09-26)

- Not in `vercel.json`. The live database has no `pg_cron` extension. No GitHub workflow,
  script or other code calls it; the only references are docs and old plans.
- Vercel production logs: 0 requests to `/api/cron/token-health` in the last 7 days in any
  environment, against 7 (one a day) for the scheduled `notify-expiring-connections`. A nightly
  QStash schedule would have shown up 7 times. QStash schedules were not listed directly (no
  QStash token in `.env.local`).
- The `notifications` table holds no `connection_expired` or `connection_disconnected` rows, and
  this route is their only writer. That is not proof it never ran: until PR #109
  (`tasks/SPEC-notification-insert-message.md`) the shared `insertNotification` helper never
  inserted a row, and the route treated that as "already notified", so it could not have sent
  an alert or an email even when run.

## Why remove rather than fix

- Both live connections have a null expiry (Facebook Page tokens do not expire), so the
  expiry-based red check never fires. `notify-expiring-connections` covers the before-expiry
  warning in the same way and has never fired either.
- Its only real trigger would be `status = needs_action`, which it would email about roughly
  every night (the notification dedupe window is 24 hours). PR #109 made the helper work, so
  this is what it would now do if anything ran it. Offboarding
  (`src/lib/admin/offboarding.ts`) and the Meta data-deletion callback
  (`src/lib/meta/data-requests.ts`) set `needs_action` on purpose, so scheduling it would nag
  offboarded brands and people who removed the app to reconnect.
- A broken connection is already handled: the publish worker sets `needs_action` and posts a
  `connection_needs_action` in-app notice, preflight blocks new jobs, and `notify-failures`
  emails the failed post.

## Decisions (owner, 2026-09-26)

- Remove the route and its test.
- No separate "reconnect needed" email for now. If wanted later, it belongs in the publish
  worker, sent once on the transition to `needs_action`.

## Change

- Delete `src/app/api/cron/token-health/route.ts` and `route.test.ts`.
- Correct the comment in `src/lib/connections/health.test.ts` that claims the DB uses
  `disconnected`.
- Update docs that describe the route as live: `docs/agent-reference.md`,
  `docs/architecture/routes.md`, `docs/architecture/relationships.md`,
  `docs/runbooks/credential-rotation.md`, `tasks/ADS-PLAYBOOK-the-anchor.md`.

Deliberately left:

- `deriveConnectionHealth` in `src/lib/connections/health.ts`: the Connections page uses it.
- The `connection_expired` and `connection_disconnected` categories in
  `src/lib/notifications/routing.ts` and `src/lib/planner/notifications.ts`: now without a
  writer but harmless; a separate tidy-up.
- Historical plans and specs (`.planning/`, `docs/redesign-plan/`, older `tasks/` files,
  including `tasks/PLAN-new-customer-stage1.md`) keep their record of what was planned.

## Rollback

Revert the PR. Nothing is scheduled, no data or schema changes, so there is nothing to undo
in production.

## Checklist

- [x] Read-only investigation and owner decision
- [x] Delete route and test; fix the test comment; update docs
- [x] Rebased on #109, then the `ci:verify` steps: lint, typecheck, tests under London and UTC
      (275 files, 2,692 tests) green; build green with the CI placeholder env (this worktree has no
      `.env.local`), route list no longer includes `/api/cron/token-health`
- [ ] PR opened (not merged or deployed without the owner's yes)

## Update, 2026-09-26

PR #111 scheduled this route nightly (02:00 UTC) twelve seconds after Peter approved its removal here, on a question that did not mention the risk. This change also removes that `vercel.json` entry and marks `tasks/SPEC-token-health-schedule.md` superseded. Reason: the nightly run would email offboarded brands and anyone who disconnected on purpose (the new Disconnect buttons) a reconnect notice every night for up to 30 days.
