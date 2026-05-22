// supabase/functions/publish-queue/banner-config.ts
//
// DUPLICATED from src/lib/banner/config.ts because Deno cannot resolve the
// `@/...` alias used in Node code. Keep the shapes and resolver logic in sync
// with src/lib/banner/config.ts. The same intentional-duplication pattern is
// already used by supabase/functions/materialise-weekly/utils.ts.

export type BannerPosition = "top" | "bottom" | "left" | "right";

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

export const FIXED_BANNER_POSITION: BannerPosition = "right";
export const FIXED_BANNER_BG = "#a57626";
export const FIXED_BANNER_TEXT = "#FFFFFF";

export function bannerConfigResolver(
    accountDefaults: AccountBannerDefaults,
    postOverrides: PostBannerOverrides,
): ResolvedConfig {
    return {
        enabled: postOverrides.banner_enabled ?? accountDefaults.banners_enabled,
        position: FIXED_BANNER_POSITION,
        bgColour: FIXED_BANNER_BG,
        textColour: FIXED_BANNER_TEXT,
        textOverride: postOverrides.banner_text_override,
    };
}
