/**
 * Helpers for the links we put in auth emails (invites and password resets).
 *
 * We send these emails ourselves through Resend rather than relying on the
 * Supabase email templates, so the link format is owned here and does not
 * depend on dashboard configuration. `/auth/confirm` verifies the token hash.
 */

export type AuthEmailLinkType = 'invite' | 'recovery';

export const SET_PASSWORD_PATH = '/auth/set-password';

/**
 * Accept only same-origin relative paths for post-auth redirects.
 * Rejects absolute URLs, protocol-relative `//host` and backslash tricks.
 */
export function safeNextPath(next: string | null | undefined, fallback: string): string {
  if (!next) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
  return next;
}

export function buildAuthConfirmUrl(options: {
  siteUrl: string;
  tokenHash: string;
  type: AuthEmailLinkType;
  next?: string;
}): string {
  if (!options.tokenHash) {
    throw new Error('Cannot build an auth link without a token.');
  }
  const url = new URL('/auth/confirm', options.siteUrl);
  url.searchParams.set('token_hash', options.tokenHash);
  url.searchParams.set('type', options.type);
  url.searchParams.set('next', options.next ?? SET_PASSWORD_PATH);
  return url.toString();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface RenderedEmail {
  subject: string;
  html: string;
}

export function renderInviteEmail(options: { link: string; brandNames: string[] }): RenderedEmail {
  if (!options.link) throw new Error('Invite email needs a link.');
  const brands = options.brandNames.filter((name) => name.trim().length > 0);
  const brandLine = brands.length
    ? `<p>You have been given access to <strong>${brands.map(escapeHtml).join(', ')}</strong>.</p>`
    : '';
  return {
    subject: "You're invited to CheersAI",
    html: `
<p>Hi,</p>
<p>You've been invited to CheersAI, the social media tool for hospitality venues.</p>
${brandLine}
<p><a href="${escapeHtml(options.link)}">Accept the invite and set your password</a></p>
<p>This link works once and expires in 24 hours. If it has expired, ask the person who invited you to send a new one.</p>
<p>CheersAI</p>
`.trim(),
  };
}

/** For someone who already has a CheersAI login and has been given access to another brand. */
export function renderAddedToBrandEmail(options: { loginUrl: string; brandName: string }): RenderedEmail {
  if (!options.loginUrl) throw new Error('Added-to-brand email needs a login link.');
  const brand = options.brandName.trim() || 'a brand';
  return {
    subject: `You now have access to ${brand} on CheersAI`,
    html: `
<p>Hi,</p>
<p>You've been given access to <strong>${escapeHtml(brand)}</strong> on CheersAI.</p>
<p><a href="${escapeHtml(options.loginUrl)}">Sign in to CheersAI</a>, then pick ${escapeHtml(brand)} from the brand switcher.</p>
<p>CheersAI</p>
`.trim(),
  };
}

export function renderPasswordResetEmail(options: { link: string }): RenderedEmail {
  if (!options.link) throw new Error('Password reset email needs a link.');
  return {
    subject: 'Reset your CheersAI password',
    html: `
<p>Hi,</p>
<p>We received a request to reset your CheersAI password.</p>
<p><a href="${escapeHtml(options.link)}">Choose a new password</a></p>
<p>This link works once and expires in 24 hours. If you did not ask for this, you can ignore this email and your password will not change.</p>
<p>CheersAI</p>
`.trim(),
  };
}
