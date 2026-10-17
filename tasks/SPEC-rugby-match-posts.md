# SPEC: Rugby match posts, plain copy and match-day round-ups

**Date:** 17 October 2026
**Owner decisions (17 October 2026):** rewrite the rugby post copy and regenerate the unpublished posts before the first one goes out on 3 November; post one round-up per match day instead of one post per match.
**Evidence:** `tasks/REVIEW-content-quality-2026-10-17.md`, section 1.5.

## 1. Problem

The Nations Championship posts are built from a fixed template, not the AI (`src/lib/tournament/generate.ts:177`). The 36 scheduled feed posts (3 to 18 November) read like an internal note:

- All 18 Facebook posts end "Book a table for this game:" with nothing after it, then "Book a table: link". The link-stripping step (`stripDirectLinks`, `src/lib/utils/social-links.ts:37`) also merges every paragraph into one line, which causes run-on sentences such as "...the end of the match may be missed Book a table for food and rugby".
- A full stop is added after the booking link (`ensureFinalPunctuation`, `src/lib/ai/content-rules.ts:679`).
- 24-hour times throughout ("kick-off 20:10", "Pub open 12:00 to 22:00"), and operational shorthand such as "start missed".
- Ireland v Argentina was generated on template v2 and still says "the end of the match may be missed", against the 5 September stay-open decision. The publish worker would block it at send time (`supabase/functions/publish-queue/tournament-freshness.ts`), so that match would get no post at all.
- Facebook and Instagram copy is identical apart from the link line, with no opening hook.
- One post per match: up to seven Facebook feed posts on one day (Wednesday 18 November).

## 2. Part 1: plain copy for each match (PR 1)

New module `src/lib/tournament/rugby-copy.ts`, a pure function of the screening facts, builds the caption lines and the image footer.

- **Opening line**, one of three forms picked from the fixture id so neighbouring posts differ, for example "Ireland v Argentina is on our screens on Friday 6th November. Kick-off 8:10pm."
- **Doors after kick-off:** "We open at 12pm, 20 minutes after kick-off, so you'll catch the rest of the game." The minutes are computed.
- **Late finish, The Anchor (stay-open policy):** "We usually close at 10pm. If you're still here watching, we'll stay open until the final whistle. Please arrive before 10pm." This keeps the owner-approved conditional wording: usual close, conditional stay, arrive before usual close.
- **Late finish, any other brand:** "We close at 10pm, before the final whistle, so you may miss the end."
- **Kitchen during the game:** "Kitchen times: 12pm to 3pm and 4pm to 9pm. Book a table to eat while you watch." **Before the game only:** "Kitchen times: 12pm to 3pm, so you can eat before kick-off." Unknown or none: no kitchen line (unchanged rule).
- **Screen and commentary** only when set: "On the main screen, with commentary."
- **Menu link (Facebook only, unchanged decision from `tasks/SPEC-nations-sunday-menu.md`):** Sunday roast menu on Sundays, food menu otherwise, only when food service is verified.
- 12-hour times (`formatFriendlyTimeFromZoned`) and the house date style (`formatEventDateLong`).
- No booking URL in the body. The channel rules add exactly one booking line: "Book a table: link" on Facebook, "Book a table via the link in our bio." on Instagram.
- Image footer: the same short wording in 12-hour time.

Shared fixes:

- `stripDirectLinks` collapses spaces and tabs only, never line breaks.
- `ensureFinalPunctuation` leaves a line that ends in a link alone.

Safety kept: generation still fails closed if the opening-time or kitchen sentence is missing after channel rules (the check now looks for the new sentences).

`NATIONS_TEMPLATE_VERSION` becomes `nations-screening-v4`. The publish worker refuses older versions, so every unpublished rugby post must be regenerated after release. Football tournaments are unchanged.

## 3. Part 2: one round-up per match day (PR 2)

- Fixtures are grouped by London date. The earliest fixture of the day (then lowest match number) is the **lead**. The lead carries the day's feed post and story; the other fixtures carry no posts of their own.
- The lead's `prompt_context` gains `roundup_fixture_ids` (every fixture in the post, kick-off order) and `roundup_revisions` (each fixture's `content_revision`). A day with one fixture is a normal single-match post.
- Schedule: the tournament lead time before the first kick-off of the day (Nations: 72 hours), so the "three days before" rule still holds for the first game.
- Copy lists each game with its kick-off and any doors-after-kick-off or late-finish note, then the day's kitchen times and one booking link (the lead's fixture card, which sits at the top of that day on the website).
- New overlay layout listing up to six games for the square and story images.
- Safety: the app's freshness check (`src/lib/tournament/content-freshness.ts`) and the worker's last gate (`supabase/functions/publish-queue/tournament-freshness.ts`) check every fixture in `roundup_fixture_ids`. Changing, hiding or deleting any fixture of the day invalidates or regenerates the whole day's round-up.
- Every per-fixture action (save and generate, show or hide, publish now, preview, delete, planner delete) acts on the day's round-up; fixture status badges map round-up posts to every fixture they cover.
- `NATIONS_TEMPLATE_VERSION` becomes `nations-screening-v5`.

Assumption, recorded for review: stories follow the same rule as the feed (one per match day), since six near-identical stories in a day has the same problem.

Decisions made while building part 2 (17 October 2026):

- Shipped in two PRs: 2a teaches every reader (worker gate, app freshness, invalidation, deletion, status badges, publish now, preview, planner sync) the round-up shape before 2b writes it, so the worker understands round-ups before any exist.
- The stay-open wording is read from the games that run past closing, not from the day's first game (resolveScreening only sets the policy on late games).
- A round-up's Instagram caption may run to 200 words (`caption_word_limit` in the post context; the hard cap is 300, the default stays 80), so its list and notes are never cut by channel shortening.
- The round-up artwork lists the games in two columns (kick-off time, then teams) under the date, and the booking label reads "Book your table at" rather than "for this game".
- Generate on any game rebuilds that whole day. Hiding a game that was in a round-up rebuilds the day for the games still showing; deleting a rugby game keeps the day's published posts as history, removes its unpublished ones and rebuilds the day. Errors from hiding now show on screen (they were silently ignored before).
- Bulk "Generate all" rebuilds each match day that has a game without posts, so a newly confirmed game joins its day's round-up.

## 4. Rollout

Each part ships on its own:

1. Merge to `main`, confirm the Vercel production deployment matches the merge commit.
2. Deploy the `publish-queue` edge function by name, so the worker's contract version matches the app.
3. Regenerate every unpublished Nations post through the normal generation path. Published posts are never touched. Nothing is published immediately: the earliest post stays scheduled for 3 November.
4. Check the regenerated rows: template version, one booking line, line breaks, 12-hour times, schedule.

Nothing rugby publishes before 3 November, so the short gap between deploying the worker and regenerating blocks nothing.

## 5. Rollback

Revert the PR, redeploy the app and the worker from the previous commit, and regenerate the unpublished rugby posts again so their template version matches. No schema change in either part.

## 6. Tests

- Rendered caption for each case: full coverage, doors after kick-off, late finish with and without the stay-open policy, kitchen during, before and absent, Sunday menu link, screen and commentary.
- Exactly one booking line on Facebook, link-in-bio line on Instagram, line breaks preserved, no full stop after the link, no 24-hour times.
- Shared fixes: `stripDirectLinks` keeps line breaks; `ensureFinalPunctuation` skips a trailing link.
- Part 2: grouping and lead choice, schedule, multi-fixture freshness (app and worker), invalidation by any fixture of the day, status mapping, overlay rendering for 2 to 6 games.
