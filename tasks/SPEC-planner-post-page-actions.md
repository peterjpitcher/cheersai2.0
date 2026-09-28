# SPEC: planner post page actions (2026-09-27)

## Problem

The single post page (`src/app/(app)/planner/[contentId]/page.tsx`, reached from the planner and
from the activity feed's "View post" link) renders eight buttons with no handler, form or link.
Confirmed in the running app (local dev server against the local Supabase stack): clicking all of
them made no network request, no DOM change, no navigation and no database change.

- Footer: "Cancel this post", "Save changes", "Publish now"
- Recovery card (failed posts): "Reconnect {platform}", "Try again now", "Download copy & image"
- Caption card: "Regenerate", "Try a different angle"

## Decisions

| Button | Outcome | Existing code reused |
|---|---|---|
| Cancel this post | Wired. Confirm, move to Trash, toast with Undo, back to the planner. Shown for draft, scheduled, queued and failed posts only: a published or publishing post cannot be cancelled. | `deletePlannerContent`, `restorePlannerContent` (the planner drawer's delete and undo) |
| Publish now | Wired. Shown only when the state machine allows the post to move to `queued` (`canTransition(status, 'queued')`: scheduled or failed). | `updatePlannerContentSchedule`, called with the next whole minute, behind a thin guard `publishPlannerContentNow` |
| Try again now | Wired to the same action as Publish now. Only one of the two shows at a time: the recovery card's button when the post has an error, the footer button otherwise. | as above |
| Reconnect {platform} | Wired as a link to `/connections`. | Connections page |
| Save changes | Removed. Every edit on the page already saves itself: "Save caption", "Save schedule", "Swap media" and the banner controls. A footer button would duplicate one of them or need their state lifted. | none |
| Download copy & image | Removed. No existing action. | none |
| Regenerate, Try a different angle | Removed. The only regenerate action (`regenerateWithModifier`) needs the create wizard's brief, which 4 of 1,474 live posts have, and writes `body_draft`, not the caption that publishes. | none |

### Why Publish now does not use `retryPublishJob`

`retryPublishJob` (`src/app/actions/publish.ts`) is the only action that already calls
`transitionStatus`, but it cannot deliver in production today:

1. It leaves `publish_jobs.next_attempt_at` as it was. The live worker (the `publish-queue` edge
   function, run by the `publish-scheduler` cron) only picks up queued jobs whose
   `next_attempt_at` is due, and it sets `next_attempt_at` to null when a job fails. A retried job
   would sit in `queued` for ever.
2. It dispatches to QStash, whose handler (`src/lib/publishing/handler.ts`) selects
   `publish_jobs.platform`, a column production does not have.

Its only UI (`PublishStatusCard` and `RetryButton`) is not rendered anywhere.

### How Publish now respects the state machine and entitlement

`publishPlannerContentNow`:

1. `requireEntitledContext('publish')`.
2. Loads the post scoped to the active brand and refuses unless `canTransition(status, 'queued')`.
   Drafts must be approved first; queued, publishing and published posts are refused.
3. Works out the next whole minute in the brand's timezone and hands it to
   `updatePlannerContentSchedule`, which runs preflight, the copy drift warning, the job reset
   (`queued`, `next_attempt_at` due, errors cleared) and revalidation, exactly as "Save schedule"
   does. The live worker then publishes it on its next run, within about a minute.

On the live (legacy bridge) pipeline the content row is recorded as `scheduled` with a due job,
which is the state every scheduled post goes out from; the live worker never writes content
`queued`. This is the same write "Save schedule" already makes for a failed post.

The next whole minute, not the current one, avoids a race where the minute ticks over between the
click and the server's "that time has already passed" check.

Clock changes: Luxon reads an ambiguous wall-clock time back using the offset in force at the
moment, so both passes of 01:00 to 01:59 on the night the clocks go back land on the right instant.
The one exception is 01:59 BST, whose next minute is 01:00 GMT: it reads back an hour early and the
schedule action refuses it as already passed; pressing again a minute later works. Tests pin both
passes, that minute, and the spring-forward gap.

## Rollback

Revert the PR. No schema, data or environment change.

## Out of scope, raised separately

- `reservePlannerSlotOnSameDay` in `src/app/(app)/planner/actions.ts` adds the wall-clock minute of
  the day to midnight as elapsed time, so on the two clock-change days a feed post saved through
  "Save schedule" (or sent with Publish now) lands an hour out: an hour early after 01:00 on
  25 October 2026, an hour late after 02:00 on 28 March 2027. Found by this PR's tests.
- `retryPublishJob` cannot deliver in production (above).
- `updatePlannerContentSchedule` on a draft creates a queued publish job, and the live worker does
  not check the content status, so rescheduling an unapproved draft would publish it at that time.
- `src/features/campaigns/AdPreview.tsx:69`: the ad preview's call-to-action is a native button
  with no handler.

## Review fixes (28 September 2026)

An independent review before merge (Peter's go-ahead, question 37) found and these changes fix:

- **A send already under way could be re-armed and published twice.** The worker marks the post `publishing` only after it has locked the job, so the post's status alone can miss a send in progress. `updatePlannerContentSchedule` (used by Publish now and Save schedule) now reads the post's jobs before writing anything: an `in_progress` job refuses with "This post is being sent right now", a `succeeded` job refuses as already published. The re-arm only touches `queued`, `failed` and `held` jobs, and if the job changed state between the check and the update, no second job is created.
- **Cancel on an out-of-date page.** The post page's Cancel now passes `onlyIfUnpublished`, so the server refuses a post that is `publishing` or `posted`, or has a job in progress or sent. Other callers of `deletePlannerContent` are unchanged.
- **Hidden error messages in production.** Publish now returns the known, user-facing schedule messages (time already passed, no free slot, already processed) instead of throwing them, so the owner sees the real reason.
- Refusal messages now cover `review`, `approved` and `published`; the slot comment is corrected; the clock-change tests run for feed posts as well as stories (feed posts depend on #129, merged first).
