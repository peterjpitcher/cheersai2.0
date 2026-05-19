'use client';

/**
 * Publish status card for individual publish jobs.
 * Shows platform badge, status chip, error details with plain-English
 * explanations, retry count, and retry button for failed jobs.
 */

import { PlatformBadge } from '@/components/ui/platform-badge';
import { StatusChip } from '@/components/ui/status-chip';
import { getPlainEnglishError } from '@/lib/publishing/error-messages';
import { ErrorClassification } from '@/lib/providers/errors';
import { RetryButton } from './retry-button';
import type { Platform, ContentStatus } from '@/types/content';

interface PublishStatusCardProps {
  job: {
    id: string;
    platform: Platform;
    status: ContentStatus;
    errorMessage: string | null;
    errorCode: string | null;
    retryCount: number;
    maxRetries: number;
    completedAt: string | null;
  };
  onRetried?: () => void;
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/London',
    });
  } catch {
    return iso;
  }
}

export function PublishStatusCard({ job, onRetried }: PublishStatusCardProps): React.JSX.Element {
  const isClassification = job.errorCode
    && Object.values(ErrorClassification).includes(job.errorCode as ErrorClassification);

  const plainError = isClassification
    ? getPlainEnglishError(job.errorCode as ErrorClassification)
    : null;

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <PlatformBadge platform={job.platform} showLabel />
        <StatusChip status={job.status} size="sm" />
      </div>

      {job.status === 'failed' && (
        <div className="space-y-3">
          {/* Error details */}
          <div className="rounded-md border p-3" style={{ borderColor: 'var(--c-claret-soft)', backgroundColor: 'var(--c-claret-soft)' }}>
            {plainError && (
              <div className="mb-2">
                <p className="text-sm font-semibold" style={{ color: 'var(--c-claret)' }}>
                  {plainError.title}
                </p>
                <p className="text-sm" style={{ color: 'var(--c-claret)' }}>
                  {plainError.description}
                </p>
              </div>
            )}
            {job.errorMessage && (
              <p className="text-xs" style={{ color: 'var(--c-claret)' }}>
                {job.errorMessage}
              </p>
            )}
          </div>

          {/* Retry count */}
          <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
            Attempt {job.retryCount} of {job.maxRetries}
          </p>

          {/* Retry button */}
          <RetryButton jobId={job.id} onRetried={onRetried} />
        </div>
      )}

      {job.status === 'publishing' && (
        <div className="flex items-center gap-2">
          <span className="size-2 animate-pulse rounded-full bg-blue-500" aria-hidden="true" />
          <p className="text-sm" style={{ color: 'var(--c-ink-2)' }}>
            Publishing to {job.platform === 'gbp' ? 'Google Business Profile' : job.platform.charAt(0).toUpperCase() + job.platform.slice(1)}...
          </p>
        </div>
      )}

      {job.status === 'published' && (
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-green-500" aria-hidden="true" />
          <p className="text-sm" style={{ color: 'var(--c-status-posted-fg)' }}>
            Published{job.completedAt ? ` on ${formatTimestamp(job.completedAt)}` : ''}
          </p>
        </div>
      )}
    </div>
  );
}
