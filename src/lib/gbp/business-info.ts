import { normalizeCanonicalGbpLocationId } from '@/lib/gbp/location-id';

export const GBP_INFO_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1';

const GBP_ACCOUNT_BASES = [
  GBP_INFO_BASE,
  'https://mybusinessaccountmanagement.googleapis.com/v1',
];
const DEFAULT_RETRY_AFTER_SECONDS = 120;
const quotaCooldownByService = new Map<string, { until: number; detail: string }>();

interface GoogleAccount {
  name?: string;
}

interface GoogleLocation {
  name?: string;
  title?: string;
  metadata?: {
    placeId?: string;
  };
}

interface GoogleErrorShape {
  error?: {
    message?: string;
    status?: string;
    details?: unknown[];
  };
}

export interface ResolvedGoogleLocation {
  locationId: string;
  displayName: string | null;
}

export class GbpRateLimitError extends Error {
  constructor(
    public readonly retryAfterSeconds: number | null,
    public readonly googleDetail: string,
    public readonly serviceKey: string | null = null,
  ) {
    super(`RATE_LIMITED: ${googleDetail}`);
  }
}

export function parseRetryAfter(headers: Headers): number | null {
  const raw = headers.get('Retry-After');
  if (!raw) return null;

  const seconds = parseInt(raw, 10);
  if (!Number.isNaN(seconds) && seconds > 0) {
    return seconds;
  }

  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) {
    return Math.max(1, Math.ceil((date.getTime() - Date.now()) / 1000));
  }

  return null;
}

export function extractGoogleErrorMessage(payload: unknown): string {
  if (typeof payload === 'string') {
    return payload.slice(0, 300);
  }

  if (payload && typeof payload === 'object') {
    const message = (payload as GoogleErrorShape).error?.message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return message;
    }
    try {
      return JSON.stringify(payload).slice(0, 300);
    } catch {
      return 'Google Business Profile API request failed.';
    }
  }

  return 'Google Business Profile API request failed.';
}

function getString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function getServiceKey(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return 'google-business-profile';
  }
}

function scanRetryDelay(value: unknown): number | null {
  if (!value) return null;

  if (typeof value === 'string') {
    const durationMatch = value.match(/(\d+)s/);
    if (durationMatch) {
      return parseInt(durationMatch[1], 10);
    }
    return null;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const parsed = scanRetryDelay(entry);
      if (parsed) return parsed;
    }
    return null;
  }

  if (typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      const parsed = scanRetryDelay(nested);
      if (parsed) return parsed;
    }
  }

  return null;
}

function getGoogleRetryDelay(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null;
  return scanRetryDelay((payload as GoogleErrorShape).error?.details ?? null);
}

function getActiveQuotaError(serviceKey: string): GbpRateLimitError | null {
  const cooldown = quotaCooldownByService.get(serviceKey);
  if (!cooldown) return null;

  if (Date.now() >= cooldown.until) {
    quotaCooldownByService.delete(serviceKey);
    return null;
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((cooldown.until - Date.now()) / 1000));
  return new GbpRateLimitError(retryAfterSeconds, cooldown.detail, serviceKey);
}

function createQuotaError(url: string, response: Response, payload: unknown) {
  const serviceKey = getServiceKey(url);
  const googleDetail = extractGoogleErrorMessage(payload);
  const retryAfterSeconds =
    parseRetryAfter(response.headers) ??
    getGoogleRetryDelay(payload) ??
    DEFAULT_RETRY_AFTER_SECONDS;

  if (retryAfterSeconds) {
    quotaCooldownByService.set(serviceKey, {
      until: Date.now() + retryAfterSeconds * 1000,
      detail: googleDetail,
    });
  }

  return new GbpRateLimitError(retryAfterSeconds, googleDetail, serviceKey);
}

async function fetchGoogleJson(url: string, headers: HeadersInit) {
  const serviceKey = getServiceKey(url);
  const activeCooldown = getActiveQuotaError(serviceKey);
  if (activeCooldown) {
    throw activeCooldown;
  }

  const response = await fetch(url, { headers });
  const text = await response.text();
  let json: unknown = null;

  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }

  if (response.status === 429) {
    throw createQuotaError(url, response, json ?? text);
  }

  return { response, json, text };
}

