// src/features/planner/banner-overlay.tsx
'use client';

import type { CSSProperties } from 'react';

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

// For vertical strips (left/right) we rotate the text inline so it reads
// along the strip instead of overflowing horizontally. This matches the
// publish-time output of `renderBannerServer`, which rotates the SVG text
// element by -90deg (left) or 90deg (right) — left reads bottom-to-top,
// right reads top-to-bottom.
const verticalTextStyle: Record<'left' | 'right', CSSProperties> = {
  left: { writingMode: 'vertical-rl', transform: 'rotate(180deg)' },
  right: { writingMode: 'vertical-rl' },
};

export function BannerOverlay({ mediaUrl, config, label, className }: Props) {
  const text =
    config.textOverride && config.textOverride.length > 0
      ? config.textOverride
      : label;
  const visible = config.enabled && text != null && text.length > 0;

  const textStyle: CSSProperties | undefined =
    config.position === 'left' || config.position === 'right'
      ? verticalTextStyle[config.position]
      : undefined;

  return (
    <div className={`relative ${className ?? ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={mediaUrl}
        alt=""
        loading="lazy"
        className="block w-full h-full object-cover"
      />
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
            style={textStyle}
          >
            {text}
          </span>
        </div>
      ) : null}
    </div>
  );
}
