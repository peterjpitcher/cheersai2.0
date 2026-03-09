import Link from 'next/link';

import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { CampaignList } from '@/features/campaigns/CampaignList';
import { getCampaigns } from './actions';
import { getAdAccountSetupStatus } from '../connections/actions-ads';

export default async function CampaignsPage() {
  const [campaigns, adStatus] = await Promise.all([
    getCampaigns(),
    getAdAccountSetupStatus(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Campaigns"
        description="Paid media campaigns for Meta"
        action={
          adStatus.setupComplete ? (
            <Button asChild>
              <Link href="/campaigns/new">New Campaign</Link>
            </Button>
          ) : undefined
        }
      />

      {!adStatus.setupComplete && (
        <div className="rounded-xl border border-amber-200/60 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-400">
          <strong>Meta Ads not connected.</strong>{' '}
          <Link href="/connections" className="underline hover:text-amber-900 font-medium">
            Complete the Meta Ads setup in Connections
          </Link>{' '}
          before creating campaigns.
        </div>
      )}

      <CampaignList campaigns={campaigns} />
    </div>
  );
}
