'use client';

import { Facebook, Globe, Instagram } from 'lucide-react';
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
  platform: Platform | null | undefined;
  showLabel?: boolean;
  className?: string;
}

/**
 * Renders a small badge with a platform-specific Lucide icon and optional label.
 * Colours are driven by CSS custom properties defined in globals.css.
 * Falls back to a neutral "No platform" badge when the platform is missing or
 * unrecognised (e.g. multi-platform drafts whose scalar platform column is null)
 * so the component never destructures undefined and crashes the page.
 */
export function PlatformBadge({
  platform,
  showLabel = false,
  className,
}: PlatformBadgeProps): React.JSX.Element {
  const config = platform ? platformConfig[platform] : undefined;
  const Icon = config?.icon ?? Globe;
  const label = config?.label ?? 'No platform';
  const fg = config ? `var(--platform-${config.token})` : 'var(--c-ink-3)';
  const bg = config ? `var(--platform-${config.token}-bg)` : 'var(--c-paper-2)';

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
