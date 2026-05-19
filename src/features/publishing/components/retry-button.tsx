'use client';

/**
 * Retry button for failed publish jobs (PUB-05).
 * Calls the retryPublishJob server action with loading and error states.
 */

import { useState } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { retryPublishJob } from '@/app/actions/publish';

interface RetryButtonProps {
  jobId: string;
  onRetried?: () => void;
}

export function RetryButton({ jobId, onRetried }: RetryButtonProps): React.JSX.Element {
  const [state, setState] = useState<'idle' | 'loading' | 'retrying' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleRetry() {
    setState('loading');
    setErrorMessage(null);

    try {
      const result = await retryPublishJob(jobId);

      if (result.error) {
        setState('error');
        setErrorMessage(result.error);
        return;
      }

      setState('retrying');
      onRetried?.();
    } catch {
      setState('error');
      setErrorMessage('Something went wrong. Please try again.');
    }
  }

  const isDisabled = state === 'loading' || state === 'retrying';

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleRetry}
        disabled={isDisabled}
        className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        style={{ borderColor: 'var(--c-line)', backgroundColor: 'var(--c-card)', color: 'var(--c-ink-2)' }}
      >
        {state === 'loading' ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCw className="size-4" aria-hidden="true" />
        )}
        {state === 'retrying' ? 'Retrying...' : 'Retry'}
      </button>
      {state === 'error' && errorMessage && (
        <p className="text-xs" style={{ color: 'var(--c-claret)' }}>{errorMessage}</p>
      )}
    </div>
  );
}
