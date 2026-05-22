// src/lib/banner/render-server.ts
import sharp from 'sharp';
import * as opentype from 'opentype.js';
import TextToSVG from 'text-to-svg';
import {
    FIXED_BANNER_BG,
    FIXED_BANNER_POSITION,
    FIXED_BANNER_TEXT,
    type ResolvedConfig,
} from '@/lib/banner/config';
import { buildRepeatedBannerLabel } from '@/lib/banner/palette';
import { BANNER_FONT_TTF_BASE64 } from '@/lib/banner/assets/font-data';

// Parse the bundled font from a base64 string at module load. Earlier we
// tried text-to-svg.loadSync(path) reading the TTF off disk, but Next.js
// outputFileTracing did not include the binary in the Vercel function
// bundle reliably — the live /api/internal/render-banner returned 200 +
// an empty banner strip on 2026-05-08 12:36 UTC because text-to-svg got
// no usable glyph data. Bundling the TTF inline as a base64 literal
// avoids the bundler entirely; opentype.parse(arrayBuffer) gives us a
// font we can hand directly to TextToSVG's constructor.
const FONT_BUFFER = Buffer.from(BANNER_FONT_TTF_BASE64, 'base64');
const FONT_ARRAY_BUFFER = FONT_BUFFER.buffer.slice(
    FONT_BUFFER.byteOffset,
    FONT_BUFFER.byteOffset + FONT_BUFFER.byteLength,
);
const FONT_RENDERER = new TextToSVG(opentype.parse(FONT_ARRAY_BUFFER));

interface BannerSvgInputs {
    width: number;
    height: number;
    config: ResolvedConfig;
    label: string;
}

/**
 * Build the inner SVG string for a banner strip — pure function, no Sharp/IO.
 * Exposed so tests can assert the shape of the SVG (e.g. "<path>", not
 * "<text>"; no "@font-face" block) without invoking the full renderer.
 */
export function buildBannerSvg(inputs: BannerSvgInputs): string {
    const { width, height, label } = inputs;
    const position = FIXED_BANNER_POSITION;
    const shortSide = Math.min(width, height);
    const stripPct = 0.07;
    const stripPx = Math.round(shortSide * stripPct);
    const fontPx = Math.round(stripPx * 0.44);

    const horizontal = position === 'top' || position === 'bottom';
    const stripWidth = horizontal ? width : stripPx;
    const stripHeight = horizontal ? stripPx : height;

    const repeatedLabel = buildRepeatedBannerLabel(label);

    // text-to-svg's getD() returns SVG path "d" attribute data, anchored
    // around the requested (x, y) per the anchor option. We anchor at the
    // strip's centre so the repeated label overflows symmetrically on both
    // sides (matching the React overlay's overflow-hidden look). For
    // vertical (left/right) strips, we rotate the path 90° around the
    // strip's centre so the natural horizontal layout becomes vertical
    // reading direction.
    const cx = stripWidth / 2;
    const cy = stripHeight / 2;
    const pathD = FONT_RENDERER.getD(repeatedLabel, {
        fontSize: fontPx,
        anchor: 'center middle',
        x: cx,
        y: cy,
    });

    const transform = horizontal
        ? ''
        : ` transform="rotate(${position === 'left' ? -90 : 90} ${cx} ${cy})"`;

    return `
    <svg width="${stripWidth}" height="${stripHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${stripWidth}" height="${stripHeight}" fill="${FIXED_BANNER_BG}"/>
      <path d="${pathD}" fill="${FIXED_BANNER_TEXT}"${transform}/>
    </svg>
  `.trim();
}

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

    const svg = buildBannerSvg({
        width: meta.width,
        height: meta.height,
        config,
        label,
    });

    const position = FIXED_BANNER_POSITION;
    const horizontal = position === 'top' || position === 'bottom';
    const shortSide = Math.min(meta.width, meta.height);
    const stripPx = Math.round(shortSide * 0.07);
    const stripWidth = horizontal ? meta.width : stripPx;
    const stripHeight = horizontal ? stripPx : meta.height;

    const top = position === 'top' ? 0 : position === 'bottom' ? meta.height - stripHeight : 0;
    const left = position === 'left' ? 0 : position === 'right' ? meta.width - stripWidth : 0;

    return img
        .composite([{ input: Buffer.from(svg), top, left }])
        .jpeg({ quality: 92, mozjpeg: false })
        .toBuffer();
}
