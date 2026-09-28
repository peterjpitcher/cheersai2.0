import { describe, expect, it } from 'vitest';

import {
  buildAuthConfirmUrl,
  isUsableAuthLinkSiteUrl,
  renderInviteEmail,
  renderMagicLinkEmail,
  renderPasswordResetEmail,
  safeNextPath,
} from '@/lib/auth/email-links';

const SITE = 'https://cheers.orangejelly.co.uk';

function assertRenderedCleanly(html: string, subject: string) {
  for (const bad of ['undefined', 'null', 'NaN', 'Invalid Date', 'href=""']) {
    expect(html).not.toContain(bad);
    expect(subject).not.toContain(bad);
  }
}

describe('safeNextPath', () => {
  it.each([
    ['/planner', '/planner'],
    ['/auth/set-password', '/auth/set-password'],
    [null, '/dashboard'],
    ['', '/dashboard'],
    ['https://evil.example/x', '/dashboard'],
    ['//evil.example/x', '/dashboard'],
    ['/\\evil.example', '/dashboard'],
    ['planner', '/dashboard'],
    ['/\t/evil.example', '/dashboard'],
    ['/\n/evil.example', '/dashboard'],
    ['/\r/evil.example', '/dashboard'],
    ['/\u007f', '/dashboard'],
    ['javascript:alert(1)', '/dashboard'],
    ['http:evil.example', '/dashboard'],
    ['/planner?x=//evil.example', '/planner?x=//evil.example'],
    ['/planner#//evil.example', '/planner#//evil.example'],
    ['/' + 'a'.repeat(2048), '/dashboard'],
    ['/' + 'a'.repeat(2046), '/' + 'a'.repeat(2046)],
  ])('%s -> %s', (input, expected) => {
    expect(safeNextPath(input, '/dashboard')).toBe(expected);
  });
});

// The login page does `window.location.href = safeNextPath(searchParams.get('next'), '/dashboard')`
// after a password sign-in, so these start from the raw query string the browser receives.
describe('login ?next= redirect target', () => {
  function loginRedirectTarget(query: string): string {
    const searchParams = new URL(`/login${query}`, SITE).searchParams;
    return safeNextPath(searchParams.get('next'), '/dashboard');
  }

  it.each([
    ['?next=https%3A%2F%2Fevil.example', '/dashboard'],
    ['?next=https://evil.example', '/dashboard'],
    ['?next=//evil', '/dashboard'],
    ['?next=javascript:alert(1)', '/dashboard'],
    ['?next=javascript%3Aalert(1)', '/dashboard'],
    ['?next=/%5Cevil', '/dashboard'],
    ['?next=/%09/evil.example', '/dashboard'],
    ['?next=/%0A/evil.example', '/dashboard'],
    ['', '/dashboard'],
    ['?next=', '/dashboard'],
    ['?next=%2Fplanner%3Fx%3D1', '/planner?x=1'],
  ])('%s -> %s', (query, expected) => {
    const target = loginRedirectTarget(query);
    expect(target).toBe(expected);
    // Whatever comes back must stay on our own origin once the browser resolves it.
    expect(new URL(target, SITE).origin).toBe(SITE);
  });

  it('keeps a normal path with its own query string', () => {
    // `?next=/planner?x=1` unencoded: the second `?` belongs to the next value.
    expect(loginRedirectTarget('?next=/planner?x=1')).toBe('/planner?x=1');
  });
});

describe('isUsableAuthLinkSiteUrl', () => {
  it.each([
    ['https://cheers.orangejelly.co.uk', true],
    ['https://cheers.orangejelly.co.uk/', true],
    ['http://localhost:3000', false],
    ['http://cheers.orangejelly.co.uk', false],
    ['https://localhost:3000', false],
    ['https://cheersml.localhost:3400', false],
    ['https://127.0.0.1', false],
    ['https://127.1.2.3:8443', false],
    ['https://2130706433', false],
    ['https://[::1]:3000', false],
    ['https://[::ffff:127.0.0.1]', false],
    ['https://0.0.0.0', false],
    ['ftp://cheers.orangejelly.co.uk', false],
    ['not a url', false],
    ['', false],
    [undefined, false],
  ])('in production, %s -> %s', (siteUrl, expected) => {
    expect(isUsableAuthLinkSiteUrl(siteUrl, true)).toBe(expected);
  });

  it('accepts local http addresses outside production (the dev server)', () => {
    expect(isUsableAuthLinkSiteUrl('http://localhost:3000', false)).toBe(true);
    expect(isUsableAuthLinkSiteUrl('http://cheersml.localhost:3400', false)).toBe(true);
    expect(isUsableAuthLinkSiteUrl('ftp://localhost', false)).toBe(false);
    expect(isUsableAuthLinkSiteUrl(undefined, false)).toBe(false);
  });
});

