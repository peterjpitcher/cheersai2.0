# Spec: the Instagram booking line names the event

Owner approval: 23 October 2026 ("8 yes", relayed by the chief of staff session), as part of the social calendar plan (`tasks/REVIEW-social-calendar-2026-10-17.md`, section 2C).

## Problem
- An Instagram post cannot carry a link, so every event post ends with a booking line pointing to the link in bio, and the bio page lists every upcoming event in date order.
- None of the 43 Instagram event posts scheduled on 23 October 2026 says which event to tap: "Book a place for each person through the link in our bio." A reader who reaches the bio page then has to work out which listing the post meant.

## Decisions
- Event posts only: an Instagram booking line names the event, as in "Book Snowball Showdown through the link in our bio."
- The prompt asks for it, using the event's name as given or the part before a colon in it ("Sleigh My Name" for "Sleigh My Name: Festive Music Bingo").
- The tidy-up enforces it without another model call. A line counts as naming the event when it contains the name, a part of it either side of a colon, or either of those without trailing event-type words ("Snowball Showdown" for "Snowball Showdown Cash Bingo") or a leading "The". A part made only of event-type words ("Festive Music Bingo", "Quiz Night") does not count, because it does not say which event. Case, apostrophes and "&" or "and" do not matter.
- A line that does not name the event keeps its wording and gains the name in front: "For Snowball Showdown Cash Bingo, book a place for each person through the link in our bio." A missing line becomes "Book Snowball Showdown Cash Bingo through the link in our bio." A name with a colon uses its first part that says which event it is.
- Every live writing path goes through `writeCopy()` (`src/lib/ai/write-copy.ts`): the create wizard, the calendar fill tool and the rewrite tool. Rugby match posts have their own template and are unchanged.
- New copy only. The posts already scheduled keep their lines: changing them would be a bulk change to scheduled posts, which needs Peter's yes first.

## Rollback
- Code only: revert the PR. No data changes.

## Tests
- The prompt names the event in its booking instruction, with the part before a colon in the example.
- Kept as written: the full name, either side of a colon, the name without its event-type ending or its leading "The", curly apostrophes, "and" for "&". Refused: no name, only the kind of event, a colon part made only of event-type words, part of a longer word.
- Fixed: a generic line gains "For <name>, " with its first word in lower case; a missing line becomes "Book <name> through the link in our bio."
- Unchanged: posts that are not events, and posts with no Instagram link.
