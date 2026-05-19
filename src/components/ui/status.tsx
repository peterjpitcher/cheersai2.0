'use client';

import { cn } from '@/lib/utils';

export type DesignStatus = 'posted' | 'publishing' | 'scheduled' | 'draft' | 'failed';

const statusLabels: Record<DesignStatus, string> = {
  posted: 'Posted',
  publishing: 'Publishing',
  scheduled: 'Scheduled',
  draft: 'Draft',
  failed: 'Failed',
};

interface StatusProps {
  status: DesignStatus;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Redesign status chip — pill shape with coloured dot and uppercase label.
 * Colours driven by --c-status-{status}-fg / --c-status-{status}-bg tokens.
 * The publishing dot pulses using the keyframe defined in globals.css.
 */
export function Status({ status, size = 'md', className }: StatusProps): React.JSX.Element {
  const fg = `var(--c-status-${status}-fg)`;
  const bg = `var(--c-status-${status}-bg)`;

  const isMd = size === 'md';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap font-semibold uppercase',
        isMd
          ? 'h-[22px] text-[11px] leading-none'
          : 'h-[18px] text-[10px] leading-none',
        className,
      )}
      style={{
        color: fg,
        backgroundColor: bg,
        borderRadius: 'var(--r-pill, 999px)',
        padding: isMd ? '3px 10px 3px 8px' : '2px 8px',
      }}
    >
      <span
        className={cn(
          'inline-block shrink-0 rounded-full',
          isMd ? 'size-1.5' : 'size-[5px]',
          status === 'publishing' && 'animate-pulse',
        )}
        style={{ backgroundColor: fg }}
        aria-hidden="true"
      />
      {statusLabels[status]}
    </span>
  );
}
