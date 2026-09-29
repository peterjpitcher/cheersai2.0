import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HOME_SEO } from '@/content/seo';

import { planningGuide, SAMPLE_GUIDES } from '../../../tests/fixtures/guides/sample-guides';

/**
 * The share images are public like their pages, whatever the sign-up switch
 * says, and never read it: /og always, /og/guides/<slug> for a real guide. An
 * unknown guide answers 404 and draws nothing.
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
  it('is drawn with the homepage headline, without reading the switch', async () => {
    const response = await homeImage.GET();
    expect(response.status).toBe(200);
    expect(mocks.render).toHaveBeenCalledWith({
      eyebrow: HOME_SEO.imageEyebrow,
      title: HOME_SEO.imageHeadline,
      footer: 'cheers.orangejelly.co.uk',
    });
    expect(mocks.switchState).not.toHaveBeenCalled();
  });
});

describe('/og/guides/<slug> (a guide share image)', () => {
  it('is not found for a slug that is not a guide, or while there are no guides', async () => {
    const response = await guideRequest('no-such-guide');
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    mocks.guides = [];
    expect((await guideRequest(planningGuide.slug)).status).toBe(404);
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it('is drawn with the guide title and category, without reading the switch', async () => {
    expect((await guideRequest(planningGuide.slug)).status).toBe(200);
    expect(mocks.render).toHaveBeenCalledWith({
      eyebrow: 'Guide: Planning and scheduling',
      title: planningGuide.title,
      footer: 'cheers.orangejelly.co.uk/guides',
    });
    expect(mocks.switchState).not.toHaveBeenCalled();
  });
});
