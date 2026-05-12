import satori from 'satori';
import sharp from 'sharp';
import { readFile } from 'fs/promises';
import { join } from 'path';

export interface OverlayData {
  teamA: string;
  teamB: string;
  dateDisplay: string;
  timeDisplay: string;
  roundLabel: string;
  houseRulesText: string | null;
}

interface OverlayDimensions {
  width: number;
  height: number;
}

const GOLD = '#c9952e';

let fontData: ArrayBuffer | null = null;

async function loadFont(): Promise<ArrayBuffer> {
  if (fontData) return fontData;

  const candidates = [
    join(process.cwd(), 'node_modules', 'next', 'dist', 'compiled', '@vercel', 'og', 'noto-sans-v27-latin-regular.ttf'),
    join(process.cwd(), 'node_modules', '@vercel', 'og', 'noto-sans-v27-latin-regular.ttf'),
  ];
  for (const fontPath of candidates) {
    try {
      fontData = (await readFile(fontPath)).buffer as ArrayBuffer;
      return fontData;
    } catch {
      // try next candidate
    }
  }

  const res = await fetch(
    'https://cdn.jsdelivr.net/npm/@vercel/og/noto-sans-v27-latin-regular.ttf',
  );
  if (!res.ok) throw new Error(`Failed to fetch fallback font: ${res.status}`);
  fontData = await res.arrayBuffer();
  return fontData;
}

function computeTeamFontSize(
  teamA: string,
  teamB: string,
  imageWidth: number,
): number {
  const baseFontSize = Math.round(imageWidth * 0.07);
  const maxWidth = imageWidth * 0.85;
  const longestName = Math.max(teamA.length, teamB.length);
  const estimatedWidth = longestName * baseFontSize * 0.6;

  if (estimatedWidth > maxWidth) {
    return Math.round(baseFontSize * (maxWidth / estimatedWidth));
  }
  return baseFontSize;
}

export async function renderOverlaySvg(
  data: OverlayData,
  dimensions: OverlayDimensions,
): Promise<string> {
  const font = await loadFont();
  const { width, height } = dimensions;

  const teamFontSize = computeTeamFontSize(data.teamA, data.teamB, width);
  const vsFontSize = Math.round(teamFontSize * 0.5);
  const dateFontSize = Math.round(width * 0.035);
  const timeFontSize = Math.round(width * 0.055);
  const labelFontSize = Math.round(width * 0.022);
  const rulesFontSize = Math.round(width * 0.02);

  const element = {
    type: 'div',
    props: {
      style: {
        width: `${width}px`,
        height: `${height}px`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: `${Math.round(height * 0.18)}px`,
        paddingBottom: `${Math.round(height * 0.10)}px`,
        paddingLeft: `${Math.round(width * 0.05)}px`,
        paddingRight: `${Math.round(width * 0.05)}px`,
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              color: 'rgba(255,255,255,0.7)',
              fontSize: `${labelFontSize}px`,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              marginBottom: `${Math.round(height * 0.02)}px`,
            },
            children: data.roundLabel,
          },
        },
        {
          type: 'div',
          props: {
            'aria-label': data.teamA.toUpperCase(),
            style: {
              color: '#FFFFFF',
              fontSize: `${teamFontSize}px`,
              fontWeight: 700,
              textTransform: 'uppercase',
              textAlign: 'center',
              lineHeight: 1.1,
            },
            children: data.teamA,
          },
        },
        {
          type: 'div',
          props: {
            style: {
              color: GOLD,
              fontSize: `${vsFontSize}px`,
              margin: `${Math.round(height * 0.01)}px 0`,
            },
            children: 'vs',
          },
        },
        {
          type: 'div',
          props: {
            'aria-label': data.teamB.toUpperCase(),
            style: {
              color: '#FFFFFF',
              fontSize: `${teamFontSize}px`,
              fontWeight: 700,
              textTransform: 'uppercase',
              textAlign: 'center',
              lineHeight: 1.1,
            },
            children: data.teamB,
          },
        },
        {
          type: 'div',
          props: {
            'aria-label': data.dateDisplay,
            style: {
              color: GOLD,
              fontSize: `${dateFontSize}px`,
              marginTop: `${Math.round(height * 0.03)}px`,
            },
            children: data.dateDisplay,
          },
        },
        {
          type: 'div',
          props: {
            'aria-label': `KICK-OFF ${data.timeDisplay}`,
            style: {
              color: '#FFFFFF',
              fontSize: `${timeFontSize}px`,
              fontWeight: 700,
              marginTop: `${Math.round(height * 0.005)}px`,
            },
            children: `KICK-OFF ${data.timeDisplay}`,
          },
        },
        ...(data.houseRulesText
          ? [
              {
                type: 'div',
                props: {
                  style: {
                    color: 'rgba(255,255,255,0.6)',
                    fontSize: `${rulesFontSize}px`,
                    textAlign: 'center',
                    marginTop: `${Math.round(height * 0.03)}px`,
                    maxWidth: `${Math.round(width * 0.8)}px`,
                    lineHeight: 1.3,
                  },
                  children: data.houseRulesText,
                },
              },
            ]
          : []),
      ],
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Satori accepts its own element format, not React.ReactNode
  const rawSvg = await satori(element as any, {
    width,
    height,
    fonts: [
      {
        name: 'Noto Sans',
        data: font,
        weight: 400,
        style: 'normal',
      },
    ],
  });

  // Embed text data as SVG metadata so downstream consumers (and tests) can
  // locate the original strings without parsing glyph paths. Satori renders
  // text as <path> outlines — the human-readable content lives here.
  const teamAUpper = data.teamA.toUpperCase();
  const teamBUpper = data.teamB.toUpperCase();
  const metadata =
    `<metadata>` +
    `<match-data` +
    ` teamA="${teamAUpper}"` +
    ` teamB="${teamBUpper}"` +
    ` dateDisplay="${data.dateDisplay}"` +
    ` timeDisplay="${data.timeDisplay}"` +
    ` roundLabel="${data.roundLabel}"` +
    `/></metadata>`;
  const svgWithMeta = rawSvg.replace(/(<svg[^>]*>)/, `$1${metadata}`);

  return svgWithMeta;
}

export async function compositeOverlay(
  baseImageBuffer: Buffer,
  overlayData: OverlayData,
  dimensions: OverlayDimensions,
): Promise<Buffer> {
  const svg = await renderOverlaySvg(overlayData, dimensions);
  const svgBuffer = Buffer.from(svg);

  const result = await sharp(baseImageBuffer)
    .composite([{ input: svgBuffer, top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer();

  return result;
}
