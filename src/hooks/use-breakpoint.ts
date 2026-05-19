'use client';

import { useEffect, useState } from 'react';

/** Breakpoint names matching Tailwind conventions */
export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

interface BreakpointResult {
  breakpoint: Breakpoint;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
}

/** Breakpoint thresholds: mobile < 640px, tablet 640-1023px, desktop >= 1024px */
const TABLET_MIN = 640;
const DESKTOP_MIN = 1024;

function getBreakpoint(width: number): Breakpoint {
  if (width < TABLET_MIN) return 'mobile';
  if (width < DESKTOP_MIN) return 'tablet';
  return 'desktop';
}

/**
 * Detects current responsive breakpoint using matchMedia listeners.
 * SSR defaults to 'desktop' to avoid layout shift on hydration for
 * the most common server-render target.
 */
export function useBreakpoint(): BreakpointResult {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>('desktop');

  useEffect(() => {
    // Set initial value from actual window width
    setBreakpoint(getBreakpoint(window.innerWidth));

    const tabletQuery = window.matchMedia(`(min-width: ${TABLET_MIN}px)`);
    const desktopQuery = window.matchMedia(`(min-width: ${DESKTOP_MIN}px)`);

    const update = () => {
      setBreakpoint(getBreakpoint(window.innerWidth));
    };

    tabletQuery.addEventListener('change', update);
    desktopQuery.addEventListener('change', update);

    return () => {
      tabletQuery.removeEventListener('change', update);
      desktopQuery.removeEventListener('change', update);
    };
  }, []);

  return {
    breakpoint,
    isMobile: breakpoint === 'mobile',
    isTablet: breakpoint === 'tablet',
    isDesktop: breakpoint === 'desktop',
  };
}
