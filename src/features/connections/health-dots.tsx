/**
 * Sidebar health dot indicators (per D-01 design requirement).
 * Shows three small coloured circles (one per platform) next to Connections.
 *
 * This is a client component that receives pre-fetched health summaries
 * from the server layout. The dots render inline next to nav text.
 */

'use client';

import type { ConnectionHealth, ConnectionHealthSummary, ProviderPlatform } from '@/types/providers';

const HEALTH_COLORS: Record<ConnectionHealth, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
};

const PLATFORM_ORDER: ProviderPlatform[] = ['facebook', 'instagram', 'gbp'];

interface ConnectionHealthDotsProps {
  summaries: ConnectionHealthSummary[];
}

/**
 * Render small coloured dots indicating per-platform connection health.
 * Shows nothing if no summaries are available.
 */
export function ConnectionHealthDots({ summaries }: ConnectionHealthDotsProps): React.ReactElement | null {
  if (!summaries.length) return null;

  const healthByPlatform = new Map(summaries.map(s => [s.provider, s.health]));

  return (
    <span className="inline-flex items-center gap-1 ml-2" aria-label="Connection health status">
      {PLATFORM_ORDER.map(platform => {
        const health = healthByPlatform.get(platform);
        if (!health) return null;
        return (
          <span
            key={platform}
            className={`inline-block h-2 w-2 rounded-full ${HEALTH_COLORS[health]}`}
            title={`${platform}: ${health}`}
            aria-label={`${platform} connection ${health}`}
          />
        );
      })}
    </span>
  );
}
