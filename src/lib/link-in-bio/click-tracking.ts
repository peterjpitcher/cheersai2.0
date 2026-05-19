'use server';

/**
 * Server-side click and page view tracking for link-in-bio public pages.
 * Uses service-role client because public page visitors are anonymous (no auth.uid()).
 * Both functions are fire-and-forget: errors are logged, never thrown to caller.
 * No third-party tracking scripts on the public page (LIB-05, D-09).
 */

import { tryCreateServiceSupabaseClient } from '@/lib/supabase/service';

/**
 * Track a tile click on a public link-in-bio page.
 * Looks up profile_id by slug, then inserts into link_in_bio_clicks.
 */
export async function trackTileClick(
  slug: string,
  tileId: string,
  referrer: string | null,
): Promise<void> {
  try {
    const supabase = tryCreateServiceSupabaseClient();
    if (!supabase) {
      console.error('[click-tracking] Supabase service credentials not configured');
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from('link_in_bio_profiles')
      .select('id')
      .eq('slug', slug)
      .maybeSingle<{ id: string }>();

    if (profileError || !profile) {
      console.error('[click-tracking] Failed to resolve profile for slug:', slug, profileError);
      return;
    }

    const { error: insertError } = await supabase
      .from('link_in_bio_clicks')
      .insert({
        profile_id: profile.id,
        tile_id: tileId,
        click_type: 'tile',
        referrer: referrer ?? null,
      });

    if (insertError) {
      console.error('[click-tracking] Failed to insert click:', insertError);
    }
  } catch (error) {
    console.error('[click-tracking] Unexpected error in trackTileClick:', error);
  }
}

/**
 * Track a page view on a public link-in-bio page.
 * Looks up profile_id by slug, then inserts into link_in_bio_page_views.
 */
export async function trackPageView(
  slug: string,
  referrer: string | null,
): Promise<void> {
  try {
    const supabase = tryCreateServiceSupabaseClient();
    if (!supabase) {
      console.error('[click-tracking] Supabase service credentials not configured');
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from('link_in_bio_profiles')
      .select('id')
      .eq('slug', slug)
      .maybeSingle<{ id: string }>();

    if (profileError || !profile) {
      console.error('[click-tracking] Failed to resolve profile for slug:', slug, profileError);
      return;
    }

    const { error: insertError } = await supabase
      .from('link_in_bio_page_views')
      .insert({
        profile_id: profile.id,
        referrer: referrer ?? null,
      });

    if (insertError) {
      console.error('[click-tracking] Failed to insert page view:', insertError);
    }
  } catch (error) {
    console.error('[click-tracking] Unexpected error in trackPageView:', error);
  }
}
