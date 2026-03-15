import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/layout/PageHeader';
import type { CampaignObjective, CampaignStatus } from '@/types/campaigns';
import { CampaignActions } from '@/features/campaigns/CampaignActions';
import { getCampaignWithTree } from '../actions';

interface CampaignDetailPageProps {
  params: Promise<{ id: string }>;
}

const OBJECTIVE_LABELS: Record<CampaignObjective, string> = {
  OUTCOME_AWARENESS: 'Awareness',
  OUTCOME_TRAFFIC: 'Traffic',
  OUTCOME_ENGAGEMENT: 'Engagement',
  OUTCOME_LEADS: 'Leads',
  OUTCOME_SALES: 'Sales',
};

const STATUS_STYLES: Record<CampaignStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  PAUSED: 'bg-amber-100 text-amber-700',
  ARCHIVED: 'bg-secondary text-secondary-foreground',
};

export default async function CampaignDetailPage({ params }: CampaignDetailPageProps) {
  const { id } = await params;
  const campaign = await getCampaignWithTree(id);

  if (!campaign) {
    notFound();
  }

  const objectiveLabel = OBJECTIVE_LABELS[campaign.objective];
  const statusStyle = STATUS_STYLES[campaign.status];

  return (
    <div className="flex flex-col gap-6 font-sans">
      <PageHeader
        title={campaign.name}
        description={`${objectiveLabel} · ${campaign.status.charAt(0) + campaign.status.slice(1).toLowerCase()}`}
        action={
          <CampaignActions
            campaignId={campaign.id}
            status={campaign.status}
            publishError={campaign.publishError ?? null}
          />
        }
      />

      {/* Status badge */}
      <div className="flex items-center gap-3">
        <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${statusStyle}`}>
          {campaign.status.charAt(0) + campaign.status.slice(1).toLowerCase()}
        </span>
        <span className="text-sm text-muted-foreground">
          {campaign.budgetType === 'DAILY'
            ? `£${campaign.budgetAmount}/day`
            : `£${campaign.budgetAmount} total`}
        </span>
        <span className="text-sm text-muted-foreground">
          {campaign.startDate}
          {campaign.endDate ? ` – ${campaign.endDate}` : ' onwards'}
        </span>
      </div>

      {/* Publish error panel — shown when save succeeded but Meta publish failed */}
      {campaign.status === 'DRAFT' && campaign.publishError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1">
            Publishing failed
          </p>
          <p className="text-sm text-red-800">{campaign.publishError}</p>
          <p className="mt-1 text-xs text-red-600">
            Your campaign has been saved. Use the &ldquo;Retry Publish&rdquo; button to try again.
          </p>
        </div>
      )}

      {/* AI rationale */}
      {campaign.aiRationale && (
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            AI rationale
          </p>
          <p className="text-sm text-foreground">{campaign.aiRationale}</p>
        </div>
      )}

      {/* Ad sets and ads */}
      <div className="space-y-4">
        {campaign.adSets?.map((adSet) => (
          <details
            key={adSet.id}
            className="rounded-xl border border-border bg-background overflow-hidden"
            open
          >
            <summary className="flex cursor-pointer items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
              <div>
                <span className="text-sm font-semibold text-foreground">{adSet.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {adSet.ads?.length ?? 0} ad{(adSet.ads?.length ?? 0) !== 1 ? 's' : ''}
                </span>
              </div>
              <span
                className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[adSet.status as CampaignStatus] ?? 'bg-muted text-muted-foreground'}`}
              >
                {adSet.status.charAt(0) + adSet.status.slice(1).toLowerCase()}
              </span>
            </summary>

            <div className="border-t border-border divide-y divide-border">
              {adSet.ads?.map((ad) => (
                <div key={ad.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{ad.headline}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                        {ad.primaryText}
                      </p>
                    </div>
                    {!ad.mediaAssetId && (
                      <span className="flex-shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                        No creative
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {(!adSet.ads || adSet.ads.length === 0) && (
                <div className="px-4 py-3">
                  <p className="text-xs text-muted-foreground">No ads in this ad set.</p>
                </div>
              )}
            </div>
          </details>
        ))}

        {(!campaign.adSets || campaign.adSets.length === 0) && (
          <p className="text-sm text-muted-foreground">No ad sets found for this campaign.</p>
        )}
      </div>
    </div>
  );
}
