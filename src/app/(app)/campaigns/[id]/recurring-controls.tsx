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

  const isRecurring = ['weekly', 'weekly_recurring', 'daily', 'monthly'].includes(campaignType);

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

  if (!isRecurring) return null;

  return (
    <div
      className="p-4 space-y-3"
      style={{
        borderRadius: 'var(--r-lg)',
        border: '1px solid var(--c-line)',
        backgroundColor: 'var(--c-card)',
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4" style={{ color: 'var(--c-ink-3)' }} />
          <span className="text-sm font-medium" style={{ color: 'var(--c-ink)' }}>Recurring Campaign</span>
        </div>

        {/* Auto-confirm badge */}
        {autoConfirm ? (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
            style={{ backgroundColor: 'var(--c-status-posted-bg)', color: 'var(--c-status-posted-fg)' }}
          >
            <CheckCircle2 className="h-3 w-3" />
            Auto-publish enabled
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
            style={{ backgroundColor: 'var(--c-orange-soft)', color: 'var(--c-orange-hi)' }}
          >
            <AlertTriangle className="h-3 w-3" />
            Manual approval
          </span>
        )}
      </div>

      {/* Status-dependent controls */}
      {status === 'completed' ? (
        <p className="text-sm" style={{ color: 'var(--c-ink-3)' }}>
          This campaign has ended. No further content will be published.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {status === 'scheduled' && (
            <button
              type="button"
              onClick={handlePause}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50"
              style={{
                borderRadius: 'var(--r-md)',
                border: '1px solid var(--c-line)',
                color: 'var(--c-ink)',
              }}
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50"
              style={{
                borderRadius: 'var(--r-md)',
                backgroundColor: 'var(--c-orange)',
                color: 'white',
              }}
            >
              <Play className="h-4 w-4" />
              {isPending ? 'Resuming...' : 'Resume'}
            </button>
          )}

          {/* Stop button (with confirmation) */}
          {(status === 'scheduled' || status === 'paused') && (
            <>
              {showStopConfirm ? (
                <div
                  className="flex items-center gap-2 px-3 py-1.5"
                  style={{
                    borderRadius: 'var(--r-md)',
                    border: '1px solid var(--c-claret-soft)',
                    backgroundColor: 'color-mix(in srgb, var(--c-claret-soft) 30%, transparent)',
                  }}
                >
                  <span className="text-sm" style={{ color: 'var(--c-claret)' }}>Stop permanently?</span>
                  <button
                    type="button"
                    onClick={handleStop}
                    disabled={isPending}
                    className="rounded px-2 py-0.5 text-xs font-medium disabled:opacity-50"
                    style={{ backgroundColor: 'var(--c-claret)', color: 'white' }}
                  >
                    {isPending ? 'Stopping...' : 'Confirm'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowStopConfirm(false)}
                    disabled={isPending}
                    className="rounded px-2 py-0.5 text-xs font-medium disabled:opacity-50"
                    style={{ border: '1px solid var(--c-line)', color: 'var(--c-ink)' }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowStopConfirm(true)}
                  disabled={isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50"
                  style={{
                    borderRadius: 'var(--r-md)',
                    border: '1px solid var(--c-claret-soft)',
                    color: 'var(--c-claret)',
                  }}
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
