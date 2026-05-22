// src/lib/banner/config.test.ts
import { describe, it, expect } from 'vitest';
import {
  FIXED_BANNER_BG,
  FIXED_BANNER_POSITION,
  FIXED_BANNER_TEXT,
  bannerConfigResolver,
} from '@/lib/banner/config';

const accountDefaults = {
  banners_enabled: true,
  banner_position: 'bottom' as const,
  banner_bg: '#000000',
  banner_text_colour: '#FFFFFF',
};

describe('bannerConfigResolver', () => {
  it('uses enabled from account defaults and fixed banner presentation', () => {
    expect(bannerConfigResolver(accountDefaults, {
      banner_enabled: null,
      banner_text_override: null,
      banner_position: null,
      banner_bg: null,
      banner_text_colour: null,
    })).toEqual({
      enabled: true,
      position: FIXED_BANNER_POSITION,
      bgColour: FIXED_BANNER_BG,
      textColour: FIXED_BANNER_TEXT,
      textOverride: null,
    });
  });

  it('respects text overrides while keeping fixed banner presentation', () => {
    expect(bannerConfigResolver(accountDefaults, {
      banner_enabled: null,
      banner_text_override: 'BANK HOLIDAY',
      banner_position: 'top',
      banner_bg: null,
      banner_text_colour: null,
    })).toEqual({
      enabled: true,
      position: FIXED_BANNER_POSITION,
      bgColour: FIXED_BANNER_BG,
      textColour: FIXED_BANNER_TEXT,
      textOverride: 'BANK HOLIDAY',
    });
  });

  it('post-level disabled wins over enabled defaults', () => {
    expect(bannerConfigResolver(accountDefaults, {
      banner_enabled: false,
      banner_text_override: 'IGNORED',
      banner_position: null,
      banner_bg: null,
      banner_text_colour: null,
    }).enabled).toBe(false);
  });

  it('disabled defaults can be overridden true on the post', () => {
    expect(bannerConfigResolver(
      { ...accountDefaults, banners_enabled: false },
      {
        banner_enabled: true,
        banner_text_override: null,
        banner_position: null,
        banner_bg: null,
        banner_text_colour: null,
      },
    ).enabled).toBe(true);
  });
});
