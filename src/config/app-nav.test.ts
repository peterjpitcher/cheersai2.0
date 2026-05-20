import { describe, it, expect } from 'vitest';

import {
  APP_NAV_ITEMS,
  MOBILE_NAV_ITEMS,
  getOverflowItems,
  isNavActive,
} from './app-nav';

describe('APP_NAV_ITEMS', () => {
  it('should have tournaments href as /tournaments (not /dashboard/tournaments)', () => {
    const tournaments = APP_NAV_ITEMS.find((item) => item.id === 'tournaments');
    expect(tournaments).toBeDefined();
    expect(tournaments!.href).toBe('/tournaments');
  });

  it('should include a Settings entry', () => {
    const settings = APP_NAV_ITEMS.find((item) => item.id === 'settings');
    expect(settings).toBeDefined();
    expect(settings!.href).toBe('/settings');
  });
});

describe('MOBILE_NAV_ITEMS', () => {
  it('should have a "More" overflow entry', () => {
    const more = MOBILE_NAV_ITEMS.find((item) => item.isOverflow);
    expect(more).toBeDefined();
    expect(more!.id).toBe('more');
    expect(more!.label).toBe('More');
  });
});

describe('getOverflowItems', () => {
  it('should return items from APP_NAV_ITEMS not in the mobile bottom bar', () => {
    const overflow = getOverflowItems();
    const overflowIds = overflow.map((item) => item.id);

    // These are in MOBILE_NAV_ITEMS and should NOT be in overflow
    expect(overflowIds).not.toContain('planner');
    expect(overflowIds).not.toContain('create');
    expect(overflowIds).not.toContain('library');
    expect(overflowIds).not.toContain('connections');

    // These are NOT in MOBILE_NAV_ITEMS and should be in overflow
    expect(overflowIds).toContain('campaigns');
    expect(overflowIds).toContain('reviews');
    expect(overflowIds).toContain('tournaments');
    expect(overflowIds).toContain('settings');
  });

  it('should include Settings in the overflow items', () => {
    const overflow = getOverflowItems();
    const settings = overflow.find((item) => item.id === 'settings');
    expect(settings).toBeDefined();
    expect(settings!.href).toBe('/settings');
  });
});

describe('isNavActive', () => {
  it('should not mark /dashboard as active for any item', () => {
    expect(isNavActive('/planner', '/dashboard')).toBe(false);
    expect(isNavActive('/tournaments', '/dashboard')).toBe(false);
  });

  it('should mark /tournaments as active for /tournaments pathname', () => {
    expect(isNavActive('/tournaments', '/tournaments')).toBe(true);
  });

  it('should mark /tournaments as active for nested tournament paths', () => {
    expect(isNavActive('/tournaments', '/tournaments/abc-123')).toBe(true);
  });

  it('should mark /planner as active for /planner pathname', () => {
    expect(isNavActive('/planner', '/planner')).toBe(true);
    expect(isNavActive('/planner', '/planner/week')).toBe(true);
  });

  it('should not mark /planner as active for unrelated paths', () => {
    expect(isNavActive('/planner', '/campaigns')).toBe(false);
  });
});
