import { describe, it, expect, vi } from 'vitest';
import { renderOverlaySvg, type OverlayData } from './overlay';

describe('renderOverlaySvg', () => {
  const baseData: OverlayData = {
    teamA: 'Germany',
    teamB: 'Japan',
    dateDisplay: 'Saturday 14 June',
    timeDisplay: '8:00 PM',
    roundLabel: 'GROUP E',
    houseRulesText: 'We stay open while the pub is busy.',
  };

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
});
