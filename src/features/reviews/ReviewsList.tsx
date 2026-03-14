'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

import type { GbpReview, ReviewStatus } from '@/types/reviews';
import { ReviewCard } from './ReviewCard';
import { syncGbpReviews } from '@/app/(app)/reviews/actions';

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
      {/* Summary bar */}
      <div className="rounded-xl border border-border bg-card p-5 flex flex-wrap gap-6 items-center justify-between">
        <div className="flex gap-8">
          {avgRating && (
            <div>
              <p className="text-2xl font-bold">{avgRating} ★</p>
              <p className="text-xs text-muted-foreground">{totalCount} reviews</p>
            </div>
          )}
          {pendingCount > 0 && (
            <div>
              <p className="text-2xl font-bold text-amber-600">{pendingCount}</p>
              <p className="text-xs text-muted-foreground">need{pendingCount === 1 ? 's' : ''} a reply</p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground">{syncedText}</p>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isPending || secondsLeft > 0}
            className="flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw size={14} className={isPending ? 'animate-spin' : ''} />
            {isPending ? 'Refreshing...' : secondsLeft > 0 ? `Retry in ${secondsLeft}s` : 'Refresh'}
          </button>
        </div>
        {syncError && (
          <p className="w-full text-xs text-destructive">
            {syncError}
            {secondsLeft > 0 && ` Retry available in ${secondsLeft}s.`}
          </p>
        )}
        {!syncError && syncMessage && (
          <p className="w-full text-xs text-emerald-700">
            {syncMessage}
          </p>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              statusFilter === f.value
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-input hover:bg-accent'
            }`}
          >
            {f.label}
          </button>
        ))}
        <div className="w-px bg-border mx-1" />
        {STAR_FILTERS.map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => setStarFilter(star === starFilter ? 0 : star)}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              starFilter === star && star > 0
                ? 'bg-amber-100 text-amber-700 border-amber-300'
                : 'bg-background border-input hover:bg-accent'
            }`}
          >
            {star === 0 ? 'All stars' : `${star} ★`}
          </button>
        ))}
      </div>

      {/* Review cards */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-muted-foreground text-sm">
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
