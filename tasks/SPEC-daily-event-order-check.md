# Spec: daily check of the event-order rule

Owner approval: 23 October 2026 ("8 yes", relayed by the chief of staff session), plan A of `tasks/REVIEW-social-calendar-2026-10-17.md` ("a check flags any scheduled post that breaks the rule, for example after an event moves").

## Problem
- The event-order rule: an event's posts may start only after the last event of the same type has finished, so two nights of one series are never promoted at once.
- The wizard, the planner and the calendar tool enforce it when a post is created or moved (#202). Nothing checks again later, so a post that was fine can start breaking the rule when the events system changes: an earlier event of the same type moves later, or this event moves.

## Decisions
- A daily cron, `/api/cron/check-event-order`, at 06:45 UTC (`verifyCronAuth`, like every cron).
- For each brand with an enabled events-system connection, it reads the brand's scheduled event posts still to go out, grouped by campaign.
- Each campaign's event is looked up in the events system by name, so a moved event is checked on its current date and category; when the lookup finds no exact match, the date and category stored with the posts are used.
- The window is worked out exactly as at creation (`loadPromotionWindow`): the day after the last event of the same type in the 120 days before.
- A post breaks the rule when its London date is before the window opens.
- The owner is told in the app only: one notification per campaign, at most once a day, naming the event, how many posts break the rule and from when the event may be promoted. Nothing is emailed or sent anywhere else, and no post is changed.
- Every run logs a summary (brands, campaigns, posts checked, posts flagged). A brand whose events-system lookup fails is logged as an error and the run answers 500, so a broken check shows in the Vercel cron logs.

## Rollback
- Remove the cron entry and the route (revert the PR). No data changes; notifications already written stay as history.

## Tests
- Flagged: a post before the window; the notification names the event, the count and the opening date.
- Not flagged: posts on or after the opening day, posts already published, other content types, campaigns whose event has no earlier event of its type.
- A moved event is checked on its current date and category from the events system.
- At most one notification per campaign a day; none when nothing breaks the rule.
- A failed events-system lookup is logged and answers 500; other brands are still checked.
- The route refuses a request without the cron secret.
