# SPEC: owners see plain words when a post fails to publish

Approved by Peter on 29 September 2026. Follows tasks/SPEC-plain-error-messages.md (PR #175).

## Why

When a post failed, owners saw Meta's own error text, for example
"[instagram_create_container] status=400 OAuthException: Only photo or video can be accepted as
media type. (code 9004, subcode 2207052) trace=..." on the post page, in the post drawer, in the
failed-post list, in the activity feed and notification history, and in the failure emails.

## What changes

- One module, `src/lib/publishing/failure-messages.ts`, turns stored failure text into a plain
  British English sentence that says what happened and, where useful, what to do next. It names the
  post's platform (Facebook or Instagram), and reads it from the stored text when the post does not
  say. It is pure, so server components, client components and email routes share it.
- Every owner-facing surface shows that sentence instead of the stored text: the post page
  (`/planner/[contentId]`), the post drawer (calendar and agenda), the failed-post list
  (`/planner?status=failed`), the activity feed and `/planner/notifications` (publish failed, story
  failed, retry scheduled, story retry, connection needs attention), the notify-failures email and
  its in-app alert body, and the QStash failure email.
- Cases covered: expired or revoked token (190 and its session subcodes), permissions missing (10,
  200 to 299, 403), the Page or Instagram account no longer reachable, Meta's ambiguous
  "Authorization Error" (usually retried), not connected, rate limits (4, 17, 32, 613, 429),
  Instagram's daily publishing limit (subcode 2207042), Instagram media fetch (9004 and 2207052,
  transient and retried, PR #45), media not ready (9007), unsupported image (36000 to 36004, 324 and
  the Instagram image subcodes), no image, story image not prepared, story or placement not
  allowed, story missed its window, no caption or content, banner render, retired platform,
  temporary Meta problems (1, 2, 5xx) and anything unknown.
- Kept as they are, because they were written for owners: billing holds ("On hold: ..."), the
  worker's refusals ("Not published: ...") and tournament screening checks ("... Review required."
  and "... Review and regenerate."). An offboarded brand's "Brand offboarded." reads as the existing
  hold wording "On hold: this brand has been closed."
- The notify-failures email now reads `last_error` (what the live edge function writes) as well as
  `error_message`, so edge-function failures get a reason in the email. It no longer quotes the error
  code, and it escapes the owner's display name.
- `src/lib/publishing/error-messages.ts` (and its test) is removed: its only caller was the QStash
  failure email, which now uses the new module, and the new module maps the same `error_code`
  classifications (auth, rate_limit, transient, content_rejected, unknown).

## What does not change

- The publish-queue edge function and everything it stores. The raw text stays in
  `publish_jobs.last_error`, `publish_jobs.error_message` and `notifications.metadata` for support.
  No edge deploy.
- Statuses, retries and buttons. A failure still shows as a failure.
- Operator surfaces. `/admin` shows no publish failure text today. The operator alert email
  (`alertRepeatedPublishFailures`) shows counts only. The edge function's own operator email (to
  `ALERT_EMAIL`) already labels the raw text "Error:" and is left alone, since changing it needs an
  edge deploy.

## Rollback

Revert the PR. No migration, no data change, no environment variable, no edge function deploy.
