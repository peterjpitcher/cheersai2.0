# SPEC: Link-in-bio "What's on" freshness and summer-time times

Status: bug fix, 17 October 2026. Complexity 2 (the link-in-bio data layer, the public page, one date
helper, tests; no migration, no new setting). Part of the social-calendar plan the owner approved on
17 October (`tasks/REVIEW-social-calendar-2026-10-17.md`, section D): Instagram posts send people to
this page to book events.

## Problem

1. **Stale "What's on" list.** `src/lib/link-in-bio/public.ts` kept the management app's event list
   in `unstable_cache` with a five-minute `revalidate`. That cache is stale-while-revalidate: after
   five minutes the next visitor is still served the old copy, and the refresh runs in the
   background for whoever comes after. The page is seen about once every two days (the management
   app logged about eight refreshes of this list between 29 September and 17 October), so most
   visitors saw a list days old. On 17 October a first fetch showed past events at the top and two
   new events missing; a second fetch 90 seconds later was right. Past events survived because the
   "started more than four hours ago" cut was made when the copy was fetched, not when it was shown.
2. **Event times an hour early in British Summer Time.**
   `src/features/link-in-bio/public/link-in-bio-public-page.tsx` read times with
   `DateTime.fromISO(value)`, which converts to the runtime's zone. Vercel runs in UTC, so "A Hint of
   Halloween Quiz Night" (7 October, 19:00 London, stored as 18:00 UTC) showed as "Wed 7 Oct at 6pm".
   The campaign cards use the same parse. A London laptop shows the right time, which is why it was
   missed. The data layer was already right: it emits London times with their offset
   (`2026-10-07T19:00:00.000+01:00`).

## Fix 1: fetch fresh, fall back only on failure

- Every render fetches the list from the management app. Each management call times out after
  2.5 seconds (was 6).
- A successful list is remembered in memory, per server instance and per brand, and reused for at
  most 60 seconds, so a burst of views, and the metadata and page renders of one request, share one
  fetch. Concurrent renders share one in-flight fetch.
- If the list call fails or times out, the page shows the last good list that instance holds. With
  none, the section is hidden, as before. The failure is logged through `createLogger`.
- Whichever list is shown is cut against the current time, so an event that started more than four
  hours ago never appears, even from a remembered list.
- The fail-closed rules stay: if the brand's `management_import_enabled` switch or its connection
  cannot be read, the page shows no events and does not use the remembered list. A switch that is
  off replaces the remembered list with an empty one.
- The fetch starts as soon as the brand's time zone is known, so its round trips overlap the
  campaign queries instead of following them.
- `unstable_cache` and `websiteEventsCacheTag` are removed: nothing else used them.

### Why not a scheduled refresh (Vercel cron)

A cron would keep views as fast as a cache hit, but it is the less robust option:

- It narrows the stale window instead of closing it, and only while the cron runs. A cron that stops
  brings the bug back without anyone noticing.
- It depends on how `unstable_cache` (a legacy API in Next 16) handles `revalidateTag` and
  background refreshes, which unit tests cannot exercise.
- It costs the same load whatever the traffic: every 10 minutes is about 1,600 management calls a
  day for a page seen about once every two days. CheersAI's management API key allows 1,000 calls
  an hour and is shared with artwork import and the other management features.

### Trade-off

A view now waits for the management app. Its own logs for the 30 days to 17 October put the list
call at 317 ms on average (641 ms at worst during a page refresh) and an event detail at 623 ms on
average (1.7 s at worst; details run in parallel). Expect about a second more per view, partly
hidden by the earlier start. At worst, when the management app is struggling, a view waits about
5 seconds (a 2.5 s list call, then 2.5 s detail calls). If only a detail call fails, that event
shows without its picture and with its website link instead of its short link, as before.

Load at today's traffic is one list call and up to ten detail calls per view. The 60-second reuse
caps one server instance at about 660 calls an hour under constant traffic, inside the key's 1,000;
the busiest hour in the last 30 days used 62.

If views prove too slow, the next step is to stream the "What's on" section (React Suspense) so the
rest of the page does not wait for it.

## Fix 2: London time on the page

New helper `parseIsoInLondon()` in `src/lib/utils/date.ts` reads an ISO string on the
Europe/London clock. The page uses it for event and campaign dates and formats times with the
existing `formatFriendlyTimeFromZoned()`, so the output no longer depends on the runtime's zone.

## Deploy and rollback

App-only change: no migration, no environment variable, no cron, nothing to switch on. Rollback:
revert the PR. The two fixes are independent, so either can be reverted alone.

## Tests

- `src/lib/link-in-bio/public.website-events.test.ts` (management client, Supabase and logger
  mocked): a list fetched yesterday is not served today; a fetch is reused for under a minute and
  repeated after; concurrent renders share one fetch; a failing management app serves the last good
  list minus events that have since passed; with no earlier list it shows nothing; a failed fetch
  shared by two renders logs one warning; a failed switch or connection lookup shows nothing and
  ignores the remembered list; a switch that is off makes no management calls; the 2.5-second
  timeout reaches the client; London start times keep their offset.
- `src/features/link-in-bio/public/link-in-bio-public-page.test.tsx`: event and campaign times in
  BST, GMT and across midnight, rendered with the runtime zone set to UTC, London and New York.
- `src/lib/utils/date.test.ts`: `parseIsoInLondon()` in BST, GMT, on the clock-change day and for
  bad input.

All run under `npm run test:ci` (TZ=Europe/London) and `npm run test:utc`. The page and helper tests
also set the runtime zone themselves (`process.env.TZ`), so the old code fails them in both runs:
put back, the old page showed "Wed 7 Oct at 6pm" with a UTC runtime.

## Checked by hand (17 October)

The page ran on a local dev server in UTC (as Vercel runs), on Node 24, against the local Supabase
stack and a stand-in management app whose list could be changed, broken or made to hang:

- An event at 18:00 UTC on 21 October showed as "Wed 21 Oct at 7pm"; one after the clocks change
  showed as "Sat 31 Oct at 8pm".
- One view made one list call and one detail call per event, shared by the metadata and the page.
  A reload 21 seconds later made no calls. The first view after the minute showed an added event
  and dropped a removed one.
- With the management app returning errors, the page kept the last good list and logged one
  warning. An event that passed its four-hour mark while it was down dropped off.
- With the management app hanging, the call gave up after 2.5 seconds and the page rendered in
  2.6 seconds with the last good list. When it answered again, the next view fetched fresh.

## Assumptions

- Every brand's `accounts.timezone` is Europe/London (true for all four live brands on
  17 October), so the page formats in London, as the rest of the app does.
- Remembering the list per server instance is enough for the fallback: during a management outage,
  a cold instance hides the section, which is what the old code did on a cache miss.
