/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: () => '/planner',
}));

// Mock @/lib/utils
vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { BottomNav } from './bottom-nav';
import { getOverflowItems } from '@/config/app-nav';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

/** Helper: find the More button inside the nav element */
function getMoreButton(): HTMLElement {
  const nav = screen.getByRole('navigation', { name: 'Mobile navigation' });
  const buttons = within(nav).getAllByRole('button');
  const more = buttons.find((b) => b.getAttribute('aria-label') === 'More navigation options');
  if (!more) throw new Error('More button not found');
  return more;
}

describe('BottomNav', () => {
  it('should render the More button', () => {
    render(<BottomNav />);
    const moreButton = getMoreButton();
    expect(moreButton).toBeInTheDocument();
  });

  it('should show overflow menu when More is tapped', () => {
    render(<BottomNav />);

    // Menu should not be visible initially
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    // Tap More
    fireEvent.click(getMoreButton());

    // Menu should now be visible
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('should contain items not in the main bottom nav', () => {
    render(<BottomNav />);
    fireEvent.click(getMoreButton());

    const overflow = getOverflowItems();
    const menu = screen.getByRole('menu');

    for (const item of overflow) {
      const link = menu.querySelector(`a[href="${item.href}"]`);
      expect(link).toBeTruthy();
    }
  });

  it('should include Settings in the overflow menu', () => {
    render(<BottomNav />);
    fireEvent.click(getMoreButton());

    const menu = screen.getByRole('menu');
    const settingsLink = menu.querySelector('a[href="/settings"]');
    expect(settingsLink).toBeTruthy();
  });

  it('should have clickable links in the overflow menu', () => {
    render(<BottomNav />);
    fireEvent.click(getMoreButton());

    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems.length).toBeGreaterThan(0);

    // Each menu item should be a link with an href
    for (const menuItem of menuItems) {
      expect(menuItem.tagName).toBe('A');
      expect(menuItem.getAttribute('href')).toBeTruthy();
    }
  });

  it('should close overflow menu on Escape key', () => {
    render(<BottomNav />);
    fireEvent.click(getMoreButton());

    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
