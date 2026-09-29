import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HOME_SEO } from '@/content/seo';

import { planningGuide, SAMPLE_GUIDES } from '../../../tests/fixtures/guides/sample-guides';

/**
 * The share images follow their pages: /og follows the homepage (shown on a
 * Preview or local dev server for copy approval), /og/guides/<slug> follows
 * the guides (switch on and a real guide). Hidden ones answer 404 and draw
 * nothing.
 */

const mocks = vi.hoisted(() => ({
  switchState: vi.fn(),
  render: vi.fn(() => new Response('png', { status: 200, headers: { 'content-type': 'image/png' } })),
  serverEnv: { VERCEL_ENV: 'production' } as Record<string, string>,
  guides: [] as import('@/content/guides/types').Guide[],
}));

vi.mock('@/env', () => ({
  env: { server: mocks.serverEnv, client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.orangejelly.co.uk' } },
}));
vi.mock('@/lib/signup/switch', () => ({ getSelfServeSignupSwitch: () => mocks.switchState() }));
vi.mock('@/content/guides', () => ({ listGuides: () => mocks.guides }));
vi.mock('@/lib/marketing/og-image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/marketing/og-image')>()),
  renderShareImage: mocks.render,
}));

const homeImage = await import('@/app/og/route');
const guideImage = await import('@/app/og/guides/[slug]/route');

function guideRequest(slug: string): Promise<Response> {
  return guideImage.GET(new Request(`https://cheers.orangejelly.co.uk/og/guides/${slug}`), {
    params: Promise.resolve({ slug }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.serverEnv.VERCEL_ENV = 'production';
  mocks.guides = SAMPLE_GUIDES;
});

describe('/og (the homepage share image)', () => {
  it.each(['closed', 'unavailable'])('is not found in production while the switch is %s', async (state) => {
    mocks.switchState.mockResolvedValue(state);
    const response = await homeImage.GET();
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it('is drawn once the switch is on, with the homepage headline', async () => {
    mocks.switchState.mockResolvedValue('open');
    const response = await homeImage.GET();
    expect(response.status).toBe(200);
    expect(mocks.render).toHaveBeenCalledWith({
      eyebrow: HOME_SEO.imageEyebrow,
      title: HOME_SEO.imageHeadline,
      footer: 'cheers.orangejelly.co.uk',
    });
  });

  it('is drawn on a Vercel Preview with the switch off, like the homepage', async () => {
    mocks.serverEnv.VERCEL_ENV = 'preview';
    mocks.switchState.mockResolvedValue('closed');
    expect((await homeImage.GET()).status).toBe(200);
  });
});

describe('/og/guides/<slug> (a guide share image)', () => {
  it.each(['closed', 'unavailable'])('is not found while the switch is %s, even on a Preview', async (state) => {
    mocks.serverEnv.VERCEL_ENV = 'preview';
    mocks.switchState.mockResolvedValue(state);
    expect((await guideRequest(planningGuide.slug)).status).toBe(404);
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it('is not found for a slug that is not a guide', async () => {
    mocks.switchState.mockResolvedValue('open');
    expect((await guideRequest('no-such-guide')).status).toBe(404);
  });

  it('is drawn with the guide title and category once public', async () => {
    mocks.switchState.mockResolvedValue('open');
    expect((await guideRequest(planningGuide.slug)).status).toBe(200);
    expect(mocks.render).toHaveBeenCalledWith({
      eyebrow: 'Guide: Planning your posts',
      title: planningGuide.title,
      footer: 'cheers.orangejelly.co.uk/guides',
    });
  });
});
