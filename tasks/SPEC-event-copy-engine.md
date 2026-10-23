# SPEC: Event copy engine (review changes 3 to 16)

**Date:** 17 October 2026
**Owner decisions (17 October 2026):** build review changes 3 to 16 as the first copy build; rewrite the posts already scheduled only after the app writes new copy well.
**Evidence:** `tasks/REVIEW-content-quality-2026-10-17.md` (findings in section 1, the change list in section 2, platform guidance in section 4).

## 1. Goal

Event posts that lead with the most interesting specific detail, never repeat themselves across a campaign, carry the facts people need (price, age rule, doors, what is included, how booking works), and sound like The Anchor rather than a template.

## 2. Measures

Checked on every campaign generated after release, against the 66 scheduled event posts reviewed on 17 October 2026.

| Measure | Before | Target |
|---|---|---|
| Posts containing "Join us" | 62 of 66 | at most 1 in 5 |
| Formulaic openers ("Get ready", "Join us for", "Tonight's the night", "Don't miss") | 24+ of 66 | none (enforced) |
| Two posts in one campaign opening the same way, or asking the same question | common | none |
| Posts with a comment question | every Facebook post | at most half, each about the event |
| "7:00pm" style times | 20 of 66 | none (enforced) |
| Invented hashtags outside the saved set and event-type tags | 28 of 66 | none |
| Key facts known in the management app (price, age rule, doors) | Tinsel & Tipples: price in 1 of 14, age rule in 0 | stated wherever booking is mentioned |
| Organic link clicks per event | about 4 (Facebook), about 1 (Instagram), 90 days to 17 October | measured once per-post links ship (review change 20) |

## 3. Pieces

Each piece ships on its own, in this order. None needs a schema change except B6 (optional) and B7.

### B1. House style and prompt fixes (review 5, 6, 8, 11, 14)

Tone by event type (review 7) moved to B2, because it needs the event category, which only arrives with the fact sheet.

- **Examples.** Replace the three generic example posts (`src/lib/ai/prompts.ts:369-390`) with one strong example per event type (music bingo, quiz, cash bingo, tasting night, party, sport, food). Each example is self-consistent and invents nothing about The Anchor; the pub-style examples stay pub-only, as today.
- **Questions.** Replace the "close with a comment question" rule (`prompts.ts:406`) with: ask at most one question, only when it is about the event and gives people something real to answer; never "Who's coming?", "tag a mate" or "share this" (Meta demotes tag and share bait).
- **Final check, enforced.** In `postprocessCopy`: reject formulaic openers, cap repeated filler words ("fun", "lively", "join us"), move the existing time tidy-up (`normaliseTimes`, today only on the unused path) onto the live path, and add the clichés found in the review ("like no other", "won't want to miss", "don your", "extravaganza", "tonight's the night") to the banned list. A failed check regenerates once with the failures listed; anything still failing is shown to the owner as a warning on that post.
- **Hashtags and emojis.** Send the brand's saved hashtags and emojis to the model (today they are never sent). At most five hashtags on Instagram (Instagram's limit since 18 December 2025; `MAX_HASHTAGS`, `PLATFORM_HASHTAG_LIMIT` and the response schema still allow ten), never a person's name as a hashtag, and name the event type and place in the caption text, which feeds Instagram search.
- **Key phrases.** Offer one or two of the saved key phrases per post, rotated by slot, instead of all ten every time.

### B2. Fact sheet from the management app (review 7, 9 and 16)

- **Tone by event type.** When the brief keeps the default tone, pick it from the event category: playful for music bingo, drag-hosted and themed nights and parties; friendly and warm for food and tasting nights; community for quizzes, cash bingo and sport. An owner's explicit tone choice always wins.

- Extend the event import (`src/lib/management-app/client.ts`, `mappers.ts`) to carry the facts the API already returns: FAQs, doors, start, finish and last-entry times, price per person or on the door, any book-ahead discount and when it ends, booking and payment mode, category and performer.
- Store them as a structured `facts` object on the brief, shown in the wizard so the owner can see and correct them, and render them into the prompt as "Facts (use only these)". The owner's free-text notes follow as "Owner notes".
- Strip markdown and Windows line endings from imported text, and tell the model to treat the event notes as facts, not wording, so it stops reusing their headline ("Get ready for a huge themed Friday night").
- Booking in plain words from the booking and payment modes, for example "Booking holds your place; pay £5 cash on the night", "Tickets £40 when you book ahead, £45 on the door", "Over 18s only".

