'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';

import { useToast } from '@/components/providers/toast-provider';
import { deleteCampaign } from '@/app/(app)/campaigns/actions';

interface DeleteCampaignButtonProps {
  campaignId: string;
  campaignName: string;
}

export function DeleteCampaignButton({ campaignId, campaignName }: DeleteCampaignButtonProps) {
  const [isPending, setIsPending] = useState(false);
  const toast = useToast();

  async function handleDelete() {
    if (!confirm(`Delete "${campaignName}"? This cannot be undone.`)) return;

    setIsPending(true);
    const result = await deleteCampaign(campaignId);
    setIsPending(false);

    if ('error' in result) {
      toast.error(result.error);
    } else {
      toast.success('Campaign deleted');
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={isPending}
      aria-label={`Delete campaign ${campaignName}`}
      className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
