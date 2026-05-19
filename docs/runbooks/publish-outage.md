# Runbook: Publish Outage

**Last updated:** 2026-05-19
**Severity:** Critical -- scheduled content not publishing
**Time to resolve:** 15-60 minutes depending on root cause

## Symptoms

- Multiple publish jobs stuck in "queued" or "publishing" status
- Activity feed shows repeated "Publish failed" notifications
- Email alert: "[CheersAI] Publish failure" for multiple posts
- Planner "Attention Needed" banner shows high count

## Diagnosis

### Step 1: Identify scope

Check how many jobs are affected:
```sql
SELECT status, count(*) FROM publish_jobs
WHERE updated_at > now() - interval '24 hours'
GROUP BY status;
```

### Step 2: Check error patterns

```sql
SELECT platform, error_message, count(*)
FROM publish_jobs
WHERE status = 'failed'
AND updated_at > now() - interval '24 hours'
GROUP BY platform, error_message
ORDER BY count(*) DESC;
```

Error classification guide:
- `auth_error`: Token expired/revoked -- see Token Reconnection runbook
- `rate_limit`: Platform rate limit hit -- wait and retry (auto-retry at 5m/15m/45m)
- `content_rejected`: Platform rejected content -- review post content for policy violations
- `transient_error`: 5xx from platform -- usually resolves on retry

### Step 3: Check QStash delivery

1. Log in to Upstash console (https://console.upstash.com)
2. Navigate to QStash > Messages
3. Check Dead Letter Queue (DLQ) for messages that exhausted all retries
4. Check message delivery logs for 500 responses from webhook

### Step 4: Check webhook endpoint

Verify the publish webhook is responsive:
```bash
curl -X POST https://[APP_URL]/api/webhooks/publish \
  -H "Content-Type: application/json" \
  -d '{"test": true}' \
  -w "\nHTTP Status: %{http_code}\n"
```
Expected: 401 (unsigned request rejected) -- confirms endpoint is up.
If timeout or 500: check Vercel function logs.

## Resolution

### If auth_error (most common)

Follow Token Reconnection runbook, then retry failed jobs.

### If rate_limit

1. Wait for rate limit window to reset (usually 1 hour)
2. Failed jobs will auto-retry via QStash backoff (5m, 15m, 45m)
3. If all retries exhausted, manually retry from planner UI

### If QStash DLQ has messages

1. Note the message IDs and content_item_ids
2. In the planner, find the affected content items
3. Click "Retry" on each -- this creates a fresh QStash message with new deduplication ID

### If webhook endpoint is down

1. Check Vercel dashboard for deployment status
2. Check Vercel function logs for errors
3. If deployment failed, trigger redeploy from Vercel dashboard
4. If function error, check recent commits for breaking changes

### Manual retry for stuck jobs

If automated retry is not working, reset job status:
```sql
-- Only do this if you understand the implications
UPDATE publish_jobs
SET status = 'scheduled', error_message = NULL, updated_at = now()
WHERE id = '<JOB_ID>'
AND status = 'failed';
```
Then trigger the scheduler cron manually:
```bash
curl -X POST https://[APP_URL]/api/cron/scheduler \
  -H "Authorization: Bearer $CRON_SECRET"
```

## Post-Resolution

1. Monitor activity feed for successful publishes
2. Verify Attention Needed count drops to zero
3. Check that scheduled future posts are processing normally
4. Review Axiom logs for any remaining errors

## Prevention

- QStash retries at 5m/15m/45m with 4 attempts max
- Idempotency keys prevent duplicate publishes
- notify-failures cron sends email on first failure
- Token health cron alerts before token expiry
