import { describe, expect, it } from 'vitest';

import { frontDoorCta, frontDoorVisible, indexableWhenOpen, robotsFor } from '@/lib/signup/front-door';

const PRODUCTION = { vercelEnv: 'production', nodeEnv: 'production' };
const PREVIEW = { vercelEnv: 'preview', nodeEnv: 'production' };
const LOCAL_DEV = { vercelEnv: undefined, nodeEnv: 'development' };

describe('robots.txt', () => {
  it('disallows everything while the switch is off or unreadable, as before', () => {
    for (const state of ['closed', 'unavailable'] as const) {
      expect(robotsFor(state)).toEqual({ rules: [{ userAgent: '*', disallow: '/' }] });
    }
  });

  it('allows only the home page and the three legal pages once the switch is on (P11)', () => {
    expect(robotsFor('open')).toEqual({
      rules: [{ userAgent: '*', allow: ['/$', '/terms', '/privacy', '/data-processing'], disallow: '/' }],
    });
  });
});

describe('who sees the landing page', () => {
  it('in production, only signed-out visitors while the switch is on', () => {
    expect(frontDoorVisible('open', PRODUCTION)).toBe(true);
    expect(frontDoorVisible('closed', PRODUCTION)).toBe(false);
    expect(frontDoorVisible('unavailable', PRODUCTION)).toBe(false);
    // Off Vercel with a production build (for example `next start`): closed stays closed.
    expect(frontDoorVisible('closed', { nodeEnv: 'production' })).toBe(false);
  });

  it('on a Vercel Preview or a local dev server whatever the switch, so the copy can be approved', () => {
    expect(frontDoorVisible('closed', PREVIEW)).toBe(true);
    expect(frontDoorVisible('unavailable', LOCAL_DEV)).toBe(true);
  });
});

describe('the call to action', () => {
  it('offers the free trial only when the switch is on; otherwise "Talk to us"', () => {
    expect(frontDoorCta('open')).toBe('trial');
    expect(frontDoorCta('closed')).toBe('talk');
    expect(frontDoorCta('unavailable')).toBe('talk');
  });
});

describe('page indexing', () => {
  const base = { title: 'Terms of Service | Cheers' };

  it('lifts the site-wide noindex only while the switch is on', () => {
    expect(indexableWhenOpen(base, 'open')).toEqual({ ...base, robots: { index: true, follow: true } });
    expect(indexableWhenOpen(base, 'closed')).toEqual(base);
    expect(indexableWhenOpen(base, 'unavailable')).toEqual(base);
  });
});
