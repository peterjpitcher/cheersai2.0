import { escapeHtml, type RenderedEmail } from '@/lib/auth/email-links';

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
