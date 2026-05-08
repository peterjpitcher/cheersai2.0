// src/lib/banner/render-server.ts
import sharp from 'sharp';
import { join } from 'node:path';
import TextToSVG from 'text-to-svg';
import type { ResolvedConfig } from '@/lib/banner/config';
import { buildRepeatedBannerLabel } from '@/lib/banner/palette';

// Path to our bundled font. Read once via text-to-svg's loadSync so the
// resulting renderer is reused across requests. text-to-svg parses the TTF up
// front (via opentype.js) and emits SVG <path> data — no runtime font
// resolution by librsvg/fontconfig is needed.
//
// Background: Vercel's Node serverless runtime did not honour the
// @font-face data-URL we tried to embed (commit e336b7b), so banner
// strips published with tofu/missing-glyph boxes again on 2026-05-08.
// Generating <path> shapes from the TTF in our own process moves font
// resolution out of librsvg entirely.
const FONT_PATH = join(process.cwd(), 'src/lib/banner/assets/noto-sans-latin-700.ttf');
const FONT_RENDERER = TextToSVG.loadSync(FONT_PATH);

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
    const { width, height, config, label } = inputs;
    const shortSide = Math.min(width, height);
    const isStory = height > width * 1.5;
    const stripPct = isStory ? 0.06 : 0.08;
    const stripPx = Math.round(shortSide * stripPct);
    const fontPx = Math.round(stripPx * 0.55);

    const horizontal = config.position === 'top' || config.position === 'bottom';
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
        : ` transform="rotate(${config.position === 'left' ? -90 : 90} ${cx} ${cy})"`;

    return `
    <svg width="${stripWidth}" height="${stripHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${stripWidth}" height="${stripHeight}" fill="${config.bgColour}"/>
      <path d="${pathD}" fill="${config.textColour}"${transform}/>
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

    const horizontal = config.position === 'top' || config.position === 'bottom';
    const shortSide = Math.min(meta.width, meta.height);
    const isStory = meta.height > meta.width * 1.5;
    const stripPx = Math.round(shortSide * (isStory ? 0.06 : 0.08));
    const stripWidth = horizontal ? meta.width : stripPx;
    const stripHeight = horizontal ? stripPx : meta.height;

    const top = config.position === 'top' ? 0 : config.position === 'bottom' ? meta.height - stripHeight : 0;
    const left = config.position === 'left' ? 0 : config.position === 'right' ? meta.width - stripWidth : 0;

    return img
        .composite([{ input: Buffer.from(svg), top, left }])
        .jpeg({ quality: 92, mozjpeg: false })
        .toBuffer();
}
