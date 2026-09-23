# SPEC: optimiser replacement ads get their own tracked link

Date: 22 September 2026. Status: implemented on branch `claude/kind-wright-9ea354`, in review as a
pull request into `main`. Not merged or deployed.

## Problem

`applyOptimisationRecommendation` (`src/app/(app)/campaigns/actions.ts`) creates a replacement Meta
ad for an approved copy rewrite. It:

- inserts the replacement `ads` row with no `utm_content_key` (nor `creative_format` or
  `creative_variant_key`);
- builds the creative with `linkUrl: campaign.destination_url`, the campaign's main link.

Publishing (`publishCampaign` in `src/app/(app)/campaigns/[id]/actions.ts`) gives every ad its own
key (`buildAdUtmContentKey`), asks the management app for a per-ad short link for that key
(`ensureManagementMetaAdVariantLinks`, stored in `source_snapshot.managementMetaAdVariants`), and
points the creative at the first of: the food service booking page with the key
(`resolveFoodBookingLinkUrl`), the ad's own short link (`resolveManagementMetaAdVariantShortUrl`),
or the main link with the key added (`applyAdUtmContent`).

`buildBlendedBookingSignals` (`src/lib/campaigns/optimisation.ts`) credits a booking to an ad only
when the booking's `utm_content` equals the ad's `utm_content_key` (`findAttributedAd`). A
replacement has no key and its link carries none of its own, so no booking can ever be credited to
it, and the optimiser cannot tell whether a rewrite worked. Worse, its bookings count as
"unattributed" for the campaign, which switches off pause recommendations for every ad in it
(`hasUnattributedFirstPartyBookings`).

## Evidence (read only, 22 September)

- Live evergreen campaigns: `destination_url` is the main short link (for example
  `https://l.the-anchor.pub/0ai0j0` for "Weekday Lunch A (cod and chips)"). Its stored target already
  carries `utm_content=meta_ads_main`. Each has three per-ad short links whose targets carry
  `utm_content=<that ad's key>`.
- So a replacement pointing at the main link lands with `utm_content=meta_ads_main` at best: never
  its own key.

## Does the replacement need its own management-app short link?

Yes. The fallback (`applyAdUtmContent` on the main short link, giving
`https://l.the-anchor.pub/<code>?utm_content=<key>`) does not work for these campaigns:

- The management app's redirect (`OJ-AnchorManagementTools`, `main` at `981541da`,
  `src/app/api/redirect/[code]/route.ts`, `appendTrackingParams`) forwards an incoming `utm_*`
  value only when the stored target has none: `if (param.startsWith('utm_') &&
  destination.searchParams.has(param)) continue`.
- Every main link made by `POST /api/marketing/meta-ads-link` or by the event links stores
  `utm_content=meta_ads_main`, so the visitor's key is dropped and the booking arrives with
  `meta_ads_main`.
- A per-ad short link's target has `utm_content` set to the ad's key
  (`src/services/short-links.ts`, `withUtmContent`), so that key reaches the booking page and,
  with marketing consent, the booking sent to CheersAI.

The `applyAdUtmContent` fallback stays last in the order, as in publishing: it only applies when
no per-ad short link exists, which after this change means a campaign whose link is not a
management short link.

Creating a per-ad short link is also exactly what publishing does, so the replacement is tracked,
counted and reported the same way as every other ad.

## What changes (no schema change)

1. **Shared link resolver.** New module `src/lib/campaigns/ad-link.ts` with `resolveAdLinkUrl()`:
   the food service booking page, then the ad's own management short link, then the main link with
   `utm_content`. `resolveFoodBookingLinkUrl` and `serviceBookingUrlsFromSnapshot` move there
   unchanged from `src/app/(app)/campaigns/[id]/actions.ts` (a `'use server'` file cannot export a
   plain function). `publishCampaign` calls the new function; its behaviour does not change.
2. **Unique key helper.** New `uniqueAdUtmContentKey(key, takenKeys)` in
   `src/lib/campaigns/ad-attribution.ts`. It returns the key unchanged unless another ad in the
   campaign already uses it, and then adds `__2`, `__3` and so on, trimmed to the 160-character
   limit. Needed because the optimiser can propose a second rewrite of the same ad, which gets the
   same name (`<ad> - booking rewrite`) and angle and so the same key, and long names are cut at 48
   characters, which can make a rewrite of a rewrite collide too. A shared key would credit both
   ads' bookings to whichever the optimiser finds first.
