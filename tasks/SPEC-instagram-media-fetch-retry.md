# SPEC: retry Instagram media-fetch failures (Meta code 9004)

Date: 2026-09-04
Status: implemented, awaiting merge and edge-function deploy

## What happened

The Instagram story for content `ecf8ddd3-b2c2-4447-85e3-d0e932b95acf`
(Big Sing Friday: Karaoke Night, scheduled 2026-09-04 11:00 BST) failed on its
first attempt with:

```
[instagram_create_container] status=400 OAuthException:
Only photo or video can be accepted as media type. (code 9004, subcode 2207052)
```

Verified facts (live project `nbkjciurhvkfpcpatbnt`, 2026-09-04):

- The banner render succeeded and uploaded a valid 1080x1920 JPEG
  (`banners/ecf8ddd3-.../c3c4b925-....jpg`, 464018 bytes). The identical file
  published fine as the Facebook story two seconds earlier.
- The signed URL handed to Instagram resolves with `image/jpeg` and a correct
  `Content-Length`.
- Supabase edge logs show no request from Meta's fetcher for that URL between
  the signing call (09:56:07) and the 400 response (09:56:08). The Instagram feed
  post in the same run was fetched by `facebookplatform/1.0` and published.
- Meta's 9004 / 2207052 is its "media could not be fetched from this URI"
  error. Other schedulers report it intermittently with valid public URLs.

Conclusion: a transient failure inside Meta's media fetcher. Nothing on our side
was wrong with the post.

## Why the job did not recover

`isRetryableMetaGraphFailure` in
`supabase/functions/publish-queue/providers/meta-error.ts` only treats 5xx,
codes 1/2/4/17/613 and a code 100 authorisation message as retryable. Code 9004
fell through, so the worker marked the job `failed` on attempt 1 of 4 and sent
the failure alert. Instagram story retries (`scheduleStoryPublishRetry`) key off
the same helper, so the story never got its short retry either.

## Change

- `meta-error.ts`: add `graph.code === 9004` to `isRetryableMetaGraphFailure`.
- Effect for Instagram stories: the existing 45 second story retry runs, up to
  `MAX_VARIANT_RETRIES` (3), inside the 5 minute story grace window.
- Effect for feed posts: the existing 5/15/30 minute backoff runs, up to
  `PUBLISH_MAX_ATTEMPTS` (4).
- A genuinely broken URL still fails, just after the bounded retries instead of
  immediately.

## Tests

- `tests/publish-queue-meta-error.test.ts`: unit coverage for the classifier.
- `tests/publish-queue.test.ts`: worker-level case where Instagram returns
  9004 / 2207052 on an Instagram story and the job is re-queued with a
  `story_publish_retry` notification.

## Deployment

The change lives in the Supabase edge function, which is outside the Vercel
build. After merge it must be deployed by name:

```
npx supabase functions deploy publish-queue --project-ref nbkjciurhvkfpcpatbnt
```

Do not run a bare deploy-all (it breaks `media-derivatives`, see memory).

## Rollback

Revert the commit and redeploy `publish-queue` by name. No schema or data
changes.

## Recovering today's story

The manual retry button re-queues the job as-is, but the worker rejects stories
more than 5 minutes past `scheduled_for` ("Story missed its scheduled window"),
so the story must be given a new time. Decision recorded in chat.
