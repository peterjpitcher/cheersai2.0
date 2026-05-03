import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createServiceSupabaseClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

const payloadSchema = z.object({
  sourceSite: z.string().trim().max(120).optional(),
  bookingId: z.string().trim().min(1).max(160),
  metaEventId: z.string().trim().max(160).optional().nullable(),
  bookingType: z.enum(['event', 'table']).default('event'),
  eventId: z.string().trim().max(160).optional().nullable(),
  eventSlug: z.string().trim().max(220).optional().nullable(),
  eventName: z.string().trim().max(240).optional().nullable(),
  eventCategoryName: z.string().trim().max(160).optional().nullable(),
  eventCategorySlug: z.string().trim().max(160).optional().nullable(),
  eventDate: z.string().trim().max(32).optional().nullable(),
  tickets: z.number().int().positive().max(100).optional().nullable(),
  value: z.number().min(0).max(100000).optional().nullable(),
  currency: z.string().trim().length(3).optional().nullable(),
  foodIntent: z.string().trim().max(80).optional().nullable(),
  sourceUrl: z.string().trim().max(2000).optional().nullable(),
  landingPath: z.string().trim().max(500).optional().nullable(),
  utmSource: z.string().trim().max(160).optional().nullable(),
  utmMedium: z.string().trim().max(160).optional().nullable(),
  utmCampaign: z.string().trim().max(240).optional().nullable(),
  utmContent: z.string().trim().max(240).optional().nullable(),
  utmTerm: z.string().trim().max(240).optional().nullable(),
  fbclid: z.string().trim().max(500).optional().nullable(),
  occurredAt: z.string().datetime().optional().nullable(),
});

function normaliseAuthHeader(value: string | null) {
  if (!value) return '';
  return value.replace(/^Bearer\s+/i, '').trim();
}

function requiredEnv(key: string) {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is not configured`);
  }
  return value;
}

function nullIfEmpty(value: string | null | undefined) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normaliseDate(value: string | null | undefined) {
  const trimmed = nullIfEmpty(value);
  if (!trimmed) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  return match?.[1] ?? null;
}

export async function POST(request: Request) {
  let secret: string;
  let accountId: string;

  try {
    secret = requiredEnv('BOOKING_CONVERSION_INGEST_SECRET');
    accountId = requiredEnv('BOOKING_CONVERSION_ACCOUNT_ID');
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Booking conversion ingest is not configured.' },
      { status: 500 },
    );
  }

  const suppliedSecret = normaliseAuthHeader(request.headers.get('authorization'));
  if (suppliedSecret !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let parsedPayload: z.infer<typeof payloadSchema>;
  try {
    parsedPayload = payloadSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid booking conversion payload.' }, { status: 400 });
  }

  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from('booking_conversion_events')
    .upsert({
      account_id: accountId,
      source_site: parsedPayload.sourceSite?.trim() || 'the-anchor.pub',
      booking_id: parsedPayload.bookingId,
      meta_event_id: nullIfEmpty(parsedPayload.metaEventId) ?? parsedPayload.bookingId,
      booking_type: parsedPayload.bookingType,
      event_id: nullIfEmpty(parsedPayload.eventId),
      event_slug: nullIfEmpty(parsedPayload.eventSlug),
      event_name: nullIfEmpty(parsedPayload.eventName),
      event_category_name: nullIfEmpty(parsedPayload.eventCategoryName),
      event_category_slug: nullIfEmpty(parsedPayload.eventCategorySlug),
      event_date: normaliseDate(parsedPayload.eventDate),
      tickets: parsedPayload.tickets ?? null,
      value: parsedPayload.value ?? null,
      currency: parsedPayload.currency?.toUpperCase() || 'GBP',
      food_intent: nullIfEmpty(parsedPayload.foodIntent),
      source_url: nullIfEmpty(parsedPayload.sourceUrl),
      landing_path: nullIfEmpty(parsedPayload.landingPath),
      utm_source: nullIfEmpty(parsedPayload.utmSource),
      utm_medium: nullIfEmpty(parsedPayload.utmMedium),
      utm_campaign: nullIfEmpty(parsedPayload.utmCampaign),
      utm_content: nullIfEmpty(parsedPayload.utmContent),
      utm_term: nullIfEmpty(parsedPayload.utmTerm),
      fbclid: nullIfEmpty(parsedPayload.fbclid),
      occurred_at: parsedPayload.occurredAt ?? new Date().toISOString(),
    }, {
      onConflict: 'account_id,booking_id',
    });

  if (error) {
    console.error('[booking-conversions] Failed to store conversion', error);
    return NextResponse.json({ error: 'Could not store booking conversion.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
