import { applyAdUtmContent } from '@/lib/campaigns/ad-attribution';
import { resolveManagementMetaAdVariantShortUrl } from '@/lib/campaigns/management-tracking';

export interface ResolveAdLinkUrlArgs {
  campaignKind: string | null | undefined;
  /** The campaign's main paid link (meta_campaigns.destination_url). */
  destinationUrl: string;
  sourceSnapshot: Record<string, unknown> | null | undefined;
  /** The ad set's food service (food_booking campaigns only). */
  serviceKey?: string | null;
  utmContentKey: string;
}

/**
 * The link an ad's creative points at, so a booking made through it carries the ad's own
 * utm_content key: the food service booking page, else the ad's own management-app short link,
 * else the campaign link with utm_content set. Used by publishing and by optimiser replacements.
 */
export function resolveAdLinkUrl(args: ResolveAdLinkUrlArgs): string {
  return (
    resolveFoodBookingLinkUrl(args) ??
    resolveManagementMetaAdVariantShortUrl(args.sourceSnapshot, args.utmContentKey) ??
    applyAdUtmContent(args.destinationUrl, args.utmContentKey)
  );
}

function resolveFoodBookingLinkUrl(args: ResolveAdLinkUrlArgs): string | null {
  if (args.campaignKind !== 'food_booking' || !args.serviceKey) {
    return null;
  }

  const serviceUrl = serviceBookingUrlsFromSnapshot(args.sourceSnapshot)[args.serviceKey];
  if (!serviceUrl) return null;

  return applyAdUtmContent(serviceUrl, args.utmContentKey);
}

function serviceBookingUrlsFromSnapshot(
  sourceSnapshot: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const value = sourceSnapshot?.serviceBookingUrls;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
    (acc, [key, rawValue]) => {
      const url = stringValue(rawValue);
      if (url) acc[key] = url;
      return acc;
    },
    {},
  );
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
