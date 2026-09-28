import type { SupabaseClient } from '@supabase/supabase-js';

import { env } from '@/env';
import { logAdminEvent } from '@/lib/admin/audit';
import { sendEmail } from '@/lib/email/resend';

/**
 * Operator alerts: tell us (not the customer) when a brand keeps failing to
 * publish, so a paying customer's broken publishing is noticed even if they
 * have turned failure emails off or are not reading them.
 *
 * Deduplicated through admin_audit (operator-only, never shown to customers):
 * at most one alert per brand per rolling 24 hours.
 */
export const REPEATED_FAILURE_THRESHOLD = 3;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const ALERT_ACTION = 'operator_publish_failure_alert';

export interface OperatorAlertResult {
  alerted: string[];
  skipped: string[];
}

export async function alertRepeatedPublishFailures(
  service: SupabaseClient,
  now: Date = new Date(),
): Promise<OperatorAlertResult> {
  const cutoff = new Date(now.getTime() - WINDOW_MS).toISOString();

  const { data: failedJobs, error: jobsError } = await service
    .from('publish_jobs')
    .select('content_item_id')
    .eq('status', 'failed')
    .gt('updated_at', cutoff)
    .returns<Array<{ content_item_id: string }>>();
  if (jobsError) throw new Error(`publish_jobs lookup failed: ${jobsError.message}`);

  const contentIds = [...new Set((failedJobs ?? []).map((job) => job.content_item_id))];
  if (contentIds.length === 0) return { alerted: [], skipped: [] };

  const { data: items, error: itemsError } = await service
    .from('content_items')
    .select('id, account_id')
    .in('id', contentIds)
    .returns<Array<{ id: string; account_id: string }>>();
  if (itemsError) throw new Error(`content_items lookup failed: ${itemsError.message}`);

  const accountByContent = new Map((items ?? []).map((item) => [item.id, item.account_id]));
  const failuresByAccount = new Map<string, number>();
  for (const job of failedJobs ?? []) {
    const accountId = accountByContent.get(job.content_item_id);
    if (accountId) failuresByAccount.set(accountId, (failuresByAccount.get(accountId) ?? 0) + 1);
  }

  const result: OperatorAlertResult = { alerted: [], skipped: [] };
  for (const [accountId, failures] of failuresByAccount) {
    if (failures < REPEATED_FAILURE_THRESHOLD) continue;

    const { data: recentAlert, error: auditError } = await service
      .from('admin_audit')
      .select('id')
      .eq('action', ALERT_ACTION)
      .eq('target_account_id', accountId)
      .gt('created_at', cutoff)
      .limit(1)
      .maybeSingle();
    if (auditError) throw new Error(`admin_audit lookup failed: ${auditError.message}`);
    if (recentAlert) {
      result.skipped.push(accountId);
      continue;
    }

    const { data: account } = await service
      .from('accounts')
      .select('business_name')
      .eq('id', accountId)
      .maybeSingle<{ business_name: string | null }>();
    const brandName = account?.business_name ?? accountId;

    const to = env.server.OPERATOR_ALERT_EMAIL;
    if (!to) throw new Error('OPERATOR_ALERT_EMAIL is not set; cannot send operator alert.');

    await sendEmail({
      to,
      subject: `[Cheers operator] ${brandName}: ${failures} failed posts in 24 hours`,
      html: `
<p>${escapeHtml(brandName)} has had <strong>${failures}</strong> posts fail to publish in the last 24 hours.</p>
<p>Brand id: ${escapeHtml(accountId)}</p>
<p>Check the brand's connections and planner. You will not get another alert for this brand for 24 hours.</p>
`.trim(),
      required: true,
    });

    await logAdminEvent({
      actorUserId: null,
      action: ALERT_ACTION,
      targetAccountId: accountId,
      detail: { failures, windowHours: 24 },
    });
    result.alerted.push(accountId);
  }

  return result;
}

const STRIPE_WEBHOOK_ALERT_ACTION = 'operator_stripe_webhook_alert';
const STRIPE_INVOICE_ALERT_ACTION = 'operator_stripe_invoice_alert';
const STRIPE_DOUBLE_BILLING_ALERT_ACTION = 'operator_stripe_double_billing_alert';
const STRIPE_TRIAL_CARD_ALERT_ACTION = 'operator_stripe_trial_card_alert';

type StripeAlertAction =
  | typeof STRIPE_WEBHOOK_ALERT_ACTION
  | typeof STRIPE_INVOICE_ALERT_ACTION
  | typeof STRIPE_DOUBLE_BILLING_ALERT_ACTION
  | typeof STRIPE_TRIAL_CARD_ALERT_ACTION;

/**
 * True when this kind of alert went out in the last 24 hours for this brand,
 * or (accountId null) for an unknown customer. Each brand has its own bucket,
 * so one brand's failures never hide another's.
 */
