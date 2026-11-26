# SPEC: Google posts that stand on their own

Status: approved by Peter, 26 November 2026. Builds on `tasks/SPEC-gbp-posting-reintroduction.md` and reverses part of its decision D12.

## Why

On 16 November 2026 Peter chose to attach each Google post to its Facebook post ("Yes, attach it", D12). On 26 November 2026, with Google's API access approved and the first Google versions created, he saw that they do not appear in the planner and that their wording is only the Facebook text made safe for Google. He asked for Google posts to be "separate like the facebook and instagram ones".

## Decisions (Peter, 26 November 2026, in chat)

- D13. Every scheduled Facebook feed post gets a Google post ("Please make sure all scheduled posts have a GBP variant too"). For an event, the earliest upcoming post is the event's own Google post, sent as an EVENT post; the rest are sent as ordinary posts ("post the event one as the first one so it's scheduled, then the rest as posts"). This replaces D5 (one Google post per event).
- D14. Each Google post shows as its own tile in the planner with a Google badge, and opens its own page ("1 yes").
- D15. Each Google post has wording written for Google by the AI; it no longer follows the Facebook text, and stays editable ("2 yes").
- D16. Each Google post has its own time, defaulting to the Facebook post's time, and can be moved or removed on its own ("3 yes").
- D17. The four Google versions created on 26 November 2026 go out with the wording they have ("5 yes"). The AI rewrite never touches them, or anything a person has edited.

Unchanged: stories and Instagram never go to Google; drinks price offers are held for a person; Google posts are sent by the `google-posts` cron, never by the Facebook and Instagram publish worker; the content `Platform` type is not widened.

Assumption recorded: "all scheduled posts" means every Facebook feed post, one Google post for each piece of content. Instagram copies and stories of the same content do not get a second Google post.

Known limit, told to Peter: a Google post still takes its image from the Facebook post it was made from, and binning that Facebook post still stops the Google post.

## Pieces (each ships on its own)

### Piece 1: every scheduled post gets a Google post (no schema change). Shipped 26 November 2026, PR #240, deployment dpl_HkxYztR3TcTHqqJ6W36EwteHVh5S; 11 reminder posts created for The Anchor's existing schedule the same day

- `src/lib/google-posts/build.ts`: a later post of an event campaign builds a STANDARD row with the event's button (BOOK or LEARN_MORE and its https link), no `source_event_key` and no event fields. An event that has finished still gets nothing.
- `src/lib/google-posts/create.ts`: the event's own post is the earliest upcoming Facebook feed post with no Google post yet, and only while the campaign has no event-keyed row. Every other post of the campaign is a reminder. One management lookup per campaign per pass, shared by its posts.
- No migration: `gbp_posts_content_item_key` still allows one Google post per Facebook post, and `gbp_posts_one_per_event` only sees rows with a `source_event_key`, which reminders do not have.
- Existing schedule: after the deploy, the ops script's dry run for The Anchor is expected to list about 11 more posts (15 Facebook feed posts, 4 already done). The apply quotes Peter's words above.
- Rollback: revert the commit. Rows already created stay and send as planned; to stop them, skip them on the post page or switch Google posting off for the brand.

### Piece 2: own tile, page and time (one additive migration). Shipped 26 November 2026, PR #241, deployment dpl_8WKMtPKfn3LwtHK2rGcgorMQvLFd; tile, page and moving a post checked live

