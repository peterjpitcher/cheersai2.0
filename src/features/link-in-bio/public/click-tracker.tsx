'use client';

/**
 * Click tracker for public link-in-bio tile links (D-09).
 * Thin client wrapper that calls trackTileClick server action on click,
 * then navigates to the href. No third-party tracking scripts (LIB-05).
 * Client-side debounce: 200ms to prevent double-fire from React 19 concurrent features.
 */

import { useCallback, useRef } from 'react';

import { trackTileClick } from '@/lib/link-in-bio/click-tracking';

interface ClickTrackerProps {
  slug: string;
  tileId: string;
  href: string;
  children: React.ReactNode;
}

export function ClickTracker({ slug, tileId, href, children }: ClickTrackerProps) {
  const lastClickRef = useRef<number>(0);

  const handleClick = useCallback(
    () => {
      const now = Date.now();
      if (now - lastClickRef.current < 200) {
        return; // Debounce: 200ms
      }
      lastClickRef.current = now;

      // Fire-and-forget: do not await -- don't block navigation
      const referrer = typeof document !== 'undefined' ? document.referrer : null;
      void trackTileClick(slug, tileId, referrer);

      // Let the <a> tag handle navigation naturally
      // No need to prevent default or programmatically navigate
    },
    [slug, tileId],
  );

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={handleClick}
      className="group flex flex-col"
    >
      {children}
    </a>
  );
}
