'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Loader2 } from 'lucide-react';
import { getFixturePreview } from '@/app/actions/tournament';
import type { PreviewItem } from '@/app/actions/tournament';

interface FixturePreviewModalProps {
  open: boolean;
  onClose: () => void;
  tournamentId: string;
  fixtureId: string;
  fixtureLabel: string;
}

const CONTENT_STATUS_STYLES: Record<string, React.CSSProperties> = {
  draft: { backgroundColor: 'var(--c-paper-2)', color: 'var(--c-ink-3)' },
  scheduled: { backgroundColor: 'var(--c-status-posted-bg)', color: 'var(--c-status-posted-fg)' },
  publishing: { backgroundColor: 'var(--c-orange-tint)', color: 'var(--c-orange-hi)' },
  succeeded: { backgroundColor: 'var(--c-status-posted-bg)', color: 'var(--c-status-posted-fg)' },
  failed: { backgroundColor: 'var(--c-claret-soft)', color: 'var(--c-claret)' },
};

function ContentStatusBadge({ status }: { status: string }) {
  const style = CONTENT_STATUS_STYLES[status] ?? { backgroundColor: 'var(--c-paper-2)', color: 'var(--c-ink-3)' };
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize"
      style={style}
    >
      {status}
    </span>
  );
}

export function FixturePreviewModal({
  open,
  onClose,
  tournamentId,
  fixtureId,
  fixtureLabel,
}: FixturePreviewModalProps) {
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function fetchPreview() {
      setLoading(true);
      setError(null);
      try {
        const result = await getFixturePreview(tournamentId, fixtureId);
        if (cancelled) return;
        if (!result.success) {
          setError(result.error ?? 'Failed to load preview');
        } else {
          setItems(result.items ?? []);
        }
      } catch {
        if (!cancelled) setError('Failed to load preview');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchPreview();

    return () => {
      cancelled = true;
    };
  }, [open, tournamentId, fixtureId]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const feedItems = items.filter((i) => i.placement === 'feed');
  const storyItems = items.filter((i) => i.placement === 'story');

  function formatScheduled(iso: string | null): string {
    if (!iso) return 'Not scheduled';
    const d = new Date(iso);
    return d.toLocaleString('en-GB', {
      timeZone: 'Europe/London',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Preview: ${fixtureLabel}`}
        tabIndex={-1}
        className="w-full max-w-3xl p-6 max-h-[90vh] overflow-y-auto"
        style={{
          backgroundColor: 'var(--c-card)',
          borderRadius: 'var(--r-xl)',
          boxShadow: 'var(--sh-lg)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2
            className="text-lg font-semibold"
            style={{ color: 'var(--c-ink)' }}
          >
            Preview: {fixtureLabel}
          </h2>
          <button onClick={onClose} aria-label="Close preview">
            <X className="h-5 w-5" style={{ color: 'var(--c-ink-3)' }} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2
              className="h-6 w-6 animate-spin"
              style={{ color: 'var(--c-ink-4)' }}
            />
          </div>
        ) : error ? (
          <div
            className="p-3 text-sm"
            style={{
              borderRadius: 'var(--r-md)',
              backgroundColor: 'var(--c-claret-soft)',
              color: 'var(--c-claret)',
            }}
          >
            {error}
          </div>
        ) : items.length === 0 ? (
          <div
            className="py-12 text-center text-sm"
            style={{ color: 'var(--c-ink-3)' }}
          >
            No generated content for this fixture.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {feedItems.length > 0 && (
              <div>
                <h3
                  className="text-sm font-medium mb-3"
                  style={{ color: 'var(--c-ink)' }}
                >
                  Feed (Square)
                </h3>
                {feedItems.map((item, i) => (
                  <div key={i} className="space-y-2 mb-4">
                    {item.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.imageUrl}
                        alt="Feed preview"
                        className="w-full"
                        style={{
                          borderRadius: 'var(--r-lg)',
                          border: '1px solid var(--c-line)',
                        }}
                      />
                    )}
                    <div className="flex items-center gap-2">
                      <span
                        className="text-xs font-medium capitalize"
                        style={{ color: 'var(--c-ink-2)' }}
                      >
                        {item.platform}
                      </span>
                      <ContentStatusBadge status={item.status} />
                    </div>
                    <p
                      className="text-xs"
                      style={{ color: 'var(--c-ink-3)' }}
                    >
                      {formatScheduled(item.scheduledFor)}
                    </p>
                    {item.captionText && (
                      <p
                        className="text-sm whitespace-pre-wrap p-2"
                        style={{
                          borderRadius: 'var(--r-md)',
                          border: '1px solid var(--c-line)',
                          backgroundColor: 'var(--c-paper)',
                          color: 'var(--c-ink-2)',
                        }}
                      >
                        {item.captionText}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {storyItems.length > 0 && (
              <div>
                <h3
                  className="text-sm font-medium mb-3"
                  style={{ color: 'var(--c-ink)' }}
                >
                  Story
                </h3>
                {storyItems.map((item, i) => (
                  <div key={i} className="space-y-2 mb-4">
                    {item.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.imageUrl}
                        alt="Story preview"
                        className="w-full max-w-[200px]"
                        style={{
                          borderRadius: 'var(--r-lg)',
                          border: '1px solid var(--c-line)',
                        }}
                      />
                    )}
                    <div className="flex items-center gap-2">
                      <span
                        className="text-xs font-medium capitalize"
                        style={{ color: 'var(--c-ink-2)' }}
                      >
                        {item.platform}
                      </span>
                      <ContentStatusBadge status={item.status} />
                    </div>
                    <p
                      className="text-xs"
                      style={{ color: 'var(--c-ink-3)' }}
                    >
                      {formatScheduled(item.scheduledFor)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm transition-colors"
            style={{
              color: 'var(--c-ink-3)',
              borderRadius: 'var(--r-md)',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
