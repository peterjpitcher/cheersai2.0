# Spec: each Facebook event post has its own link

Owner approval: 23 October 2026, relayed by the chief of staff session. Peter answered "5 yes" to the change in the management app that CheersAI needs for links that track each post. Part of calendar step 5 in `tasks/REVIEW-social-calendar-2026-10-17.md` ("per-post links: give each post its own short link, so clicks and bookings trace back to the post, its time and its angle").

## Problem
- Every Facebook post of an event carries the event's one Facebook short link (`brief.ctaLinks.facebook`, from the management app), so a click or a booking cannot be traced to the post that brought it.
- Instagram posts carry no link at all: people tap the bio page.

## Facts (checked 23 October 2026)
- The management app counts clicks per short link and keeps each click's UTMs.
- Its redirect keeps the stored `utm_*` over incoming ones and adds `short_code`. So a link's own `utm_content` reaches the website.
- The website keeps `utm_content` and `short_code` for consented bookings and sends them with each booking to CheersAI's `/api/booking-conversions` (`booking_conversion_events.utm_content`).
- **The website needs no change.**
- The management app's variant links (PR #79, for ads) were all labelled `meta_ads`. Two lookups could also hand a variant out as the event's own link, or repoint it during a link refresh:
  - its event API (`/api/events/{id}`);
  - its event-link lookup and refresh (`generateSingleLink`, `generateLinks`).

## Decisions
- **Management app (its own PR, `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools`):**
  - `POST /api/marketing/social-post-links`, with the same API-key permissions as the ads endpoint. It takes the event (its id, or the code of one of its short links) and up to 50 posts. For each post it makes or reuses a variant of the event's own Facebook link, labelled `facebook_post`, that differs only by the post's `utm_content`.
  - Every lookup of an event's own link skips variants, which also closes the gap for ad variants.
  - No migration.
- **CheersAI (this PR):**
  - When the wizard schedules an event's Facebook feed posts and the brand has an events-system connection, it asks for one link per post. The link is keyed by when the post goes out, in London time (`post_20261026_1100`), and is written into that post's caption and stored copy.
  - Two posts at the same minute share one link.
  - If the request fails, the posts keep the event's shared link and a warning is logged, so scheduling never fails over attribution.
  - Instagram posts and stories are unchanged.
- **Not covered yet:**
  - The calendar fill tool. Its plan run must change nothing, and making links writes to the management app, so that needs a step at apply time.
  - Posts already scheduled keep the shared link, because no bulk changes are allowed.
  - Reading each link's clicks back into CheersAI comes with the post results (`tasks/SPEC-post-results.md`).

## Rollback
- CheersAI: revert the PR. New posts go back to the shared link. Links already made keep working.
- Management app: revert its PR. Variants already made keep redirecting and counting clicks.

## Tests
- **CheersAI:**
  - the key in London time on both sides of the clock change;
  - the code read from a short link;
  - one request per batch, one link per post time;
  - each slot gets its link;
  - a failure throws to the caller;
  - the Facebook feed post carries its own link and Instagram does not;
  - the action falls back and warns on failure, and asks nothing for posts that are not events, not on Facebook or without a connection;
  - no key in the logs.
- **Management app:**
  - the endpoint makes Facebook-post variants of the event's Facebook link and accepts an event short code;
  - validation;
  - the event API and both lookups skip variants;
  - the refresh never repoints one;
  - ad variants are unchanged by default.
