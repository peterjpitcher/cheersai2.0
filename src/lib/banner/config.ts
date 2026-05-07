// src/lib/banner/config.ts
//
// SCOPE: publish-time banner resolution. Owns the contract between raw DB
// rows (posting_defaults + content_variants override columns) and the
// ResolvedConfig consumed by the renderer and the planner overlay preview.
//
// DO NOT confuse with `src/lib/scheduling/banner-config.ts` — that module
// owns the brand colour-id → hex map, the Zod schemas used by campaign and
// settings forms, and the BANNER_EDITABLE_STATUSES list. Forms speak
// colour ids; this module speaks resolved hex strings + booleans.
export type BannerPosition = 'top' | 'bottom' | 'left' | 'right';

export type AccountBannerDefaults = {
  banners_enabled: boolean;
  banner_position: BannerPosition;
  banner_bg: string;
  banner_text_colour: string;
};

export type PostBannerOverrides = {
  banner_enabled: boolean | null;
  banner_text_override: string | null;
  banner_position: BannerPosition | null;
  banner_bg: string | null;
  banner_text_colour: string | null;
};

export type ResolvedConfig = {
  enabled: boolean;
  position: BannerPosition;
  bgColour: string;
  textColour: string;
  textOverride: string | null;
};

export function bannerConfigResolver(
  accountDefaults: AccountBannerDefaults,
  postOverrides: PostBannerOverrides,
): ResolvedConfig {
  return {
    enabled: postOverrides.banner_enabled ?? accountDefaults.banners_enabled,
    position: postOverrides.banner_position ?? accountDefaults.banner_position,
    bgColour: postOverrides.banner_bg ?? accountDefaults.banner_bg,
    textColour: postOverrides.banner_text_colour ?? accountDefaults.banner_text_colour,
    textOverride: postOverrides.banner_text_override,
  };
}
