// src/features/planner/banner-overlay.tsx
'use client';

import type { CSSProperties } from 'react';

import {
  FIXED_BANNER_BG,
  FIXED_BANNER_POSITION,
  FIXED_BANNER_TEXT,
  type ResolvedConfig,
} from '@/lib/banner/config';
import { buildRepeatedBannerLabel } from '@/lib/banner/palette';

type Props = {
  mediaUrl: string;
  config: ResolvedConfig;
  label: string | null;
  className?: string;
};

const positionClasses: Record<ResolvedConfig['position'], string> = {
  top: 'top-0 left-0 right-0 h-[7%] flex-row',
  bottom: 'bottom-0 left-0 right-0 h-[7%] flex-row',
  left: 'top-0 bottom-0 left-0 w-[7%] flex-col',
  right: 'top-0 bottom-0 right-0 w-[7%] flex-col',
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
  const position = FIXED_BANNER_POSITION;
  const text =
    config.textOverride && config.textOverride.length > 0
      ? config.textOverride
      : label;
  const visible = config.enabled && text != null && text.length > 0;

  const textStyle: CSSProperties | undefined =
    position === 'left' || position === 'right'
      ? verticalTextStyle[position]
      : undefined;

  // Repeat the label many times with " · " separators so the strip visually
  // overflows on both ends regardless of strip width or label length. The
  // strip itself uses overflow-hidden + flex centring so the result clips
  // symmetrically. Mirrors the SVG output of renderBannerServer so preview
  // and published image stay in sync.
  const displayText = visible && text ? buildRepeatedBannerLabel(text) : null;

  return (
    <div className={`relative ${className ?? ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={mediaUrl}
        alt=""
        loading="lazy"
        className="block w-full h-full object-contain"
      />
      {visible && displayText ? (
        <div
          data-banner-overlay
          data-position={position}
          className={`absolute ${positionClasses[position]} flex items-center justify-center overflow-hidden`}
          style={{ backgroundColor: FIXED_BANNER_BG, color: FIXED_BANNER_TEXT }}
        >
          <span
            className="whitespace-nowrap font-bold tracking-wide text-[clamp(0.42rem,1.05vw,0.82rem)]"
            aria-label={text!}
            style={textStyle}
          >
            {displayText}
          </span>
        </div>
      ) : null}
    </div>
  );
}
