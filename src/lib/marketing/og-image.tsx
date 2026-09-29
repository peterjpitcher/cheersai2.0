import { ImageResponse } from 'next/og';

import { BANNER_FONT_TTF_BASE64 } from '@/lib/banner/assets/font-data';
import { token } from '@/lib/design/tokens';
import { SHARE_IMAGE_SIZE } from '@/lib/marketing/metadata';

/**
 * The share image (Open Graph and Twitter card) for the public pages, drawn
 * with next/og at 1200 x 630. Colours come from the design tokens (through
 * the mirror in src/lib/design/tokens.ts, as satori cannot read CSS
 * variables). The font is the bold Noto Sans the banner renderer already
 * ships inline, so nothing is fetched at request time.
 */

export interface ShareImageText {
  /** A short line above the title. */
  eyebrow: string;
  title: string;
  /** Bottom right, for example the site's host name. */
  footer: string;
}

let fontData: ArrayBuffer | null = null;

function boldFont(): ArrayBuffer {
  if (!fontData) {
    const bytes = Buffer.from(BANNER_FONT_TTF_BASE64, 'base64');
    fontData = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }
  return fontData;
}

/** A token colour with transparency, as rgba() (satori accepts it; CSS variables it does not). */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((start) => parseInt(value.slice(start, start + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Longer titles get a smaller size so they stay within three lines. */
export function titleFontSize(title: string): number {
  if (title.length > 70) return 54;
  if (title.length > 45) return 62;
  return 72;
}

function Chip({ label, colour }: { label: string; colour: string }): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        padding: '10px 20px',
        borderRadius: 999,
        backgroundColor: colour,
        color: token('--c-card'),
        fontSize: 22,
      }}
    >
      {label}
    </div>
  );
}

export function renderShareImage({ eyebrow, title, footer }: ShareImageText): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '60px 72px',
          backgroundColor: token('--c-ink'),
          backgroundImage: `radial-gradient(circle at 88% 12%, ${withAlpha(token('--c-orange'), 0.5)} 0%, ${withAlpha(token('--c-orange'), 0)} 48%), radial-gradient(circle at 0% 100%, ${withAlpha(token('--c-orange-hi'), 0.3)} 0%, ${withAlpha(token('--c-orange-hi'), 0)} 40%)`,
          fontFamily: 'Noto Sans',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <div style={{ fontSize: 46, color: token('--c-orange'), letterSpacing: -1 }}>Cheers</div>
          <div style={{ fontSize: 22, color: token('--c-ink-4') }}>by Orange Jelly</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 980 }}>
          <div
            style={{
              display: 'flex',
              fontSize: 22,
              color: token('--c-orange-soft'),
              letterSpacing: 3,
              textTransform: 'uppercase',
            }}
          >
            {eyebrow}
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: titleFontSize(title),
              lineHeight: 1.08,
              color: token('--c-card'),
              letterSpacing: -1.5,
            }}
          >
            {title}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <Chip label="Facebook" colour={token('--c-fb')} />
            <Chip label="Instagram" colour={token('--c-ig')} />
          </div>
          <div style={{ display: 'flex', fontSize: 22, color: token('--c-line-2') }}>{footer}</div>
        </div>
      </div>
    ),
    {
      ...SHARE_IMAGE_SIZE,
      fonts: [{ name: 'Noto Sans', data: boldFont(), weight: 700, style: 'normal' }],
    },
  );
}

/** The response for a guide share image whose guide does not exist. */
export function shareImageNotFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}
