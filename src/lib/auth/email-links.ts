/**
 * Helpers for the links we put in auth emails (invites, password resets,
 * magic links and self-serve sign-up confirmations).
 *
 * We send every auth email ourselves through Resend rather than relying on the
 * Supabase email templates or its built-in mailer, so the link format is owned
 * here and does not depend on dashboard configuration. `/auth/confirm`
 * verifies the token hash.
 */

/**
 * `signup` is our own name for a self-serve sign-up confirmation. Supabase
 * made its token with generateLink type 'invite' (the login has no password
 * yet), so /auth/confirm verifies it as an invite; the name only picks the
 * page's wording and where the person goes next.
 */
export type AuthEmailLinkType = 'invite' | 'recovery' | 'signup' | 'magiclink';

export const SET_PASSWORD_PATH = '/auth/set-password';

/** Where a signed-in person goes when a link names nowhere safe (a magic link's default). */
export const DEFAULT_SIGNED_IN_PATH = '/dashboard';

/** Where a confirmed self-serve sign-up goes next: naming the venue (spec §4.4). */
export const SIGNUP_VENUE_PATH = '/signup/venue';

/**
 * Accept only same-origin relative paths for post-auth redirects.
 * Rejects absolute URLs, protocol-relative `//host` and backslash tricks.
 * Also rejects control characters: URL parsers strip tabs and newlines, so
 * `/\t/evil.example` would otherwise resolve to `//evil.example`.
 * Safe to call from client components (no server imports).
 */
/** Longer paths are refused: nothing we link to comes close, and it keeps redirect headers small. */
const MAX_NEXT_PATH_LENGTH = 2048;

export function safeNextPath(next: string | null | undefined, fallback: string): string {
  if (!next) return fallback;
  if (next.length > MAX_NEXT_PATH_LENGTH) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  // Belt and braces: resolve it the way a browser would and require that it
  // stays on the same origin, whatever the string checks above missed.
  try {
    const base = 'https://same-origin.invalid';
    if (new URL(next, base).origin !== base) return fallback;
  } catch {
    return fallback;
  }
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
  url.searchParams.set('next', options.next ?? defaultNextPath(options.type));
  return url.toString();
}

/** Where each kind of link goes after the button when the email names no `next`. */
function defaultNextPath(type: AuthEmailLinkType): string {
  if (type === 'signup') return SIGNUP_VENUE_PATH;
  if (type === 'magiclink') return DEFAULT_SIGNED_IN_PATH;
  return SET_PASSWORD_PATH;
}

export function escapeHtml(value: string): string {
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
    subject: "You're invited to Cheers by Orange Jelly",
    html: `
<p>Hi,</p>
<p>You've been invited to Cheers by Orange Jelly, the social media tool for hospitality venues.</p>
${brandLine}
<p><a href="${escapeHtml(options.link)}">Accept the invite and set your password</a></p>
<p>This link works once and expires in 24 hours. If it has expired, ask the person who invited you to send a new one.</p>
<p>Cheers by Orange Jelly</p>
`.trim(),
  };
}

export function renderPasswordResetEmail(options: { link: string }): RenderedEmail {
  if (!options.link) throw new Error('Password reset email needs a link.');
  return {
    subject: 'Reset your Cheers password',
    html: `
<p>Hi,</p>
<p>We received a request to reset your Cheers password.</p>
<p><a href="${escapeHtml(options.link)}">Choose a new password</a></p>
<p>This link works once and expires in 24 hours. If you did not ask for this, you can ignore this email and your password will not change.</p>
<p>Cheers by Orange Jelly</p>
`.trim(),
  };
}

/**
 * The magic-link email. Its expiry wording matches the reset email's because
 * Supabase checks both tokens against the same setting (the email OTP expiry):
 * a magic link is stored as a recovery token.
 */
export function renderMagicLinkEmail(options: { link: string }): RenderedEmail {
  if (!options.link) throw new Error('Magic link email needs a link.');
  return {
    subject: 'Your Cheers sign-in link',
    html: `
<p>Hi,</p>
<p>We received a request to sign in to Cheers with this email address.</p>
<p><a href="${escapeHtml(options.link)}">Sign in to Cheers</a></p>
<p>This link works once and expires in 24 hours. If you did not ask for this, you can ignore this email and nobody will be signed in.</p>
<p>Cheers by Orange Jelly</p>
`.trim(),
  };
}
