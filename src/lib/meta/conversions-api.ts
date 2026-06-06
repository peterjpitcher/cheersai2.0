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
  });

  if (Object.keys(userData).length === 0) {
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

function removeNullish<T extends Record<string, unknown>>(input: T) {
  const output = { ...input };
  for (const key of Object.keys(output) as Array<keyof T>) {
    if (output[key] === undefined || output[key] === null || output[key] === '') {
      delete output[key];
    }
  }
  return output;
}
