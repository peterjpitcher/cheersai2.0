# Runbook: Token Reconnection

**Last updated:** 2026-05-19
**Severity:** High -- blocks publishing to affected platform
**Time to resolve:** 5-15 minutes

## Symptoms

- Activity feed shows "Connection needs attention" or "Token expired" notification
- Email alert: "[CheersAI] Action required: {Provider} token expired"
- Publish jobs fail with error classification "auth_error"
- Connection health status shows red dot in sidebar

## Diagnosis

1. Check which connection is affected:
   - Navigate to /connections
   - Look for connection cards with red/amber status indicators
   - Note the provider (Facebook, Instagram, or GBP) and display name

2. Verify the failure in database (optional, for engineers):
   ```sql
   SELECT id, provider, status, token_expires_at, health_status
   FROM connections
   WHERE account_id = '<ACCOUNT_ID>'
   AND (status = 'disconnected' OR token_expires_at < now());
   ```

## Resolution

### For Facebook / Instagram (Long-lived tokens)

1. Navigate to /connections
2. Click the card's main button: "Update connection" (active), "Renew access" (expiring) or "Reconnect" (needs action). Facebook and Instagram are separate logins, so do each card.
3. Complete the OAuth flow -- sign in to Facebook/Instagram when prompted
4. Grant all requested permissions (pages_manage_posts, instagram_content_publish, read_insights, instagram_manage_insights, etc.). Nothing checks what was granted, so a declined permission still shows the card as connected.
5. Verify the connection card shows green status after redirect
6. Do not click "Change Page" unless the Page is wrong, and do not remove the app in Facebook's settings: that deletes every Meta token, including the paid-ads one.

### For Google Business Profile (1-hour tokens)

GBP tokens auto-refresh via just-in-time refresh before each publish. If refresh fails:

1. Navigate to /connections
2. Click "Reconnect" on the GBP connection
3. Complete the Google OAuth flow
4. Verify the connection card shows green status
5. GBP refresh tokens are long-lived but can be revoked if user changes Google password

## Post-Resolution

1. Verify connection health: navigate to /connections, confirm green status
2. Check pending publish jobs: navigate to /planner, look for failed posts
3. Retry any failed publishes: click "Retry" on failed content items
4. Monitor the next scheduled publish to confirm it succeeds

## Prevention

- Token health cron runs nightly and alerts 7 days before expiry
- Email notifications sent at 4 days before expiry
- Consider reconnecting proactively when amber warning appears
