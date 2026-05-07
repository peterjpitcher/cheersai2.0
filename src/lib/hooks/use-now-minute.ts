// src/lib/hooks/use-now-minute.ts
'use client';

import { useEffect, useState } from 'react';

function startOfMinute(d: Date): Date {
  const out = new Date(d);
  out.setSeconds(0, 0);
  return out;
}

/**
 * Returns a Date pinned to the start of the current minute, updating once
 * every 60 seconds. Use for relative-time UI (banner overlays, scheduling
 * badges) that needs to recompute when the wall clock crosses a minute,
 * hour, or day boundary while the page stays open.
 */
export function useNowMinute(): Date {
  const [now, setNow] = useState<Date>(() => startOfMinute(new Date()));

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(startOfMinute(new Date()));
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  return now;
}
