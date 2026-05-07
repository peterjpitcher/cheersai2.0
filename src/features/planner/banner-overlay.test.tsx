// @vitest-environment jsdom
// src/features/planner/banner-overlay.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BannerOverlay } from '@/features/planner/banner-overlay';

const baseConfig = {
  enabled: true,
  position: 'bottom' as const,
  bgColour: '#000000',
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
    expect(screen.getByText('BANK HOLIDAY')).toBeInTheDocument();
  });

  it('renders computed label when override is empty', () => {
    render(
      <BannerOverlay
        mediaUrl="/x.jpg"
        config={baseConfig}
        label="THIS WEDNESDAY"
      />,
    );
    expect(screen.getByText('THIS WEDNESDAY')).toBeInTheDocument();
  });

  it('positions strip at top when position=top', () => {
    render(
      <BannerOverlay
        mediaUrl="/x.jpg"
        config={{ ...baseConfig, position: 'top' }}
        label="TODAY"
      />,
    );
    const strip = screen.getByText('TODAY').closest('[data-banner-overlay]')!;
    expect(strip).toHaveAttribute('data-position', 'top');
  });
});
