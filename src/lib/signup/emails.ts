import { escapeHtml, type RenderedEmail } from '@/lib/auth/email-links';
import { formatUkDateTime } from '@/lib/utils/date';

/**
 * Emails for the self-serve sign-up request (tasks/SPEC-self-serve-signup.md
 * §4.2). An invited member who never accepted gets the normal member invite
 * (renderInviteEmail in src/lib/auth/email-links.ts) instead.
 *
 * Nothing a stranger typed goes into these emails: no name, no venue. Only
 * links we built and our own contact address.
 */

/** A new sign-up, or an earlier one that was never confirmed: the confirmation link. */
export function renderSignupConfirmEmail(options: { link: string; signupUrl: string }): RenderedEmail {
  if (!options.link) throw new Error('Sign-up email needs a link.');
  if (!options.signupUrl) throw new Error('Sign-up email needs the sign-up page address.');
  return {
    subject: 'Confirm your email to start your Cheers trial',
    html: `
<p>Hi,</p>
<p>Thanks for asking to try Cheers by Orange Jelly, the social media tool for hospitality venues.</p>
<p><a href="${escapeHtml(options.link)}">Confirm your email</a></p>
<p>You will then set up your venue and your password, and start your free trial.</p>
<p>This link works once and expires in 24 hours. If it has expired, ask for a new one at <a href="${escapeHtml(options.signupUrl)}">${escapeHtml(options.signupUrl)}</a>.</p>
<p>If you did not ask to sign up, you can ignore this email. Sign-ups that are not confirmed are deleted after 7 days.</p>
<p>Cheers by Orange Jelly</p>
`.trim(),
  };
}

/** Someone asked to sign up with an email that already has a confirmed Cheers login. */
export function renderExistingLoginEmail(options: { loginUrl: string; resetUrl: string; contactEmail: string }): RenderedEmail {
  if (!options.loginUrl) throw new Error('Existing-login email needs a sign-in link.');
  if (!options.resetUrl) throw new Error('Existing-login email needs a reset link.');
  if (!options.contactEmail) throw new Error('Existing-login email needs a contact address.');
  const contact = escapeHtml(options.contactEmail);
  return {
    subject: 'You already have a Cheers login',
    html: `
<p>Hi,</p>
<p>Someone asked to sign up to Cheers with this email address, but it already has a Cheers login.</p>
<p><a href="${escapeHtml(options.loginUrl)}">Sign in to Cheers</a></p>
<p>Forgotten your password? <a href="${escapeHtml(options.resetUrl)}">Choose a new one</a>.</p>
<p>To add another venue, email <a href="mailto:${contact}">${contact}</a>. Replies to this email are not read.</p>
<p>If you did not ask to sign up, you can ignore this email. Nothing has changed.</p>
<p>Cheers by Orange Jelly</p>
`.trim(),
  };
}

/**
 * The operator's "new venue" email (spec §4.9): venue name, type, sign-up
 * email and time, to OPERATOR_ALERT_EMAIL only. The venue name is the one
 * thing a stranger typed; it has passed the venue-name rule (no links, no
 * email addresses, no control characters) and is escaped here. It stays out
 * of the subject line.
 */
export function renderNewVenueOperatorEmail(options: {
  venueName: string;
  venueTypeLabel: string;
  signupEmail: string;
  createdAt: Date;
  accountId: string;
  adminUrl: string;
}): RenderedEmail {
  if (!options.venueName.trim()) throw new Error('New-venue email needs the venue name.');
  if (!options.venueTypeLabel.trim()) throw new Error('New-venue email needs the venue type.');
  if (!options.signupEmail.trim()) throw new Error('New-venue email needs the sign-up email.');
  if (!options.accountId.trim()) throw new Error('New-venue email needs the brand id.');
  if (!options.adminUrl) throw new Error('New-venue email needs the admin link.');
  const createdAt = formatUkDateTime(options.createdAt);
  if (!createdAt) throw new Error('New-venue email needs a valid time.');
  return {
    subject: '[Cheers operator] New self-serve venue',
    html: `
<p>A new venue signed up to Cheers on its own.</p>
<ul>
<li>Venue: <strong>${escapeHtml(options.venueName)}</strong></li>
<li>Type: ${escapeHtml(options.venueTypeLabel)}</li>
<li>Sign-up email: ${escapeHtml(options.signupEmail)}</li>
<li>Created: ${escapeHtml(createdAt)} (UK time)</li>
<li>Brand id: ${escapeHtml(options.accountId)}</li>
</ul>
<p>The owner is on the Billing page next, to start the free trial through Stripe Checkout. Until the trial starts the brand is not paid for. See it in <a href="${escapeHtml(options.adminUrl)}">Admin</a>.</p>
`.trim(),
  };
}
