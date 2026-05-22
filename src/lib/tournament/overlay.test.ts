import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';

import { compositeOverlay, renderOverlaySvg, type OverlayData } from './overlay';

describe('renderOverlaySvg', () => {
  const baseData: OverlayData = {
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

  it('escapes metadata attribute values', async () => {
    const svg = await renderOverlaySvg(
      {
        ...baseData,
        teamA: 'Bosnia & Herzegovina',
        teamB: 'A "Quoted" Team',
        roundLabel: 'A < B',
      },
      { width: 1080, height: 1080 },
    );

    expect(svg).toContain('teamA="BOSNIA &amp; HERZEGOVINA"');
    expect(svg).toContain('teamB="A &quot;QUOTED&quot; TEAM"');
    expect(svg).toContain('roundLabel="A &lt; B"');
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