async function alertedRecently(
  service: SupabaseClient,
  action: StripeAlertAction,
  accountId: string | null,
  cutoff: string,
): Promise<boolean> {
  const base = service.from('admin_audit').select('id').eq('action', action).gt('created_at', cutoff);
  const scoped = accountId ? base.eq('target_account_id', accountId) : base.is('target_account_id', null);
  const { data, error } = await scoped.limit(1).maybeSingle();
  if (error) throw new Error(`admin_audit lookup failed: ${error.message}`);
  return Boolean(data);
}

/** Email the operator at most once per brand per rolling 24 hours for this kind of alert, and record it. */
async function sendStripeAlert(
  service: SupabaseClient,
  alert: { action: StripeAlertAction; accountId: string | null; subject: string; html: string; detail: Record<string, unknown> },
  now: Date,
): Promise<'sent' | 'skipped'> {
  const cutoff = new Date(now.getTime() - WINDOW_MS).toISOString();
  if (await alertedRecently(service, alert.action, alert.accountId, cutoff)) return 'skipped';

  const to = env.server.OPERATOR_ALERT_EMAIL;
  if (!to) throw new Error('OPERATOR_ALERT_EMAIL is not set; cannot send operator alert.');

  await sendEmail({ to, subject: alert.subject, html: alert.html, required: true });
  await logAdminEvent({ actorUserId: null, action: alert.action, targetAccountId: alert.accountId, detail: alert.detail });
  return 'sent';
}

/**
 * Tell the operator a Stripe webhook event failed to process (Stripe retries
 * it for up to three days). At most one email per brand per rolling 24 hours
 * (unknown customers share one bucket), so a failing event retried many times
 * does not flood the inbox; every failure is still logged and kept on its
 * stripe_events row.
 */
export async function alertStripeWebhookFailure(
  service: SupabaseClient,
  details: { eventId: string; eventType: string; message: string; accountId: string | null },
  now: Date = new Date(),
): Promise<'sent' | 'skipped'> {
  return sendStripeAlert(
    service,
    {
      action: STRIPE_WEBHOOK_ALERT_ACTION,
      accountId: details.accountId,
      subject: `[Cheers operator] Stripe webhook failing: ${details.eventType}`,
      html: `
<p>A Stripe event could not be processed. Stripe will keep retrying it.</p>
<p>Event: ${escapeHtml(details.eventId)} (${escapeHtml(details.eventType)})</p>
<p>Brand id: ${escapeHtml(details.accountId ?? 'unknown')}</p>
<p>Error: ${escapeHtml(details.message.slice(0, 500))}</p>
<p>Check stripe_events rows with an error, then use "Re-sync from Stripe" on the admin page for the brand. You will not get another alert like this for this brand for 24 hours.</p>
`.trim(),
      detail: { eventId: details.eventId, eventType: details.eventType },
    },
    now,
  );
}

/**
 * Tell the operator Stripe could not finalise a CheersAI customer's invoice
 * (usually a tax or address problem), so nothing is charged until it is fixed
 * in Stripe. At most one email per brand per rolling 24 hours.
 */
export async function alertStripeInvoiceFinalizationFailed(
  service: SupabaseClient,
  details: { eventId: string; invoiceId: string | null; customerId: string | null; accountId: string; reason: string | null },
  now: Date = new Date(),
): Promise<'sent' | 'skipped'> {
  return sendStripeAlert(
    service,
    {
      action: STRIPE_INVOICE_ALERT_ACTION,
      accountId: details.accountId,
      subject: '[Cheers operator] Stripe could not finalise a Cheers invoice',
      html: `
<p>Stripe could not finalise an invoice for a Cheers brand, so it has not been charged.</p>
<p>Invoice: ${escapeHtml(details.invoiceId ?? 'unknown')}</p>
<p>Customer: ${escapeHtml(details.customerId ?? 'unknown')}</p>
<p>Brand id: ${escapeHtml(details.accountId)}</p>
<p>Reason from Stripe: ${escapeHtml((details.reason ?? 'not given').slice(0, 500))}</p>
<p>Open the invoice in the Stripe dashboard, fix the cause (often the customer's address or tax details), then finalise it. You will not get another alert like this for this brand for 24 hours.</p>
`.trim(),
      detail: { eventId: details.eventId, invoiceId: details.invoiceId },
    },
    now,
  );
}

/**
 * Tell the operator a brand's Stripe customer has more than one live CheersAI
 * subscription, which may mean it is being billed twice. At most one email per
 * brand per rolling 24 hours.
 */
export async function alertPossibleDoubleBilling(
  service: SupabaseClient,
  details: { accountId: string; customerId: string; subscriptionIds: string[] },
  now: Date = new Date(),
): Promise<'sent' | 'skipped'> {
  return sendStripeAlert(
    service,
    {
      action: STRIPE_DOUBLE_BILLING_ALERT_ACTION,
      accountId: details.accountId,
      subject: '[Cheers operator] Possible double billing: a brand has more than one live subscription',
      html: `
<p>A Cheers brand has more than one live subscription in Stripe, so it may be billed twice.</p>
<p>Brand id: ${escapeHtml(details.accountId)}</p>
<p>Customer: ${escapeHtml(details.customerId)}</p>
<p>Subscriptions: ${details.subscriptionIds.map(escapeHtml).join(', ')}</p>
<p>Cancel the extra subscription in Stripe (refund if it has charged), then use "Re-sync from Stripe" on the admin page. You will not get another alert like this for this brand for 24 hours.</p>
`.trim(),
      detail: { customerId: details.customerId, subscriptionIds: details.subscriptionIds },
    },
    now,
  );
}

