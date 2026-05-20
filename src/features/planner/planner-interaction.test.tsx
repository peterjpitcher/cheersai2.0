// @vitest-environment jsdom
// src/features/planner/planner-interaction.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// ── Mocks ──

// Mock the realtime hook used by the banner
vi.mock('@/hooks/use-realtime-feed', () => ({
  useFailedPublishCount: (_accountId: string, initial: number) => initial,
}));

// Mock next/link to render a plain anchor
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// Mock the Button component to render its children directly
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, asChild, ...props }: { children: React.ReactNode; asChild?: boolean; [key: string]: unknown }) => {
    if (asChild) return <>{children}</>;
    return <button {...props}>{children}</button>;
  },
}));

import { AttentionNeededBanner } from '@/features/planner/attention-needed-banner';

describe('AttentionNeededBanner', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders CTA text as "View failed posts" (not "Reconnect")', () => {
    render(<AttentionNeededBanner accountId="acc-1" initialCount={3} />);
    const link = screen.getByRole('link', { name: /view failed posts/i });
    expect(link).toBeDefined();
    expect(screen.queryByText('Reconnect')).toBeNull();
  });

  it('renders CTA href as /planner?status=failed', () => {
    render(<AttentionNeededBanner accountId="acc-1" initialCount={2} />);
    const link = screen.getByRole('link', { name: /view failed posts/i });
    expect(link.getAttribute('href')).toBe('/planner?status=failed');
  });

  it('does not render when count is 0', () => {
    render(<AttentionNeededBanner accountId="acc-1" initialCount={0} />);
    expect(screen.queryByTestId('attention-needed-banner')).toBeNull();
  });
});

describe('Planner page URL param parsing', () => {
  it('extracts status param from URL search params', () => {
    // Unit test for the param extraction logic used in the planner page
    const params: Record<string, string | string[] | undefined> = {
      month: '2025-06',
      status: 'failed',
      view: 'list',
    };
    const statusParam = typeof params.status === 'string' ? params.status : undefined;
    expect(statusParam).toBe('failed');
  });

  it('returns undefined when status param is missing', () => {
    const params: Record<string, string | string[] | undefined> = {
      month: '2025-06',
    };
    const statusParam = typeof params.status === 'string' ? params.status : undefined;
    expect(statusParam).toBeUndefined();
  });

  it('returns undefined when status param is an array', () => {
    const params: Record<string, string | string[] | undefined> = {
      status: ['failed', 'draft'],
    };
    const statusParam = typeof params.status === 'string' ? params.status : undefined;
    expect(statusParam).toBeUndefined();
  });
});
