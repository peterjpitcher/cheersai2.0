// @vitest-environment jsdom
// src/features/planner/banner-overlay.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BannerOverlay } from '@/features/planner/banner-overlay';
import { BANNER_LABEL_REPEAT_COUNT } from '@/lib/banner/palette';
import {
  FIXED_BANNER_BG,
  FIXED_BANNER_POSITION,
  FIXED_BANNER_TEXT,
} from '@/lib/banner/config';

const baseConfig = {
  enabled: true,
  position: 'bottom' as const,
  bgColour: '#005131',
  textColour: '#1a1a1a',
  textOverride: null,
};

describe('<BannerOverlay />', () => {
  it('renders nothing when config.enabled is false', () => {
    const { container } = render(
      <BannerOverlay
        mediaUrl="/x.jpg"
        config={{ ...baseConfig, enabled: false }}
        label="THIS WEDNESDAY"
      />,
    );
    expect(container.querySelector('[data-banner-overlay]')).toBeNull();
  });

  it('renders nothing when label is null and no override', () => {
    const { container } = render(
      <BannerOverlay
        mediaUrl="/x.jpg"
        config={baseConfig}
        label={null}
      />,
    );
    expect(container.querySelector('[data-banner-overlay]')).toBeNull();
  });

  it('renders override text when set even with null label', () => {
    render(
      <BannerOverlay
        mediaUrl="/x.jpg"
        config={{ ...baseConfig, textOverride: 'BANK HOLIDAY' }}
        label={null}
      />,
    );
    const span = screen.getByLabelText('BANK HOLIDAY');
    expect(span.textContent).toMatch(/BANK HOLIDAY · BANK HOLIDAY/);
  });

  it('renders computed label when override is empty', () => {
    render(
      <BannerOverlay
        mediaUrl="/x.jpg"
        config={baseConfig}
        label="THIS WEDNESDAY"
      />,
    );
    const span = screen.getByLabelText('THIS WEDNESDAY');
    expect(span.textContent).toMatch(/THIS WEDNESDAY · THIS WEDNESDAY/);
  });

  it('repeats the label BANNER_LABEL_REPEAT_COUNT times joined by " · "', () => {
    render(
      <BannerOverlay
        mediaUrl="/x.jpg"
        config={baseConfig}
        label="TODAY"
      />,
    );
    const span = screen.getByLabelText('TODAY');
    const segments = (span.textContent ?? '').split(' · ');
    expect(segments).toHaveLength(BANNER_LABEL_REPEAT_COUNT);
    expect(segments.every((s) => s === 'TODAY')).toBe(true);
  });

  it('always renders the fixed right-side gold strip', () => {
    const { container } = render(
      <BannerOverlay
        mediaUrl="/x.jpg"
        config={{ ...baseConfig, position: 'top' }}
        label="TODAY"
      />,
    );
    const strip = container.querySelector('[data-banner-overlay]')!;
    expect(strip).toHaveAttribute('data-position', FIXED_BANNER_POSITION);
    expect(strip).toHaveStyle({
      backgroundColor: FIXED_BANNER_BG,
      color: FIXED_BANNER_TEXT,
    });
  });

  // The strip is overflow-hidden so the spilled-over repeated label clips
  // symmetrically at both edges, matching the publish-time SVG output.
  it('clips the repeated label by setting overflow-hidden on the strip', () => {
    const { container } = render(
      <BannerOverlay
        mediaUrl="/x.jpg"
        config={baseConfig}
        label="TODAY"
      />,
    );
    const strip = container.querySelector('[data-banner-overlay]')!;
    expect(strip.className).toMatch(/overflow-hidden/);
    const span = strip.querySelector('span')!;
    expect(span.className).toMatch(/whitespace-nowrap/);
  });

  // The fixed right-side strip must rotate the text along the banner,
  // matching the publish-time SVG rotation in renderBannerServer.
  it('rotates text vertically for the fixed right-side strip', () => {
    const { container } = render(
      <BannerOverlay
        mediaUrl="/x.jpg"
        config={{ ...baseConfig, position: 'left' }}
        label="THIS WEDNESDAY"
      />,
    );
    const strip = container.querySelector('[data-banner-overlay]')!;
    expect(strip).toHaveAttribute('data-position', 'right');
    const span = strip.querySelector('span')!;
    expect(span.textContent).toMatch(/THIS WEDNESDAY · THIS WEDNESDAY/);
    expect(span.getAttribute('style') ?? '').toMatch(/writing-mode:\s*vertical-rl/);
  });

  // AB-007 perf bonus: img must be lazy-loaded so calendar/list grids don't
  // download every banner upfront.
  it('lazy-loads the underlying image', () => {
    const { container } = render(
      <BannerOverlay
        mediaUrl="/x.jpg"
        config={baseConfig}
        label="TODAY"
      />,
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('loading')).toBe('lazy');
  });
});
