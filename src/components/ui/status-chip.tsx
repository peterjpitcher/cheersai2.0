'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import type { ContentStatus } from '@/types/content';

const statusLabels: Record<ContentStatus, string> = {
  draft: 'Draft',
  review: 'In Review',
  approved: 'Approved',
  scheduled: 'Scheduled',
  queued: 'Queued',
  publishing: 'Publishing',
  published: 'Published',
  failed: 'Failed',
};

const chipVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap',
  {
    variants: {
      size: {
        sm: 'text-xs px-2 py-0.5',
        md: 'text-sm px-2.5 py-1',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  }
);

interface StatusChipProps extends VariantProps<typeof chipVariants> {
  status: ContentStatus;
  className?: string;
}

/**
 * Renders a pill-shaped status badge with a coloured dot and label.
 * Colours are driven by CSS custom properties defined in globals.css.
 */
export function StatusChip({ status, size, className }: StatusChipProps): React.JSX.Element {
  const fg = `var(--status-${status}-fg)`;
  const bg = `var(--status-${status}-bg)`;

  return (
    <span
      className={cn(chipVariants({ size }), className)}
      style={{ color: fg, backgroundColor: bg }}
    >
      <span
        className="inline-block size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: fg }}
        aria-hidden="true"
      />
      {statusLabels[status]}
    </span>
  );
}
