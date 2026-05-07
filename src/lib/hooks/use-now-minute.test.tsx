// @vitest-environment jsdom
// src/lib/hooks/use-now-minute.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNowMinute } from '@/lib/hooks/use-now-minute';

describe('useNowMinute', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-03T10:00:30Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a Date aligned to the start of the current minute', () => {
    const { result } = renderHook(() => useNowMinute());
    expect(result.current.getSeconds()).toBe(0);
    expect(result.current.getMinutes()).toBe(0);
    expect(result.current.getUTCHours()).toBe(10);
  });

  it('updates exactly once per minute', () => {
    const { result } = renderHook(() => useNowMinute());
    const first = result.current;
    act(() => { vi.advanceTimersByTime(59_500); });
    expect(result.current).toBe(first);
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(result.current).not.toBe(first);
    expect(result.current.getMinutes()).toBe(1);
  });

  it('cleans up its timer on unmount', () => {
    const { unmount } = renderHook(() => useNowMinute());
    const before = vi.getTimerCount();
    unmount();
    const after = vi.getTimerCount();
    expect(after).toBeLessThan(before);
  });
});
