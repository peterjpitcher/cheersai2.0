import { NextResponse } from 'next/server';
import { z } from 'zod';

import { forwardBookingConversionToMetaCapi } from '@/lib/meta/conversions-api';
import { validateSecret } from '@/lib/security/signing';
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
  gclid: z.string().trim().max(500).optional().nullable(),
  shortCode: z.string().trim().max(120).optional().nullable(),
  attributionCapturedAt: z.string().trim().max(40).optional().nullable(),
  attributionUpdatedAt: z.string().trim().max(40).optional().nullable(),
  metaConsentGranted: z.boolean().optional().nullable(),
  fbp: z.string().trim().max(500).optional().nullable(),
  fbc: z.string().trim().max(500).optional().nullable(),
  clientUserAgent: z.string().trim().max(500).optional().nullable(),
  // Advanced matching: SHA-256 hex digests only — raw email/phone are rejected.
  emailSha256: z.string().trim().regex(/^[0-9a-fA-F]{64}$/).optional().nullable(),
  phoneSha256: z.string().trim().regex(/^[0-9a-fA-F]{64}$/).optional().nullable(),
  clientIpAddress: z.string().trim().max(45).optional().nullable(),
  occurredAt: z.string().datetime().optional().nullable(),
});

function jsonNoStore(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      ...(init?.headers ?? {}),
    },
  });
}

