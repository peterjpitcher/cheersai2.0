# SPEC: schedule the token-health cron

## Problem

`/api/cron/token-health` is the only alert for a connection that has already expired or needs
action: it marks the connection and emails the brand. It was never in `vercel.json`, so nothing
ran it. Found while fixing the notification insert (PR #109).

## Change

- Add `/api/cron/token-health` to `vercel.json` at `0 2 * * *` (02:00 UTC, the time in the original
  design, `docs/redesign-plan/11-devops-and-schema.md`). Overnight means the owner can reconnect
  before the 07:00 event posts.
- Update the route's header comment and the cron table in `docs/agent-reference.md`.

## What it does once live

- For each connection whose health is red (status `expired`, `disconnected`, `revoked` or
  `needs_action`, or a token past its expiry date): sets the status to `expired` (the live CHECK
  rejects that, so it falls back to `needs_action`), records an in-app alert, and emails the brand's
  contact address unless an alert for that connection was recorded in the last 24 hours.
- An owner with a broken connection therefore gets about one email a day until they reconnect.
  They cannot turn this off: `emailConnections` is read in `routing.ts` but no settings screen writes it.
- Checked live 2026-09-26: two connections, Facebook `active` and Instagram `expiring` (a dead label),
  both with no expiry date. Both derive as green, so the first run sends nothing and changes nothing.

## Deploy and rollback

- Needs PR #109 live first (it is: deployment `dpl_DaBgujbdUgapo13gLvEt2WiSdW5x`). Before it, the
  in-app alert always failed and the run never emailed.
- `CRON_SECRET` is already set for the other crons; Vercel Cron sends it as a Bearer token.
- Rollback: remove the entry from `vercel.json` and redeploy.
