'use client';

import { useState, useTransition } from 'react';
import { Star } from 'lucide-react';

import type { GbpReview } from '@/types/reviews';
import { generateAiDraft, postReply, saveAiDraft } from '@/app/(app)/reviews/actions';

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={14}
          className={n <= rating ? 'fill-current' : ''}
          style={{ color: n <= rating ? 'var(--c-orange)' : 'var(--c-ink-4)' }}
        />
      ))}
    </div>
  );
}

export function ReviewCard({ review }: { review: GbpReview }) {
  const [draft, setDraft] = useState(review.aiDraft ?? '');
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(review.status === 'replied');
  const [isPending, startTransition] = useTransition();

  const handleGenerate = () => {
    setError(null);
    startTransition(async () => {
      const result = await generateAiDraft(review.id);
      if (result.error) { setError(result.error); return; }
      setDraft(result.draft ?? '');
    });
  };

  const handlePost = () => {
    if (!draft.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await postReply(review.id, draft.trim());
      if (result.error) { setError(result.error); return; }
      setPosted(true);
    });
  };

  const handleDraftChange = (value: string) => {
    setDraft(value);
  };

  const handleDraftBlur = () => {
    if (draft !== review.aiDraft) {
      startTransition(async () => { await saveAiDraft(review.id, draft); });
    }
  };

  const needsCare = review.starRating <= 3;

  const date = new Date(review.createTime).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  return (
    <div
      className="p-5 space-y-3"
      style={{
        borderRadius: 'var(--r-xl)',
        border: '1px solid var(--c-line)',
        backgroundColor: 'var(--c-card)',
        boxShadow: 'var(--sh-xs)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="font-semibold text-sm" style={{ color: 'var(--c-ink)' }}>{review.reviewerName}</p>
          <StarRating rating={review.starRating} />
          <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>{date}</p>
        </div>
        <div className="flex items-center gap-2">
          {needsCare && (
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full shrink-0"
              style={{ backgroundColor: 'var(--c-claret-soft)', color: 'var(--c-claret)' }}
            >
              Needs care
            </span>
          )}
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full shrink-0"
            style={{
              backgroundColor: review.status === 'replied'
                ? 'var(--c-status-posted-bg)'
                : review.status === 'draft_ready'
                  ? 'var(--c-orange-soft)'
                  : 'var(--c-paper-2)',
              color: review.status === 'replied'
                ? 'var(--c-status-posted-fg)'
                : review.status === 'draft_ready'
                  ? 'var(--c-orange-hi)'
                  : 'var(--c-ink-3)',
            }}
          >
            {review.status === 'replied' ? 'Replied' : review.status === 'draft_ready' ? 'Draft ready' : 'Needs reply'}
          </span>
        </div>
      </div>

      {review.comment && (
        <p className="text-sm leading-relaxed" style={{ color: 'var(--c-ink-2)' }}>{review.comment}</p>
      )}

      {posted && review.replyComment && (
        <div
          className="px-4 py-3 text-sm"
          style={{
            borderRadius: 'var(--r-lg)',
            backgroundColor: 'var(--c-status-posted-bg)',
            border: '1px solid color-mix(in srgb, var(--c-status-posted-fg) 20%, transparent)',
            color: 'var(--c-ink-2)',
          }}
        >
          <p className="text-xs font-medium mb-1" style={{ color: 'var(--c-status-posted-fg)' }}>Your reply</p>
          <p>{review.replyComment}</p>
        </div>
      )}

      {!posted && (
        <div className="space-y-2 pt-1">
          {(draft || review.status === 'draft_ready') ? (
            <>
              <textarea
                value={draft}
                onChange={(e) => handleDraftChange(e.target.value)}
                onBlur={(e) => { e.currentTarget.style.boxShadow = 'none'; handleDraftBlur(); }}
                rows={4}
                disabled={isPending}
                className="w-full px-3 py-2 text-sm resize-none disabled:opacity-50"
                style={{
                  borderRadius: 'var(--r-lg)',
                  border: '1px dashed var(--c-orange-hi)',
                  backgroundColor: 'var(--c-card)',
                  color: 'var(--c-ink)',
                  outline: 'none',
                }}
                onFocus={(e) => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--c-orange)'; }}
                placeholder="Edit your response here..."
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handlePost}
                  disabled={isPending || !draft.trim()}
                  className="flex-1 px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  style={{
                    borderRadius: 'var(--r-lg)',
                    backgroundColor: 'var(--c-orange)',
                    color: 'white',
                  }}
                >
                  {isPending ? 'Posting...' : 'Post reply'}
                </button>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={isPending}
                  className="px-4 py-2 text-sm font-medium disabled:opacity-50 transition-colors"
                  style={{
                    borderRadius: 'var(--r-lg)',
                    border: '1px solid var(--c-line)',
                    backgroundColor: 'var(--c-card)',
                    color: 'var(--c-ink)',
                  }}
                >
                  Try a different angle
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isPending}
              className="w-full px-4 py-2 text-sm font-medium disabled:opacity-50 transition-colors"
              style={{
                borderRadius: 'var(--r-lg)',
                border: '1px solid var(--c-line)',
                backgroundColor: 'var(--c-card)',
                color: 'var(--c-ink)',
              }}
            >
              {isPending ? 'Generating...' : 'Generate response'}
            </button>
          )}
          {error && <p className="text-xs" style={{ color: 'var(--c-claret)' }}>{error}</p>}
        </div>
      )}
    </div>
  );
}
