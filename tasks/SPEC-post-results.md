# Spec: store each published post's results

Owner approval: 23 October 2026, relayed by the chief of staff session. Peter answered "4 yes" to asking Meta for the two permissions that show reach and link clicks; he reconnects Facebook and Instagram himself, and he submits the Meta App Review. Part of calendar step 5 in `tasks/REVIEW-social-calendar-2026-10-17.md`.

## Problem
- The Analytics page reads `analytics_snapshots` (`src/lib/analytics/queries.ts`), but nothing writes to it, so the page is blank.
- Organic results are therefore not stored anywhere. The review of 17 October 2026 could only count clicks from the short-link logs.

## What exists (checked 23 October 2026)
- `analytics_snapshots` has: `account_id`, `publish_job_id`, `platform`, `impressions`, `reach`, `engagement_count`, `engagement_rate`, `clicks`, `shares`, `comments`, `snapshot_date`, `raw_data`. No migration is needed.
- The page counts each row as one post and works out the rate as engagement / impressions. A row added every day would therefore count each post many times.
- Published posts are `publish_jobs` with status `succeeded`.
  - Meta's id for the post is in `provider_response->>'externalId'`.
  - `platform_post_id` is never set.
- Today's permissions allow only part of the picture:
  - Facebook reactions, comments and shares (`pages_read_engagement`).
  - Instagram likes and comments (`instagram_basic`).
  - Views, reach and link clicks need `read_insights` (Facebook) and `instagram_manage_insights` (Instagram).
- Meta has retired metrics recently:
  - Facebook post impressions were removed on 15 November 2025, and post reach in June 2026. Their replacements are `post_media_view` (views) and `post_total_media_view_unique` (viewers).
  - Instagram `impressions` became `views` for media made after 2 July 2024.

## Decisions
- **Permissions (first PR):**
  - `read_insights` and `instagram_manage_insights` are added to `FACEBOOK_SCOPE_LIST`, and `instagram_manage_insights` to `INSTAGRAM_SCOPE_LIST` (`src/lib/connections/oauth.ts`).
  - The Facebook login asks for both, because choosing a new Page there re-saves Instagram with its token.
  - The privacy policy and `docs/runbooks/meta-app-review.md` name both permissions and what they are for.
- **The job (second PR):**
  - `/api/cron/sync-post-results`, protected by `verifyCronAuth`, runs daily.
  - Each run covers every brand's feed posts published in the last 28 days.
  - It reads each metric on its own request, so one metric Meta has retired, or refused for a missing permission, costs only that metric.
  - What was refused is kept in `raw_data` and logged once per run.
  - Stories are left out: their results disappear after 24 hours.
- **Storage:**
  - One row per publish job, updated in place each day.
  - `snapshot_date` is the London date the post went out, so the page filters by publish date and never double counts.
  - `raw_data` keeps every value Meta returned, when it was read, and what was refused.
- **Mapping:**
  - `impressions` comes from views.
  - `reach` comes from viewers or reach.
  - `clicks` comes from Facebook link clicks; Instagram posts carry no link.
  - `comments` and `shares` come from their counts.
  - `engagement_count` is reactions plus comments plus shares on Facebook, and likes plus comments plus shares plus saves on Instagram.
  - `engagement_rate` is engagement divided by reach when reach is known, and empty otherwise.
- **The Analytics page** shows reach and link clicks once they arrive, and says when a platform's results need the reconnect.
- **Failures:**
  - A brand whose posts or connection cannot be read fails the run (500 and an error log), and the other brands are still read.
  - Tokens are never logged.

## Peter's reconnect (after the first PR is live)
1. In CheersAI open **Connections**.
2. On the **Facebook Page** card click **Update connection**. In Meta's dialog allow everything it lists, including the two new results permissions, and keep **The Anchor - Heathrow Pub & Dining** selected. It returns to Connections saying "Connected facebook successfully".
3. On the **Instagram Business** card click **Update connection** and do the same. Facebook and Instagram are separate logins.
4. Leave the paid-ads connection alone. Reconnecting Facebook or Instagram does not touch it, and the ad account does not need choosing again. Only a Meta Ads **Reconnect** clears the chosen ad account.
5. Do not click **Change Page** or **Disconnect**, and do not remove CheersAI in Facebook's settings. Removing it deletes every Meta token, the paid-ads one included.
6. Nothing in CheersAI checks which permissions were granted. A declined permission still shows the card as connected, and only the results job will show what is missing.

## As built (23 October 2026)
- `src/lib/analytics/post-results.ts` reads and stores the results, and `post-results-token.ts` reads each brand's stored token. The cron `/api/cron/sync-post-results` runs at 05:15 UTC daily, with a 300-second limit.
- The Graph requests send the token in the `Authorization` header, never in the URL.
- Facebook:
  - the post's own counts come from `GET /{post-id}?fields=shares,reactions.summary(total_count),comments.summary(total_count)`;
  - the insights are `post_media_view` (views), `post_total_media_view_unique` (viewers) and `post_clicks_by_type` (its "link clicks").
- Instagram:
  - the counts come from `GET /{media-id}?fields=like_count,comments_count`;
  - the insights are `views`, `reach`, `shares`, `saved` and `total_interactions`.
- A post Meta no longer knows is skipped and logged. An expired or revoked token (code 190) stops that platform for the brand in this run.
- The Analytics page shows Views, People reached, Engagement rate (on reach when known, otherwise on views), Link clicks and Posts published. Until reach arrives it shows "Not yet" and a line asking for the reconnect.
- Found while building it: `analytics_snapshots`, like 26 other tables, grants the `anon` role write access. RLS is on and every policy needs brand membership, so the API refuses anonymous reads and writes; revoking the grants is a separate change.

## Rollback
- Permissions: revert the PR. Tokens already granted keep the extra permissions until the next reconnect, and nothing calls them.
- Job: revert the PR and delete the rows it wrote (derived data, safe to remove).

## Tests
- OAuth requests exactly the new lists, and a saved connection records them.
- Job:
  - each metric is read on its own request;
  - a refused or retired metric costs only itself;
  - one row per post, updated, not added;
  - the publish date sets `snapshot_date`;
  - the mapping and the rate;
  - stories are left out;
  - a failed brand fails the run;
  - no token appears in the logs.
- Page: shows reach and clicks when present, and the reconnect note when they are missing.
