import satori from 'satori';
import sharp from 'sharp';

import {
  OSWALD_500_TTF_BASE64,
  OSWALD_600_SIZE_BYTES,
  OSWALD_600_SHA256,
  OSWALD_600_TTF_BASE64,
  OSWALD_700_TTF_BASE64,
  INTER_500_TTF_BASE64,
  INTER_600_TTF_BASE64,
} from '@/lib/tournament/assets/font-data';
import { tournamentDebug, tournamentDebugError } from '@/lib/tournament/debug';

export interface OverlayData {
  teamA: string;
  teamB: string;
  dateDisplay: string;
  timeDisplay: string;
  roundLabel: string;
  houseRulesText: string | null;
  bookingLabel?: string;
  bookingUrl?: string;
  footerNote?: string;
}

interface OverlayDimensions {
  width: number;
  height: number;
}

const GOLD = '#c9952e';

type FontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

interface FontEntry {
  name: string;
  data: ArrayBuffer;
  weight: FontWeight;
  style: 'normal' | 'italic';
}

let fontsCache: FontEntry[] | null = null;

function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const buf = Buffer.from(b64, 'base64');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function loadFonts(): FontEntry[] {
  if (fontsCache) return fontsCache;

  fontsCache = [
    { name: 'Oswald', data: b64ToArrayBuffer(OSWALD_500_TTF_BASE64), weight: 500, style: 'normal' },
    { name: 'Oswald', data: b64ToArrayBuffer(OSWALD_600_TTF_BASE64), weight: 600, style: 'normal' },
    { name: 'Oswald', data: b64ToArrayBuffer(OSWALD_700_TTF_BASE64), weight: 700, style: 'normal' },
    { name: 'Inter', data: b64ToArrayBuffer(INTER_500_TTF_BASE64), weight: 500, style: 'normal' },
    { name: 'Inter', data: b64ToArrayBuffer(INTER_600_TTF_BASE64), weight: 600, style: 'normal' },
  ];

  tournamentDebug('overlay.fonts.loaded', {
    count: fontsCache.length,
    families: ['Oswald', 'Inter'],
    primarySha256: OSWALD_600_SHA256,
    primaryBytes: OSWALD_600_SIZE_BYTES,
  });

  return fontsCache;
}

function escapeSvgAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

const LONG_THRESHOLD = 9;

