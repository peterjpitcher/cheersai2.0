/**
 * Just-in-time GBP access token refresh (PLAT-05).
 * Google access tokens have a ~1 hour TTL. This module checks
 * token_expires_at on social_connections and refreshes via
 * Google OAuth2 when within 5 minutes of expiry.
 */

import { env } from '@/env';
import { getDecryptedToken, storeEncryptedToken } from '@/lib/providers/token-helpers';
import { ProviderError, ErrorClassification } from '@/lib/providers/errors';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

/** Refresh 5 minutes before actual expiry to avoid mid-request token death */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Ensure the GBP connection has a valid access token.
 * Returns the current access token if still valid, or refreshes it
 * via Google OAuth2 and stores the new token in the vault.
 */
export async function ensureFreshGbpToken(connectionId: string): Promise<string> {
  // 1. Read token_expires_at from social_connections
  const supabase = createServiceSupabaseClient();
  const { data: conn } = await supabase
    .from('social_connections')
    .select('token_expires_at')
    .eq('id', connectionId)
    .single();

  const expiresAt = conn?.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  const needsRefresh = !expiresAt || (Date.now() + REFRESH_BUFFER_MS) >= expiresAt;

  if (!needsRefresh) {
    return getDecryptedToken(connectionId, 'access');
  }

  // 2. Get refresh token from vault
  const refreshToken = await getDecryptedToken(connectionId, 'refresh');

  // 3. Call Google OAuth2 refresh endpoint
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.server.GOOGLE_MY_BUSINESS_CLIENT_ID,
      client_secret: env.server.GOOGLE_MY_BUSINESS_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new ProviderError(
      'GBP token refresh failed',
      'gbp',
      ErrorClassification.AUTH,
      false,
    );
  }

  const data = await response.json();
  const newAccessToken = data.access_token as string;
  const expiresInSeconds = (data.expires_in as number) ?? 3600;

  // 4. Store refreshed access token in vault
  await storeEncryptedToken(connectionId, 'access', newAccessToken);

  // 5. Update token_expires_at on social_connections
  const newExpiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
  await supabase
    .from('social_connections')
    .update({ token_expires_at: newExpiresAt })
    .eq('id', connectionId);

  return newAccessToken;
}
