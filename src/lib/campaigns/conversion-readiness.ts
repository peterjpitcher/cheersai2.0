export const BOOKING_CONVERSION_EVENT_NAME = 'Purchase';

export interface ConversionReadinessRow {
  meta_pixel_id?: string | null;
  conversion_event_name?: string | null;
  conversion_optimisation_enabled?: boolean | null;
}

export interface ConversionReadiness {
  enabled: boolean;
  pixelId: string | null;
  eventName: string;
  ready: boolean;
  issues: string[];
}

export function buildConversionReadiness(
  row: ConversionReadinessRow | null | undefined,
): ConversionReadiness {
  const enabled = row?.conversion_optimisation_enabled !== false;
  const pixelId = normalisePixelId(row?.meta_pixel_id);
  const eventName = row?.conversion_event_name?.trim() || BOOKING_CONVERSION_EVENT_NAME;
  const issues: string[] = [];

  if (!enabled) {
    issues.push('Meta conversion optimisation is disabled.');
  }

  if (!pixelId) {
    issues.push('Add the venue Meta pixel ID.');
  }

  if (eventName.toLowerCase() !== BOOKING_CONVERSION_EVENT_NAME.toLowerCase()) {
    issues.push('Set the conversion event to Purchase.');
  }

  return {
    enabled,
    pixelId,
    eventName,
    ready: enabled &&
      Boolean(pixelId) &&
      eventName.toLowerCase() === BOOKING_CONVERSION_EVENT_NAME.toLowerCase(),
    issues,
  };
}

function normalisePixelId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
