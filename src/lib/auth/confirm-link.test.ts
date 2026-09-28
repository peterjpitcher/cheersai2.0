import { describe, expect, it } from 'vitest';

import { parseConfirmLinkParams } from '@/lib/auth/confirm-link';
import { buildAuthConfirmUrl } from '@/lib/auth/email-links';

const SITE = 'https://cheers.orangejelly.co.uk';
const TOKEN = 'a3f1c9e2b7d4a3f1c9e2b7d4a3f1c9e2b7d4a3f1c9e2b7d4a3f1c9e2';

function paramsOf(link: string) {
  const url = new URL(link);
  return {
    token_hash: url.searchParams.get('token_hash') ?? undefined,
    type: url.searchParams.get('type') ?? undefined,
    next: url.searchParams.get('next') ?? undefined,
  };
}

describe('parseConfirmLinkParams', () => {
  it('reads invite links exactly as buildAuthConfirmUrl writes them (links already sent keep working)', () => {
    const link = buildAuthConfirmUrl({ siteUrl: SITE, tokenHash: TOKEN, type: 'invite' });
    expect(parseConfirmLinkParams(paramsOf(link))).toEqual({ tokenHash: TOKEN, type: 'invite', next: '/auth/set-password' });
  });

  it('reads password reset links the same way', () => {
    const link = buildAuthConfirmUrl({ siteUrl: SITE, tokenHash: TOKEN, type: 'recovery' });
    expect(parseConfirmLinkParams(paramsOf(link))).toEqual({ tokenHash: TOKEN, type: 'recovery', next: '/auth/set-password' });
  });

  it('accepts only invite and recovery links (magic links go through Supabase and /auth/callback)', () => {
    for (const type of ['magiclink', 'email', 'signup', 'email_change']) {
      expect(parseConfirmLinkParams({ token_hash: TOKEN, type })).toBeNull();
    }
  });

  it('refuses a missing or malformed token', () => {
    expect(parseConfirmLinkParams({ type: 'invite' })).toBeNull();
    expect(parseConfirmLinkParams({ token_hash: '', type: 'invite' })).toBeNull();
    expect(parseConfirmLinkParams({ token_hash: 'short', type: 'invite' })).toBeNull();
    expect(parseConfirmLinkParams({ token_hash: `${TOKEN}"><script>`, type: 'invite' })).toBeNull();
    expect(parseConfirmLinkParams({ token_hash: [TOKEN, TOKEN], type: 'invite' })).toBeNull();
  });

  it('refuses an unknown type', () => {
    expect(parseConfirmLinkParams({ token_hash: TOKEN })).toBeNull();
    expect(parseConfirmLinkParams({ token_hash: TOKEN, type: 'email_change' })).toBeNull();
  });

  it('only ever sends people to a same-origin path afterwards', () => {
    expect(parseConfirmLinkParams({ token_hash: TOKEN, type: 'recovery', next: 'https://evil.example' })?.next).toBe('/dashboard');
    expect(parseConfirmLinkParams({ token_hash: TOKEN, type: 'recovery', next: '//evil.example' })?.next).toBe('/dashboard');
    expect(parseConfirmLinkParams({ token_hash: TOKEN, type: 'recovery', next: '/\t/evil.example' })?.next).toBe('/dashboard');
    expect(parseConfirmLinkParams({ token_hash: TOKEN, type: 'recovery' })?.next).toBe('/dashboard');
    expect(parseConfirmLinkParams({ token_hash: TOKEN, type: 'recovery', next: '/planner' })?.next).toBe('/planner');
  });
});
