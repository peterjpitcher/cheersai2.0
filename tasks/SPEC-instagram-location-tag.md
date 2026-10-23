# Spec: Instagram posts carry The Anchor's location (B5)

Owner approval: 23 October 2026 ("8 yes", relayed by the chief of staff session), piece B5 of `tasks/SPEC-event-copy-engine.md` (review change 12).

## Finding that changed the plan
- The review assumed Settings held location tags that the publisher never sent. It does not. The two "location" columns in `posting_defaults` are labelled "Facebook Page ID" and "Instagram Business ID" in Settings, and for The Anchor they hold exactly the connected Page (628953850871830) and Instagram account (17841409165322018), as `social_connections.metadata` does.
- Instagram's `location_id` must be the ID of a Facebook Page that has location data; a Page without it makes container creation fail (`INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID`, IG User Media reference, checked 23 October 2026). An Instagram account ID can never be a location.
- The Anchor's Page is a "Page · Pub" with an address, phone number, opening hours and reviews (public Page, 23 October 2026), so it can be the location.

## Decisions
- Instagram feed posts send `location_id` = the Page saved as "Facebook Page ID" in Settings (`posting_defaults.facebook_location_id`), when it is a number. The Instagram ID beside it is not used.
- Stories are unchanged: this step covers feed posts only, where the location shows above the photo.
- Facebook posts are unchanged for now. The only location on offer is the Page itself, and a Page post tagged with its own Page would read "The Anchor is at The Anchor", which adds nothing. Built only if Peter wants it.
- If Instagram refuses the location, the worker creates the container again without it, once, and logs a warning, so a bad tag can never stop a post. Any other error is handled exactly as today.
- If the Settings read fails, the post goes out without a location and the worker logs a warning.
- Only the live publisher changes: the `publish-queue` edge function. The Next.js publishing path in `src/lib/publishing` is not the one that posts.

## Deploy
- The worker deploys by name from clean main (`supabase functions deploy publish-queue`), after the live source is compared with main.
- Checks: the next Instagram feed post publishes with the location, read back from the Graph API or the post itself, and the worker logs no refusal.

## Rollback
- Redeploy the previous worker source (main before this PR) by name. No data changes.

## Tests
- Feed post: `location_id` is sent with the caption when the Page id is a number.
- Not sent for a story, for a missing or non-numeric id.
- Refused location: a second container without `location_id`, a warning, and the post publishes.
- Any other container error: no second attempt, thrown as today.
- Worker: passes the saved Page id to the Instagram provider; a failed Settings read publishes without it.
