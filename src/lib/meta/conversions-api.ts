import { getMetaGraphApiBase } from '@/lib/meta/graph';
import type { createServiceSupabaseClient } from '@/lib/supabase/service';

type SupabaseClientLike = ReturnType<typeof createServiceSupabaseClient>;

export interface BookingConversionForCapi {
  bookingId: string;
  metaEventId: string;
  bookingType: 'event' | 'table';
  eventName?: string | null;
  eventCategoryName?: string | null;
  tickets?: number | null;
  value?: number | null;
  currency?: string | null;
  sourceUrl?: string | null;
  occurredAt: string;
  metaConsentGranted?: boolean | null;
  fbp?: string | null;
  fbc?: string | null;
  clientUserAgent?: string | null;
  // Advanced matching signals. Email/phone must arrive already SHA-256 hashed
  // (lowercase hex) — raw values are never accepted or stored.
  emailSha256?: string | null;
  phoneSha256?: string | null;
  clientIpAddress?: string | null;
}

export type CapiForwardResult =
  | { status: 'skipped'; reason: 'no_consent' | 'not_configured' | 'missing_match_keys' }
  | { status: 'sent'; eventId: string }
  | { status: 'failed'; eventId: string; error: string };

interface MetaAdAccountCapiRow {
  meta_pixel_id: string | null;
  conversions_api_access_token?: string | null;
}

export async function forwardBookingConversionToMetaCapi(args: {
  supabase: SupabaseClientLike;
  accountId: string;
  conversion: BookingConversionForCapi;
}): Promise<CapiForwardResult> {
  const conversion = args.conversion;
  if (conversion.metaConsentGranted !== true) {
    return { status: 'skipped', reason: 'no_consent' };
  }

  const userData = removeNullish({
    fbp: normaliseSignal(conversion.fbp),
    fbc: normaliseSignal(conversion.fbc),
    client_user_agent: normaliseSignal(conversion.clientUserAgent),
    em: normaliseHashedSignal(conversion.emailSha256),
    ph: normaliseHashedSignal(conversion.phoneSha256),
    client_ip_address: normaliseSignal(conversion.clientIpAddress),
  });

  // client_user_agent alone cannot identify a person; require at least one
  // real match key so Meta does not silently drop the event.
  const hasIdentifyingKey = Boolean(
    userData.fbp || userData.fbc || userData.em || userData.ph || userData.client_ip_address,
  );
  if (!hasIdentifyingKey) {
    return { status: 'skipped', reason: 'missing_match_keys' };
  }

  const { data, error } = await args.supabase
    .from('meta_ad_accounts')
    .select('meta_pixel_id, conversions_api_access_token')
    .eq('account_id', args.accountId)
    .maybeSingle<MetaAdAccountCapiRow>();

  if (error) {
    return { status: 'failed', eventId: conversion.metaEventId, error: error.message };
  }

  const pixelId = data?.meta_pixel_id?.trim();
  const accessToken = data?.conversions_api_access_token?.trim();
  if (!pixelId || !accessToken) {
    return { status: 'skipped', reason: 'not_configured' };
  }

  const eventId = conversion.metaEventId || conversion.bookingId;
  const payload = {
    data: [
      {
        event_name: 'Purchase',
        event_time: Math.floor(new Date(conversion.occurredAt).getTime() / 1000),
        event_id: eventId,
        action_source: 'website',
        event_source_url: normaliseSignal(conversion.sourceUrl),
        user_data: userData,
        custom_data: removeNullish({
          currency: conversion.currency?.trim().toUpperCase() || 'GBP',
          value: typeof conversion.value === 'number' && Number.isFinite(conversion.value)
            ? conversion.value
            : 0,
          order_id: conversion.bookingId,
          content_name: normaliseSignal(conversion.eventName),
          content_category: normaliseSignal(conversion.eventCategoryName),
          content_type: `${conversion.bookingType}_booking`,
          num_items: conversion.tickets ?? undefined,
        }),
      },
    ],
  };

  try {
    const response = await fetch(`${getMetaGraphApiBase()}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;

    if (!response.ok || body?.error) {
      return {
        status: 'failed',
        eventId,
        error: body?.error?.message ?? `Meta CAPI returned ${response.status}`,
      };
    }

    return { status: 'sent', eventId };
  } catch (error) {
    return {
      status: 'failed',
      eventId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function normaliseSignal(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 500) : undefined;
}

// Meta expects advanced-matching values as SHA-256 hex. Anything that is not a
// 64-char hex digest is discarded rather than forwarded malformed.
function normaliseHashedSignal(value: string | null | undefined) {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed || !/^[0-9a-f]{64}$/.test(trimmed)) return undefined;
  return trimmed;
}

function removeNullish<T extends Record<string, unknown>>(input: T) {
  const output = { ...input };
  for (const key of Object.keys(output) as Array<keyof T>) {
    if (output[key] === undefined || output[key] === null || output[key] === '') {
      delete output[key];
    }
  }
  return output;
}
