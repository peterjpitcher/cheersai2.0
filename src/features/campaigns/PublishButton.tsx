'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { publishCampaign, pauseCampaign } from '@/app/(app)/campaigns/[id]/actions';
import { useToast } from '@/components/providers/toast-provider';

interface Props {
  campaignId: string;
  status: string;
}

export function PublishButton({ campaignId, status }: Props) {
  const toast = useToast();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (status === 'DRAFT') {
    return (
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            const result = await publishCampaign(campaignId);
            if (result.success) {
              toast.success('Campaign published to Meta');
              router.refresh();
            } else {
              toast.error('Publish failed', { description: result.error });
            }
          });
        }}
        className="rounded-full bg-brand-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-navy/90 disabled:opacity-60"
      >
        {isPending ? 'Publishing…' : 'Publish to Meta'}
      </button>
    );
  }

  if (status === 'ACTIVE') {
    return (
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            const result = await pauseCampaign(campaignId);
            if (result.success) {
              toast.success('Campaign paused');
              router.refresh();
            } else {
              toast.error('Pause failed', { description: result.error });
            }
          });
        }}
        className="rounded-full border border-amber-400 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-60"
      >
        {isPending ? 'Pausing…' : 'Pause Campaign'}
      </button>
    );
  }

  return null;
}