- `gbp_posts.scheduled_for timestamptz null`: the Google post's own time. Null means "the Facebook post's time", so nothing changes until a person moves it. Applied to production on 26 November 2026 as `20261126112119_gbp_posts_own_time` (additive; 15 existing rows untouched).
- The sender uses the Google post's own time, when set, for when it is due, for the 24 hour late limit and for "moved later".
- Planner: a Google tile per Google post in the calendar and the agenda (`src/lib/google-posts/tile.ts`, `planner-tiles.ts`), with the Facebook post's thumbnail, and a page at `/planner/google/[id]` with the picture, the time form and the existing Google section (wording, state, link, edit, release, skip, retry). A skipped Google post has no tile. The Facebook and Instagram platform filter hides Google tiles while it is on. A reminder also keeps the event's end so it is never sent after the event (review finding on PR #240).
- Rollback: revert the application; the column can stay.

### Piece 4: a Google tile opens a drawer (no schema change)

Peter, 26 November 2026: "When I click on a Facebook or Instagram post in the UI, it pops a draw, but when I click on a GBP post, it takes me to another page", then "Yes, use the drawer". Piece 2 sent a Google tile to its own page only because the post drawer reads content items.

- `src/features/planner/google-post-drawer.tsx`: the same sheet as the post drawer, opened from the calendar and the agenda, showing the picture, when it goes out (with the time form), the Google section (wording, state, buttons) and links to the Facebook post and to the full page.
- One reader for both the drawer and the page, `src/lib/google-posts/post-detail.ts`, behind the `loadGooglePostDetail` action, so they can never show different things. It reads for the active brand only and returns nothing for another brand's post or with the switch off.
- The Google section and the time form take `onChanged`, so the drawer re-reads the post after a change; the section has a `compact` layout for the drawer's width.
- The page `/planner/google/[id]` stays, one link away.
- Rollback: revert the commit; tiles go back to opening the page.

### Piece 3: wording written for Google (one migration)

Migration applied to production on 26 November 2026 as `20261126113907_gbp_posts_google_wording` (11 rows left `awaiting_ai`, 4 marked `facebook`). Trialled the same day on four of the real reminder posts, read only: every draft passed the checks in 2 to 4 seconds.

- `gbp_posts.wording_source` (`awaiting_ai`, `ai`, `facebook`, `person`; default `awaiting_ai`) and `gbp_posts.wording_attempts`. A new Google post starts with wording derived from the Facebook post and `awaiting_ai`.
- A separate cron, `/api/cron/google-wording`, every 2 minutes (`src/lib/google-posts/wording.ts`, the OpenAI call in `wording-ai.ts`). It is apart from the sending cron because one draft can take most of a minute and must never delay a send. Two posts a run, the copy model the rest of the app uses, recorded in the AI usage log as post copy.
- The prompt asks for the key detail first, the place named, plain British English, no hashtags, links or contact details, and no fact that is not in the Facebook post.
- Guard against invented facts (`checkGoogleWording`): every number compared whole with its currency sign or am/pm (so "£7" is not excused by a "7pm" in the source, nor "7am" by "7pm"; review finding on PR #242), every day and month name, "today", "tonight", "tomorrow" and the word "free" in the draft must appear in the Facebook copy or the event details given to the AI; no banned phrase; nothing the copy rules would hold as a drinks price offer. A refused draft is tried again; after three refusals the post goes back to `facebook` and follows the Facebook wording. A call that fails outright (an outage, a timeout) is asked again and never counts towards giving up.
- AI wording is frozen: the sender, the post page and release all use `wordingIsFrozen` (a person's edit, or `ai`). A person's edit always wins, including one saved while the AI was writing (compare-and-set on the row as read).
- Never touched: held posts, sent posts, anything a person edited, and (D17) the four Google posts created before 11:00 UTC on 26 November 2026, which the migration marks `facebook`. The 11 reminder posts created at 11:14 UTC that day get Google wording.
- Also in this change: a Google tile now sits straight after its Facebook post in the planner (`placeGoogleTiles`), so it is not the tile hidden under "more".
- Rollback: revert the application; rows keep the wording they have. To stop new AI wording without a deploy, switch Google posting off for the brand.

## Tests

Each piece: unit tests beside the existing ones in `tests/lib/google-posts/`, run in London time and UTC; `npm run ci:verify` before each PR. Mocked Google and mocked OpenAI only.
