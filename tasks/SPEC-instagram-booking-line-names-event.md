# Spec: the Instagram booking line names the event

Owner approval: 23 October 2026 ("8 yes", relayed by the chief of staff session), as part of the social calendar plan (`tasks/REVIEW-social-calendar-2026-10-17.md`, section 2C).

## Problem
- An Instagram post cannot carry a link, so every event post ends with a booking line pointing to the link in bio, and the bio page lists every upcoming event in date order.
- None of the 43 Instagram event posts scheduled on 23 October 2026 says which event to tap: "Book a place for each person through the link in our bio." A reader who reaches the bio page then has to work out which listing the post meant.

## Decisions
- Event posts only: an Instagram booking line names the event, as in "Book Snowball Showdown through the link in our bio."
- The prompt asks for it, using the event's name as given or the part before a colon in it ("Sleigh My Name" for "Sleigh My Name: Festive Music Bingo").
- The tidy-up enforces it without another model call. A line counts as naming the event when it contains the name, a part of it either side of a colon, or either of those without trailing event-type words ("Snowball Showdown" for "Snowball Showdown Cash Bingo") or a leading "The". A part made only of event-type words ("Festive Music Bingo", "Quiz Night") does not count, because it does not say which event. Case, apostrophes and "&" or "and" do not matter.
- A line that does not name the event keeps its wording and gains the name where it says what to book: "Book a place for each person at Snowball Showdown Cash Bingo through the link in our bio.", "Book Tinsel & Tipples Christmas Tasting Night through the link in our bio." for a bare "Book", "...for each person attending Christmas Jackpot Cash Bingo." after "attending", and "for" instead of "at" when the line already says "at". Only a line that says nothing about booking gets the name in front ("For <name>, tap the link in our bio for tickets."). A missing line becomes "Book <name> through the link in our bio."
- A name with a colon uses its first part that identifies the event and is not a tagline: "Sleigh My Name" for "Sleigh My Name: Festive Music Bingo", but "The House of Horrors Halloween Party" for "Enter If You Dare: The House of Horrors Halloween Party". The first version (#212) put every name in front ("For Sleigh My Name, for shared tables, book..."), which read badly in about ten of the 43 scheduled lines; changed 23 October 2026 before any of them was written.
- Every live writing path goes through `writeCopy()` (`src/lib/ai/write-copy.ts`): the create wizard, the calendar fill tool and the rewrite tool. Rugby match posts have their own template and are unchanged.
- The posts already scheduled: Peter said yes on 23 October 2026 (relayed by his chief of staff session) to naming the event in the 43 Instagram event posts scheduled before #212, once he has seen the list. `npm run ops:booking-line-backfill -- --account <id>` (`src/lib/content/booking-line-backfill.ts`) makes the plan and the list and changes nothing. After his go-ahead, `--apply --plan <file>` writes exactly the planned line, in the caption and in `preview_data.structuredCopy.linkInBioLine`, only to posts that still carry the planned caption, at the planned time, with status `scheduled`, every publish job `queued` and more than an hour to go. `--rollback --plan <file>` puts the old lines back on the same terms. A caption edited by hand (`publishBodyOverride`), a stored line that differs from the caption, or a caption with no or two booking lines is left alone.

## Rollback
- Code: revert the PR.
- Scheduled posts: `npm run ops:booking-line-backfill -- --rollback --plan <the applied plan>`.

## Tests
- The prompt names the event in its booking instruction, with the part before a colon in the example.
- Kept as written: the full name, either side of a colon, the name without its event-type ending or its leading "The", curly apostrophes, "and" for "&". Refused: no name, only the kind of event, a colon part made only of event-type words, part of a longer word.
- Fixed: the name goes where the line says what to book, after "attending", or with "for" when "at" is taken; a line that says nothing about booking gains "For <name>, "; a missing line becomes "Book <name> through the link in our bio."
- Backfill (`tests/lib/content/booking-line-backfill.test.ts`): only the brand's scheduled Instagram feed event posts; only the booking line changes, in the caption and the stored copy; posts due within the hour, being sent, edited, moved or published are left alone; apply is guarded by the old caption; rollback restores it; the report lists London time, event and both lines.
- Unchanged: posts that are not events, and posts with no Instagram link.
