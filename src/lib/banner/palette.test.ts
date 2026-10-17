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

// An event story's booking prompt shares the strip with the label
// (tasks/SPEC-story-booking-prompt.md). The strip is centred, so the middle
// item is what sits mid-height, clear of the story UI at top and bottom.
describe('buildRepeatedBannerLabel with a story booking prompt', () => {
  const middle = Math.floor(BANNER_LABEL_REPEAT_COUNT / 2);

  it('alternates the prompt with the label, with a prompt in the middle', () => {
    const parts = buildRepeatedBannerLabel('THIS FRIDAY', 'LINK IN BIO TO BOOK').split(' · ');

    expect(parts).toHaveLength(BANNER_LABEL_REPEAT_COUNT);
    expect(parts[middle]).toBe('LINK IN BIO TO BOOK');
    expect(parts[middle - 1]).toBe('THIS FRIDAY');
    expect(parts[middle + 1]).toBe('THIS FRIDAY');
    for (let index = 1; index < parts.length; index += 1) {
      expect(parts[index]).not.toBe(parts[index - 1]);
    }
  });

  it('is symmetrical, so the clipped ends match', () => {
    const parts = buildRepeatedBannerLabel('TONIGHT', 'BOOK AT THE-ANCHOR.PUB').split(' · ');
    expect(parts).toEqual([...parts].reverse());
  });

  it('leaves the strip as before when there is no prompt', () => {
    const plain = buildRepeatedBannerLabel('TODAY');
    expect(buildRepeatedBannerLabel('TODAY', null)).toBe(plain);
    expect(buildRepeatedBannerLabel('TODAY', undefined)).toBe(plain);
    expect(buildRepeatedBannerLabel('TODAY', '   ')).toBe(plain);
  });
});
