// F4: when the user has not customised the banner appearance on the
// campaign-creation form (BannerDefaults exactly matches the form's initial
// state), no override columns may be written — the variant must inherit the
// account-level configuration including banners_enabled. Forcing banner_enabled
// true would silently override account-level "off".
import { describe, expect, it } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "https://example.com/key";
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "supabase-service-role-key";

const { computeBannerOverride } = await import("@/lib/create/service");
const { DEFAULT_BANNER_DEFAULTS } = await import("@/lib/scheduling/banner-config");

describe("computeBannerOverride [F4]", () => {
  it("returns null when bannerDefaults is undefined", () => {
    expect(computeBannerOverride(undefined)).toBeNull();
  });

  it("returns null when bannerDefaults exactly matches DEFAULT_BANNER_DEFAULTS", () => {
    // The user opened the form, didn't touch the banner picker, submitted.
    // The variant must inherit account defaults — including banners_enabled.
    expect(computeBannerOverride({ ...DEFAULT_BANNER_DEFAULTS })).toBeNull();
  });

  it("never sets banner_enabled — only appearance columns", () => {
    const override = computeBannerOverride({
      position: "top",
      bgColour: "black",
      textColour: "white",
    });

    expect(override).not.toBeNull();
    expect(override).not.toHaveProperty("banner_enabled");
  });

  it("returns the customised position when only position differs", () => {
    const override = computeBannerOverride({
      ...DEFAULT_BANNER_DEFAULTS,
      position: "top",
    });

    expect(override).toEqual({
      banner_position: "top",
      banner_bg: expect.any(String),
      banner_text_colour: expect.any(String),
    });
  });

  it("returns customised colours when only bgColour differs", () => {
    const override = computeBannerOverride({
      ...DEFAULT_BANNER_DEFAULTS,
      bgColour: "black",
    });

    expect(override).not.toBeNull();
    expect(override?.banner_bg).toBe("#1a1a1a");
  });

  it("returns customised text colour when only textColour differs", () => {
    const override = computeBannerOverride({
      ...DEFAULT_BANNER_DEFAULTS,
      textColour: "green",
    });

    expect(override).not.toBeNull();
    expect(override?.banner_text_colour).toBe("#005131");
  });
});
