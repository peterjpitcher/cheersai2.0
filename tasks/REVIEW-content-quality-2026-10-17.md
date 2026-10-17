# Content quality review, 17 October 2026

Read-only discovery. Nothing in production, the database or the code was changed.

## Verdict

No, we are not producing the best content we could. The posts are accurate and safe, but generic, and each campaign repeats itself. The cause is mostly how the copy is produced, not the event information: the management app already holds rich, specific detail, and the AI is set up to play it safe and to write each post on its own.

## What was checked

- The live copy path: `src/app/actions/ai-generate.ts`, `src/lib/ai/prompts.ts`, `src/lib/ai/postprocess.ts`, `src/lib/ai/voice.ts`, `src/lib/publishing/compose-body.ts`, `src/features/create/steps/generate-step.tsx`, `src/lib/management-app/mappers.ts`, `src/lib/tournament/`.
- Every scheduled post for The Anchor (read-only SQL on `nbkjciurhvkfpcpatbnt`): 66 event feed posts across 6 events (19 October to 2 December) and 36 rugby match feed posts (3 to 18 November), plus their stories.
- The Sleigh My Name draft created today and the brief it was written from.
- The 8 upcoming events in the management app (`tfcasgxopxegwrabvwat`): descriptions, FAQs, timings.
- Management app short-link clicks, link-in-bio stats, and the public Instagram profile.

## 1. Findings

### 1.1 The writing engine is set to "safe and samey"

| Finding | Evidence |
|---|---|
| Model is `gpt-4o-mini`, one draft per post, temperature 0.7, no second look before the owner sees it | `src/lib/ai/generate.ts:49`, `src/lib/ai/temperature.ts:11`; `ai_generation_params.model` on today's draft |
| The three example posts in the prompt teach the clichés we see: "Join us for a proper...", "Looking for the perfect spot", "just the ticket", "Who are you backing this year?" | `src/lib/ai/prompts.ts:369-390` |
| A Facebook rule asks for a closing comment question, so all 33 Facebook event posts have one; 17 are "Who's coming / joining / ready" | `src/lib/ai/prompts.ts:406` |
| A rule bans "Get ready" openers, but nothing checks it: "Get ready" is in 24 of 66 posts | `src/lib/ai/prompts.ts:423`; no check in `src/lib/ai/postprocess.ts` |
| Eight rotating opening styles (avoiding the last three used) and content pillars exist but nothing calls them | `src/lib/ai/hooks.ts`, `src/lib/ai/pillars.ts` (no imports outside tests) |
| Every event gets the "Friendly & Warm" tone, including drag-hosted music bingo and Halloween | all 6 scheduled campaigns have `tone: friendly_warm` |
| The "7:00pm" to "7pm" tidy-up only runs on the old, unused path, so 20 of 66 posts say "7:00pm" | `src/lib/ai/postprocess.ts:54` and `:280` (old path) vs the live `postprocessCopy` at `:458` |

Across the 66 scheduled event posts: "Join us" in 62, "fun" in 50, "lively" in 23, "proper" in 11, "before the fun starts" (or similar) in 11, "Bring your mates" in 10, "friendly competition" in 10.

### 1.2 Each post is written alone, so a campaign repeats itself

- The wizard writes each slot separately, three at a time, and no slot sees what the others said (`src/features/create/steps/generate-step.tsx:520-563`).
- Sequins & Showstoppers has 6 posts per platform over three weeks. Its Facebook posts repeat nearly the same facts each time: date, Nikki, two themed rounds, "ballroom classics and glitterball anthems", dress up for extra points, £5 cash, dinner from 4pm.
- Tinsel & Tipples opens with "Christmas starts here" on 20 October, 8, 15 and 16 November; mulled cider is in all 7 Facebook posts.
- Repeated questions: "Who's on your team?" four times across the two quiz nights, "Who's ready to sing along?" twice in Sequins & Showstoppers.
- Every post in a campaign uses the same single image (6 of 6 campaigns, 8 to 14 posts each).

### 1.3 Important facts never reach the AI

The event import puts only the management app's `brief`, highlights, one price, capacity and performer into the prompt (`src/lib/management-app/mappers.ts:41-131`, `src/features/create/forms/event-fields.tsx:97-99`). It leaves out the public description, FAQs, doors, finish and last-entry times, and the book-ahead discount, though all 8 upcoming events have them filled in (4 to 6 FAQs each; doors at 6:30pm on 7 of the 8).

