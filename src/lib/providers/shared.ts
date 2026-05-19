/**
 * Shared utilities for all platform adapters.
 * Prevents duplicate getConnectionMetadata implementations across
 * Facebook, Instagram, and GBP adapters (Wave 2 plans 02-04).
 */

import { createServiceSupabaseClient } from '@/lib/supabase/service';

/**
 * Reads social_connections.metadata JSONB for a given connection ID.
 * Used by all three adapters (Facebook, Instagram, GBP) to retrieve
 * platform-specific identifiers (pageId, igBusinessId, locationId).
 *
 * Uses service-role client (bypasses RLS) — adapter operations run
 * in background job context without user session.
 */
export async function getConnectionMetadata(connectionId: string): Promise<Record<string, unknown>> {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from('social_connections')
    .select('metadata')
    .eq('id', connectionId)
    .single();

  if (error || !data) throw new Error(`Connection not found: ${connectionId}`);

  return (data.metadata as Record<string, unknown>) ?? {};
}
