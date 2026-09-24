import { describe, expect, it } from 'vitest';

import {
  buildAuthConfirmUrl,
  renderInviteEmail,
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
  ])('%s -> %s', (input, expected) => {
    expect(safeNextPath(input, '/dashboard')).toBe(expected);
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

  it('refuses to render without a link', () => {
    expect(() => renderInviteEmail({ link: '', brandNames: [] })).toThrow();
    expect(() => renderPasswordResetEmail({ link: '' })).toThrow();
  });
});
