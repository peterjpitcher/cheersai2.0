'use client';

import type { FixtureContentStatus } from '@/types/tournament';

const STATUS_CONFIG: Record<FixtureContentStatus, { label: string; style: React.CSSProperties }> = {
  no_teams: {
    label: 'No Teams',
    style: { backgroundColor: 'var(--c-paper-2)', color: 'var(--c-ink-3)' },
  },
  not_showing: {
    label: 'Not Showing',
    style: { backgroundColor: 'var(--c-paper-2)', color: 'var(--c-ink-4)' },
  },
  ready: {
    label: 'Ready',
    style: { backgroundColor: 'var(--c-orange-tint)', color: 'var(--c-orange-hi)' },
  },
  blocked: {
    label: 'Blocked',
    style: { backgroundColor: 'var(--c-claret-soft)', color: 'var(--c-claret)' },
  },
  past_due: {
    label: 'Past Due',
    style: { backgroundColor: 'var(--c-orange-soft)', color: 'var(--c-orange-hi)' },
  },
  scheduled: {
    label: 'Scheduled',
    style: { backgroundColor: 'var(--c-status-posted-bg)', color: 'var(--c-status-posted-fg)' },
  },
  published: {
    label: 'Published',
    style: { backgroundColor: 'var(--c-status-posted-bg)', color: 'var(--c-status-posted-fg)' },
  },
};

export function StatusBadge({ status }: { status: FixtureContentStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={config.style}
    >
      {config.label}
    </span>
  );
}
