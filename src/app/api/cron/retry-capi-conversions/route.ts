import { NextResponse } from 'next/server';

import { forwardBookingConversionToMetaCapi } from '@/lib/meta/conversions-api';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { verifyCronAuth } from '@/lib/security/cron-auth';

export const dynamic = 'force-dynamic';

// Meta CAPI accepts events up to 7 days old; stop retrying a little before that
// so a send never arrives outside the acceptance window.
const RETRY_WINDOW_MS = 156 * 60 * 60 * 1000; // 6.5 days
const RETRY_BATCH_LIMIT = 100;

interface RetryableConversionRow {
  account_id: string;
  booking_id: string;
  meta_event_id: string | null;
  booking_type: 'event' | 'table';
  event_name: string | null;
  event_category_name: string | null;
  tickets: number | null;
  value: number | string | null;
  currency: string | null;
  source_url: string | null;
  occurred_at: string;
  meta_consent_granted: boolean;
  fbp: string | null;
  fbc: string | null;
  client_user_agent: string | null;
  capi_status: string | null;
  capi_error: string | null;
  // Present only once the advanced-matching migration has been applied.
  email_sha256?: string | null;
  phone_sha256?: string | null;
  client_ip_address?: string | null;
}

async function handle(request: Request) {
  const auth = verifyCronAuth(request);
  if (!auth.authorised) {
    return NextResponse.json({ error: auth.errorMessage }, { status: auth.errorStatus ?? 401 });
  }

  const supabase = createServiceSupabaseClient();
  const windowStart = new Date(Date.now() - RETRY_WINDOW_MS).toISOString();

  // select('*') on purpose: naming the advanced-matching columns explicitly would
  // error until their migration is applied, whereas '*' degrades gracefully.
  const { data, error } = await supabase
    .from('booking_conversion_events')
    .select('*')
    .eq('meta_consent_granted', true)
    .or('capi_status.is.null,capi_status.eq.failed,and(capi_status.eq.skipped,capi_error.eq.not_configured)')
    .gte('occurred_at', windowStart)
    .order('occurred_at', { ascending: true })
    .limit(RETRY_BATCH_LIMIT);

  if (error) {
    console.error('[retry-capi-conversions] Failed to load retryable conversions', error);
    return NextResponse.json({ error: 'Could not load retryable conversions.' }, { status: 500 });
  }

  const rows = (data ?? []) as RetryableConversionRow[];
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    const metaEventId = row.meta_event_id?.trim() || row.booking_id;
    // Postgres numerics arrive as strings; a corrupted value must not silently
    // become NaN → 0 in the CAPI payload.
    const numericValue = row.value === null ? null : Number(row.value);
    const result = await forwardBookingConversionToMetaCapi({
      supabase,
      accountId: row.account_id,
      conversion: {
        bookingId: row.booking_id,
        metaEventId,
        bookingType: row.booking_type,
        eventName: row.event_name,
        eventCategoryName: row.event_category_name,
        tickets: row.tickets,
        value: numericValue !== null && Number.isFinite(numericValue) ? numericValue : null,
        currency: row.currency,
        sourceUrl: row.source_url,
        occurredAt: row.occurred_at,
        metaConsentGranted: row.meta_consent_granted,
        fbp: row.fbp,
        fbc: row.fbc,
        clientUserAgent: row.client_user_agent,
        emailSha256: row.email_sha256 ?? null,
        phoneSha256: row.phone_sha256 ?? null,
        clientIpAddress: row.client_ip_address ?? null,
      },
    });

    if (result.status === 'sent') sent++;
    if (result.status === 'failed') failed++;
    if (result.status === 'skipped') skipped++;

    // 'not_configured' skips stay retryable (status untouched) so the row heals as
    // soon as the pixel/CAPI token are configured — within the 7-day window.
    if (result.status === 'skipped' && result.reason === 'not_configured') continue;

    const { error: updateError } = await supabase
      .from('booking_conversion_events')
      .update({
        capi_status: result.status,
        capi_event_id: metaEventId,
        capi_sent_at: result.status === 'sent' ? new Date().toISOString() : null,
        capi_error: result.status === 'failed'
          ? result.error
          : result.status === 'skipped'
            ? result.reason
            : null,
      })
      .eq('account_id', row.account_id)
      .eq('booking_id', row.booking_id);

    if (updateError) {
      console.error(
        `[retry-capi-conversions] Failed to update status for booking ${row.booking_id}`,
        updateError,
      );
    }
  }

  return NextResponse.json({ attempted: rows.length, sent, failed, skipped });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
