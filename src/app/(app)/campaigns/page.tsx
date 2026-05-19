import Link from 'next/link';

import { PageHeader } from '@/components/layout/PageHeader';
import { Btn } from '@/components/ui/button';
import { CampaignDashboard } from '@/features/campaigns/CampaignDashboard';
import { getCampaignDashboard } from './actions';
import { getAdAccountSetupStatus } from '../connections/actions-ads';

export default async function CampaignsPage() {
  const [dashboard, adStatus] = await Promise.all([
    getCampaignDashboard(),
    getAdAccountSetupStatus(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Campaigns"
        description="Paid media campaigns for Meta"
        action={
          adStatus.setupComplete ? (
            <Btn asChild>
              <Link href="/campaigns/new">New Campaign</Link>
            </Btn>
          ) : undefined
        }
      />

      {!adStatus.setupComplete && (
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{
            backgroundColor: 'var(--c-orange-soft)',
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: 'var(--c-orange)',
            color: 'var(--c-ink)',
          }}
        >
          <strong>Meta Ads not connected.</strong>{' '}
          <Link
            href="/connections"
            className="underline font-medium"
            style={{ color: 'var(--c-orange-hi)' }}
          >
            Complete the Meta Ads setup in Connections
          </Link>{' '}
          before creating campaigns.
        </div>
      )}

      <CampaignDashboard dashboard={dashboard} />
    </div>
  );
}
