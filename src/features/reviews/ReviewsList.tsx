'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

import type { GbpReview, ReviewStatus } from '@/types/reviews';
import { ReviewCard } from './ReviewCard';
import { syncGbpReviews } from '@/app/(app)/reviews/actions';
import { Card } from '@/components/ui/card';

interface ReviewsListProps {
  reviews: GbpReview[];
  lastSynced: string | null;
  pendingCount: number;
  avgRating: string | null;
  totalCount: number;
}

const STATUS_FILTERS: { label: string; value: ReviewStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Needs reply', value: 'pending' },
  { label: 'Replied', value: 'replied' },
];

const STAR_FILTERS = [0, 5, 4, 3, 2, 1];

export function ReviewsList({ reviews, lastSynced, pendingCount, avgRating, totalCount }: ReviewsListProps) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<ReviewStatus | 'all'>('all');
  const [starFilter, setStarFilter] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<Date | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!retryAfter) return;
    const tick = () => {
      const remaining = Math.ceil((retryAfter.getTime() - Date.now()) / 1000);
      if (remaining <= 0) {
        setSecondsLeft(0);
        setRetryAfter(null);
      } else {
        setSecondsLeft(remaining);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [retryAfter]);

  const handleRefresh = () => {
    setSyncError(null);
    setSyncMessage(null);
    setRetryAfter(null);
    startTransition(async () => {
      const result = await syncGbpReviews();
      if (result.error) {
        setSyncError(result.error);
        if (result.retryAfter) setRetryAfter(new Date(result.retryAfter));
        return;
      }
      setSyncMessage(`Synced ${result.synced ?? 0} review${result.synced === 1 ? '' : 's'}.`);
      router.refresh();
    });
  };

  const filtered = reviews.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (starFilter > 0 && r.starRating !== starFilter) return false;
    return true;
  });

  const syncedText = lastSynced
    ? `Last synced ${new Date(lastSynced).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
    : 'Not yet synced';

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {avgRating && (
          <Card>
            <div className="p-4">
              <p className="eyebrow">Average rating</p>
              <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color: 'var(--c-ink)' }}>{avgRating} ★</p>
              <p className="mt-1 text-xs" style={{ color: 'var(--c-ink-3)' }}>{totalCount} reviews</p>
            </div>
          </Card>
        )}
        <Card>
          <div className="p-4">
            <p className="eyebrow">Total reviews</p>
            <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color: 'var(--c-ink)' }}>{totalCount}</p>
          </div>
        </Card>
        {pendingCount > 0 && (
          <Card>
            <div className="p-4">
              <p className="eyebrow">Awaiting reply</p>
              <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color: 'var(--c-orange)' }}>{pendingCount}</p>
              <p className="mt-1 text-xs" style={{ color: 'var(--c-ink-3)' }}>need{pendingCount === 1 ? 's' : ''} a reply</p>
            </div>
          </Card>
        )}
        <Card>
          <div className="p-4">
            <p className="eyebrow">Last synced</p>
            <p className="mt-1 text-sm" style={{ color: 'var(--c-ink-2)' }}>{syncedText}</p>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isPending || secondsLeft > 0}
              className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium disabled:opacity-50 transition-colors"
              style={{
                borderRadius: 'var(--r-lg)',
                border: '1px solid var(--c-line)',
                backgroundColor: 'var(--c-card)',
                color: 'var(--c-ink)',
              }}
            >
              <RefreshCw size={14} className={isPending ? 'animate-spin' : ''} />
              {isPending ? 'Refreshing...' : secondsLeft > 0 ? `Retry in ${secondsLeft}s` : 'Refresh'}
            </button>
          </div>
        </Card>
      </div>

      {syncError && (
        <p className="text-xs" style={{ color: 'var(--c-claret)' }}>
          {syncError}
          {secondsLeft > 0 && ` Retry available in ${secondsLeft}s.`}
        </p>
      )}
      {!syncError && syncMessage && (
        <p className="text-xs" style={{ color: 'var(--c-status-posted-fg)' }}>
          {syncMessage}
        </p>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            className="rounded-full px-3 py-1 text-xs font-medium transition-colors"
            style={{
              backgroundColor: statusFilter === f.value ? 'var(--c-orange)' : 'var(--c-card)',
              color: statusFilter === f.value ? 'white' : 'var(--c-ink)',
              border: statusFilter === f.value ? '1px solid var(--c-orange)' : '1px solid var(--c-line)',
            }}
          >
            {f.label}{f.value === 'pending' && pendingCount > 0 ? ` (${pendingCount})` : ''}
          </button>
        ))}
        <div className="w-px mx-1" style={{ backgroundColor: 'var(--c-line)' }} />
        {STAR_FILTERS.map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => setStarFilter(star === starFilter ? 0 : star)}
            className="rounded-full px-3 py-1 text-xs font-medium transition-colors"
            style={{
              backgroundColor: starFilter === star && star > 0 ? 'var(--c-orange-soft)' : 'var(--c-card)',
              color: starFilter === star && star > 0 ? 'var(--c-orange-hi)' : 'var(--c-ink)',
              border: starFilter === star && star > 0 ? '1px solid var(--c-orange)' : '1px solid var(--c-line)',
            }}
          >
            {star === 0 ? 'All stars' : `${star} ★`}
          </button>
        ))}
      </div>

      {/* Review cards */}
      {filtered.length === 0 ? (
        <div
          className="p-10 text-center text-sm"
          style={{
            borderRadius: 'var(--r-xl)',
            border: '1px solid var(--c-line)',
            backgroundColor: 'var(--c-card)',
            color: 'var(--c-ink-3)',
          }}
        >
          {reviews.length === 0
            ? 'No reviews yet. Click Refresh to sync from Google.'
            : 'No reviews match the selected filters.'}
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </div>
      )}
    </div>
  );
}
