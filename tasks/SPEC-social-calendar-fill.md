# Spec: event-order rule and calendar fill

Owner approval: 17 October 2026, on `tasks/REVIEW-social-calendar-2026-10-17.md` (plan and build order approved; recommendations accepted for daily volume, content mix, timing, story prompt, order-rule definitions and merging #201). This spec covers build step 1: the order rule (plan section A) and the calendar tool (plan section B). The link-in-bio fixes (D) and the story booking prompt (C) run in their own sessions.

## Decisions

### Order rule
- An event's promotion window opens at 00:00 London on the day after the last event of the same type.
- "Type" is the events system's category (slug). A themed one-off in that category counts. A cancelled event counts as the last of its type.
- Events typed by hand in the wizard have no category, so the rule cannot apply to them.

### Daily volume
- One feed post a day on Facebook and on Instagram, each with its story (same platform, same minute, the matching upright image).
- At most two a day, which happens on rugby and event days.
- Never two posts at the same minute on one platform.

### Times
- Build-up and food posts go out at 11:00, changed from 12:00.
- Event-day posts stay at 07:00.
- Rugby keeps its own rule: 72 hours before kick-off.

### What fills an empty day (only days with no feed post)
- **Tuesday to Friday:** weekday lunch. Source: the owner's "Now Open Lunchtimes" brief, and the book-a-table link.
- **Friday or Saturday:** Sunday roast. Source: the-anchor.pub/sunday-roast, checked 17 October 2026: Sundays 1pm to 6pm, walk-ins welcome, no pre-order, booking recommended for groups and peak times, last table booking 5:30pm, groups of 15 or more pay a £10 a head deposit taken off the bill. No prices unless the page pairs them with dishes.
- **Twice a month:** private hire, from the-anchor.pub/private-hire.
- **Any other empty day:** a build-up post for an event whose promotion window is open. Choose the soonest event that has no post in the two days before.
- **Christmas menu and party bookings:** wait for the owner's details. Nothing about Christmas is invented.

### New campaigns now
- **Sleigh My Name:** music bingo, Friday 11 December, posting from 14 November. Its artwork was imported on 17 October.
- **Christmas Jackpot Cash Bingo:** Wednesday 16 December, posting from 19 November. Its artwork is imported by the tool.

### Collisions
- When two posts on one platform share a minute, the one that is not an event-day post moves to 11:00 that day.
- Today this applies only to Saturday 14 November at 07:00.

### Existing 12:00 posts
- Build-up posts already scheduled at 12:00 move to 11:00 the same day, listed in the same approval.

### Images
- Event posts use the event's imported artwork: the square image for the feed, the designed upright image for the story.
- Food and venue posts use library photos tagged for the subject that have a story version. The same photo is not used twice within seven days.
- A day with no suitable photo is listed for the owner rather than filled.

### Copy
- Copy comes from the shared engine (`src/lib/ai/write-copy.ts`), on gpt-5.5.
- Each event post gets its job from `planSlotJobs`, and the openings of the campaign's other posts are passed in.

### Approval
- The tool follows the same pattern as the rewrite tool:
  1. A plan run changes nothing. It writes a report and a plan file under `temp/`.
  2. The owner approves the whole list once.
  3. `--apply --plan` writes exactly that, only where the day and posts are as planned.
  4. `--rollback --plan` removes what was added and puts moved posts back.

## Build pieces (each its own PR)

### 1. Order rule in the wizard
- `src/lib/management-app/promotion-window.ts` (new): `promotionOpensOn(events, { categorySlug, eventDate })` is pure. It returns the London date after the latest same-category event before `eventDate`, or null when there is none. A loader lists events from the management app for the 120 days before the event date.
- `getManagementEventPrefill` returns `promotionOpensOn`, and the event brief stores it (optional field).
- Schedule step:
  - Suggestions before `promotionOpensOn` are dropped.
  - A manual slot before it is refused with the reason, for example "Sleigh My Name can be promoted from Saturday 14 November, after the last Music Bingo on 13 November".
- `createScheduledBatch` refuses any slot before `brief.promotionOpensOn`. It fails closed, with the same message.

### 2. Shared scheduling step
- The body of `createScheduledBatch` after its auth, entitlement and draft checks moves to a lib function that takes a service client and an accountId.
- It gains one option: add posts to an existing campaign instead of creating one.
- No change to what the wizard writes. The existing tests must pass unchanged.

### 3. Calendar tool
- `src/lib/content/calendar-fill.ts` (logic) and `scripts/ops/calendar-fill.ts` (wiring), with `npm run ops:calendar-fill`.
- As built (17 October 2026):
  - The logic is split three ways: `calendar-fill.ts` (the rules and the plan run), `calendar-fill-apply.ts` (apply, read-back and undo) and `calendar-fill-report.ts` (the owner's list).
  - The venue subjects (lunch, roast, private hire) live in `scripts/ops/calendar-fill-subjects.json`, per brand: the facts, where they came from, the links and the photos. Lunch and roast are weekly campaigns; private hire is one-off posts with no campaign.
  - Facebook links carry Facebook tracking and Instagram links Instagram tracking, using the events system's existing short links where they exist.
  - A photo is used only when it is square or landscape, has a story version and is not hidden, so the feed never shows a cropped upright image.
  - The shared scheduling step accepts `placements: ['feed', 'story']` on a weekly or one-off brief, and a weekly campaign's link-in-bio card carries its Instagram link. The wizard's posts are unchanged by either.
  - Apply records what it did in `applied.json` beside the plan, and reads every post back. Undo puts added posts in the bin (as the planner does) and leaves any campaign it created, empty.
- **Plan run:**
  1. Read the period's schedule.
  2. Work out each event's window.
  3. Find empty days and collisions.
  4. Choose a source per empty day by the rules above.
  5. Build the two new campaigns.
  6. Write copy and choose images.
  7. Check every new post with `evaluateTemporalDrift` and the order rule.
  8. Write the report and plan.
- **Apply:**
  - New posts go through the shared scheduling step.
  - Time moves go through the planner's existing reschedule path.
  - Every change re-checks that the day and post are as planned.

## Rollback
- Code: revert the PRs.
- Data: `npm run ops:calendar-fill -- --rollback --plan <file>` deletes the posts the plan added (only those not yet published) and moves moved posts back.

## Tests
- **Order rule:** previous event found by category; cancelled events count; no category means no rule; London dates around the clock change; suggestions dropped; manual slot refused; server refusal.
- **Shared scheduling step:** the existing createScheduledBatch tests pass unchanged; a new test adds posts to an existing campaign.
- **Calendar tool:**
  - empty-day choice by weekday;
  - the window respected;
  - no two posts at one minute;
  - photo rotation;
  - a story for every feed post, with a story image;
  - apply skipping changed days;
  - rollback.
- No test calls OpenAI, Meta or the management app.
