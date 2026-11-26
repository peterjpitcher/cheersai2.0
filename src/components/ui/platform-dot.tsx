'use client';

import { Facebook, Globe, Instagram, Store } from 'lucide-react';
import { cn } from '@/lib/utils';

export type PlatformKey = 'fb' | 'ig' | 'facebook' | 'instagram' | 'google';

/** Normalise production keys to design tokens; null for unknown/missing platforms. */
function toDesignKey(key: PlatformKey | null | undefined): 'fb' | 'ig' | 'google' | null {
  if (key === 'facebook' || key === 'fb') return 'fb';
  if (key === 'instagram' || key === 'ig') return 'ig';
  if (key === 'google') return 'google';
  return null;
}

// Google posts go to the venue's Google profile, shown as a shopfront.
const platformIcons: Record<'fb' | 'ig' | 'google', typeof Facebook> = {
  fb: Facebook,
  ig: Instagram,
  google: Store,
};

interface PlatformDotProps {
  platform: PlatformKey | null | undefined;
  /** Circle diameter in pixels. Default 18. */
  size?: number;
  className?: string;
}

/**
 * Circular badge with platform tint background and solid-colour icon.
 * Colours driven by --c-{token}-bg (background) and --c-{token} (icon).
 * Falls back to a neutral dot when the platform is missing or unrecognised
 * (e.g. multi-platform drafts whose scalar platform column is null) so the
 * component never renders an undefined icon and crashes the page.
 */
export function PlatformDot({
  platform,
  size = 18,
  className,
}: PlatformDotProps): React.JSX.Element {
  const token = toDesignKey(platform);
  const Icon = token ? platformIcons[token] : Globe;
  const iconSize = Math.round(size * 0.6);
  const backgroundColor = token ? `var(--c-${token}-bg)` : 'var(--c-paper-2)';
  const iconColor = token ? `var(--c-${token})` : 'var(--c-ink-3)';

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full',
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundColor,
      }}
    >
      <Icon
        style={{ color: iconColor, width: iconSize, height: iconSize }}
        aria-hidden="true"
      />
    </span>
  );
}
