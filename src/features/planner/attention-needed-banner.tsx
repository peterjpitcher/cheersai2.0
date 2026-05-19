'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

import { useFailedPublishCount } from '@/hooks/use-realtime-feed';

interface AttentionNeededBannerProps {
  accountId: string;
  initialCount: number;
}

/**
 * Banner shown at top of planner when there are failed publish jobs.
 * Count updates in realtime via Supabase Realtime subscriptions (D-07).
 */
export function AttentionNeededBanner({ accountId, initialCount }: AttentionNeededBannerProps) {
  const count = useFailedPublishCount(accountId, initialCount);

  if (count === 0) return null;

  return (
    <div
      data-testid="attention-needed-banner"
      className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3"
    >
      <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
      <p className="text-sm font-medium text-amber-800">
        {count} post{count !== 1 ? 's' : ''} need{count === 1 ? 's' : ''} attention
      </p>
      <Link
        href="/planner?status=failed"
        className="ml-auto text-sm font-semibold text-amber-700 underline hover:text-amber-900"
      >
        Review
      </Link>
    </div>
  );
}
