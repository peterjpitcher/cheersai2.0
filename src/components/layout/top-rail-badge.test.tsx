import { describe, it, expect } from 'vitest';

import { formatBadgeCount } from './top-rail';

describe('formatBadgeCount', () => {
  it('should return "99+" when count is 100', () => {
    expect(formatBadgeCount(100)).toBe('99+');
  });

  it('should return "99+" when count is 1988', () => {
    expect(formatBadgeCount(1988)).toBe('99+');
  });

  it('should return "5" when count is 5', () => {
    expect(formatBadgeCount(5)).toBe('5');
  });

  it('should return "99" when count is exactly 99', () => {
    expect(formatBadgeCount(99)).toBe('99');
  });

  it('should return "0" when count is 0', () => {
    expect(formatBadgeCount(0)).toBe('0');
  });

  it('should return "1" when count is 1', () => {
    expect(formatBadgeCount(1)).toBe('1');
  });
});
