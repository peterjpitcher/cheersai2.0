import { beforeAll, describe, expect, it } from "vitest";

function seedBaseEnv() {
  const defaults: Record<string, string> = {
    ALERTS_SECRET: "test-alert",
    CRON_SECRET: "test-cron",
    FACEBOOK_APP_SECRET: "fb-secret",
    GOOGLE_MY_BUSINESS_CLIENT_ID: "google-client",
    GOOGLE_MY_BUSINESS_CLIENT_SECRET: "google-secret",
    INSTAGRAM_APP_ID: "ig-app",
    INSTAGRAM_APP_SECRET: "ig-secret",
    INSTAGRAM_VERIFY_TOKEN: "verify",
    OPENAI_API_KEY: "openai",
    RESEND_API_KEY: "resend",
    RESEND_FROM: "notifications@test",
    SUPABASE_SERVICE_ROLE_KEY: "supabase",
    NEXT_PUBLIC_FACEBOOK_APP_ID: "test-fb-app-id",
    NEXT_PUBLIC_SITE_URL: "https://example.com",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    NEXT_PUBLIC_SUPABASE_URL: "https://supabase.local",
  };

  Object.entries(defaults).forEach(([key, defaultValue]) => {
    if (!process.env[key]) {
      process.env[key] = defaultValue;
    }
  });
}

describe("buildFacebookAdsOAuthUrl", () => {
  beforeAll(() => {
    seedBaseEnv();
  });

  it("should include ads_management scope", async () => {
    const { buildFacebookAdsOAuthUrl } = await import("@/lib/connections/oauth");
    const url = buildFacebookAdsOAuthUrl("test-state-123");
    expect(url).toContain("ads_management");
  });

  it("should include ads_read scope", async () => {
    const { buildFacebookAdsOAuthUrl } = await import("@/lib/connections/oauth");
    const url = buildFacebookAdsOAuthUrl("test-state-123");
    expect(url).toContain("ads_read");
  });

  it("should include the state value in the URL", async () => {
    const state = "unique-state-value-xyz";
    const { buildFacebookAdsOAuthUrl } = await import("@/lib/connections/oauth");
    const url = buildFacebookAdsOAuthUrl(state);
    expect(url).toContain(state);
  });

  it("should point to the facebook-ads callback path", async () => {
    const { buildFacebookAdsOAuthUrl } = await import("@/lib/connections/oauth");
    const url = buildFacebookAdsOAuthUrl("state-abc");
    expect(url).toContain("facebook-ads%2Fcallback");
  });

  it("should use the configured Facebook App ID", async () => {
    const { buildFacebookAdsOAuthUrl } = await import("@/lib/connections/oauth");
    const url = buildFacebookAdsOAuthUrl("state-abc");
    expect(url).toContain("test-fb-app-id");
  });
});