### B3. Campaign planning (review 13 and 14)

- Before writing, give each slot of a campaign its own job from a fixed list, chosen in code from the number of slots and the facts available: announce, how it works (for first-timers), meet the host, dress-up and prizes, eat first, last call, tonight. "Meet the host" needs a performer; "eat first" needs kitchen times.
- Write the slots in order rather than three at once. Each slot's prompt carries its job, the details to lead with, and the openings and questions earlier slots already used, which it must not repeat. Questions go in at most half the slots.
- The wizard shows each slot's job above its copy.

Core built 17 October 2026, ahead of the wizard part, because the first B8 rewrite plan repeated itself (7 of 7 Tinsel & Tipples Facebook posts opened "Hot mulled cider on..."; every Sparks & Sparklers post led with the host). `src/lib/ai/slot-jobs.ts` assigns the jobs and renders a "Campaign plan" block that `buildUserPrompt` adds when given one; the B8 rewrite tool writes each campaign's posts in order with it. Decisions:

- Every post on the event day (London date) is "tonight"; the first earlier post announces; the last post before the day is the last call only when it is within three days; the posts between take how it works, meet the host (needs a host in the facts), dress-up and prizes, and eat first (each needs the brief to mention it), then fresh angles.
- A post after the event day is a fresh angle, never a last call: the timing rules already write it as a recap (added with the wizard part).
- Questions are allowed in the second, fourth and sixth posts, so never in more than half.
- Each post is told the first line of every earlier post in its campaign, on both platforms, and every question they asked.

Wizard part built 17 October 2026 (`src/features/create/steps/campaign-plan.ts`, used by `generate-step.tsx`). Decisions:

- An event campaign's slots are written one at a time, in send order (Generate, Generate next and Regenerate All). Each is sent its job, its place, the first lines and questions of the campaign's other posts that already have copy, and whether it may ask a question. Other content types are still written three at a time, with no plan.
- Rewriting one post (Regenerate, a refine chip or Retry) tells it how every other post in the campaign opened, later ones included. The prompt therefore says "other posts in this campaign" rather than "earlier posts", for the ops tool too.
- First lines and questions are read from the platforms the brief posts to, and from the owner's edited text where they edited it.
- The server actions check the plan before writing: event briefs only, a known job, a place within at most 12 posts (the campaign cap), at most 22 first lines of up to 140 characters and 22 questions of up to 200. The host named in the prompt always comes from the brief. A plan that fails is refused with "We could not write this post. Refresh the page and try again." and a warning in the log, without calling the model.
- Each card shows "Job: ..." above its copy. The job is stored with the slot's copy, so it shows what the copy was written for, and a saved draft keeps it.
- Writing in order is slower: a seven-post campaign is seven model calls one after another rather than three at a time.