Effect on scheduled posts:

- Tinsel & Tipples (£40 in advance or £45 on the night, over-18s only, includes a full Christmas supper): a price appears in 1 of 14 posts, over-18s in none, the advance saving in none.
- Snowball Showdown (players must be 18+): 18+ appears in none of 12 posts.
- Doors time (6:30pm) appears only in 5 quiz posts.

The brief also arrives with raw formatting (markdown headings, `\r\n`) and its own "Get ready for a huge themed Friday night" headline, which the AI copied into the Sleigh My Name post. The management app's public long description opens the same way, so part of the generic tone starts upstream. "Performer: Nikki Manfadge (Person)" is how the host is described, which is why the AI turned her name into a hashtag.

### 1.4 Brand Voice settings that do nothing on the live path

- The 9 saved default hashtags and 3 default emojis are never sent to the AI (`src/lib/ai/prompts.ts:503-508`; only the unused old prompt reads them). The AI invents tags instead: #FunNightOut, #NikkiManfadge or #FestiveFun are on 28 of 66 posts, while the saved ones (#VillagePub, #SurreyPubs and so on) are on 2. #TheAnchor, shared with every other Anchor pub, is on 39.
- "Include emojis" switched on adds no instruction (`src/lib/ai/prompts.ts:589-591` only acts when it is off), so none of the 33 Facebook event posts has an emoji.
- All 10 saved key phrases are offered on every post, so the same few keep coming back.
- Facebook and Instagram location tags are saved in Settings for The Anchor, but the live publisher never sends them (`supabase/functions/publish-queue/providers/instagram.ts:38-49` sends a caption only; `providers/facebook.ts` likewise).

### 1.5 Rugby match posts (most urgent: the first go out on 3 November)

These come from a fixed template, not the AI (`src/lib/tournament/generate.ts:177`, `src/lib/tournament/screening.ts:83` and `:90`). In the 36 scheduled feed posts:

- Ireland v Argentina (posts on 3 November) is still on the old template (`nations-screening-v2`) and says "the end of the match may be missed". That contradicts the 5 September decision to stay open while people are still watching (`tasks/SPEC-nations-late-screenings.md`).
- All 18 Facebook posts carry a doubled call to action: "Book a table for this game:" with nothing after it, then "Book a table: link".
- 6 have a run-on sentence, for example "...the end of the match may be missed Book a table for food and rugby."
- All use 24-hour times ("kick-off 20:10", "Pub open 12:00 to 22:00").
- 4 say "start missed" for 11:40 kick-offs.
- Facebook and Instagram copy is identical apart from the link line, and there is no opening hook.
- Up to 7 Facebook feed posts land on one day: Wednesday 18 November has six match posts plus Snowball Showdown.

### 1.6 We cannot see what works

- No organic post results are stored. `analytics_snapshots` is empty and nothing writes to it.
- Each event has one Facebook link shared by all of its posts, so a click cannot be traced to the post that earned it.
- The link-in-bio page records clicks on custom tiles only, not on event cards (`src/lib/link-in-bio/click-tracking.ts`). It shows no clicks since May, while the Instagram event links got about 50 real-looking clicks in 90 days.
- Event campaigns have no way to rewrite posts that are already scheduled; only the rugby tournament can regenerate (`src/app/actions/tournament.ts:454`).

Baseline from the management app short links, last 90 days, obvious bots removed by user agent (approximate):

| Channel | Event links clicked | Clicks | Per event |
|---|---|---|---|
| Facebook | 50 | about 195 | about 4 (best 13 to 16) |
| Instagram (via the bio page) | 43 | about 50 | about 1 |

Instagram has 304 followers, and its bio link goes to `cheers.orangejelly.co.uk/l/the-anchor`.

## 2. Recommended changes

Ordered by value. Size is rough build effort.

### Before 3 November

1. **Rugby posts.** Rewrite the template in plain, friendly words: 12-hour times, one booking line, kick-off and closing wording that matches the 5 September decision, and a short hook per match. Fix the collapsed line breaks. Then regenerate every unpublished match post. Size: small.
2. **Rugby volume.** Consider one round-up post per match day instead of one post per match (needs an owner decision; the three-days-before rule came from `tasks/SPEC-tournament-defaults.md`). Size: medium.

### The writing engine

