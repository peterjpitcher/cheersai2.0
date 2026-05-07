// src/lib/banner/palette.test.ts
import { describe, expect, it } from 'vitest';

import {
  BANNER_LABEL_REPEAT_COUNT,
  BANNER_PALETTES,
  buildRepeatedBannerLabel,
  paletteFromColours,
} from '@/lib/banner/palette';

describe('paletteFromColours', () => {
  it('returns "bronze" for the bronze preset (canonical lowercase hex)', () => {
    expect(
      paletteFromColours(BANNER_PALETTES.bronze.bg, BANNER_PALETTES.bronze.text),
    ).toBe('bronze');
  });

  it('returns "green" for the green preset (canonical lowercase hex)', () => {
    expect(
      paletteFromColours(BANNER_PALETTES.green.bg, BANNER_PALETTES.green.text),
    ).toBe('green');
  });

  it('matches palettes case-insensitively (uppercase hex)', () => {
    expect(paletteFromColours('#A57626', '#FFFFFF')).toBe('bronze');
    expect(paletteFromColours('#005131', '#FFFFFF')).toBe('green');
  });

  it('matches palettes case-insensitively (mixed case hex)', () => {
    expect(paletteFromColours('#a57626', '#fFfFfF')).toBe('bronze');
    expect(paletteFromColours('#005131', '#FfFfFf')).toBe('green');
  });

  it('falls back to bronze for unrecognised hex values', () => {
    expect(paletteFromColours('#000000', '#FFFFFF')).toBe('bronze');
    expect(paletteFromColours('#123456', '#FFFFFF')).toBe('bronze');
  });
});

describe('buildRepeatedBannerLabel', () => {
  it('repeats the label BANNER_LABEL_REPEAT_COUNT times joined by " · "', () => {
    const result = buildRepeatedBannerLabel('TODAY');
    expect(result.split(' · ')).toHaveLength(BANNER_LABEL_REPEAT_COUNT);
    expect(result.split(' · ').every((part) => part === 'TODAY')).toBe(true);
  });

  it('uses the U+00B7 middle dot as separator', () => {
    const result = buildRepeatedBannerLabel('A');
    // Middle-dot separator is " · " (space + U+00B7 + space).
    expect(result).toContain(' · ');
  });
});
