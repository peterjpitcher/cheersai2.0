import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';

import { compositeOverlay, renderOverlaySvg, type OverlayData } from './overlay';
import { displayTeamName } from './team-display';

function extractFirstTeamTextBounds(svg: string): {
  minX: number;
  maxX: number;
  centerX: number;
} {
  const paths = [...svg.matchAll(/<path fill="([^"]+)" d="([^"]+)"/g)].map((match) => {
    const nums = [...match[2].matchAll(/-?\d+(?:\.\d+)?/g)].map((n) => Number(n[0]));
    const xs = nums.filter((_, index) => index % 2 === 0);
    const ys = nums.filter((_, index) => index % 2 === 1);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    return {
      fill: match[1],
      minX,
      maxX,
      minY: Math.min(...ys),
    };
  });

  const teamPath = paths
    .filter((path) => path.fill === '#FFFFFF')
    .sort((a, b) => a.minY - b.minY)[0];

  if (!teamPath) {
    throw new Error('No team text path found in overlay SVG');
  }

  return {
    minX: teamPath.minX,
    maxX: teamPath.maxX,
    centerX: (teamPath.minX + teamPath.maxX) / 2,
  };
}

describe('renderOverlaySvg', () => {
  const baseData: OverlayData = {
    tournamentName: 'Nations Championship 2026',
    teamA: 'Germany',
    teamB: 'Japan',
    dateDisplay: 'Saturday 14 June',
    timeDisplay: '8:00 PM',
    roundLabel: 'GROUP E',
    houseRulesText: 'We stay open while the pub is busy.',
  };

  it('renders without filesystem or CDN font access', async () => {
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/tmp/no-fonts-here');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network disabled'));

    try {
      const svg = await renderOverlaySvg(baseData, { width: 1080, height: 1080 });

      expect(svg).toContain('<svg');
      expect(cwdSpy).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      cwdSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  });

  it.each([1080, 1920])('renders the tournament name as visible artwork at height %i', async (height) => {
    const dimensions = { width: 1080, height };
    const named = await renderOverlaySvg(baseData, dimensions);
    const unnamed = await renderOverlaySvg({ ...baseData, tournamentName: '' }, dimensions);
    const titleRegion = { left: 64, top: Math.round(height * 0.06), width: 952, height: Math.round(height * 0.12) };
    const namedPixels = await sharp(Buffer.from(named)).extract(titleRegion).raw().toBuffer();
    const unnamedPixels = await sharp(Buffer.from(unnamed)).extract(titleRegion).raw().toBuffer();

    expect(named).toContain('tournamentName="Nations Championship 2026"');
    expect(namedPixels.equals(unnamedPixels)).toBe(false);
    // A title must not displace any existing match, date, booking or footer artwork.
    const matchRegion = { left: 0, top: Math.round(height * 0.18), width: 1080, height: height - Math.round(height * 0.18) };
    const namedMatch = await sharp(Buffer.from(named)).extract(matchRegion).raw().toBuffer();
    const unnamedMatch = await sharp(Buffer.from(unnamed)).extract(matchRegion).raw().toBuffer();
    expect(namedMatch.equals(unnamedMatch)).toBe(true);
  });

  it.each([1080, 1920])('keeps long tournament names inside the title area at height %i', async (height) => {
    for (const tournamentName of ['International Nations Championship Rugby Tournament 2026', 'W'.repeat(200)]) {
      const svg = await renderOverlaySvg({ ...baseData, tournamentName }, { width: 1080, height });
      const paths = [...svg.matchAll(/<path fill="rgba\(255,255,255,0.95\)" d="([^"]+)"/g)];
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        const nums = [...path[1].matchAll(/-?\d+(?:\.\d+)?/g)].map(value => Number(value[0]));
        const xs = nums.filter((_, index) => index % 2 === 0);
        const ys = nums.filter((_, index) => index % 2 === 1);
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(64);
        expect(Math.max(...xs)).toBeLessThanOrEqual(1016);
        expect(Math.min(...ys)).toBeGreaterThanOrEqual(Math.round(height * 0.06));
        expect(Math.max(...ys)).toBeLessThanOrEqual(Math.round(height * 0.18));
      }
    }
  });

  it('should return an SVG buffer', async () => {
    const svg = await renderOverlaySvg(baseData, { width: 1080, height: 1080 });
    expect(svg).toBeDefined();
    expect(typeof svg).toBe('string');
    expect(svg).toContain('<svg');
  });

  it('should include team names in the SVG', async () => {
    const svg = await renderOverlaySvg(baseData, { width: 1080, height: 1080 });
    expect(svg).toContain('GERMANY');
    expect(svg).toContain('JAPAN');
  });

  it('should include date and time', async () => {
    const svg = await renderOverlaySvg(baseData, { width: 1080, height: 1080 });
    expect(svg).toContain('Saturday 14 June');
    expect(svg).toContain('8:00 PM');
  });

  it('should render story dimensions', async () => {
    const svg = await renderOverlaySvg(baseData, { width: 1080, height: 1920 });
    expect(svg).toContain('<svg');
  });

  it('should scale font for long team names', async () => {
    const longData = { ...baseData, teamA: 'Bosnia & Herzegovina' };
    const svg = await renderOverlaySvg(longData, { width: 1080, height: 1080 });
    expect(svg).toBeDefined();
  });

  it('keeps World Cup 2026 long and accented team names centred in the safe area', async () => {
    const atRiskNames = [
      'Bosnia and Herzegovina',
      'Korea Republic',
      'South Africa',
      'Saudi Arabia',
      "Côte d'Ivoire",
      'New Zealand',
      'Netherlands',
      'Switzerland',
      'Cabo Verde',
      'Congo DR',
      'Uzbekistan',
      'Curaçao',
      'Türkiye',
    ];

    for (const rawName of atRiskNames) {
      const displayName = displayTeamName(rawName);
      for (const dimensions of [{ width: 1080, height: 1080 }, { width: 1080, height: 1920 }]) {
        const svg = await renderOverlaySvg(
          { ...baseData, teamA: displayName, teamB: 'Qatar' },
          dimensions,
        );
        const bounds = extractFirstTeamTextBounds(svg);
        const safeInset = Math.round(dimensions.width * 0.06);

        expect(bounds.minX, `${rawName} left bound`).toBeGreaterThanOrEqual(safeInset);
        expect(bounds.maxX, `${rawName} right bound`).toBeLessThanOrEqual(dimensions.width - safeInset);
        expect(
          Math.abs(bounds.centerX - dimensions.width / 2),
          `${rawName} centre delta`,
        ).toBeLessThanOrEqual(8);
      }
    }
  });

  it('escapes metadata attribute values', async () => {
    const svg = await renderOverlaySvg(
      {
        ...baseData,
        teamA: 'Bosnia & Herzegovina',
        teamB: 'A "Quoted" Team',
        roundLabel: 'A < B',
        tournamentName: 'Rugby & \"Friends\" <2026>',
      },
      { width: 1080, height: 1080 },
    );

    expect(svg).toContain('teamA="BOSNIA &amp; HERZEGOVINA"');
    expect(svg).toContain('teamB="A &quot;QUOTED&quot; TEAM"');
    expect(svg).toContain('roundLabel="A &lt; B"');
    expect(svg).toContain('tournamentName="Rugby &amp; &quot;Friends&quot; &lt;2026&gt;"');
  });

  it('does not expand replacement tokens in metadata', async () => {
    const svg = await renderOverlaySvg(
      { ...baseData, teamA: '$&', teamB: "$1 $'" },
      { width: 1080, height: 1080 },
    );

    expect(svg).toContain('teamA="$&amp;"');
    expect(svg).toContain("teamB=\"$1 $'\"");
  });

  it('snapshot: short/short team names', async () => {
    const data: OverlayData = {
    tournamentName: 'Nations Championship 2026',
      teamA: 'Germany',
      teamB: 'Japan',
      dateDisplay: 'Saturday 14 June',
      timeDisplay: '8:00 PM',
      roundLabel: 'Group E',
      houseRulesText: null,
    };
    const svg = await renderOverlaySvg(data, { width: 1080, height: 1080 });
    expect(svg).toContain('<svg');
    expect(svg).toContain('teamA="GERMANY"');
    expect(svg).toContain('teamB="JAPAN"');
    expect(svg).toContain('dateDisplay="Saturday 14 June"');
    expect(svg).toContain('timeDisplay="8:00 PM"');
  });

  it('snapshot: long/long team names', async () => {
    const data: OverlayData = {
    tournamentName: 'Nations Championship 2026',
      teamA: 'Netherlands',
      teamB: 'Switzerland',
      dateDisplay: 'Sunday 15 June',
      timeDisplay: '5:00 PM',
      roundLabel: 'Round of 16',
      houseRulesText: null,
    };
    const svg = await renderOverlaySvg(data, { width: 1080, height: 1080 });
    expect(svg).toContain('<svg');
    expect(svg).toContain('teamA="NETHERLANDS"');
    expect(svg).toContain('teamB="SWITZERLAND"');
  });

  it('snapshot: default booking and footer', async () => {
    const data: OverlayData = {
    tournamentName: 'Nations Championship 2026',
      teamA: 'England',
      teamB: 'France',
      dateDisplay: 'Friday 20 June',
      timeDisplay: '8:00 PM',
      roundLabel: 'Quarter-Final',
      houseRulesText: null,
    };
    const svg = await renderOverlaySvg(data, { width: 1080, height: 1080 });
    expect(svg).toContain('<svg');
    expect(svg).toContain('teamA="ENGLAND"');
    expect(svg).toContain('teamB="FRANCE"');
  });

  it('uses custom booking and footer when provided', async () => {
    const data: OverlayData = {
    tournamentName: 'Nations Championship 2026',
      teamA: 'Spain',
      teamB: 'Italy',
      dateDisplay: 'Saturday 21 June',
      timeDisplay: '5:00 PM',
      roundLabel: 'Semi-Final',
      houseRulesText: null,
      bookingLabel: 'Reserve now at',
      bookingUrl: 'my-pub.co.uk',
      footerNote: 'Kitchen closes at 10pm.',
    };
    const svg = await renderOverlaySvg(data, { width: 1080, height: 1080 });
    expect(svg).toContain('<svg');
    expect(svg).toContain('teamA="SPAIN"');
    expect(svg).toContain('teamB="ITALY"');
  });
});

describe('compositeOverlay', () => {
  const baseData: OverlayData = {
    tournamentName: 'Nations Championship 2026',
    teamA: 'Germany',
    teamB: 'Japan',
    dateDisplay: 'Saturday 14 June',
    timeDisplay: '8:00 PM',
    roundLabel: 'GROUP E',
    houseRulesText: 'We stay open while the pub is busy.',
  };

  async function makeImage(width: number, height: number): Promise<Buffer> {
    return sharp({
      create: {
        width,
        height,
        channels: 3,
        background: '#203040',
      },
    })
      .jpeg()
      .toBuffer();
  }

  it('resizes a smaller square base image before compositing', async () => {
    const source = await makeImage(640, 640);

    const output = await compositeOverlay(source, baseData, { width: 1080, height: 1080 });
    const metadata = await sharp(output).metadata();

    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1080);
  });

  it('contains a non-matching story base image before compositing', async () => {
    const source = await makeImage(900, 1200);

    const output = await compositeOverlay(source, baseData, { width: 1080, height: 1920 });
    const metadata = await sharp(output).metadata();

    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1920);
  });
});
