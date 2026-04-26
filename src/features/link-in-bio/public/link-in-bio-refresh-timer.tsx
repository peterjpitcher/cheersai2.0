"use client";

import { useEffect } from "react";

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Invisible client component that reloads the page every hour
 * so proximity banner labels stay fresh across day boundaries.
 */
export function LinkInBioRefreshTimer(): null {
  useEffect(() => {
    const interval = setInterval(() => {
      window.location.reload();
    }, ONE_HOUR_MS);
    return () => clearInterval(interval);
  }, []);

  return null;
}
