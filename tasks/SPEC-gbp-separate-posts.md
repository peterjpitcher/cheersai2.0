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

### Piece 1: every scheduled post gets a Google post (no schema change)

- `src/lib/google-posts/build.ts`: a later post of an event campaign builds a STANDARD row with the event's button (BOOK or LEARN_MORE and its https link), no `source_event_key` and no event fields. An event that has finished still gets nothing.
- `src/lib/google-posts/create.ts`: the event's own post is the earliest upcoming Facebook feed post with no Google post yet, and only while the campaign has no event-keyed row. Every other post of the campaign is a reminder. One management lookup per campaign per pass, shared by its posts.
- No migration: `gbp_posts_content_item_key` still allows one Google post per Facebook post, and `gbp_posts_one_per_event` only sees rows with a `source_event_key`, which reminders do not have.
- Existing schedule: after the deploy, the ops script's dry run for The Anchor is expected to list about 11 more posts (15 Facebook feed posts, 4 already done). The apply quotes Peter's words above.
- Rollback: revert the commit. Rows already created stay and send as planned; to stop them, skip them on the post page or switch Google posting off for the brand.

### Piece 2: own tile, page and time (one additive migration)

- `gbp_posts.scheduled_for timestamptz null`: the Google post's own time. Null means "the Facebook post's time", so nothing changes until a person moves it.
- The sender uses the Google post's own time, when set, for when it is due, for the 24 hour late limit and for "moved later".
- Planner: a Google tile per Google post, showing the image that will be sent (the Facebook post's first `media_ids` image), and a page at `/planner/google/[id]` with the wording, state, link, and the edit, move, release, skip and retry actions.
- Rollback: revert the application; the column can stay.

### Piece 3: wording written for Google

- At creation, the AI writes a Google wording from the Facebook copy and the event facts: the key detail in the first line, the place named, no hashtags, links or contact details. The result goes through the existing copy rules (`summary.ts`) and the drinks price hold.
- Guard against invented facts: every number, price, time and date in the AI's wording must appear in the Facebook copy or the event details; if not, or if the AI call fails, the derived wording is used and it is tried again on a later pass.
- The wording is frozen once written (today the sender re-derives it from the Facebook copy unless `summary_edited_at` is set), and the page says who wrote it.
- Never applied to the four versions of 26 November 2026 (D17) or to wording a person edited.
- Rollback: revert the application; rows keep the wording they have.

## Tests

Each piece: unit tests beside the existing ones in `tests/lib/google-posts/`, run in London time and UTC; `npm run ci:verify` before each PR. Mocked Google and mocked OpenAI only.