House-style check holds each post to its plan, built 23 October 2026 (Peter's "8 yes", relayed by the chief of staff session). Until then the plan was only advice in the prompt. `findCopyIssues` (`src/lib/ai/postprocess.ts`), given the plan by `writeCopy`, now also flags:

- a question in a post whose plan says to ask none;
- an opening that starts with the same three words as another post's in the campaign, ignoring case, punctuation and emoji (the Tinsel & Tipples posts all began "Hot mulled cider");
- a question that starts with the same four words as one another post asked.

A flagged post is rewritten once with the problems listed, like any other house-style failure, and anything still wrong is shown to the owner as a warning. Posts written without a plan are checked as before. Rollback: revert the PR.

### B4. Stronger model and best of three (review 3 and 4)

- New ops script runs the current model and two or three candidates on 10 recent real briefs (stored in `content_items.ai_generation_params`), scores each draft with the B1 checks and a judging model, and prints a side-by-side for the owner. Candidates available to this account's key on 17 October 2026 include the GPT-5.4 and GPT-5.5 families and GPT-6 variants.
- The default model changes (`OPENAI_MODEL`) only after the owner has seen the side-by-side.
- Decided 17 October 2026 (owner's yes, after the side-by-side and the 66-post rewrite list): `DEFAULT_COPY_MODEL` is gpt-5.5. About 6 US cents and 25 to 35 seconds a post; `OPENAI_MODEL` still overrides it, and image tagging keeps its own model. Rollback: set `DEFAULT_COPY_MODEL` back, or set `OPENAI_MODEL=gpt-4o-mini` in Vercel and redeploy.
- Best of three: write three drafts, keep the one with the fewest check failures, then the judge's pick.
- Reasoning models do not take a temperature; the generator leaves it out for them.
- Image naming and tagging keeps its own model (`DEFAULT_MEDIA_TAGGING_MODEL`, gpt-4o-mini) whatever the copy model is; it used to read `OPENAI_MODEL` and would have broken on a reasoning model (review finding on #192, 17 October 2026).
- Cost: about 15 copy generations a month at about 3,000 prompt tokens each (`ai_usage_events`, September and October 2026). Prices are checked on OpenAI's pricing page before the switch.

### B5. Location tag (review 12)

- The publish worker sends the saved location with each post: `location_id` on the Instagram media container, `place` on the Facebook photo post, only when Settings holds a valid id. Worker deployed separately, by name.
- As built (23 October 2026, PRs #213 and #214, worker v50): Settings held the Page and Instagram account ids, not location tags, so Instagram feed posts are tagged with the Page saved as "Facebook Page ID", which has an address. Facebook posts are unchanged. See `tasks/SPEC-instagram-location-tag.md`.

### B6. Vary the picture (review 15)

- The wizard lets each slot use its own image. Default: the event artwork for the announcement and the day itself; for the slots between, library images tagged with the event type, food, the host or the venue, when there are any.
- As built (23 October 2026): the per-post picture already existed; the defaults are new, and draw only on photos the owner tags `reuse` in the Library, because the library's own tags can mislead the copy. See `tasks/SPEC-vary-the-picture.md`.

### B7. Later: performer tags and collab posts (review 10)

Needs the performer's Instagram handle stored in the management app and returned by its API, then the publisher's collaborators parameter. Both repos; planned separately.

### B8. Rewrite the posts already scheduled (review 23)

After B1 to B3: a "Rewrite with the new engine" action on a campaign rewrites its unpublished posts in place, keeping schedule, images and links, for the owner to review. Then this autumn's six campaigns are rewritten.

Decided 17 October 2026: this autumn's campaigns cannot wait for B3, because their posts start going out on 19 October. They are rewritten now, with B1, B2 and the chosen model, by an ops tool: `npm run ops:rewrite-event-posts` (`scripts/ops/rewrite-event-posts.ts`, logic in `src/lib/content/rewrite-event-posts.ts`).

- A plan run changes no post. It refreshes each event's facts from the management app, writes every slot afresh through the same pipeline as the wizard (`src/lib/ai/write-copy.ts`), and saves a before-and-after report and a plan file under `temp/` (git-ignored). The AI calls are logged in `ai_usage_events`, as the wizard's are.
- The owner approves the whole list once. `--apply --plan <file>` then writes exactly that text, and only to posts that still carry the planned old text, at the planned time, with status `scheduled`, every publish job `queued` and more than an hour to go. `--rollback --plan <file>` restores the old text on the same terms.
- Only the text changes: `content_variants.body` and `preview_data` (the stored copy and the brief that wrote it). Schedule, images, links, overlays and stories are untouched. New text that would be untrue at its time (`evaluateTemporalDrift`) is left out of the plan.
- Each campaign's posts are written in order with the B3 core (see B3), so later posts know how the earlier ones opened.
- The in-app action stays the long-term plan, after B3.

## 4. Rollback

B1 to B4 are code only: revert the PR. The model switch rolls back by resetting `OPENAI_MODEL`. B5 rolls back by redeploying the previous worker. B8 rolls back with `npm run ops:rewrite-event-posts -- --rollback --plan <file>`, which restores the old text of every post not changed since.

## 5. Tests

- B1: prompt tests for the examples and rules; `postprocessCopy` tests for openers, filler caps, times, banned phrases and the Instagram hashtag cap; tone picked by category.
- B2: mapper tests from a recorded management-app response, including FAQs, discount and payment modes; the prompt renders facts and strips markdown.
- B3: slot job assignment for 3 to 7 slots with and without a performer or kitchen times; a later slot's prompt lists earlier openings and questions. Wizard: event slots written one at a time in send order, each with its plan and its job shown; a single-slot rewrite sees every other post; other content still written three at a time; the server refuses a plan it cannot use.
- B4: evaluation script dry run with OpenAI mocked; temperature left out for reasoning models.
- B8: plan, apply and rollback against an in-memory database with the writer mocked: eligibility (status, publish jobs, the hour's lead), the brief rebuilt from the management app, the untrue-wording guard, and apply skipping posts edited, moved or published since the plan.
- No unit test calls OpenAI, Meta or the management app.
