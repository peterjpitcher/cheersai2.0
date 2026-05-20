'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, X } from 'lucide-react';

import { useFailedPublishCount } from '@/hooks/use-realtime-feed';
import { Button } from '@/components/ui/button';

interface AttentionNeededBannerProps {
  accountId: string;
  initialCount: number;
}

/**
 * Banner shown at top of planner when there are failed publish jobs.
 * Count updates in realtime via Supabase Realtime subscriptions (D-07).
 * Dismissible per-session (useState, not localStorage).
 */
export function AttentionNeededBanner({ accountId, initialCount }: AttentionNeededBannerProps) {
  const count = useFailedPublishCount(accountId, initialCount);
  const [dismissed, setDismissed] = useState(false);

  if (count === 0 || dismissed) return null;

  return (
    <div
      data-testid="attention-needed-banner"
      style={{
        backgroundColor: 'var(--c-orange-soft)',
        border: '1px solid var(--c-orange)',
        borderRadius: 14,
      }}
      className="flex items-center gap-3 px-4 py-3"
    >
      {/* Icon disc */}
      <span
        className="flex shrink-0 items-center justify-center rounded-full"
        style={{
          width: 36,
          height: 36,
          backgroundColor: 'var(--c-orange)',
        }}
      >
        <AlertTriangle className="h-[18px] w-[18px] text-white" />
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p
          className="text-[14px] font-medium leading-tight"
          style={{ color: 'var(--c-ink)' }}
        >
          {count} post{count !== 1 ? 's' : ''} need{count === 1 ? 's' : ''} attention
        </p>
        <p
          className="text-[13px] leading-tight mt-0.5"
          style={{ color: 'var(--c-ink-2)' }}
        >
          Review and fix failed posts to keep your publishing on track.
        </p>
      </div>

      {/* View failed posts button */}
      <Button variant="secondary" size="sm" asChild>
        <Link href="/planner?status=failed">
          View failed posts
        </Link>
      </Button>

      {/* Dismiss button */}
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded-full p-1.5 transition hover:opacity-70"
        style={{ color: 'var(--c-ink-3)' }}
        aria-label="Dismiss banner"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