3. **Apply builds the replacement like publishing does.**
   - Loads the ad set's `name` and `service_key` and the original ad's `creative_format` (the
     replacement reuses its image), plus every `utm_content_key` already used in the campaign.
   - Builds `creative_format`, `creative_variant_key` and `utm_content_key` with the existing
     helpers (`normaliseCreativeFormat`, `buildCreativeVariantKey`, `buildAdUtmContentKey`), made
     unique, and stores all three on the new row.
   - Calls `ensureManagementMetaAdVariantLinks` for the one new key and saves the returned
     `source_snapshot` on the campaign (account-scoped), as publishing does. This happens before
     the replacement row is inserted.
   - Points the creative at `resolveAdLinkUrl(...)`.
   - Claims the recommendation first, with a conditional update from `planned` to `applied` before
     any side effect. Two overlapping applies (a double submission of the approve form) would
     otherwise both read the campaign's keys, build the same "unique" key and create two
     replacement ads sharing it. The loser stops and says so. A failure afterwards that created
     nothing hands the claim back to `planned` with the reason, so it can be tried again; a
     failure that reached Meta stays `failed`, as before. The `status` column allows only
     `planned`, `applied`, `skipped` and `failed` (live check constraint), so there is no
     in-flight value and no migration.
   - Fails closed: if the key list, the short link or the snapshot save fails, no replacement row
     is saved, Meta is not called, and the recommendation is marked failed with the reason, as for
     any other Apply failure. A later Meta failure deletes the row as before; the spare short link
     it leaves behind only redirects.

## Decisions and assumptions

1. The replacement's key uses the campaign's current name, the ad set name, the original ad's
   creative format, and the proposal's name and angle. It will not share the originals' prefix
   when a campaign was renamed after publishing (the weekday campaigns were); it is still unique
   and matched exactly, so attribution is unaffected.
2. Uniqueness is checked within the campaign only, as publishing's preflight does.
3. Apply creates the per-ad short link for every campaign kind, as publishing does. A food booking
   ad set still links to its service booking page first, exactly as at publish.
4. The management app must be reachable at Apply time. If it is not, Apply fails and says so,
   rather than creating an ad whose bookings cannot be credited (the workspace fail-closed rule).
5. Replacement ads already created (the one applied on 22 September, now paused) are not
   backfilled. Their Meta creative points at the main link and cannot be changed, so a key in the
   database would never match a booking.

## Not in scope

- The event-only `BOOK_NOW` override in Apply differs from publishing (which also forces it for
  `food_booking`). Parked.
- A failed Apply cannot be retried (status `failed` is terminal). Unchanged.
- The optimiser's campaign short-code matching ignores per-ad short codes. Unchanged; attribution
  is by `utm_content`.

## Deployment

No migration, no environment variable. Builds on PR #76 (replacement created paused, audit rows)
and PR #77 (controlled-test guard), both already merged to `main` and live. Nothing on Meta or in
the production database changes until an owner applies a rewrite after deploy, and a campaign
flagged as a controlled test refuses rewrites before any of this runs.

## Rollback

Revert the commit. No data to undo: rows created meanwhile keep their key and short link, which
are harmless (the key only adds attribution; the short link only redirects).

## Tests

- `tests/lib/campaigns/campaign-actions.test.ts`, `applyOptimisationRecommendation`:
  - the replacement row is inserted with a `utm_content_key`, and the creative's `linkUrl` is the
    per-ad short link created for that key;
  - the key is unique when the campaign already uses the same key;
  - a second overlapping apply stops at the claim and creates nothing;
  - a read that fails after the claim hands the recommendation back to `planned`;
  - if the short link cannot be created, no Meta call is made, the row is deleted and the
    recommendation fails.
- `tests/lib/campaigns/ad-attribution.test.ts`: `uniqueAdUtmContentKey`.
- New `tests/lib/campaigns/ad-link.test.ts`: food service page, per-ad short link, and fallback
  order.
- Existing publish tests still pass unchanged.
- `npm run ci:verify`.
