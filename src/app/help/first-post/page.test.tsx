/**
 * The first-post help article and its links follow the self-serve sign-up
 * switch: hidden (not found, and unlisted) while it is off or unreadable.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSelfServeSignupSwitch: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  permanentRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock('@/lib/signup/switch', () => ({ getSelfServeSignupSwitch: mocks.getSelfServeSignupSwitch }));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound, permanentRedirect: mocks.permanentRedirect }));

import FirstPostHelpPage from '@/app/help/first-post/page';
import HelpPage from '@/app/help/[[...slug]]/page';
import { FIRST_POST_HELP_PATH, getFirstPostHelpHref } from '@/lib/help/first-post';
import { CONTACT } from '@/lib/legal/company';

const BAD_OUTPUT = ['undefined', 'NaN', 'Invalid Date', 'null'];

describe('getFirstPostHelpHref', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gives the link only while the switch is open', async () => {
    mocks.getSelfServeSignupSwitch.mockResolvedValueOnce('open');
    expect(await getFirstPostHelpHref()).toBe(FIRST_POST_HELP_PATH);
    mocks.getSelfServeSignupSwitch.mockResolvedValueOnce('closed');
    expect(await getFirstPostHelpHref()).toBeNull();
    mocks.getSelfServeSignupSwitch.mockResolvedValueOnce('unavailable');
    expect(await getFirstPostHelpHref()).toBeNull();
  });
});

describe('first-post help article', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['closed', 'unavailable'])('is not found while the switch is %s', async (state) => {
    mocks.getSelfServeSignupSwitch.mockResolvedValue(state);

    await expect(FirstPostHelpPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('walks through the create wizard with its real labels once the switch is open', async () => {
    mocks.getSelfServeSignupSwitch.mockResolvedValue('open');

    const html = renderToStaticMarkup(await FirstPostHelpPage());

    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(html).toContain('How to publish your first post');
    for (const label of [
      'Instant Post',
      'Brief / prompt',
      'Platforms',
      'Attach Media',
      'When to publish',
      'Post Now',
      'Generate Content',
      'Final publish preview',
      'Approve this post',
      'Post approved',
      'Schedule approved',
      'Save as Draft',
      'View failed posts',
      'Get set up',
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('href="/connections"');
    expect(html).toContain(`href="mailto:${CONTACT.email}"`);
    for (const bad of BAD_OUTPUT) expect(html).not.toContain(bad);
  });
});

describe('Help Centre', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists the first-post article only while the switch is open', async () => {
    mocks.getSelfServeSignupSwitch.mockResolvedValue('closed');
    const closed = renderToStaticMarkup(await HelpPage({ params: Promise.resolve({}) }));
    expect(closed).not.toContain(FIRST_POST_HELP_PATH);
    expect(closed).toContain('href="/login"');

    mocks.getSelfServeSignupSwitch.mockResolvedValue('open');
    const open = renderToStaticMarkup(await HelpPage({ params: Promise.resolve({}) }));
    expect(open).toContain(`href="${FIRST_POST_HELP_PATH}"`);
  });

  it('still sends old article addresses to the Help Centre', async () => {
    await expect(HelpPage({ params: Promise.resolve({ slug: ['old-article'] }) })).rejects.toThrow('NEXT_REDIRECT:/help');
    expect(mocks.getSelfServeSignupSwitch).not.toHaveBeenCalled();
  });
});
