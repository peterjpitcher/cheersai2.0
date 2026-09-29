# SPEC: Homepage, a bigger logo and "made for hospitality"

Status: built on `feat/homepage-hospitality-and-logo`, 29 September 2026. No migration, no new environment variable, no production setting.
Owner: Peter Pitcher. Author: Claude.
Parent: `tasks/SPEC-homepage-and-guides.md` (the homepage it changes; §3, §4 and §7 there still apply).

## 1. Why

Peter, 29 September 2026, on the live homepage: "We need to make more of the logo, it's very small. Also, I want to really push on how this has been designed for hospitality."

## 2. What changes

1. **Logo.** The header logo goes from 117 by 40 CSS pixels to 164 by 56 on a phone and 211 by 72 from `md`. It uses the 1600px on-dark file with a `sizes` list, so the browser can pick a copy sharp enough for a 3x screen (next/image offers only 1x and 2x copies for a fixed-size image). The footer logo doubles to 234 by 80 (alt text "Cheers by Orange Jelly", the words in the image). The brand mark, two glasses raised, sits over the closing call to action as decoration (empty alt text). No new artwork: only files already in `public/brand/`.
2. **Header.** Nav links are 44px tall (a comfortable tap). On a phone the trial button reads "Free trial" (from `sm` it reads "Start your free trial") so it fits beside the larger logo down to 320px; "Talk to us" is unchanged. The header change shows on the guides pages too, which share it.
3. **Hero.** Headline "Made for hospitality." then "Cheers writes your venue's posts and puts them out on time."; a new intro in venue language; new supporting points (event countdown, venue types, approval, the company).
4. **New section "Made for the way venues work"**, straight after the hero: events with a run-up, weekly regulars, posts that sound like the venue, the link in bio. Each has a drawn example (`src/features/front-door/venue-illustrations.tsx`, HTML and design tokens, like the hero's planner card).
5. **Order.** Hero, the new section, the venue types ("Whatever kind of venue you run", examples rewritten in venue language), how it works, then "Everything else you need" (features, now without the four the new section covers, plus specials and offers), prices, guides, questions, who we are, closing.
6. **One new FAQ**, "Is Cheers only for pubs?", built from the sign-up form's venue types; the FAQ JSON-LD repeats it as before.

Unchanged: the SEO title and description (they still describe the page), the share image words, prices, the trial and support wording, every WhatsApp and email line (another PR is changing WhatsApp support), the call to action following the sign-up switch.

## 3. Claims and where the code proves them

| Claim on the page | Proof |
|---|---|
| The venue type chosen at sign-up shapes the writing | `src/lib/signup/venue-form.ts` (VENUE_TYPES, stored as `brand_profile.business_type`); `src/lib/ai/prompts.ts` `buildSystemPrompt` ("Business type: ...", "Write as this business") |
| Written in British English | `src/lib/ai/prompts.ts` ("Use British English throughout.") |
| Keeps out tired lines like "a night to remember" and "mouth-watering" | `src/lib/ai/voice.ts` BANNED_PHRASES; in the prompt via `mergedBannedPhrases` (`prompts.ts`); removed after writing by `postprocessCopy` (`src/lib/ai/postprocess.ts`, called from `src/app/actions/ai-generate.ts`) |
| Set your tone, key phrases, banned phrases | `src/features/settings/brand-voice-form.tsx` (Formal to Casual and Serious to Playful sliders, Key phrases, Banned phrases); `prompts.ts` uses each |
| An event gets a suggested run-up: weeks before, two days, the day before, the day | `src/lib/create/event-cadence.ts`; shown by `src/features/create/steps/schedule-step.tsx` |
| Each event post goes on the feed and as a story | `src/features/create/schemas/content-schemas.ts` and `src/lib/create/schema.ts` (default `['feed', 'story']`); `src/app/actions/content.ts` `resolveBatchPlacements` |
| The strip on the picture changes: THIS FRIDAY, TOMORROW NIGHT, TONIGHT | `src/app/actions/content.ts` `createScheduledBatch` (banner on for events); `supabase/functions/publish-queue/worker.ts` and `banner-label.ts` (label per post, stories too), mirrored by `src/lib/scheduling/proximity-label.ts` |
| Weekly regulars: days, time, end date, every date written up front, up to 52 | `src/features/create/schedule/suggestion-utils.ts` `buildWeeklyMultiDaySuggestions`; `src/lib/constants.ts` WEEKLY_MAX_OCCURRENCES |
| Link in bio with Book a table, See our menu, Call us, Find us, plus what's on now | `src/features/link-in-bio/public/link-in-bio-public-page.tsx` (CTA_ORDER, the Live now list) |
| Specials: an end date, then a launch post, a reminder and a last-chance post | `src/features/create/forms/promotion-fields.tsx` (end date required); `suggestion-utils.ts` `buildPromotionSuggestions` |
| Food and drink photos named and tagged | `src/lib/ai/media-tagging.ts` (tags describe the subject, setting, any food or drink and the mood); called on upload from `src/app/(app)/library/actions.ts` |
| Nothing goes out until you approve it; checks before sending; an email if a post fails | unchanged from the parent spec: `src/lib/publishing/preflight.ts`, `src/app/api/cron/notify-failures/route.ts` |

`src/content/homepage-claims.test.ts` runs the code behind each of these (labels, cadence, placements, promotion suggestions, prompt, banned phrases, venue types, link-in-bio labels, tagging prompt) against the page's words.

## 4. Decisions made while building

- **Examples, not a venue.** The drawings name no venue ("Your venue") and show product words only (the wizard's "Thursday · Week 1", the planner's Scheduled badge, the link-in-bio button labels).
- **The strip in the drawing sits down the right of the picture**, as the worker draws it (`FIXED_BANNER_POSITION`), in ink rather than the worker's gold, which is not a design token.
- **No time on the event-day post in the words.** The wizard moves the event-day suggestion to 07:00 only when the month already has posts (`deconflictSuggestions` runs only then); otherwise it stays at noon. The page says "on the day" and makes no time promise.
- **Crawl and index rules are untouched**: the new images are under `/brand/` and `/_next/image`, which robots.txt already allows.

## 5. Rollback

Revert the PR. Nothing else depends on it.
