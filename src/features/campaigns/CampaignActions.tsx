'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { useToast } from '@/components/providers/toast-provider';
import { publishCampaign, pauseCampaign, syncCampaignPerformance } from '@/app/(app)/campaigns/[id]/actions';

interface CampaignActionsProps {
  campaignId: string;
  status: string;
  publishError: string | null;
  hasMetaCampaign: boolean;
}

export function CampaignActions({ campaignId, status, publishError, hasMetaCampaign }: CampaignActionsProps) {
  const toast = useToast();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<'sync' | 'pause' | 'publish' | null>(null);
  const isBusy = isPending || pendingAction !== null;

  const syncButton = hasMetaCampaign ? (
    <button
      type="button"
      disabled={isBusy}
      onClick={() => {
        setPendingAction('sync');
        startTransition(async () => {
          try {
            const result = await syncCampaignPerformance(campaignId);
            if ('success' in result) {
              toast.success('Performance synced');
              router.refresh();
            } else {
              toast.error('Sync failed', { description: result.error });
            }
          } finally {
            setPendingAction(null);
          }
        });
      }}
      className="rounded-full px-4 py-2 text-sm font-semibold transition disabled:opacity-60"
      style={{
        border: '1px solid var(--c-line)',
        backgroundColor: 'var(--c-card)',
        color: 'var(--c-ink-2)',
      }}
    >
      {pendingAction === 'sync' ? 'Syncing…' : 'Sync performance'}
    </button>
  ) : null;

  if (status === 'ACTIVE') {
    return (
      <div className="flex flex-wrap justify-end gap-2">
        {syncButton}
        <button
          type="button"
          disabled={isBusy}
          onClick={() => {
            setPendingAction('pause');
            startTransition(async () => {
              try {
                const result = await pauseCampaign(campaignId);
                if (result.success) {
                  toast.success('Campaign paused');
                  router.refresh();
                } else {
                  toast.error('Pause failed', { description: result.error });
                }
              } finally {
                setPendingAction(null);
              }
            });
          }}
          className="rounded-full px-4 py-2 text-sm font-semibold transition disabled:opacity-60"
          style={{
            border: '1px solid var(--c-orange)',
            backgroundColor: 'var(--c-orange-soft)',
            color: 'var(--c-orange-hi)',
          }}
        >
          {pendingAction === 'pause' ? 'Pausing…' : 'Pause Campaign'}
        </button>
      </div>
    );
  }

  if (status === 'DRAFT' && publishError) {
    return (
      <div className="flex flex-wrap justify-end gap-2">
        {syncButton}
        <button
          type="button"
          disabled={isBusy}
          onClick={() => {
            setPendingAction('publish');
            startTransition(async () => {
              try {
                const result = await publishCampaign(campaignId);
                if (result.success) {
                  toast.success('Campaign published to Meta');
                } else {
                  toast.error('Publish failed', { description: result.error });
                }
                // Always refresh — publishCampaign updates publish_error in DB.
                router.refresh();
              } finally {
                setPendingAction(null);
              }
            });
          }}
          className="rounded-full px-4 py-2 text-sm font-semibold transition disabled:opacity-60"
          style={{
            backgroundColor: 'var(--c-orange)',
            color: 'white',
          }}
        >
          {pendingAction === 'publish' ? 'Retrying…' : 'Retry Publish'}
        </button>
      </div>
    );
  }

  return syncButton;
}
