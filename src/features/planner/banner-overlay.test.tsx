// @vitest-environment jsdom
// src/features/planner/banner-overlay.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BannerOverlay } from '@/features/planner/banner-overlay';
import { BANNER_LABEL_REPEAT_COUNT } from '@/lib/banner/palette';

const baseConfig = {
  enabled: true,
  position: 'bottom' as const,
  bgColour: '#a57626',
  textColour: '#FFFFFF',
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

  it('positions strip at top when position=top', () => {
    const { container } = render(
      <BannerOverlay
        mediaUrl="/x.jpg"
        config={{ ...baseConfig, position: 'top' }}
        label="TODAY"
      />,
    );
    const strip = container.querySelector('[data-banner-overlay]')!;
    expect(strip).toHaveAttribute('data-position', 'top');
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

  // G2: vertical strips (left/right) must rotate the text along the strip,
  // matching the publish-time SVG rotation in renderBannerServer. We assert
  // that the label is rendered and that the text element carries a
  // writing-mode style so long labels stay inside the 8% strip.
  it('rotates text vertically for position=left', () => {
    const { container } = render(
      <BannerOverlay
        mediaUrl="/x.jpg"
        config={{ ...baseConfig, position: 'left' }}
        label="THIS WEDNESDAY"
      />,
    );
    const strip = container.querySelector('[data-banner-overlay]')!;
    expect(strip).toHaveAttribute('data-position', 'left');
    const span = strip.querySelector('span')!;
    expect(span.textContent).toMatch(/THIS WEDNESDAY · THIS WEDNESDAY/);
    expect(span.getAttribute('style') ?? '').toMatch(/writing-mode:\s*vertical-rl/);
  });

  it('rotates text vertically for position=right', () => {
    const { container } = render(
      <BannerOverlay
        mediaUrl="/x.jpg"
        config={{ ...baseConfig, position: 'right' }}
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
