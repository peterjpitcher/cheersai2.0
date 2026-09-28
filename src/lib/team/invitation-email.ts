import { escapeHtml, type RenderedEmail } from '@/lib/auth/email-links';

/**
 * For someone who already has a Cheers login and has been invited to another
 * brand (spec §4.6). They get access only if they accept, so the email asks
 * them to sign in and choose; it carries no sign-in token.
 */
export function renderTeamInvitationEmail(options: { acceptUrl: string; brandName: string }): RenderedEmail {
  if (!options.acceptUrl) throw new Error('Team invitation email needs a link.');
  const brand = options.brandName.trim() || 'a brand';
  return {
    subject: `You're invited to join ${brand} on Cheers`,
    html: `
<p>Hi,</p>
<p>You've been invited to join <strong>${escapeHtml(brand)}</strong> on Cheers by Orange Jelly, the social media tool for hospitality venues.</p>
<p><a href="${escapeHtml(options.acceptUrl)}">Sign in to accept or decline</a></p>
<p>You only get access if you accept. The invitation expires in 7 days. If you have forgotten your password, use "Forgot password" on the sign-in page.</p>
<p>If you were not expecting this, you can ignore this email.</p>
<p>Cheers by Orange Jelly</p>
`.trim(),
  };
}
