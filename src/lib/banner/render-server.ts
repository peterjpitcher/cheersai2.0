// src/lib/banner/render-server.ts
import sharp from 'sharp';
import type { ResolvedConfig } from '@/lib/banner/config';
import { buildRepeatedBannerLabel } from '@/lib/banner/palette';
import {
  BANNER_FONT_FAMILY,
  BANNER_FONT_TTF_BASE64,
} from '@/lib/banner/assets/font-data';

// Inline @font-face block so librsvg (used by Sharp's SVG composite) renders
// our text with bundled glyphs instead of relying on the host fontconfig.
//
// Production reproducer: Vercel's Node serverless runtime did not ship a
// font that fontconfig could resolve for the previous "system-ui, sans-serif"
// stack, so every glyph rendered as a tofu/missing-glyph box. The two
// stories that went out on 2026-05-08 06:00 UTC ("Music Bingo" + "Gavin &
// Stacey") looked like a vertical strip of "□ □ □ □ …" — see the saved
// banner JPEGs in tasks/codex-qa-review/ for evidence.
//
// We bundle Noto Sans Latin 400 (already shipped by Next.js for @vercel/og)
// as a base64 data URL inside the SVG. ~27 KB raw / ~37 KB base64. librsvg
// supports embedded TTF via @font-face data URLs.
const BANNER_FONT_FACE_STYLE = `
    @font-face {
      font-family: "${BANNER_FONT_FAMILY}";
      font-style: normal;
      font-weight: 700;
      src: url(data:font/ttf;base64,${BANNER_FONT_TTF_BASE64}) format("truetype");
    }
  `;

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

  // Repeat the label so the SVG text always overflows the strip on both
  // ends. text-anchor="middle" + the SVG viewport's symmetric clipping
  // produce the same look as the React overlay's overflow-hidden strip.
  // Middle-dot separators are safe in SVG without entity escaping.
  const repeatedLabel = buildRepeatedBannerLabel(label);

  // Build SVG overlay deterministically.
  const svg = `
    <svg width="${stripWidth}" height="${stripHeight}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style type="text/css">${BANNER_FONT_FACE_STYLE}</style>
      </defs>
      <rect x="0" y="0" width="${stripWidth}" height="${stripHeight}" fill="${config.bgColour}"/>
      <text x="50%" y="50%" fill="${config.textColour}"
            font-family="${BANNER_FONT_FAMILY}"
            font-weight="700"
            font-size="${fontPx}"
            text-anchor="middle"
            dominant-baseline="central"
            ${horizontal ? '' : `transform="rotate(${config.position === 'left' ? -90 : 90} ${stripWidth / 2} ${stripHeight / 2})"`}>
        ${escapeXml(repeatedLabel)}
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
