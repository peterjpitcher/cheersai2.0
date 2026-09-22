import type { CreativeFormat } from '@/types/campaigns';

const MAX_UTM_CONTENT_LENGTH = 160;

export const CREATIVE_FORMAT_SEQUENCE: CreativeFormat[] = [
  'venue_photo',
  'people_social',
  'offer_graphic',
  'event_detail',
  'short_video',
];

export function normaliseCreativeFormat(value: string | null | undefined, fallbackIndex = 0): CreativeFormat {
  const normalised = value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') ?? '';
  if (isCreativeFormat(normalised)) return normalised;
  return CREATIVE_FORMAT_SEQUENCE[fallbackIndex % CREATIVE_FORMAT_SEQUENCE.length]!;
}

export function buildCreativeVariantKey(args: {
  campaignName: string;
  adSetName: string;
  adName: string;
  angle?: string | null;
  creativeFormat?: string | null;
}) {
  return compactKey([
    args.campaignName,
    args.adSetName,
    args.creativeFormat,
    args.angle,
    args.adName,
  ], 140);
}

export function buildAdUtmContentKey(args: {
  campaignName: string;
  adSetName: string;
  adName: string;
  angle?: string | null;
  creativeFormat?: string | null;
}) {
  return compactKey([
    'ad',
    args.campaignName,
    args.adSetName,
    args.creativeFormat,
    args.angle,
    args.adName,
  ], MAX_UTM_CONTENT_LENGTH);
}

/**
 * Returns `key`, or `key` with a `__2`, `__3`... suffix (trimmed to the length limit) when another
 * ad in the campaign already uses it. Two ads sharing a key would have every booking credited to
 * whichever the optimiser finds first.
 */
export function uniqueAdUtmContentKey(
  key: string,
  takenKeys: Iterable<string | null | undefined>,
): string {
  const taken = new Set(Array.from(takenKeys, normaliseUtmContentKey).filter(Boolean));
  if (!taken.has(normaliseUtmContentKey(key))) return key;

  // Terminates: `taken` is finite, so some suffix is always free.
  for (let suffix = 2; ; suffix += 1) {
    const tail = `__${suffix}`;
    const candidate = `${key.slice(0, MAX_UTM_CONTENT_LENGTH - tail.length).replace(/_+$/g, '')}${tail}`;
    if (!taken.has(normaliseUtmContentKey(candidate))) return candidate;
  }
}

export function applyAdUtmContent(destinationUrl: string, utmContentKey: string): string {
  const parsed = new URL(destinationUrl);
  parsed.searchParams.set('utm_content', utmContentKey);
  return parsed.toString();
}

export function normaliseUtmContentKey(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

export function utmContentMatchesAd(value: string | null | undefined, ad: { utm_content_key?: string | null }) {
  const eventKey = normaliseUtmContentKey(value);
  const adKey = normaliseUtmContentKey(ad.utm_content_key);
  return Boolean(eventKey && adKey && eventKey === adKey);
}

function isCreativeFormat(value: string): value is CreativeFormat {
  return (CREATIVE_FORMAT_SEQUENCE as readonly string[]).includes(value);
}

function compactKey(parts: Array<string | null | undefined>, max: number) {
  const value = parts
    .map((part) => slugPart(part))
    .filter(Boolean)
    .join('__');

  return value.length > max ? value.slice(0, max).replace(/_+$/g, '') : value;
}

function slugPart(value: string | null | undefined) {
  return value
    ?.trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) ?? '';
}
