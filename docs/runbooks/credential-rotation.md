# Runbook: Credential Rotation

**Last updated:** 2026-05-19
**Severity:** Medium -- planned maintenance, not emergency (unless credentials leaked)
**Time to resolve:** 15-30 minutes

## Symptoms

Triggered by:
- Scheduled credential rotation (quarterly recommended)
- Suspected credential leak or compromise
- Team member departure with access to secrets
- Vercel/Supabase security advisory

## Credentials Inventory

| Credential | Location | Rotation Method |
|------------|----------|-----------------|
| TOKEN_VAULT_KEY | Vercel env vars | Generate new key, lazy re-encrypt |
| SUPABASE_SERVICE_ROLE_KEY | Vercel env vars | Regenerate in Supabase dashboard |
| OPENAI_API_KEY | Vercel env vars | Regenerate in OpenAI dashboard |
| RESEND_API_KEY | Vercel env vars | Regenerate in Resend dashboard |
| CRON_SECRET | Vercel env vars | Generate new random string |
| ALERTS_SECRET | Vercel env vars | Generate new random string |
| FACEBOOK_APP_SECRET | Vercel env vars | Regenerate in Meta developer console |
| INSTAGRAM_APP_SECRET | Vercel env vars | Regenerate in Meta developer console |
| GOOGLE_MY_BUSINESS_CLIENT_SECRET | Vercel env vars | Regenerate in Google Cloud console |
| QSTASH_TOKEN | Vercel env vars | Regenerate in Upstash console |

## Rotation Procedures

### TOKEN_VAULT_KEY (encrypts social OAuth tokens)

This is the most sensitive credential. Uses lazy re-encrypt strategy:

1. Generate a new 256-bit key:
   ```bash
   openssl rand -hex 32
   ```
2. In Vercel dashboard, update `TOKEN_VAULT_KEY` to the new value
3. In Supabase Edge Function secrets, set the same value for `TOKEN_VAULT_KEY`
   ```bash
   supabase secrets set TOKEN_VAULT_KEY=<NEW_KEY> TOKEN_VAULT_KEY_VERSION=1
   ```
4. Keep the old key accessible (you may need it for manual decryption of old entries)
5. The token vault uses lazy re-encryption: tokens are re-encrypted with the new key when next accessed (decrypt with old key version, encrypt with new)
6. To force immediate re-encryption of all tokens, run:
   ```bash
   npx tsx scripts/ops-rotate-vault-key.ts --old-key=<OLD_KEY> --new-key=<NEW_KEY>
   ```
   (Create this script if it does not exist -- it should iterate all token_vault entries, decrypt with old key, re-encrypt with new key, and update in place)
7. Redeploy the application and Supabase Edge Functions to pick up the new env var
8. Test: navigate to /connections, reconnect one provider, verify `token_vault` receives an `access` row, then trigger `publish-queue` once in staging.

### SUPABASE_SERVICE_ROLE_KEY

1. Go to Supabase dashboard > Settings > API
2. Click "Regenerate" on the service role key
3. Copy the new key
4. Update in Vercel: `SUPABASE_SERVICE_ROLE_KEY=<new_key>`
5. Redeploy
6. Test: trigger any cron job (e.g., token-health) and verify it succeeds

### CRON_SECRET / ALERTS_SECRET

1. Generate new secrets:
   ```bash
   openssl rand -hex 32  # for CRON_SECRET
   openssl rand -hex 32  # for ALERTS_SECRET
   ```
2. Update in Vercel env vars
3. Update in Vercel Cron configuration (if cron jobs pass the secret as a header)
4. Update in QStash message headers (if QStash passes CRON_SECRET)
5. Redeploy
6. Test: manually trigger a cron endpoint and verify 200 response

### Third-Party API Keys (OpenAI, Resend, Meta, Google)

1. Go to the provider's dashboard
2. Generate a new API key / secret
3. Update the corresponding env var in Vercel
4. Redeploy
5. Test the specific integration:
   - OpenAI: create a test post and trigger AI generation
   - Resend: trigger a test email (via cron or test endpoint)
   - Meta: verify Facebook/Instagram connection health
   - Google: verify GBP connection health

### QSTASH_TOKEN

1. Log in to Upstash console (https://console.upstash.com)
2. Navigate to QStash > Settings
3. Regenerate the token
4. Update in Vercel: `QSTASH_TOKEN=<new_token>`
5. Redeploy
6. Test: schedule a test publish and verify QStash dispatch succeeds

## Emergency Rotation (Credential Leak)

If credentials are suspected compromised:

1. **Immediately** rotate the compromised credential(s) using steps above
2. **Check audit log** for unauthorized access:
   ```sql
   SELECT * FROM audit_log
   WHERE created_at > '<LEAK_TIMESTAMP>'
   ORDER BY created_at DESC
   LIMIT 100;
   ```
3. **Review Vercel deployment logs** for unauthorized deploys
4. **Revoke old credentials** at the provider (don't just generate new ones -- explicitly revoke)
5. **Notify affected users** if their data may have been accessed
6. **Document the incident** with timeline, impact, and resolution

## Post-Rotation Verification

After rotating any credential:

1. Trigger a full CI build to ensure no build-time env var issues
2. Visit /planner -- verify page loads (tests Supabase connection)
3. Visit /connections -- verify all connections show green (tests token vault)
4. Create a test draft -- verify AI generation works (tests OpenAI)
5. Check Vercel function logs for any new errors
6. Monitor for 1 hour -- ensure cron jobs succeed on next run

## Prevention

- Rotate credentials quarterly
- Never commit credentials to git (env vars only)
- Use separate credentials for staging vs production
- Limit access to Vercel/Supabase/provider dashboards to necessary personnel
- Enable 2FA on all provider accounts