describe('buildAuthConfirmUrl', () => {
  it('points at /auth/confirm on the site host with the token, type and set-password next', () => {
    const url = new URL(buildAuthConfirmUrl({ siteUrl: SITE, tokenHash: 'abc123', type: 'invite' }));
    expect(url.origin).toBe(SITE);
    expect(url.pathname).toBe('/auth/confirm');
    expect(url.searchParams.get('token_hash')).toBe('abc123');
    expect(url.searchParams.get('type')).toBe('invite');
    expect(url.searchParams.get('next')).toBe('/auth/set-password');
  });

  it('refuses to build a link without a token', () => {
    expect(() => buildAuthConfirmUrl({ siteUrl: SITE, tokenHash: '', type: 'recovery' })).toThrow();
  });

  it('sends a magic link to the dashboard by default, never to set-password', () => {
    const url = new URL(buildAuthConfirmUrl({ siteUrl: SITE, tokenHash: 'abc123', type: 'magiclink' }));
    expect(url.pathname).toBe('/auth/confirm');
    expect(url.searchParams.get('type')).toBe('magiclink');
    expect(url.searchParams.get('next')).toBe('/dashboard');
  });
});

describe('auth email templates (fixture render)', () => {
  const link = buildAuthConfirmUrl({ siteUrl: SITE, tokenHash: 'fixture-token', type: 'invite' });

  it('renders the invite with the link and brand names', () => {
    const email = renderInviteEmail({ link, brandNames: ['The Crown & Anchor', 'Orange Jelly'] });
    assertRenderedCleanly(email.html, email.subject);
    expect(email.html).toContain(link.replace(/&/g, '&amp;'));
    expect(email.html).toContain('The Crown &amp; Anchor, Orange Jelly');
  });

  it('renders the invite without a brand line when no names are known', () => {
    const email = renderInviteEmail({ link, brandNames: [] });
    assertRenderedCleanly(email.html, email.subject);
    expect(email.html).not.toContain('given access to');
  });

  it('renders the password reset with the link', () => {
    const resetLink = buildAuthConfirmUrl({ siteUrl: SITE, tokenHash: 'fixture-token', type: 'recovery' });
    const email = renderPasswordResetEmail({ link: resetLink });
    assertRenderedCleanly(email.html, email.subject);
    expect(email.html).toContain('type=recovery');
  });

  it('renders the magic link with the link, escaped, and the sign-in wording', () => {
    const magicLink = buildAuthConfirmUrl({ siteUrl: SITE, tokenHash: 'fixture-token', type: 'magiclink', next: '/planner?view=week' });
    const email = renderMagicLinkEmail({ link: magicLink });
    assertRenderedCleanly(email.html, email.subject);
    expect(email.subject).toBe('Your Cheers sign-in link');
    expect(email.html).toContain(`href="${magicLink.replace(/&/g, '&amp;')}"`);
    expect(email.html).toContain('type=magiclink');
    expect(email.html).toContain('next=%2Fplanner%3Fview%3Dweek');
    expect(email.html).toContain('Sign in to Cheers');
    expect(email.html).toContain(
      'This link works once and only for a short time. If you did not ask for this, you can ignore this email and nobody will be signed in.',
    );
  });

  // Supabase sets how long these links last (one hour or less in production),
  // so no email promises a duration.
  it.each([
    ['invite', () => renderInviteEmail({ link, brandNames: ['The Anchor'] }), 'If it has expired, ask the person who invited you to send a new one.'],
    [
      'password reset',
      () => renderPasswordResetEmail({ link }),
      'If you did not ask for this, you can ignore this email and your password will not change.',
    ],
    ['magic link', () => renderMagicLinkEmail({ link }), 'If you did not ask for this, you can ignore this email and nobody will be signed in.'],
  ])('the %s email promises no link lifetime', (_name, render, followUp) => {
    const email = render();
    expect(email.html).toContain(`This link works once and only for a short time. ${followUp}`);
    expect(email.html).not.toMatch(/expires in|\bhours?\b|\bminutes?\b|\bdays?\b/i);
  });

  it('escapes anything odd in a magic link rather than breaking out of the href', () => {
    const email = renderMagicLinkEmail({ link: 'https://cheers.orangejelly.co.uk/auth/confirm?x="><script>' });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('refuses to render without a link', () => {
    expect(() => renderInviteEmail({ link: '', brandNames: [] })).toThrow();
    expect(() => renderPasswordResetEmail({ link: '' })).toThrow();
    expect(() => renderMagicLinkEmail({ link: '' })).toThrow();
  });
});
