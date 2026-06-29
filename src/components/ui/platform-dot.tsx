'use client';

import { Facebook, Instagram } from 'lucide-react';
import { cn } from '@/lib/utils';

export type PlatformKey = 'fb' | 'ig' | 'facebook' | 'instagram';

/** Normalise production keys to design tokens */
function toDesignKey(key: PlatformKey): 'fb' | 'ig' {
  if (key === 'facebook') return 'fb';
  if (key === 'instagram') return 'ig';
  return key as 'fb' | 'ig';
}

const platformIcons: Record<'fb' | 'ig', typeof Facebook> = {
  fb: Facebook,
  ig: Instagram,
};

interface PlatformDotProps {
  platform: PlatformKey;
  /** Circle diameter in pixels. Default 18. */
  size?: number;
  className?: string;
}

/**
 * Circular badge with platform tint background and solid-colour icon.
 * Colours driven by --c-{token}-bg (background) and --c-{token} (icon).
 */
export function PlatformDot({
  platform,
  size = 18,
  className,
}: PlatformDotProps): React.JSX.Element {
  const token = toDesignKey(platform);
  const Icon = platformIcons[token];
  const iconSize = Math.round(size * 0.6);

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full',
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: `var(--c-${token}-bg)`,
      }}
    >
      <Icon
        style={{ color: `var(--c-${token})`, width: iconSize, height: iconSize }}
        aria-hidden="true"
      />
    </span>
  );
}
