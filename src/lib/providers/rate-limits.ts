/**
 * Database-backed rate limit counters (PLAT-08).
 * Tracks per-provider API usage in the provider_rate_limits table.
 * Uses increment_rate_limit RPC for atomic counter increment.
 */

import type { ProviderPlatform } from '@/types/providers';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

/** Platform-specific rate limits matching API quotas */
const RATE_LIMITS: Record<ProviderPlatform, { ceiling: number; windowMs: number }> = {
  facebook: { ceiling: 200, windowMs: 60 * 60 * 1000 },      // 200/hr (BUC policy)
  instagram: { ceiling: 200, windowMs: 60 * 60 * 1000 },     // 200/hr
  gbp: { ceiling: 1000, windowMs: 24 * 60 * 60 * 1000 },     // ~1000/day (varies by quota)
};

/**
 * Compute the window start time for the current rate limit window.
 * Windows align to fixed boundaries (e.g. hourly, daily).
 */
function getWindowStart(platform: ProviderPlatform): string {
  const windowMs = RATE_LIMITS[platform].windowMs;
  const now = Date.now();
  const windowStart = new Date(now - (now % windowMs));
  return windowStart.toISOString();
}

/**
 * Atomically increment the rate limit counter for a provider endpoint.
 * Uses the increment_rate_limit RPC function (Plan 01 migration)
 * which performs ON CONFLICT DO UPDATE SET request_count = request_count + 1.
 *
 * Rate limits are advisory — errors are logged but do not block publishing.
 */
export async function incrementRateLimit(
  accountId: string,
  platform: ProviderPlatform,
  endpoint: string,
): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const windowStart = getWindowStart(platform);
  const ceiling = RATE_LIMITS[platform].ceiling;

  const { error } = await supabase.rpc('increment_rate_limit', {
    p_account_id: accountId,
    p_provider: platform,
    p_endpoint: endpoint,
    p_window_start: windowStart,
    p_limit_ceiling: ceiling,
  });

  if (error) {
    // Log but don't block the publish operation — rate limits are advisory
    console.error('Rate limit increment failed:', error.message);
  }
}

/**
 * Check whether a request is within rate limits for the given provider endpoint.
 * Returns { allowed, remaining } and optionally retryAfterMs when at ceiling.
 */
export async function checkRateLimit(
  accountId: string,
  platform: ProviderPlatform,
  endpoint: string,
): Promise<{ allowed: boolean; remaining: number; retryAfterMs?: number }> {
  const supabase = createServiceSupabaseClient();
  const windowStart = getWindowStart(platform);
  const ceiling = RATE_LIMITS[platform].ceiling;

  const { data } = await supabase
    .from('provider_rate_limits')
    .select('request_count')
    .eq('account_id', accountId)
    .eq('provider', platform)
    .eq('endpoint', endpoint)
    .eq('window_start', windowStart)
    .single();

  const currentCount = data?.request_count ?? 0;
  const remaining = Math.max(0, ceiling - currentCount);

  if (remaining <= 0) {
    const windowMs = RATE_LIMITS[platform].windowMs;
    const windowStartMs = new Date(windowStart).getTime();
    const retryAfterMs = (windowStartMs + windowMs) - Date.now();
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, retryAfterMs) };
  }

  return { allowed: true, remaining };
}

/**
 * Get current rate limit usage across all endpoints for a provider.
 * Returns an array of { endpoint, count, ceiling } entries.
 */
export async function getRateLimitStatus(
  accountId: string,
  platform: ProviderPlatform,
): Promise<{ endpoint: string; count: number; ceiling: number }[]> {
  const supabase = createServiceSupabaseClient();
  const windowStart = getWindowStart(platform);

  const { data } = await supabase
    .from('provider_rate_limits')
    .select('endpoint, request_count, limit_ceiling')
    .eq('account_id', accountId)
    .eq('provider', platform)
    .eq('window_start', windowStart);

  return (data ?? []).map((row: { endpoint: string; request_count: number; limit_ceiling: number }) => ({
    endpoint: row.endpoint,
    count: row.request_count,
    ceiling: row.limit_ceiling,
  }));
}
