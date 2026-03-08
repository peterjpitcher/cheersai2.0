import Link from 'next/link';

import type { Campaign, CampaignObjective, CampaignStatus } from '@/types/campaigns';

interface CampaignListProps {
  campaigns: Campaign[];
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

export function CampaignList({ campaigns }: CampaignListProps) {
  if (campaigns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center">
        <p className="text-lg font-semibold text-foreground">No campaigns yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Create your first Meta paid media campaign to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-background">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th scope="col" className="px-4 py-3 text-left font-semibold text-foreground">
              Name
            </th>
            <th scope="col" className="px-4 py-3 text-left font-semibold text-foreground">
              Objective
            </th>
            <th scope="col" className="px-4 py-3 text-left font-semibold text-foreground">
              Status
            </th>
            <th scope="col" className="px-4 py-3 text-left font-semibold text-foreground">
              Budget
            </th>
            <th scope="col" className="px-4 py-3 text-left font-semibold text-foreground">
              Dates
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {campaigns.map((campaign) => (
            <tr key={campaign.id} className="hover:bg-muted/30 transition-colors">
              <td className="px-4 py-3">
                <Link
                  href={`/campaigns/${campaign.id}`}
                  className="font-medium text-foreground hover:text-primary hover:underline"
                >
                  {campaign.name}
                </Link>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {OBJECTIVE_LABELS[campaign.objective]}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLES[campaign.status]}`}
                >
                  {campaign.status.charAt(0) + campaign.status.slice(1).toLowerCase()}
                </span>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                £{campaign.budgetAmount}/{campaign.budgetType === 'DAILY' ? 'day' : 'total'}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {campaign.startDate}
                {campaign.endDate ? ` – ${campaign.endDate}` : ' onwards'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
