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
          <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
            {plainError && (
              <div className="mb-2">
                <p className="text-sm font-semibold text-red-800 dark:text-red-200">
                  {plainError.title}
                </p>
                <p className="text-sm text-red-700 dark:text-red-300">
                  {plainError.description}
                </p>
              </div>
            )}
            {job.errorMessage && (
              <p className="text-xs text-red-600 dark:text-red-400">
                {job.errorMessage}
              </p>
            )}
          </div>

          {/* Retry count */}
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Attempt {job.retryCount} of {job.maxRetries}
          </p>

          {/* Retry button */}
          <RetryButton jobId={job.id} onRetried={onRetried} />
        </div>
      )}

      {job.status === 'publishing' && (
        <div className="flex items-center gap-2">
          <span className="size-2 animate-pulse rounded-full bg-blue-500" aria-hidden="true" />
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            Publishing to {job.platform === 'gbp' ? 'Google Business Profile' : job.platform.charAt(0).toUpperCase() + job.platform.slice(1)}...
          </p>
        </div>
      )}

      {job.status === 'published' && (
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-green-500" aria-hidden="true" />
          <p className="text-sm text-green-700 dark:text-green-300">
            Published{job.completedAt ? ` on ${formatTimestamp(job.completedAt)}` : ''}
          </p>
        </div>
      )}
    </div>
  );
}
