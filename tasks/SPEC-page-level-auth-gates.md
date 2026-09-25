# SPEC: page-level auth gates for /planner and /admin

## Problem

In the App Router a layout renders in parallel with its page, so a redirect in a
layout does not stop the page's own data fetching, and the page's rendered output
is still written into the response body.

1. **/planner** read the user with `getCurrentUser()` and fell back to
   `accountId = ''`. A signed-out visit therefore sent two `content_items` queries
   with `account_id=eq.` (Postgres `22P02 invalid input syntax for type uuid: ""`),
   seen in Supabase logs on 2026-09-25 at 17:00:22 UTC alongside `GET /planner 307`.
2. **/admin** relied only on `admin/layout.tsx` for its super-admin gate. The page
   called `getAdminOverview()` (service-role read of every brand, user email,
   membership and billing state) regardless, and the result was serialised into
   the 307 body and the RSC payload. Reproduced on a local production build and
   confirmed on the live site on 2026-09-25 with one signed-out request.

## Change

- `src/app/(app)/planner/page.tsx`: resolve the brand with `requireAuthContext()`
  before any query (redirects to `/auth/login` or `/no-access`). The blank-id
  fallback and the `accountId ?` guards it needed are removed.
- `src/app/(app)/admin/page.tsx`: call `requireAuthContext()` and redirect
  non-super-admins to `/planner` before `getAdminOverview()`, mirroring the layout.
- `src/lib/content/queries.ts`: `getContentById`, `getContentByAccount` and
  `getContentForCalendar` return nothing without querying when `accountId` is blank.
- Tests: `tests/app/planner-page.test.ts`, `tests/app/admin-page.test.ts`, and a
  blank-id case in `tests/lib/content/queries.test.ts`. All new cases fail on the
  old code.

## Audit of the other (app) pages

Every other page's data path calls `requireAuthContext()` (or
`requireFeatureContext()`) itself, so it redirects before querying: settings,
connections, tournaments, campaigns (list, new, detail), library, planner detail
and notifications. Analytics, create and link-in-bio load data client-side through
server actions that each re-check auth. Dashboard pages only redirect.

Deliberately left: `/tournaments` pages do not re-check the per-brand tournaments
switch that `tournaments/layout.tsx` enforces. They only ever read the caller's own
brand, so this is a product switch, not a tenancy or data exposure issue.

## Rollback

Revert the PR. No schema, environment or data changes; nothing to deploy first.
