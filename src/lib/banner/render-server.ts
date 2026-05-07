// src/lib/banner/render-server.ts
import sharp from 'sharp';
import type { ResolvedConfig } from '@/lib/banner/config';

export async function renderBannerServer(
  source: Buffer,
  config: ResolvedConfig,
  label: string,
): Promise<Buffer> {
  const img = sharp(source, { failOn: 'error' });
  const meta = await img.metadata();
  if (!meta.width || !meta.height) {
    throw new Error('BANNER_RENDER_FAILED: source has no dimensions');
  }
  const shortSide = Math.min(meta.width, meta.height);
  const isStory = meta.height > meta.width * 1.5;
  const stripPct = isStory ? 0.06 : 0.08;
  const stripPx = Math.round(shortSide * stripPct);
  const fontPx = Math.round(stripPx * 0.55);

  const horizontal = config.position === 'top' || config.position === 'bottom';
  const stripWidth = horizontal ? meta.width : stripPx;
  const stripHeight = horizontal ? stripPx : meta.height;

  // Build SVG overlay deterministically.
  const svg = `
    <svg width="${stripWidth}" height="${stripHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${stripWidth}" height="${stripHeight}" fill="${config.bgColour}"/>
      <text x="50%" y="50%" fill="${config.textColour}"
            font-family="-apple-system, system-ui, sans-serif"
            font-weight="700"
            font-size="${fontPx}"
            text-anchor="middle"
            dominant-baseline="central"
            ${horizontal ? '' : `transform="rotate(${config.position === 'left' ? -90 : 90} ${stripWidth / 2} ${stripHeight / 2})"`}>
        ${escapeXml(label)}
      </text>
    </svg>
  `.trim();

  const top = config.position === 'top' ? 0 : config.position === 'bottom' ? meta.height - stripHeight : 0;
  const left = config.position === 'left' ? 0 : config.position === 'right' ? meta.width - stripWidth : 0;

  return img
    .composite([{ input: Buffer.from(svg), top, left }])
    .jpeg({ quality: 92, mozjpeg: false })
    .toBuffer();
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === "'" ? '&apos;' : '&quot;',
  );
}
