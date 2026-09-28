import { describe, expect, it } from 'vitest';

import { parseConfirmLinkParams, SUPABASE_OTP_TYPE } from '@/lib/auth/confirm-link';
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

  it('reads self-serve sign-up links, which go on to naming the venue', () => {
    const link = buildAuthConfirmUrl({ siteUrl: SITE, tokenHash: TOKEN, type: 'signup' });
    expect(new URL(link).pathname).toBe('/auth/confirm');
    expect(parseConfirmLinkParams(paramsOf(link))).toEqual({ tokenHash: TOKEN, type: 'signup', next: '/signup/venue' });
  });

  it('reads magic links, which go to the next path the login page gave, else the dashboard', () => {
    const link = buildAuthConfirmUrl({ siteUrl: SITE, tokenHash: TOKEN, type: 'magiclink', next: '/planner' });
    expect(parseConfirmLinkParams(paramsOf(link))).toEqual({ tokenHash: TOKEN, type: 'magiclink', next: '/planner' });
    const bare = buildAuthConfirmUrl({ siteUrl: SITE, tokenHash: TOKEN, type: 'magiclink' });
    expect(parseConfirmLinkParams(paramsOf(bare))?.next).toBe('/dashboard');
    expect(parseConfirmLinkParams({ token_hash: TOKEN, type: 'magiclink', next: '//evil.example' })?.next).toBe('/dashboard');
  });

  it('verifies a sign-up link as a Supabase invite, and a magic link as a magic link (never the generic email type)', () => {
    expect(SUPABASE_OTP_TYPE).toEqual({ invite: 'invite', recovery: 'recovery', signup: 'invite', magiclink: 'magiclink' });
  });

  it('accepts only invite, recovery, signup and magiclink links', () => {
    for (const type of ['email', 'email_change', 'Signup', 'sign_up', 'MagicLink', 'magic_link']) {
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

  it('sends a sign-up link with a missing or unsafe next to naming the venue', () => {
    expect(parseConfirmLinkParams({ token_hash: TOKEN, type: 'signup' })?.next).toBe('/signup/venue');
    expect(parseConfirmLinkParams({ token_hash: TOKEN, type: 'signup', next: 'https://evil.example' })?.next).toBe('/signup/venue');
  });
});
