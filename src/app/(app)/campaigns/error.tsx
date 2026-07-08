'use client';

import { useEffect } from 'react';

/**
 * Error boundary for the campaigns routes (/campaigns and /campaigns/[id]).
 *
 * getCampaignDashboard() and getCampaignWithTree() rethrow DB and Meta load failures; without
 * this boundary those surface as an unstyled Next.js error screen. This renders a branded,
 * recoverable state whose retry re-runs the failed server render.
 */
export default function CampaignsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[campaigns] Route render failed:', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center font-sans">
      <div
        className="max-w-md px-6 py-8"
        style={{
          borderRadius: 'var(--r-xl)',
          border: '1px solid var(--c-line)',
          backgroundColor: 'var(--c-card)',
        }}
      >
        <p className="eyebrow mb-2" style={{ color: 'var(--c-claret)' }}>
          Something went wrong
        </p>
        <h1 className="mb-2 text-lg font-semibold" style={{ color: 'var(--c-ink)' }}>
          Couldn&rsquo;t load your campaigns
        </h1>
        <p className="mb-6 text-sm" style={{ color: 'var(--c-ink-3)' }}>
          The campaign data failed to load. This is usually temporary — try again, and if it keeps
          happening check your Meta Ads connection in Settings.
        </p>
        <button
          type="button"
          onClick={reset}
          className="rounded-full px-4 py-2 text-sm font-semibold transition"
          style={{ backgroundColor: 'var(--c-orange)', color: 'white' }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
