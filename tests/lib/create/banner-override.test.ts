// F4 + G3: when the user has not customised the banner appearance on the
// campaign-creation form (BannerDefaults exactly matches the form's initial
// state), no override columns may be written — the variant must inherit the
// account-level configuration including banners_enabled. Forcing banner_enabled
// true would silently override account-level "off".
//
// G3: each appearance column is also independent — only the columns the user
// actually changed should be written. Writing all three whenever any one
// differs would freeze the appearance to specific values, defeating the
// per-column fallback (e.g. an account-level colour change must apply to a
// post that only customised position).
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

describe("computeBannerOverride [G3] per-field overrides", () => {
  it("when only position differs, only banner_position is set", () => {
    const override = computeBannerOverride({
      ...DEFAULT_BANNER_DEFAULTS,
      position: "top",
    });

    // banner_position is the only column written. The other appearance
    // columns must NOT be present so they fall back to the account default
    // at resolve time. (Spread `...(override ?? {})` into the upsert payload
    // omits the other columns entirely — the per-column fallback wins.)
    expect(override).toEqual({ banner_position: "top" });
    expect(override).not.toHaveProperty("banner_bg");
    expect(override).not.toHaveProperty("banner_text_colour");
    expect(override).not.toHaveProperty("banner_text_override");
    expect(override).not.toHaveProperty("banner_enabled");
  });

  it("when only bgColour differs, only banner_bg is set", () => {
    const override = computeBannerOverride({
      ...DEFAULT_BANNER_DEFAULTS,
      bgColour: "black",
    });

    expect(override).toEqual({ banner_bg: "#1a1a1a" });
    expect(override).not.toHaveProperty("banner_position");
    expect(override).not.toHaveProperty("banner_text_colour");
  });

  it("when only textColour differs, only banner_text_colour is set", () => {
    const override = computeBannerOverride({
      ...DEFAULT_BANNER_DEFAULTS,
      textColour: "green",
    });

    expect(override).toEqual({ banner_text_colour: "#005131" });
    expect(override).not.toHaveProperty("banner_position");
    expect(override).not.toHaveProperty("banner_bg");
  });

  it("when multiple fields differ, all changed fields are set and others are absent", () => {
    const override = computeBannerOverride({
      ...DEFAULT_BANNER_DEFAULTS,
      position: "top",
      bgColour: "black",
    });

    expect(override).toEqual({
      banner_position: "top",
      banner_bg: "#1a1a1a",
    });
    expect(override).not.toHaveProperty("banner_text_colour");
  });
});