function normaliseAuthHeader(value: string | null) {
  if (!value) return '';
  return value.replace(/^Bearer\s+/i, '').trim();
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

function normaliseDateTime(value: string | null | undefined) {
  const trimmed = nullIfEmpty(value);
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export async function POST(request: Request) {
  const suppliedSecret = normaliseAuthHeader(request.headers.get('authorization'));
  if (!suppliedSecret) {
    return jsonNoStore({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceSupabaseClient();

  // Resolve the target brand from the supplied ingest secret (no free-form
  // account id is ever trusted from the caller).
  let accountId: string | null = null;

  // 1. Legacy single-brand env path (constant-time), kept for the original
  //    brand's existing integration. Optional -- absent in per-brand-only setups.
  const legacySecret = process.env.BOOKING_CONVERSION_INGEST_SECRET;
  const legacyAccountId = process.env.BOOKING_CONVERSION_ACCOUNT_ID;
  if (legacySecret && legacyAccountId && validateSecret(suppliedSecret, legacySecret)) {
    accountId = legacyAccountId;
  }

  // 2. Per-brand ingest key -> the owning brand.
  if (!accountId) {
    const { data: brand } = await supabase
      .from('accounts')
      .select('id')
      .eq('booking_ingest_secret', suppliedSecret)
      .maybeSingle<{ id: string }>();
    if (brand) accountId = brand.id;
  }

  if (!accountId) {
    return jsonNoStore({ error: 'Unauthorized' }, { status: 401 });
  }

  let parsedPayload: z.infer<typeof payloadSchema>;
  try {
    parsedPayload = payloadSchema.parse(await request.json());
  } catch {
    return jsonNoStore({ error: 'Invalid booking conversion payload.' }, { status: 400 });
  }
  const metaEventId = nullIfEmpty(parsedPayload.metaEventId) ?? parsedPayload.bookingId;

  // Keep occurredAt inside Meta's ~7-day CAPI acceptance window. A future timestamp is bad data
  // (reject it); a stale one is clamped so the event stays deliverable and the retry cron (which
  // only re-sends rows newer than ~6.5 days) can still heal it instead of leaving it stuck.
  const nowMs = Date.now();
  const providedMs = parsedPayload.occurredAt ? Date.parse(parsedPayload.occurredAt) : nowMs;
  if (Number.isFinite(providedMs) && providedMs > nowMs + 5 * 60 * 1000) {
    return jsonNoStore({ error: 'occurredAt cannot be in the future.' }, { status: 400 });
  }
  const MAX_OCCURRED_AGE_MS = 6.5 * 24 * 60 * 60 * 1000;
  const occurredAtMs = Number.isFinite(providedMs) ? Math.max(providedMs, nowMs - MAX_OCCURRED_AGE_MS) : nowMs;
  const occurredAt = new Date(occurredAtMs).toISOString();
  const hasMetaConsent = parsedPayload.metaConsentGranted === true;
  const emailSha256 = hasMetaConsent ? nullIfEmpty(parsedPayload.emailSha256)?.toLowerCase() ?? null : null;
  const phoneSha256 = hasMetaConsent ? nullIfEmpty(parsedPayload.phoneSha256)?.toLowerCase() ?? null : null;
  const clientIpAddress = hasMetaConsent ? nullIfEmpty(parsedPayload.clientIpAddress) : null;

  const { error } = await supabase
    .from('booking_conversion_events')
    .upsert({
      account_id: accountId,
      source_site: parsedPayload.sourceSite?.trim() || 'the-anchor.pub',
      booking_id: parsedPayload.bookingId,
      meta_event_id: metaEventId,
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
      gclid: nullIfEmpty(parsedPayload.gclid),
      short_code: nullIfEmpty(parsedPayload.shortCode),
      attribution_captured_at: normaliseDateTime(parsedPayload.attributionCapturedAt),
      attribution_updated_at: normaliseDateTime(parsedPayload.attributionUpdatedAt),
      meta_consent_granted: hasMetaConsent,
      fbp: hasMetaConsent ? nullIfEmpty(parsedPayload.fbp) : null,
      fbc: hasMetaConsent ? nullIfEmpty(parsedPayload.fbc) : null,
      client_user_agent: hasMetaConsent ? nullIfEmpty(parsedPayload.clientUserAgent) : null,
      // Advanced-matching columns only exist once the match-key migration has been
      // applied; omit them entirely until the sender actually supplies values so the
      // insert stays compatible with the pre-migration schema.
      ...(emailSha256 ? { email_sha256: emailSha256 } : {}),
      ...(phoneSha256 ? { phone_sha256: phoneSha256 } : {}),
      ...(clientIpAddress ? { client_ip_address: clientIpAddress } : {}),
      occurred_at: occurredAt,
    }, {
      onConflict: 'account_id,booking_id',
    });

  if (error) {
    console.error('[booking-conversions] Failed to store conversion', error);
    return jsonNoStore({ error: 'Could not store booking conversion.' }, { status: 500 });
  }

  if (!hasMetaConsent) {
    // Mark why this event will never be forwarded, but never downgrade a row that
    // already recorded a successful send (idempotent re-posts can change consent).
    const { error: skipError } = await supabase
      .from('booking_conversion_events')
      .update({ capi_status: 'skipped', capi_error: 'no_consent', capi_event_id: metaEventId })
      .eq('account_id', accountId)
      .eq('booking_id', parsedPayload.bookingId)
      .is('capi_status', null);
    if (skipError) {
      console.error('[booking-conversions] Failed to record no-consent skip', skipError);
    }
  }

  if (hasMetaConsent) {
    const capiResult = await forwardBookingConversionToMetaCapi({
      supabase,
      accountId,
      conversion: {
        bookingId: parsedPayload.bookingId,
        metaEventId,
        bookingType: parsedPayload.bookingType,
        eventName: parsedPayload.eventName,
        eventCategoryName: parsedPayload.eventCategoryName,
        tickets: parsedPayload.tickets,
        value: parsedPayload.value,
        currency: parsedPayload.currency,
        sourceUrl: parsedPayload.sourceUrl,
        occurredAt,
        metaConsentGranted: hasMetaConsent,
        fbp: parsedPayload.fbp,
        fbc: parsedPayload.fbc,
        clientUserAgent: parsedPayload.clientUserAgent,
        emailSha256,
        phoneSha256,
        clientIpAddress,
      },
    });

    try {
      await supabase
        .from('booking_conversion_events')
        .update({
          capi_status: capiResult.status,
          capi_event_id: capiResult.status === 'sent' || capiResult.status === 'failed'
            ? capiResult.eventId
            : metaEventId,
          capi_sent_at: capiResult.status === 'sent' ? new Date().toISOString() : null,
          capi_error: capiResult.status === 'failed'
            ? capiResult.error
            : capiResult.status === 'skipped'
              ? capiResult.reason
              : null,
        })
        .eq('account_id', accountId)
        .eq('booking_id', parsedPayload.bookingId)
        // Never regress a row a concurrent retry already marked 'sent'. A freshly upserted row
        // has capi_status NULL, so match NULL-or-not-sent (a bare .neq would skip NULL rows).
        .or('capi_status.is.null,capi_status.neq.sent');
    } catch (statusError) {
      console.error('[booking-conversions] Failed to update CAPI status', statusError);
    }
  }

  return jsonNoStore({ success: true });
}
