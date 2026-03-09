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
          className={n <= rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}
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

  const date = new Date(review.createTime).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="font-semibold text-sm">{review.reviewerName}</p>
          <StarRating rating={review.starRating} />
          <p className="text-xs text-muted-foreground">{date}</p>
        </div>
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${
            review.status === 'replied'
              ? 'bg-green-100 text-green-700'
              : review.status === 'draft_ready'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-slate-100 text-slate-600'
          }`}
        >
          {review.status === 'replied' ? 'Replied' : review.status === 'draft_ready' ? 'Draft ready' : 'Needs reply'}
        </span>
      </div>

      {review.comment && (
        <p className="text-sm text-foreground/80 leading-relaxed">{review.comment}</p>
      )}

      {posted && review.replyComment && (
        <div className="rounded-lg bg-muted/50 px-4 py-3 text-sm text-muted-foreground border border-border/50">
          <p className="text-xs font-medium mb-1">Your reply</p>
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
                onBlur={handleDraftBlur}
                rows={4}
                disabled={isPending}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                placeholder="Edit your response here..."
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handlePost}
                  disabled={isPending || !draft.trim()}
                  className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPending ? 'Posting...' : 'Post reply'}
                </button>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={isPending}
                  className="rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
                >
                  Regenerate
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isPending}
              className="w-full rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              {isPending ? 'Generating...' : 'Generate response'}
            </button>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
