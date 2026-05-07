// src/features/planner/banner-overlay.tsx
'use client';

import type { ResolvedConfig } from '@/lib/banner/config';

type Props = {
  mediaUrl: string;
  config: ResolvedConfig;
  label: string | null;
  className?: string;
};

const positionClasses: Record<ResolvedConfig['position'], string> = {
  top: 'top-0 left-0 right-0 h-[8%] flex-row',
  bottom: 'bottom-0 left-0 right-0 h-[8%] flex-row',
  left: 'top-0 bottom-0 left-0 w-[8%] flex-col',
  right: 'top-0 bottom-0 right-0 w-[8%] flex-col',
};

export function BannerOverlay({ mediaUrl, config, label, className }: Props) {
  const text =
    config.textOverride && config.textOverride.length > 0
      ? config.textOverride
      : label;
  const visible = config.enabled && text != null && text.length > 0;

  return (
    <div className={`relative ${className ?? ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={mediaUrl} alt="" className="block w-full h-full object-cover" />
      {visible ? (
        <div
          data-banner-overlay
          data-position={config.position}
          className={`absolute ${positionClasses[config.position]} flex items-center justify-center`}
          style={{ backgroundColor: config.bgColour, color: config.textColour }}
        >
          <span
            className="font-bold tracking-wide text-[clamp(0.75rem,2.5vw,1.5rem)]"
            aria-label={text!}
          >
            {text}
          </span>
        </div>
      ) : null}
    </div>
  );
}
