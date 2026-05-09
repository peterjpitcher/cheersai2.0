'use client';

import type { FixtureContentStatus } from '@/types/tournament';

const STATUS_CONFIG: Record<FixtureContentStatus, { label: string; className: string }> = {
  no_teams: { label: 'No Teams', className: 'bg-gray-100 text-gray-600' },
  not_showing: { label: 'Not Showing', className: 'bg-gray-100 text-gray-500' },
  ready: { label: 'Ready', className: 'bg-blue-100 text-blue-700' },
  blocked: { label: 'Blocked', className: 'bg-red-100 text-red-700' },
  past_due: { label: 'Past Due', className: 'bg-amber-100 text-amber-700' },
  scheduled: { label: 'Scheduled', className: 'bg-green-100 text-green-700' },
  published: { label: 'Published', className: 'bg-emerald-100 text-emerald-700' },
};

export function StatusBadge({ status }: { status: FixtureContentStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
}
