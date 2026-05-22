// @vitest-environment jsdom
// G1: the public link-in-bio page must render an override-only banner
// (textOverride set, proximity label null) on a campaign card. Previously
// the gate required both `bannerConfig` AND `bannerLabel`, which silently
// hid override-only banners that the planner preview happily showed.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// Stub next/image — we only care that it renders an <img>. We deliberately
// drop next/image-only props (`priority`, `unoptimized`, `sizes`) to avoid
// React DOM warnings about unknown boolean attributes.
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt, width, height, className } = props as {
      src: string;
      alt: string;
      width?: number;
      height?: number;
      className?: string;
    };
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        className={className}
      />
    );
  },
}));

// The refresh timer fires intervals — stub it for determinism.
vi.mock('./link-in-bio-refresh-timer', () => ({
  LinkInBioRefreshTimer: () => null,
}));

import { LinkInBioPublicPage } from './link-in-bio-public-page';
import type { PublicLinkInBioPageData } from '@/lib/link-in-bio/types';

afterEach(() => {
  cleanup();
});

function buildData(overrides: Partial<PublicLinkInBioPageData['campaigns'][number]>): PublicLinkInBioPageData {
  const baseCampaign: PublicLinkInBioPageData['campaigns'][number] = {
    id: 'c1',
    campaignId: 'c1',
    name: 'Spring Special',
    scheduledFor: '2026-05-07T18:00:00.000Z',
    endAt: '2026-05-08T22:00:00.000Z',
    linkUrl: 'https://example.com',
    slotLabel: null,
    media: {
      url: 'https://mock.supabase.co/x.jpg',
      mediaType: 'image',
      shape: 'square',
    },
    bannerConfig: null,
    bannerLabel: null,
  };

  return {
    profile: {
      accountId: 'a1',
      slug: 'demo',
      displayName: 'Demo',
      bio: null,
      logoUrl: null,
      heroMediaId: null,
      theme: {},
      phoneNumber: null,
      whatsappNumber: null,
      bookingUrl: null,
      menuUrl: null,
      parkingUrl: null,
      directionsUrl: null,
      facebookUrl: null,
      instagramUrl: null,
      websiteUrl: null,
      template: 'classic',
      fontFamily: 'inter',
      isPublished: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    tiles: [],
    logoMedia: null,
    heroMedia: null,
    campaigns: [{ ...baseCampaign, ...overrides }],
  };
}

describe('<LinkInBioPublicPage /> banner rendering [G1]', () => {
  it('renders an override-only banner when bannerLabel is null but textOverride is set', () => {
    const data = buildData({
      bannerConfig: {
        enabled: true,
        position: 'bottom',
        bgColour: '#000000',
        textColour: '#FFFFFF',
        textOverride: 'BANK HOLIDAY',
      },
      bannerLabel: null,
    });

    render(<LinkInBioPublicPage data={data} />);

    // BannerOverlay renders the label repeated with " · " separators so the
    // strip overflows on both ends. Assert via the aria-label (which is the
    // single un-repeated label) and check repetition in textContent.
    const span = screen.getByLabelText('BANK HOLIDAY');
    expect(span.textContent).toMatch(/BANK HOLIDAY · BANK HOLIDAY/);
  });

  it('renders the proximity label when bannerLabel is set and override is empty', () => {
    const data = buildData({
      bannerConfig: {
        enabled: true,
        position: 'bottom',
        bgColour: '#000000',
        textColour: '#FFFFFF',
        textOverride: null,
      },
      bannerLabel: 'TODAY',
    });

    render(<LinkInBioPublicPage data={data} />);

    const span = screen.getByLabelText('TODAY');
    expect(span.textContent).toMatch(/TODAY · TODAY/);
  });

  it('does not render a banner when bannerConfig is null', () => {
    const data = buildData({
      bannerConfig: null,
      bannerLabel: null,
    });

    const { container } = render(<LinkInBioPublicPage data={data} />);

    expect(container.querySelector('[data-banner-overlay]')).toBeNull();
  });

  it('renders the configured logo', () => {
    const data = buildData({
      bannerConfig: null,
      bannerLabel: null,
    });
    data.profile.logoUrl = 'logos/demo.png';
    data.logoMedia = { url: 'https://mock.supabase.co/logo.png' };

    render(<LinkInBioPublicPage data={data} />);

    expect(screen.getByAltText('Demo logo')).toHaveAttribute('src', 'https://mock.supabase.co/logo.png');
    expect(screen.queryByRole('heading', { name: 'Demo' })).not.toBeInTheDocument();
  });
});
