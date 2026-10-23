# Spec: vary the picture across an event campaign (B6)

Owner approval: 23 October 2026 ("8 yes", relayed by the chief of staff session), piece B6 of `tasks/SPEC-event-copy-engine.md` (review change 15): "Artwork for the announcement and the day itself; venue, food, host or past-event photos in between."

## What is already there
- The create wizard lets each post use its own image: every card in the Generate step has Replace and Add (`SlotMediaModal`), and saving uses each post's own choice (`slot.mediaIds ?? selectedMediaIds` in `src/lib/content/schedule-batch.ts`).
- Nothing picks a different picture by default, so every post in a campaign shows the event artwork unless the owner changes each one by hand.
- Copy is written from the campaign's pictures, not the post's own: `generateContent` is sent `selectedMediaIds`, and the pictures' tags and file names go into the prompt.

## Finding that shapes the design
- The Anchor's library (23 October 2026): 230 rugby images, 16 event artworks, about a dozen food photos, a few bar and kitchen photos, and promotional graphics (job adverts, "now open lunchtimes", a meal deal).
- Tags are free-form and written by the AI or the upload path, and some mislead: the photo of pies is tagged "sunday roast". A picture's tags go into the prompt, so a wrongly tagged photo can put an untrue claim in the copy, such as a Sunday roast on a Wednesday.

## Decisions
- Defaults apply only to event campaigns written with a campaign plan.
- The announcement and the event-day posts keep the event artwork, as today.
- The posts in between take a photo the owner has marked for reuse with the Library tag `reuse`, chosen for the post's job: a food photo for "eat first"; a photo of the host, then a venue or past-event photo, for "meet the host"; a venue or past-event photo for the rest. Each photo is used once per campaign, and only photos with an upright story version are offered. With no fitting photo left, the post keeps the artwork.
- With no `reuse` photos, nothing changes. Promotional graphics and other events' artwork are left out unless the owner tags them `reuse`.
- The owner sees each post's picture in the Generate step and can change it before scheduling, as today.
- Each post's copy is written from its own picture, so the words match what is shown.

## Rollback
- Code only: revert the PR. Posts already scheduled keep the pictures they were saved with.

## Tests
- Jobs: announcement and event day keep the artwork; "eat first" takes a food `reuse` photo; "meet the host" prefers the host; other middle posts take venue or event photos; no photo twice; no fitting `reuse` photo means the artwork.
- Never picked: untagged photos, other events' artwork, videos.
- An owner's own choice on a post is never replaced.
- Generation is sent the post's own pictures when it has them.
