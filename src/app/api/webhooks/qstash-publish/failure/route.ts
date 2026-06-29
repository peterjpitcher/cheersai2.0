/**
 * QStash publish failure callback (PUB-09).
 * Triggered when all QStash retries are exhausted for a publish job.
 * Sends an immediate email alert to the account owner.
 */

import { NextResponse } from 'next/server';
import { verifyQStashSignature } from '@/lib/qstash/client';
import { getPlainEnglishError } from '@/lib/publishing/error-messages';
import { sendEmail } from '@/lib/email/resend';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { ErrorClassification } from '@/lib/providers/errors';
import { env } from '@/env';
import { createLogger } from '@/lib/logging';

export const dynamic = 'force-dynamic';

const logger = createLogger('publish-failure-webhook');

/** Idempotency category for immediate failure notifications */
const NOTIFICATION_CATEGORY = 'publish_failed_immediate';

const PLATFORM_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
};

type PublishJobRow = {
  id: string;
  content_item_id: string;
  platform: string;
  error_message: string | null;
  error_code: string | null;
};

type ContentItemRow = {
  account_id: string;
};

type AccountRow = {
  email: string;
  display_name: string | null;
};

type PostingDefaultsRow = {
  notifications: Record<string, unknown> | null;
};

type NotificationRow = {
  id: string;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function POST(request: Request): Promise<NextResponse> {
  // Clone before verify -- verifyQStashSignature consumes request.text()
  const cloned = request.clone();
  const isValid = await verifyQStashSignature(request);
  if (!isValid) {
    logger.warn('Invalid QStash signature rejected');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const body = await cloned.json();
  const { jobId } = body as { jobId: string };
  if (!jobId) {
    logger.warn('Missing jobId in failure callback payload');
    return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
  }

  const db = createServiceSupabaseClient();

  try {
    // Load publish job
    const { data: job, error: jobError } = await db
      .from('publish_jobs')
      .select('id, content_item_id, platform, error_message, error_code')
      .eq('id', jobId)
      .single<PublishJobRow>();

    if (jobError || !job) {
      logger.warn('Publish job not found for failure callback', { jobId });
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Load content item to get account_id
    const { data: contentItem, error: ciError } = await db
      .from('content_items')
      .select('account_id')
      .eq('id', job.content_item_id)
      .single<ContentItemRow>();

    if (ciError || !contentItem) {
      logger.warn('Content item not found', { contentItemId: job.content_item_id });
      return NextResponse.json({ error: 'Content item not found' }, { status: 404 });
    }

    // Check notification preferences (default true)
    const { data: postingDefaults } = await db
      .from('posting_defaults')
      .select('notifications')
      .eq('account_id', contentItem.account_id)
      .maybeSingle<PostingDefaultsRow>();

    const emailFailures = postingDefaults?.notifications?.emailFailures !== false;

    if (!emailFailures) {
      logger.info('Email notifications disabled for account', { accountId: contentItem.account_id });
      return NextResponse.json({ skipped: true, reason: 'notifications_disabled' });
    }

    // Idempotency check -- skip if we already sent for this job
    const { data: existing } = await db
      .from('notifications')
      .select('id')
      .eq('category', NOTIFICATION_CATEGORY)
      .filter('metadata->>job_id', 'eq', jobId)
      .maybeSingle<NotificationRow>();

    if (existing) {
      logger.info('Failure notification already sent', { jobId });
      return NextResponse.json({ skipped: true, reason: 'already_sent' });
    }

    // Fetch account email
    const { data: account, error: accountError } = await db
      .from('accounts')
      .select('email, display_name')
      .eq('id', contentItem.account_id)
      .single<AccountRow>();

    if (accountError || !account?.email) {
      logger.warn('Account email not found', { accountId: contentItem.account_id });
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    // Build email
    const platformLabel = PLATFORM_LABELS[job.platform] ?? job.platform;
    const plannerUrl = `${env.client.NEXT_PUBLIC_SITE_URL}/planner`;
    const greeting = account.display_name ? `Hi ${account.display_name},` : 'Hi,';

    // Get plain-English explanation if error_code maps to a classification
    let plainEnglishHtml = '';
    if (job.error_code && Object.values(ErrorClassification).includes(job.error_code as ErrorClassification)) {
      const pe = getPlainEnglishError(job.error_code as ErrorClassification);
      plainEnglishHtml = `<p><strong>${escapeHtml(pe.title)}:</strong> ${escapeHtml(pe.description)}</p>`;
    }

    const html = `
<p>${escapeHtml(greeting)}</p>
<p>We were unable to publish your post to <strong>${escapeHtml(platformLabel)}</strong> after multiple attempts.</p>
${job.error_message ? `<p><strong>Error details:</strong><br>${escapeHtml(job.error_message)}</p>` : ''}
${plainEnglishHtml}
<p>
  Please visit your <a href="${plannerUrl}">Planner</a> to review and retry the post.
</p>
<p>If you need help, please contact support.</p>
<p>-- CheersAI</p>
`.trim();

    await sendEmail({
      to: account.email,
      subject: 'Post failed to publish -- action needed',
      html,
    });

    // Record notification for idempotency
    const { error: insertError } = await db.from('notifications').insert({
      account_id: contentItem.account_id,
      category: NOTIFICATION_CATEGORY,
      message: 'Immediate failure email sent',
      metadata: { job_id: jobId },
    });

    if (insertError) {
      logger.error('Failed to insert notification record', new Error(insertError.message), { jobId });
    }

    logger.info('Failure notification sent', { jobId, to: account.email, platform: job.platform });
    return NextResponse.json({ sent: true });
  } catch (err) {
    logger.error('Failure callback error', err instanceof Error ? err : new Error(String(err)), { jobId });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
