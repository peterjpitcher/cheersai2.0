# SPEC: booking prompt on event stories

## Decision (owner, 17 October 2026)

Section C of the social calendar review (`REVIEW-social-calendar-2026-10-17.md`, approved on 17
October 2026): add a small booking prompt to the artwork of event stories.

- Instagram stories: `LINK IN BIO TO BOOK`
- Facebook stories: `BOOK AT THE-ANCHOR.PUB`

## Why

Every event post has a story at the same minute, using the event's upright artwork, but a story
gives the viewer no way to book. Meta's publishing API cannot add link stickers to stories.
Bookings come from the Facebook post's link and from the Instagram link in bio, so the story has to
say where to go.

## What changes

**Which stories.** A story gets the prompt when all of these hold:

- it is a story (`placement = 'story'`) of an event campaign (`campaigns.campaign_type = 'event'`);
- its own platform has a booking link in `prompt_context.brief.ctaLinks` (http or https). That is
  the same test that gives the paired feed post its booking line ("Book now: link" on Facebook,
  the link-in-bio line on Instagram);
- the gold date strip is drawn on it. The prompt follows the same overlay switch: turning the
  overlay off for a post in the planner removes both, and `BANNER_OVERLAY_DISABLED` removes both.
  After the event has started no strip is due, so no prompt either. Custom overlay text replaces
  only the date label; the prompt stays.

Live data, read only, 17 October 2026: all 66 scheduled event stories (33 Facebook, 33
Instagram) carry booking links for both platforms.

**The text.** Instagram: `LINK IN BIO TO BOOK` for every brand. Facebook: `BOOK AT ` plus the
brand's website domain in capitals, without a leading `www.`. The domain comes from the brand's
existing website setting, `link_in_bio_profiles.website_url` (Settings, Link in bio, Website).
The Anchor's is `https://www.the-anchor.pub`, which gives `BOOK AT THE-ANCHOR.PUB`. The booking
links themselves are short links on `l.the-anchor.pub`, so the domain is not taken from them. A
brand with no website, an address that is not a plain domain, or a domain too long for the
40-character cap gets `SEE OUR PAGE TO BOOK`: the Page holds the paired post with the link.

No migration and no new setting: the live schema already has `website_url` per brand (checked read
only on 17 October 2026), and nothing hard-codes The Anchor.

**Where on the image.** In the gold strip that already runs down the right-hand edge. The strip's
text alternates the date label with the prompt ("WEDNESDAY 18TH NOVEMBER · BOOK AT
THE-ANCHOR.PUB · WEDNESDAY 18TH NOVEMBER"), with a prompt in the middle. The strip text is
centred, so one whole prompt always sits mid-height, clear of the top and bottom 14% that
Instagram and Facebook cover with their own UI; even a 40-character prompt fits there. The
artwork is not covered any further: everything left of the strip is pixel for pixel what
publishes today.

A separate gold box was tried first: centred, just above the bottom 14%, on the six story images
scheduled from 19 October to 2 December. It covered real content on four of them: the times on
the Halloween party story ("8PM - MIDNIGHT", the only place they appear), the top of the Music
Bingo story's own "BOOK NOW" button, the icon labels on Tinsel & Tipples, and the logo on the
Christmas quiz. The designed artwork puts its details in the lower third, where the safe area
ends, so any fixed box there will keep doing that.

**Code.**

| Area | Change |
|---|---|
| `src/lib/scheduling/proximity-label.ts`, `supabase/functions/publish-queue/banner-label.ts` | `getStoryBookingPrompt()`, the rule and texts above, in both copies (Deno cannot import `@/`); parity test |
| `supabase/functions/publish-queue/worker.ts` | `resolveAndRenderBanner` works out the prompt and sends it to the render route as `storyPrompt`. It reads the website only for a Facebook event story with a booking link; if that read fails it logs and uses `SEE OUR PAGE TO BOOK`, so the story still goes out |
| `src/app/api/internal/render-banner/route.ts` | Optional `storyPrompt` (string, at most 40 characters, the overlay character set); absent means no prompt |
| `src/lib/banner/palette.ts` | `buildRepeatedBannerLabel(label, storyPrompt)` alternates the two with a prompt in the middle; without a prompt the strip text is unchanged. The renderer and the preview both use it, so they cannot drift |
| `src/lib/banner/render-server.ts` | Passes the prompt to the strip; same size, place, colours and font |
| `src/features/planner/banner-overlay.tsx` | Optional `storyPrompt` prop for the preview strip |
| `src/lib/planner/data.ts`, `post-drawer.tsx`, `planner-content-composer.tsx` | The post detail carries `storyPrompt`, so the planner drawer and the post page preview it |

**Not changed.** The strip's size, place, colours and font; feed posts; non-event stories; and
the rugby posts (they are `instant_post` items with no campaign). The create wizard's story
preview shows one image for both platforms, so it does not show the per-platform prompt; the
planner does. The live planner calendar shows no images.

## Deploy

1. Merge, then let Vercel deploy production (render route, renderer and planner preview).
2. Deploy the worker from the merged `main`:
   `npx supabase functions deploy publish-queue --project-ref nbkjciurhvkfpcpatbnt`.
   The live worker is v47, deployed on 17 October 2026 after `74ded85b`, the newest commit on
   `main` that touches `supabase/functions/publish-queue`, so this deploy adds only this change.

Either order is safe. The current route ignores the new field and the current worker never sends
it, so stories render as today until both are live. The first event stories due are on Monday 19
October at 07:00.

**Check after deploy.** The rendered image is stored before it is published, at
`media/banners/<content id>/<variant id>.jpg`. Look at the first Facebook and the first Instagram
event story after they go out: the strip reads `BOOK AT THE-ANCHOR.PUB` and `LINK IN BIO TO BOOK`
respectively between the date labels, with one whole prompt mid-height.

## Rollback

- Quickest: roll Vercel back to the previous production deployment. The old route ignores
  `storyPrompt`, so stories render exactly as before. Or redeploy `publish-queue` from the commit
  before this change.
- One story: turn its overlay off in the planner (this removes the date label as well).
- Every overlay: `BANNER_OVERLAY_DISABLED=true` on Supabase, the existing kill switch.

No data changes, so there is nothing to undo in the database.

## Tests

- `getStoryBookingPrompt`: which stories qualify, both texts, domain handling and the fallback,
  and agreement with the feed booking-line test (`readPlatformCtaLinks` and
  `resolvePlatformCtaUrl`).
- Parity between the Node and Deno copies over the same cases.
- Strip text: the prompt alternates with the label, sits in the middle, and the text is
  unchanged without a prompt.
- Renderer: glyph paths not `<text>`, the same strip, and everything left of the strip pixel for
  pixel the strip-only render.
- Render route: passes `storyPrompt` through, rejects a bad one, and passes `null` when absent.
- Worker: Facebook and Instagram event stories send the right prompt; the website read happens
  only for Facebook; a failed read falls back and still publishes; feed posts send none.
- Preview: `BannerOverlay` carries the prompt only in a visible strip; the planner detail returns
  it, reading the website only for Facebook and falling back if that read fails; the drawer
  passes it on.