3. **Stronger model.** Test a stronger current model side by side with `gpt-4o-mini` on 10 real briefs, then switch if it wins. Size: small.
4. **Best of three.** Write two or three drafts per post and keep the best, scored against a short checklist: specific hook, no banned opener, every fact matches the brief, different from the other posts in the campaign. Size: medium.
5. **Better examples.** Replace the three example posts with 6 to 8 strong ones written for The Anchor, one per event type (music bingo, quiz, cash bingo, tasting night, party, sport, food). Size: small (writing, not code).
6. **Better questions.** Ask only when the question is about the event itself ("Which Christmas number one has you singing every year?"), on some posts not all, and never "Who's coming?" or "tag a friend". Size: small.
7. **Tone by event type.** Playful for themed and drag-hosted nights, warm for food and tasting nights, and so on. Size: small.
8. **A final check before the owner sees it.** Block formulaic openers ("Get ready", "Join us for", "Tonight's the night", "Don't miss"), limit repeated words ("fun", "lively"), move the existing "7pm" tidy-up onto the live path, and add the clichés found here ("like no other", "a night you won't want to miss", "don your best", "extravaganza") to the banned list. Rewrite rather than ship when a check fails. Size: small.

### Facts in

9. **A clean fact sheet per event.** Send the FAQs, doors, start, finish and last-entry times, price and any book-ahead saving, age rule, what's included, how booking works and the category, with the formatting stripped, and tell the AI to treat the brief as facts, not wording. The public long description adds little: it is written in the same style ("Get ready for a huge themed Friday night at The Anchor!"). Size: medium.
10. **Tag performers.** Store performers' Instagram handles in the management app so posts can tag them (Nikki, DJ Jermaine) and invite them as collaborators. A collab post shows to the collaborator's followers as well as ours; a plain tag does not. Meta's publishing API supports collaborators on posts and Reels. Size: medium, both apps.
11. **Hashtags and emojis.** Use the saved hashtags and emojis, five tags at most: one brand, one or two local, one or two event type, never a person's name. Instagram has allowed only five per post since 18 December 2025, but our code still allows ten (`src/lib/publishing/copy-rules.ts:9-12`, `src/app/actions/ai-generate.ts:75`, `src/lib/ai/schemas.ts:22`); no post has gone over five yet. Hashtags no longer add reach on Instagram, but captions feed its search, so name the event type and the place in the text (for example "Christmas music bingo in Stanwell Moor"). Size: small.
12. **Send the saved location tag** with every Facebook and Instagram post. This is in the publish worker, which deploys separately from the app. Size: small.

### Campaigns that build rather than repeat

13. **Plan the campaign as a set.** Give each post its own job, for example: announce, how it works, meet the host, dress-up ideas and prizes, eat first, last call, tonight. Each post leads with a different detail and asks a different question, or none. Size: medium.
14. **Rotate key phrases.** One or two per post, not all ten every time. Size: small.
15. **Vary the picture.** Artwork for the announcement and the day itself; venue, food, host or past-event photos in between. Size: medium.

### Clarity that helps bookings

16. Say how booking works when it is unclear ("Booking holds your place; pay £5 cash on the night"), give the phone number on Facebook, and explain the format once per campaign (music bingo: hear the clip, mark your card). Size: small, part of 9 and 13.

### Formats and platform limits

17. **Carousels, then Reels.** The publisher can only post a single image (`supabase/functions/publish-queue/providers/instagram.ts:39-49`; `providers/facebook.ts` posts `media[0]`). Carousels get the highest engagement on Instagram and Reels the highest on Facebook (Socialinsider benchmarks, Q3 2026). Size: large.
18. **Plan for Facebook's link limit.** Meta's help centre says a Page can be limited to links in two organic posts or comments a month, and that the limit may not apply to all Pages. The Anchor's Page is not limited today: 15 link posts went out in October and links in posts from 3, 7 and 17 October got clicks from Facebook. Every Facebook event post depends on its link, so keep a fallback ready: link to a Facebook Event (links to Meta products do not count) or give the phone number. Size: small.

### Learn what works

19. Pull reach, reactions, comments, shares and link clicks for each published post from Meta, and show them per campaign. Size: medium.
20. Give each post its own short link, as PR #79 did for ads, so clicks trace back to the post and its angle. Size: medium, both apps.
21. Count event-card clicks on the link-in-bio page. Size: small.
22. Later: feed The Anchor's own best-performing posts back in as examples. Size: medium.

### Reaching this autumn's posts

