import Link from 'next/link';
import { Megaphone } from 'lucide-react';

import type { Campaign, CampaignObjective, CampaignStatus } from '@/types/campaigns';
import { DeleteCampaignButton } from './DeleteCampaignButton';

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

const STATUS_STYLES: Record<CampaignStatus, { bg: string; fg: string }> = {
  DRAFT: { bg: 'var(--c-status-draft-bg)', fg: 'var(--c-status-draft-fg)' },
  ACTIVE: { bg: 'var(--c-status-posted-bg)', fg: 'var(--c-status-posted-fg)' },
  PAUSED: { bg: 'var(--c-status-scheduled-bg)', fg: 'var(--c-status-scheduled-fg)' },
  ARCHIVED: { bg: 'var(--c-paper-2)', fg: 'var(--c-ink-3)' },
};

export function CampaignList({ campaigns }: CampaignListProps) {
  if (campaigns.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-20 text-center"
        style={{
          borderRadius: 'var(--r-xl)',
          border: '2px dashed var(--c-line)',
        }}
      >
        <Megaphone className="mb-3 h-8 w-8" style={{ color: 'var(--c-ink-3)' }} />
        <p className="text-lg font-semibold" style={{ color: 'var(--c-ink)' }}>No campaigns yet</p>
        <p className="mt-1 text-sm" style={{ color: 'var(--c-ink-3)' }}>
          Create your first Meta paid media campaign to get started.
        </p>
      </div>
    );
  }

  return (
    <div
      className="overflow-x-auto"
      style={{
        borderRadius: 'var(--r-xl)',
        border: '1px solid var(--c-line)',
        backgroundColor: 'var(--c-card)',
      }}
    >
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--c-line)', backgroundColor: 'var(--c-paper)' }}>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--c-ink-3)' }}>
              Name
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--c-ink-3)' }}>
              Objective
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--c-ink-3)' }}>
              Status
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--c-ink-3)' }}>
              Budget
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--c-ink-3)' }}>
              Dates
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider sr-only" style={{ color: 'var(--c-ink-3)' }}>
              Actions
            </th>
          </tr>
        </thead>
        <tbody style={{ borderColor: 'var(--c-line)' }} className="divide-y">
          {campaigns.map((campaign) => {
            const statusStyle = STATUS_STYLES[campaign.status];
            return (
              <tr
                key={campaign.id}
                className="transition-colors"
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--c-paper)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <td className="px-4 py-3.5">
                  <Link
                    href={`/campaigns/${campaign.id}`}
                    className="font-medium hover:underline"
                    style={{ color: 'var(--c-ink)' }}
                  >
                    {campaign.name}
                  </Link>
                </td>
                <td className="px-4 py-3.5" style={{ color: 'var(--c-ink-3)' }}>
                  {OBJECTIVE_LABELS[campaign.objective]}
                </td>
                <td className="px-4 py-3.5">
                  <span
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
                    style={{ backgroundColor: statusStyle.bg, color: statusStyle.fg }}
                  >
                    {campaign.status.charAt(0) + campaign.status.slice(1).toLowerCase()}
                  </span>
                </td>
                <td className="px-4 py-3.5" style={{ color: 'var(--c-ink-3)' }}>
                  £{campaign.budgetAmount}/{campaign.budgetType === 'DAILY' ? 'day' : 'total'}
                </td>
                <td className="px-4 py-3.5" style={{ color: 'var(--c-ink-3)' }}>
                  {campaign.startDate}
                  {campaign.endDate ? ` – ${campaign.endDate}` : ' onwards'}
                </td>
                <td className="px-4 py-3.5">
                  <DeleteCampaignButton campaignId={campaign.id} campaignName={campaign.name} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