function selectMatchingLocation(
  locations: GoogleLocation[],
  desiredLocationId: string | null | undefined,
  normalizedDesired: string | null,
) {
  if (!locations.length) return null;

  if (normalizedDesired) {
    const matched = locations.find((location) => normalizeCanonicalGbpLocationId(location.name) === normalizedDesired);
    if (matched) return matched;
    return null;
  }

  if (desiredLocationId) {
    const exactMatch = locations.find((location) => getString(location.name) === desiredLocationId);
    if (exactMatch) return exactMatch;

    const desiredPlaceId = desiredLocationId.replace(/^locations\//, '');
    const placeMatch = locations.find((location) => getString(location.metadata?.placeId) === desiredPlaceId);
    if (placeMatch) return placeMatch;

    return null;
  }

  return locations[0] ?? null;
}

export async function resolveGoogleLocation(
  accessToken: string,
  desiredLocationId?: string | null,
): Promise<ResolvedGoogleLocation> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const normalizedDesired = normalizeCanonicalGbpLocationId(desiredLocationId);
  const lookupTarget = normalizedDesired ?? getString(desiredLocationId);

  if (lookupTarget) {
    const lookupUrl = `${GBP_INFO_BASE}/${lookupTarget}?readMask=name,title`;
    const { response, json, text } = await fetchGoogleJson(lookupUrl, headers);
    if (response.ok) {
      const rawName = getString((json as { name?: unknown } | null)?.name) ?? lookupTarget;
      const canonical = normalizeCanonicalGbpLocationId(rawName);
      if (canonical) {
        return {
          locationId: canonical,
          displayName: getString((json as { title?: unknown } | null)?.title) ?? null,
        };
      }
    } else {
      console.warn('[gbp] direct location lookup failed', response.status, extractGoogleErrorMessage(json ?? text));
    }
  }

  for (const accountBase of GBP_ACCOUNT_BASES) {
    const accountsUrl = `${accountBase}/accounts`;
    const { response: accountsResponse, json: accountsJson, text: accountsText } = await fetchGoogleJson(accountsUrl, headers);
    if (!accountsResponse.ok) {
      console.warn('[gbp] accounts list failed', accountBase, accountsResponse.status, extractGoogleErrorMessage(accountsJson ?? accountsText));
      continue;
    }

    const accounts = Array.isArray((accountsJson as { accounts?: GoogleAccount[] } | null)?.accounts)
      ? ((accountsJson as { accounts: GoogleAccount[] }).accounts ?? [])
      : [];

    for (const account of accounts) {
      const accountName = getString(account.name);
      if (!accountName) continue;

      const locationsUrl = `${GBP_INFO_BASE}/${accountName}/locations?pageSize=100&readMask=name,title,metadata`;
      const { response: locationsResponse, json: locationsJson, text: locationsText } = await fetchGoogleJson(locationsUrl, headers);
      if (!locationsResponse.ok) {
        console.warn('[gbp] locations list failed', accountName, locationsResponse.status, extractGoogleErrorMessage(locationsJson ?? locationsText));
        continue;
      }

      const locations = Array.isArray((locationsJson as { locations?: GoogleLocation[] } | null)?.locations)
        ? ((locationsJson as { locations: GoogleLocation[] }).locations ?? [])
        : [];
      const matched = selectMatchingLocation(locations, desiredLocationId, normalizedDesired);
      if (!matched) {
        continue;
      }

      const canonical = normalizeCanonicalGbpLocationId(matched.name);
      if (!canonical) {
        continue;
      }

      return {
        locationId: canonical,
        displayName: getString(matched.title) ?? null,
      };
    }
  }

  if (desiredLocationId) {
    throw new Error(
      `Could not resolve Google Business Profile location ID "${desiredLocationId}" to a canonical numeric form. Verify the location is still accessible from the connected account.`,
    );
  }

  throw new Error(
    'No Google Business Profile locations were found. Ensure the connected account has at least one verified location.',
  );
}

export async function resolveCanonicalLocationIdViaApi(locationId: string, accessToken: string): Promise<string> {
  const normalized = normalizeCanonicalGbpLocationId(locationId);
  if (normalized) {
    return normalized;
  }

  const resolved = await resolveGoogleLocation(accessToken, locationId);
  return resolved.locationId;
}