23. Add a "rewrite scheduled posts" option for event campaigns, or recreate the six campaigns through the wizard, once 3 to 15 are in. Each rewritten post needs re-approval. Size: medium.

## 3. What good could look like: Sleigh My Name

Written by hand from the brief and FAQs only. Nothing invented.

**Facebook (announcement)**

> Christmas number ones, cheesy crackers and the party anthems that only come out once a year. Nikki is back with Sleigh My Name, our festive Music Bingo, on Friday 11th December. 🎶
>
> We play a clip, you find it on your card and mark it off. Two themed rounds, prizes, and plenty of Nikki's cheek in between. You don't need to be a music buff, just ready for a laugh.
>
> Dress up for extra points. A full costume is brilliant, but a Christmas jumper counts too.
>
> Doors 6:30pm, bingo 7pm to 10pm. It's £5 each, cash on the night, and the bar takes card. Seating is shared, so book a place for everyone in your group and we'll sit you together where we can. Dinner is on from 4pm if you want to eat first. Prefer to call? 01753 682707.
>
> Which Christmas song has you singing every single year?
>
> Book your places: https://l.the-anchor.pub/fb9b8f85

**Instagram (announcement)**

> The party anthems that only come out once a year are back. 🎄
>
> Sleigh My Name: Festive Music Bingo with Nikki
> Friday 11th December, 7pm to 10pm
>
> Hear the clip, mark your card, win prizes.
> Dress up for extra points (a Christmas jumper counts).
> £5 each, cash on the night.
> Dinner from 4pm if you want to eat first.
>
> Book a seat for everyone in your group: link in bio.
>
> #MusicBingo #StanwellMoor #SurreyPubs #PubEvents

**The rest of the campaign, one job per post**

| Post | Job | Leads with |
|---|---|---|
| Announcement | What and when | The once-a-year anthems |
| About 3 weeks out | How it works | "Never played Music Bingo?" and the clip-and-card format |
| About 2 weeks out | Meet the host | Nikki and what she brings |
| 1 week out | Dress up | Extra points, small touches count, jumpers welcome |
| 2 days out | Eat first | Dinner from 4pm, so come early and eat before the bingo |
| Event day | Tonight | Doors 6:30pm, cash for entry, walk-ins if space allows |

## 4. Platform guidance checked (17 October 2026)

Items marked "checked" were read directly on 17 October 2026; the rest come from a research pass and were not re-read.

- **Facebook link limit (checked).** Meta's help centre says Pages may be limited to links in two organic posts or comments a month (more on paid Meta One plans), that links to Meta products do not count, and that the limit may not apply to all Pages: https://www.facebook.com/help/1929252614431792. Our own data shows The Anchor is not limited today (see item 18).
- **Instagram hashtag cap (checked).** Instagram's @creators account announced on 18 December 2025 that posts and Reels may carry up to five hashtags: https://www.threads.com/@creators/post/DSalXGPCWM4. Adam Mosseri has said hashtags do not increase reach (February 2025, reported by Social Media Today).
- **Captions and search.** Instagram says captions feed its search and advises a strong first line, since only about two lines show before "more" (@creators, 13 August 2026). The often-quoted 125 characters is a rule of thumb, not a Meta limit.
- **Engagement bait.** Facebook demotes posts that explicitly ask for votes, shares, comments, tags, likes or reactions: https://transparency.meta.com/features/approach-to-ranking/content-distribution-guidelines/engagement-bait/ (updated July 2025). A genuine question is fine; "tag a mate" or "share this" is not. No evidence either way on generic questions such as "Who's coming?", but they give people nothing real to answer.
- **Collab posts.** Instagram allows up to five collaborators, and a collab post reaches each collaborator's followers; a tag or mention does not: https://help.instagram.com/iphone-app/5861247717337470. The publishing API supports collaborators, location tags and user tags on posts and Reels.
- **Formats.** Instagram engagement in Q3 2026: carousels 0.50%, Reels 0.48%, single images 0.35%. On Facebook, Reels get the highest engagement and albums the most shares and views: https://www.socialinsider.io/social-media-benchmarks/instagram and https://www.socialinsider.io/social-media-benchmarks/facebook (updated October 2026).
- **Stories.** The API cannot add link, poll or location stickers to Stories, so Stories stay artwork-only.
- **Countdown series.** No Meta guidance found. Event marketers advise that each countdown post reveals something new; Instagram says it will not recommend content copied from elsewhere with only small edits (not confirmed for a venue's own near-duplicates).
