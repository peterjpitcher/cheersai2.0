'use client';

/**
 * Recurring campaign lifecycle controls (06-05, D-14).
 * Displays pause/resume/stop actions for recurring (weekly) campaigns.
 * Only renders for weekly campaign types.
 */

import { useCallback, useState, useTransition } from 'react';
import { Pause, Play, Square, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

import {
  pauseRecurringCampaign,
  resumeRecurringCampaign,
  stopRecurringCampaign,
} from '@/app/actions/campaigns';
import { cn } from '@/lib/utils';

interface RecurringControlsProps {
  campaignId: string;
  campaignType: string;
  status: string;
  autoConfirm: boolean;
}

export function RecurringControls({
  campaignId,
  campaignType,
  status,
  autoConfirm,
}: RecurringControlsProps) {
  const [isPending, startTransition] = useTransition();
  const [showStopConfirm, setShowStopConfirm] = useState(false);

  // Only render for recurring campaign types (weekly, daily, monthly)
  const isRecurring = ['weekly', 'weekly_recurring', 'daily', 'monthly'].includes(campaignType);
  if (!isRecurring) return null;

  const handlePause = useCallback(() => {
    startTransition(async () => {
      const result = await pauseRecurringCampaign(campaignId);
      if (result.success) {
        toast.success('Campaign paused', {
          description: 'No new content will be published until you resume.',
        });
      } else {
        toast.error('Failed to pause campaign', {
          description: result.error ?? 'An unexpected error occurred.',
        });
      }
    });
  }, [campaignId]);

  const handleResume = useCallback(() => {
    startTransition(async () => {
      const result = await resumeRecurringCampaign(campaignId);
      if (result.success) {
        toast.success('Campaign resumed', {
          description: 'Recurring publishing will continue on schedule.',
        });
      } else {
        toast.error('Failed to resume campaign', {
          description: result.error ?? 'An unexpected error occurred.',
        });
      }
    });
  }, [campaignId]);

  const handleStop = useCallback(() => {
    startTransition(async () => {
      const result = await stopRecurringCampaign(campaignId);
      setShowStopConfirm(false);
      if (result.success) {
        toast.success('Campaign stopped', {
          description: 'All future scheduled posts have been cancelled.',
        });
      } else {
        toast.error('Failed to stop campaign', {
          description: result.error ?? 'An unexpected error occurred.',
        });
      }
    });
  }, [campaignId]);

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Recurring Campaign</span>
        </div>

        {/* Auto-confirm badge */}
        {autoConfirm ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
            <CheckCircle2 className="h-3 w-3" />
            Auto-publish enabled
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" />
            Manual approval
          </span>
        )}
      </div>

      {/* Status-dependent controls */}
      {status === 'completed' ? (
        <p className="text-sm text-muted-foreground">
          This campaign has ended. No further content will be published.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {status === 'scheduled' && (
            <button
              type="button"
              onClick={handlePause}
              disabled={isPending}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors',
                'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'disabled:pointer-events-none disabled:opacity-50',
              )}
            >
              <Pause className="h-4 w-4" />
              {isPending ? 'Pausing...' : 'Pause'}
            </button>
          )}

          {status === 'paused' && (
            <button
              type="button"
              onClick={handleResume}
              disabled={isPending}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors',
                'hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'disabled:pointer-events-none disabled:opacity-50',
              )}
            >
              <Play className="h-4 w-4" />
              {isPending ? 'Resuming...' : 'Resume'}
            </button>
          )}

          {/* Stop button (with confirmation) */}
          {(status === 'scheduled' || status === 'paused') && (
            <>
              {showStopConfirm ? (
                <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-1.5">
                  <span className="text-sm text-destructive">Stop permanently?</span>
                  <button
                    type="button"
                    onClick={handleStop}
                    disabled={isPending}
                    className="rounded bg-destructive px-2 py-0.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                  >
                    {isPending ? 'Stopping...' : 'Confirm'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowStopConfirm(false)}
                    disabled={isPending}
                    className="rounded border border-border px-2 py-0.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowStopConfirm(true)}
                  disabled={isPending}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md border border-destructive/30 px-3 py-1.5 text-sm font-medium text-destructive transition-colors',
                    'hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    'disabled:pointer-events-none disabled:opacity-50',
                  )}
                >
                  <Square className="h-4 w-4" />
                  Stop
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
