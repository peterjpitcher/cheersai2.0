/**
 * Per-post links for organic Facebook event posts (tasks/SPEC-per-post-links.md).
 *
 * Every Facebook post of an event used to carry the event's one Facebook short link, so a click
 * or a booking could not be traced to the post that brought it. Each post now gets its own
 * variant of that link from the management app: the same page and campaign tracking, with the
 * post's own utm_content, which names when the post went out ("post_20261026_1100", London
 * time). Clicks are counted per link there, and a booking made after a click carries the
 * utm_content through the website to CheersAI's booking conversions.
 *
 * Instagram posts cannot carry links, so they keep the event's link-in-bio link.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { DateTime } from 'luxon';

import { DEFAULT_TIMEZONE } from '@/lib/constants';
import { createManagementSocialPostLinks, type ManagementApiConfig } from '@/lib/management-app/client';

/** utm_content for one post: when it goes out, in London time ("post_20261026_1100"). */
export function postLinkKey(scheduledAt: string | null | undefined, now: Date = new Date()): string {
  const parsed = scheduledAt ? DateTime.fromISO(scheduledAt, { setZone: true }) : null;
  const at = parsed?.isValid ? parsed : DateTime.fromJSDate(now);
  return `post_${at.setZone(DEFAULT_TIMEZONE).toFormat('yyyyLLdd_HHmm')}`;
}

/** The code of a short link ("fb6e761f" for https://l.example.com/fb6e761f), or null. */
export function shortCodeOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    return last && /^[a-z0-9-]+$/i.test(last) ? last.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * An owner-edited Facebook caption with the event's shared link swapped for the post's own link.
 * An edited caption is published exactly as written, so without this it would keep the shared
 * link. Every other edit stays. Only the exact shared link is swapped, wherever it appears, and
 * not where it is the start of a longer link; a caption whose link the owner changed or removed
 * is left as it is.
 */
export function withPostLink(caption: string, sharedLink: string | null | undefined, postLink: string): string {
  const shared = sharedLink?.trim();
  if (!shared) return caption;
  const escaped = shared.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return caption.replace(new RegExp(`${escaped}(?![A-Za-z0-9_\\-/?#=&%])`, 'g'), () => postLink);
}

/**
 * Each post's own Facebook link, by slot key. Two posts at the same minute share one. Throws when
 * the event link is not a short link or the management app cannot make them, so the caller can
 * fall back to the event's own link.
 */
export async function resolveFacebookPostLinks(
  config: ManagementApiConfig,
  input: { facebookLink: string; slots: ReadonlyArray<{ slotKey: string; scheduledAt: string | null }> },
  now: Date = new Date(),
): Promise<Map<string, string>> {
  const eventShortCode = shortCodeOf(input.facebookLink);
  if (!eventShortCode) throw new Error('the event Facebook link is not a short link');
  const keys = input.slots.map((slot) => ({ slotKey: slot.slotKey, utmContent: postLinkKey(slot.scheduledAt, now) }));
  const unique = [...new Set(keys.map((key) => key.utmContent))];
  if (!unique.length) return new Map();

  const result = await createManagementSocialPostLinks(config, {
    eventShortCode,
    posts: unique.map((utmContent) => ({ utmContent, name: `CheersAI Facebook ${utmContent}` })),
  });
  const urls = new Map(result.variants.map((variant) => [variant.utmContent, variant.shortUrl]));
  const links = new Map<string, string>();
  for (const { slotKey, utmContent } of keys) {
    const url = urls.get(utmContent);
    if (!url) throw new Error(`no link came back for ${utmContent}`);
    links.set(slotKey, url);
  }
  return links;
}

/** The brand's events-system connection, or null when it has none or it is switched off. */
export async function loadManagementConfig(db: SupabaseClient, accountId: string): Promise<ManagementApiConfig | null> {
  const { data, error } = await db
    .from('management_app_connections')
    .select('base_url, api_key, enabled')
    .eq('account_id', accountId)
    .maybeSingle<{ base_url: string | null; api_key: string | null; enabled: boolean | null }>();
  if (error) throw new Error(`the events-system connection could not be read: ${error.message}`);
  const baseUrl = data?.base_url?.trim();
  const apiKey = data?.api_key?.trim();
  return data?.enabled && baseUrl && apiKey ? { baseUrl, apiKey } : null;
}