export async function renderOverlaySvg(
  data: OverlayData,
  dimensions: OverlayDimensions,
): Promise<string> {
  tournamentDebug('overlay.render-svg.start', {
    dimensions,
    teamA: data.teamA,
    teamB: data.teamB,
    roundLabel: data.roundLabel,
  });
  const fonts = loadFonts();
  const { width, height } = dimensions;

  const teamA = data.teamA.toUpperCase();
  const teamB = data.teamB.toUpperCase();
  const sw = (k: number): number => Math.round(width * k);
  const sh = (k: number): number => Math.round(height * k);
  const teamSize = sw(0.11);
  const teamSizeLong = sw(0.085);

  const teamStyle = (name: string) => ({
    color: '#FFFFFF',
    fontFamily: 'Oswald',
    fontWeight: 700 as const,
    fontSize: name.length > LONG_THRESHOLD ? teamSizeLong : teamSize,
    lineHeight: 0.92,
    textTransform: 'uppercase' as const,
  });

  // 1: Matchup zone — centred in the lit safe area
  const matchupZone = {
    type: 'div',
    props: {
      style: {
        position: 'absolute',
        top: sh(0.18),
        bottom: sh(0.38),
        left: sw(0.06),
        right: sw(0.06),
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      },
      children: [
        // Round eyebrow with flanking gold rules
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: sw(0.012),
              marginBottom: sw(0.03),
              color: 'rgba(255,255,255,0.9)',
              fontFamily: 'Inter',
              fontSize: sw(0.026),
              fontWeight: 600,
              letterSpacing: '0.32em',
              textTransform: 'uppercase',
            },
            children: [
              { type: 'div', props: { style: { width: sw(0.05), height: 1, background: GOLD } } },
              data.roundLabel,
              { type: 'div', props: { style: { width: sw(0.05), height: 1, background: GOLD } } },
            ],
          },
        },
        // Team A
        { type: 'div', props: { 'aria-label': teamA, style: teamStyle(teamA), children: teamA } },
        // vs — italic gold pivot
        {
          type: 'div',
          props: {
            style: {
              color: GOLD,
              fontFamily: 'Oswald',
              fontStyle: 'italic',
              fontWeight: 500,
              fontSize: sw(0.06),
              lineHeight: 1,
              margin: `${sw(0.014)}px 0`,
            },
            children: 'vs',
          },
        },
        // Team B
        { type: 'div', props: { 'aria-label': teamB, style: teamStyle(teamB), children: teamB } },
        // Date | Kick-off strap
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: sw(0.026),
              marginTop: sw(0.04),
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    color: '#FFFFFF',
                    fontFamily: 'Inter',
                    fontWeight: 500,
                    fontSize: sw(0.024),
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                  },
                  children: data.dateDisplay,
                },
              },
              {
                type: 'div',
                props: {
                  style: { width: 1, height: sw(0.044), background: 'rgba(255,255,255,0.4)' },
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    color: GOLD,
                    fontFamily: 'Oswald',
                    fontWeight: 600,
                    fontSize: sw(0.05),
                    letterSpacing: '0.02em',
                  },
                  children: data.timeDisplay,
                },
              },
            ],
          },
        },
      ],
    },
  };

  // 2: Booking CTA — anchored above the pitch
  const cta = {
    type: 'div',
    props: {
      style: {
        position: 'absolute',
        bottom: sh(0.20),
        left: sw(0.06),
        right: sw(0.06),
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: sw(0.006),
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              color: 'rgba(255,255,255,0.92)',
              fontFamily: 'Inter',
              fontWeight: 600,
              fontSize: sw(0.024),
              letterSpacing: '0.20em',
              textTransform: 'uppercase',
            },
            children: data.bookingLabel ?? 'Book your table at',
          },
        },
        {
          type: 'div',
          props: {
            style: {
              color: GOLD,
              fontFamily: 'Oswald',
              fontWeight: 700,
              fontSize: sw(0.056),
              lineHeight: 0.95,
              letterSpacing: '-0.005em',
            },
            children: data.bookingUrl ?? 'the-anchor.pub',
          },
        },
      ],
    },
  };

  // 3: Closing-time note — pinned at the canvas bottom edge
  const note = {
    type: 'div',
    props: {
      style: {
        position: 'absolute',
        bottom: sh(0.04),
        left: sw(0.06),
        right: sw(0.06),
        display: 'flex',
        justifyContent: 'center',
        color: 'rgba(255,255,255,0.7)',
        fontFamily: 'Inter',
        fontWeight: 500,
        fontStyle: 'italic',
        fontSize: sw(0.02),
        lineHeight: 1.4,
        textAlign: 'center',
      },
      children: data.footerNote ?? 'We stay open past closing on busy match nights.',
    },
  };

  // 4: Root — relative so the three zones layer correctly
  const element = {
    type: 'div',
    props: {
      style: {
        position: 'relative',
        display: 'flex',
        width: `${width}px`,
        height: `${height}px`,
      },
      children: [matchupZone, cta, note],
    },
  };

  let rawSvg: string;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Satori accepts its own element format, not React.ReactNode
    rawSvg = await satori(element as any, {
      width,
      height,
      fonts,
    });
  } catch (error) {
    tournamentDebugError('overlay.render-svg.satori-failed', error, {
      dimensions,
    });
    throw error;
  }

  // Embed text data as SVG metadata so downstream consumers (and tests) can
  // locate the original strings without parsing glyph paths. Satori renders
  // text as <path> outlines — the human-readable content lives here.
  const teamAUpper = data.teamA.toUpperCase();
  const teamBUpper = data.teamB.toUpperCase();
  const metadata =
    `<metadata>` +
    `<match-data` +
    ` teamA="${escapeSvgAttribute(teamAUpper)}"` +
    ` teamB="${escapeSvgAttribute(teamBUpper)}"` +
    ` dateDisplay="${escapeSvgAttribute(data.dateDisplay)}"` +
    ` timeDisplay="${escapeSvgAttribute(data.timeDisplay)}"` +
    ` roundLabel="${escapeSvgAttribute(data.roundLabel)}"` +
    `/></metadata>`;
  // Use function replacement to avoid $& / $1 expansion in metadata strings
  const svgWithMeta = rawSvg.replace(/(<svg[^>]*>)/, (match) => `${match}${metadata}`);

  tournamentDebug('overlay.render-svg.success', {
    dimensions,
    svgBytes: Buffer.byteLength(svgWithMeta),
  });

  return svgWithMeta;
}

export async function compositeOverlay(
  baseImageBuffer: Buffer,
  overlayData: OverlayData,
  dimensions: OverlayDimensions,
): Promise<Buffer> {
  tournamentDebug('overlay.composite.start', {
    dimensions,
    baseImageBytes: baseImageBuffer.byteLength,
  });
  const svg = await renderOverlaySvg(overlayData, dimensions);
  const svgBuffer = Buffer.from(svg);

  let result: Buffer;
  try {
    result = await sharp(baseImageBuffer)
      .rotate()
      .resize(dimensions.width, dimensions.height, {
        fit: 'contain',
        position: 'center',
        background: '#0f172a',
      })
      .composite([{ input: svgBuffer, top: 0, left: 0 }])
      .jpeg({ quality: 92 })
      .toBuffer();
  } catch (error) {
    tournamentDebugError('overlay.composite.sharp-failed', error, {
      dimensions,
      baseImageBytes: baseImageBuffer.byteLength,
      svgBytes: svgBuffer.byteLength,
    });
    throw error;
  }

  tournamentDebug('overlay.composite.success', {
    dimensions,
    outputBytes: result.byteLength,
  });
  return result;
}
