import type { SupabaseClient } from '@supabase/supabase-js';

import { escapeHtml, type RenderedEmail } from '@/lib/auth/email-links';
import { CLOSURE_REPEAT_WINDOW_HOURS, CLOSURE_STEPS, CLOSED_VENUE_KEPT_DAYS } from '@/lib/settings/owner-data';
import { formatUkDateTime } from '@/lib/utils/date';

/**
 * "Ask us to close this venue" (tasks/SPEC-self-serve-signup.md, section 5,
 * "Later (P10)"; decision D5 keeps closing itself with the operator). The
 * request deletes and stops nothing: it emails the operator, records a
 * venue_closure_request row in admin_audit and sends the owner a
 * confirmation. The operator then follows docs/runbooks/customer-offboarding.md.
 */

export const CLOSURE_AUDIT_ACTION = 'venue_closure_request';

/**
 * When this brand last asked to be closed, within the repeat window, or null.
 * Only requests that reached the operator are recorded, so a failed attempt
 * never blocks a retry. Throws on a database error (the caller fails closed).
 */
export async function findRecentClosureRequest(service: SupabaseClient, accountId: string, now: Date): Promise<string | null> {
  const since = new Date(now.getTime() - CLOSURE_REPEAT_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await service
    .from('admin_audit')
    .select('created_at')
    .eq('action', CLOSURE_AUDIT_ACTION)
    .eq('target_account_id', accountId)
    .eq('result', 'success')
    .gt('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ created_at: string }>();
  if (error) throw new Error(`admin_audit lookup failed: ${error.message}`);
  return data?.created_at ?? null;
}

function stepsHtml(): string {
  return `<ol>\n${CLOSURE_STEPS.map((step) => `<li>${escapeHtml(step)}</li>`).join('\n')}\n</ol>`;
}

/**
 * The operator's email. The venue name is the brand's own name (typed by the
 * operator, or by the owner at sign-up, where it passed the venue-name rule);
 * it is escaped and kept out of the subject line.
 */
export function renderClosureRequestOperatorEmail(options: {
  venueName: string;
  accountId: string;
  ownerEmail: string;
  requestedAt: Date;
  adminUrl: string;
}): RenderedEmail {
  if (!options.venueName.trim()) throw new Error('Closure request email needs the venue name.');
  if (!options.accountId.trim()) throw new Error('Closure request email needs the brand id.');
  if (!options.ownerEmail.trim()) throw new Error('Closure request email needs the owner email.');
  if (!options.adminUrl) throw new Error('Closure request email needs the admin link.');
  const requestedAt = formatUkDateTime(options.requestedAt);
  if (!requestedAt) throw new Error('Closure request email needs a valid time.');
  return {
    subject: '[Cheers operator] Request to close a venue',
    html: `
<p>An owner asked to close their venue from Settings. Nothing has been stopped or deleted yet.</p>
<ul>
<li>Venue: <strong>${escapeHtml(options.venueName)}</strong></li>
<li>Brand id: ${escapeHtml(options.accountId)}</li>
<li>Asked by: ${escapeHtml(options.ownerEmail)} (signed in as an owner of this venue)</li>
<li>Asked at: ${escapeHtml(requestedAt)} (UK time)</li>
</ul>
<p>Next, follow docs/runbooks/customer-offboarding.md: reply to the owner to check it was them, cancel the subscription in Stripe, pause any paid ads, send an export if they want one, then offboard in <a href="${escapeHtml(options.adminUrl)}">Admin, Offboarding</a>. The data is deleted ${CLOSED_VENUE_KEPT_DAYS} days after offboarding.</p>
<p>The owner has been sent a confirmation that lists these steps. Another request for this venue within ${CLOSURE_REPEAT_WINDOW_HOURS} hours will not email you again.</p>
`.trim(),
  };
}

/** The owner's confirmation, to the signed-in login's own email address. */
export function renderClosureConfirmationEmail(options: {
  venueName: string;
  requestedAt: Date;
  contactEmail: string;
}): RenderedEmail {
  if (!options.venueName.trim()) throw new Error('Closure confirmation needs the venue name.');
  if (!options.contactEmail.trim()) throw new Error('Closure confirmation needs a contact address.');
  const requestedAt = formatUkDateTime(options.requestedAt);
  if (!requestedAt) throw new Error('Closure confirmation needs a valid time.');
  const contact = escapeHtml(options.contactEmail);
  return {
    subject: 'We have your request to close your venue on Cheers',
    html: `
<p>Hi,</p>
<p>We have your request to close <strong>${escapeHtml(options.venueName)}</strong> on Cheers, sent on ${escapeHtml(requestedAt)} (UK time).</p>
<p>Nothing has changed yet. The venue keeps working until we close it.</p>
<p>What happens next:</p>
${stepsHtml()}
<p>If you did not ask for this, or you change your mind, email <a href="mailto:${contact}">${contact}</a>. Replies to this email are not read.</p>
<p>Cheers by Orange Jelly</p>
`.trim(),
  };
}
