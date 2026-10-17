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
import type { PublicLinkInBioPageData, PublicWebsiteEvent } from '@/lib/link-in-bio/types';

afterEach(() => {
  cleanup();
});

function buildData(overrides: Partial<PublicLinkInBioPageData['campaigns'][number]>): PublicLinkInBioPageData {
  const baseCampaign: PublicLinkInBioPageData['campaigns'][number] = {
    id: 'c1',
    campaignId: 'c1',
    name: 'Spring Special',
    campaignType: 'event',
    scheduledFor: '2026-05-07T18:00:00.000Z',
    endAt: '2026-05-08T22:00:00.000Z',
    linkUrl: 'https://example.com',
    ctaLabel: 'Book now',
    summary: 'Seasonal offer',
    displayStartsAt: '2026-05-08T18:00:00.000Z',
    displayEndsAt: '2026-05-08T22:00:00.000Z',
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

  it('lets the menu quick action span both columns by default', () => {
    const data = buildData({
      bannerConfig: null,
      bannerLabel: null,
    });
    data.profile.phoneNumber = '01753 682707';
    data.profile.directionsUrl = 'https://maps.example.com';
    data.profile.whatsappNumber = '+441753682707';
    data.profile.bookingUrl = 'https://example.com/book';
    data.profile.menuUrl = 'https://example.com/menu';

    render(<LinkInBioPublicPage data={data} />);

    const menuLink = screen.getByRole('link', { name: /see our menu/i });
    expect(menuLink.parentElement).toHaveClass('grid-cols-2');
    expect(menuLink).toHaveClass('col-span-2');
  });

  it('renders quick actions in one column when configured', () => {
    const data = buildData({
      bannerConfig: null,
      bannerLabel: null,
    });
    data.profile.theme = { quickActionLayout: 'single' };
    data.profile.phoneNumber = '01753 682707';
    data.profile.menuUrl = 'https://example.com/menu';

    render(<LinkInBioPublicPage data={data} />);

    const menuLink = screen.getByRole('link', { name: /see our menu/i });
    expect(menuLink.parentElement).toHaveClass('grid-cols-1');
    expect(menuLink).not.toHaveClass('col-span-2');
  });

  it('renders story-shaped campaign media in a story frame', () => {
    const data = buildData({
      bannerConfig: null,
      bannerLabel: null,
      media: {
        url: 'https://mock.supabase.co/story.jpg',
        mediaType: 'image',
        shape: 'story',
      },
    });

    render(<LinkInBioPublicPage data={data} />);

    const frame = screen.getByAltText('Spring Special').closest('[data-media-placement]');
    expect(frame).toHaveAttribute('data-media-placement', 'story');
    expect(frame).toHaveAttribute('data-media-size', 'fluid');
    expect(frame).toHaveClass('aspect-[9/16]');
  });
});

// The page renders on the server, which runs in UTC on Vercel. Reading times
// in the runtime's zone showed a 7pm event in British Summer Time as 6pm, so
// every case runs with the runtime zone set to UTC, London and New York.
describe('<LinkInBioPublicPage /> times on the London clock', () => {
  const originalTimeZone = process.env.TZ;
  const RUNTIME_ZONES = ['UTC', 'Europe/London', 'America/New_York'];

  afterEach(() => {
    process.env.TZ = originalTimeZone;
  });

  function websiteEvent(id: string, startsAt: string): PublicWebsiteEvent {
    return {
      id,
      slug: id,
      name: `Event ${id}`,
      startsAt,
      status: 'scheduled',
      categoryLabel: null,
      summary: null,
      imageUrl: null,
      ctaUrl: `https://l.the-anchor.pub/${id}`,
      ctaLabel: 'Book now',
    };
  }

  function timingsShown(data: PublicLinkInBioPageData): string[] {
    const { container } = render(<LinkInBioPublicPage data={data} />);
    // A card's timing line is a calendar icon and the text beside it: a <p> on
    // campaign cards, a <span> on event cards. The other calendar icons sit in
    // <div>s (the "Event" badge and the no-picture placeholder).
    const timings = Array.from(
      container.querySelectorAll('p > svg.lucide-calendar-days, span > svg.lucide-calendar-days'),
    ).map((icon) => icon.parentElement?.textContent?.trim() ?? '');
    cleanup();
    return timings;
  }

  it.each(RUNTIME_ZONES)('shows "What\'s on" events at their London time (runtime zone %s)', (zone) => {
    process.env.TZ = zone;
    const data = buildData({ bannerConfig: null, bannerLabel: null });
    data.campaigns = [];
    data.websiteEvents = [
      // What the data layer sends: London time with its offset.
      websiteEvent('summer', '2026-10-07T19:00:00.000+01:00'),
      // The same kind of instant written in UTC.
      websiteEvent('summer-utc', '2026-10-16T18:00:00.000Z'),
      // After the clocks go back on 25 October.
      websiteEvent('winter', '2026-11-04T19:00:00.000+00:00'),
      // 23:30 UTC on 7 October is half past midnight on the 8th in London.
      websiteEvent('after-midnight', '2026-10-07T23:30:00.000Z'),
      // Midnight London means no time was set, so only the date shows.
      websiteEvent('date-only', '2026-10-09T00:00:00.000+01:00'),
    ];

    expect(timingsShown(data)).toEqual([
      'Wed 7 Oct at 7pm',
      'Fri 16 Oct at 7pm',
      'Wed 4 Nov at 7pm',
      'Thu 8 Oct at 12:30am',
      'Fri 9 Oct',
    ]);
  });

  it.each(RUNTIME_ZONES)('shows campaign dates at their London time (runtime zone %s)', (zone) => {
    process.env.TZ = zone;
    const event = buildData({
      bannerConfig: null,
      bannerLabel: null,
      displayStartsAt: '2026-10-07T19:30:00.000+01:00',
    });
    expect(timingsShown(event)).toEqual(['Wed 7 Oct at 7:30pm']);

    const weekly = buildData({
      bannerConfig: null,
      bannerLabel: null,
      campaignType: 'weekly',
      displayStartsAt: '2026-10-08T18:00:00.000Z',
    });
    expect(timingsShown(weekly)).toEqual(['Thursday at 7pm']);
  });
});
