const CANONICAL_LOCATION_RESOURCE_PATTERN = /^(?:accounts\/[^/]+\/)?locations\/(\d+)$/;
const ACCOUNT_QUALIFIED_PLACE_ID_PATTERN = /^accounts\/[^/]+\/locations\/(ChI[\w-]+)$/;
const PLACE_ID_PATTERN = /^(?:locations\/)?(ChI[\w-]+)$/;

function getTrimmed(input: string | null | undefined) {
  return typeof input === 'string' ? input.trim() : '';
}

export function normalizeCanonicalGbpLocationId(input: string | null | undefined): string | null {
  const trimmed = getTrimmed(input);
  if (!trimmed) return null;

  const match = trimmed.match(CANONICAL_LOCATION_RESOURCE_PATTERN);
  return match ? `locations/${match[1]}` : null;
}

export function isCanonicalGbpLocationId(input: string | null | undefined): boolean {
  const trimmed = getTrimmed(input);
  return /^locations\/\d+$/.test(trimmed);
}

export function isLikelyGbpPlaceId(input: string | null | undefined): boolean {
  const trimmed = getTrimmed(input);
  return PLACE_ID_PATTERN.test(trimmed) || ACCOUNT_QUALIFIED_PLACE_ID_PATTERN.test(trimmed);
}

export function getGbpLocationIdValidationError(input: string | null | undefined): string | null {
  const trimmed = getTrimmed(input);
  if (!trimmed) return null;
  if (normalizeCanonicalGbpLocationId(trimmed)) return null;
  if (isLikelyGbpPlaceId(trimmed)) {
    return 'Use the numeric Google Business Profile location resource ID (for example `locations/1234567890`), not a Google Place ID such as `ChIJ...`.';
  }
  return 'Use a Google Business Profile location resource ID in the format `locations/1234567890`. Account-qualified values like `accounts/123/locations/1234567890` are also accepted and will be normalized automatically.';
}