/**
 * Repeat free-trial check (SPEC-self-serve-signup §4.7): a trial refused for a
 * repeat card is not finished (not yet marked cancelled) and Stripe no longer
 * lists it on the brand's customer (moved or deleted), so the code cannot
 * tell whether it still runs. At most one email per brand per rolling 24
 * hours. Ids only: no card details, no names beyond the brand id.
 */
export async function alertRefusedTrialNotOnCustomer(
  service: SupabaseClient,
  details: { accountId: string; customerId: string; subscriptionId: string },
  now: Date = new Date(),
): Promise<'sent' | 'skipped'> {
  return sendStripeAlert(
    service,
    {
      action: STRIPE_TRIAL_CARD_ALERT_ACTION,
      accountId: details.accountId,
      subject: '[Cheers operator] A refused free trial is no longer on its Stripe customer',
      html: `
<p>A free trial refused because its card had a Cheers trial before has not been finished, and Stripe no longer lists it on the brand's customer (it was moved to another customer or deleted), so Cheers cannot tell whether it still runs.</p>
<p>Brand id: ${escapeHtml(details.accountId)}</p>
<p>Customer: ${escapeHtml(details.customerId)}</p>
<p>Subscription: ${escapeHtml(details.subscriptionId)}</p>
<p>Find the subscription in Stripe and cancel it if it is still running (nothing should have been charged while it was a trial), then set cancelled_at on its trial_card_checks row. You will not get another alert like this for this brand for 24 hours.</p>
`.trim(),
      detail: { customerId: details.customerId, subscriptionId: details.subscriptionId },
    },
    now,
  );
}

/**
 * Repeat free-trial check (SPEC-self-serve-signup §4.7, P5): a new trial was
 * started with a card that has already had a Cheers trial, so it was cancelled
 * at once with nothing charged. One email per refused subscription (not
 * deduplicated: each is a separate decision). No card details at all: not the
 * card brand, last four digits, fingerprint or its code.
 */
export async function alertTrialRefusedRepeatCard(details: {
  accountId: string;
  brandName: string | null;
  subscriptionId: string;
  customerId: string;
}): Promise<void> {
  const to = env.server.OPERATOR_ALERT_EMAIL;
  if (!to) throw new Error('OPERATOR_ALERT_EMAIL is not set; cannot send operator alert.');
  const brand = details.brandName?.trim() || details.accountId;
  await sendEmail({
    to,
    subject: `[Cheers operator] Free trial refused for ${brand}: card already used for a trial`,
    html: `
<p>${escapeHtml(brand)} started a free trial with a card that has already had a Cheers free trial, so the trial was cancelled straight away. Nothing was charged.</p>
<p>Brand id: ${escapeHtml(details.accountId)}</p>
<p>Stripe subscription: ${escapeHtml(details.subscriptionId)} (cancelled)</p>
<p>Stripe customer: ${escapeHtml(details.customerId)}</p>
<p>The owner now sees "This card has already been used for a Cheers free trial" on Billing and can start a paid plan straight away. Nothing to do unless they contact you. Recorded in admin_audit as trial_refused_repeat_card.</p>
`.trim(),
    required: true,
  });
}

/**
 * Repeat free-trial check (SPEC-self-serve-signup §4.7 step 5): a new trial's
 * subscription has no card to check (for example a wallet or Link payment
 * method with no card fingerprint), so the check could not run and the trial
 * carries on. One email per such subscription.
 */
export async function alertTrialStartedWithoutCard(details: {
  accountId: string;
  brandName: string | null;
  subscriptionId: string;
  customerId: string;
}): Promise<void> {
  const to = env.server.OPERATOR_ALERT_EMAIL;
  if (!to) throw new Error('OPERATOR_ALERT_EMAIL is not set; cannot send operator alert.');
  const brand = details.brandName?.trim() || details.accountId;
  await sendEmail({
    to,
    subject: `[Cheers operator] Free trial started with no card to check: ${brand}`,
    html: `
<p>${escapeHtml(brand)} started a free trial, but its Stripe subscription has no card payment method, so the one-trial-per-card check could not run. The trial carries on.</p>
<p>Brand id: ${escapeHtml(details.accountId)}</p>
<p>Stripe subscription: ${escapeHtml(details.subscriptionId)}</p>
<p>Stripe customer: ${escapeHtml(details.customerId)}</p>
<p>Look at the subscription's payment method in Stripe. If this business has had a Cheers trial before, decide whether to cancel the trial there by hand.</p>
`.trim(),
    required: true,
  });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
