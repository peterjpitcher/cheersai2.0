'use client';

import { Facebook, Instagram } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Platform } from '@/types/content';

/** Maps platform enum to CSS token prefix, Lucide icon, and display label */
const platformConfig: Record<
  Platform,
  { token: string; icon: typeof Facebook; label: string }
> = {
  facebook: { token: 'fb', icon: Facebook, label: 'Facebook' },
  instagram: { token: 'ig', icon: Instagram, label: 'Instagram' },
};

interface PlatformBadgeProps {
  platform: Platform;
  showLabel?: boolean;
  className?: string;
}

/**
 * Renders a small badge with a platform-specific Lucide icon and optional label.
 * Colours are driven by CSS custom properties defined in globals.css.
 */
export function PlatformBadge({
  platform,
  showLabel = false,
  className,
}: PlatformBadgeProps): React.JSX.Element {
  const { token, icon: Icon, label } = platformConfig[platform];
  const fg = `var(--platform-${token})`;
  const bg = `var(--platform-${token}-bg)`;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        className,
      )}
      style={{ color: fg, backgroundColor: bg }}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {showLabel && <span>{label}</span>}
      {!showLabel && <span className="sr-only">{label}</span>}
    </span>
  );
}
