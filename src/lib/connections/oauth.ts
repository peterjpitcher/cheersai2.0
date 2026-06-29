import { env } from "@/env";
import { getMetaOAuthBase } from "@/lib/meta/graph";

const FACEBOOK_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "pages_manage_metadata",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments",
  "business_management",
].join(",");

const INSTAGRAM_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments",
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
].join(",");

const SITE_URL = env.client.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");

export type Provider = "facebook" | "instagram";

export function buildOAuthRedirectUrl(provider: Provider, state: string) {
  switch (provider) {
    case "facebook":
      return buildFacebookOAuthUrl(state);
    case "instagram":
      return buildInstagramOAuthUrl(state);
    default:
      throw new Error(`Unsupported provider ${provider}`);
  }
}

function buildFacebookOAuthUrl(state: string) {
  const redirectUri = `${SITE_URL}/api/oauth/facebook/callback`;
  const params = new URLSearchParams({
    client_id: env.client.NEXT_PUBLIC_FACEBOOK_APP_ID,
    redirect_uri: redirectUri,
    state,
    scope: FACEBOOK_SCOPES,
    response_type: "code",
  });
  return `${getMetaOAuthBase()}/dialog/oauth?${params.toString()}`;
}

function buildInstagramOAuthUrl(state: string) {
  const redirectUri = `${SITE_URL}/api/oauth/instagram/callback`;
  const params = new URLSearchParams({
    client_id: env.client.NEXT_PUBLIC_FACEBOOK_APP_ID,
    redirect_uri: redirectUri,
    state,
    scope: INSTAGRAM_SCOPES,
    response_type: "code",
  });
  return `${getMetaOAuthBase()}/dialog/oauth?${params.toString()}`;
}

const FACEBOOK_ADS_SCOPES = [
  "ads_management",
  "ads_read",
  "business_management",
  "pages_show_list",
].join(",");

export function buildFacebookAdsOAuthUrl(state: string): string {
  const redirectUri = `${SITE_URL}/api/oauth/facebook-ads/callback`;
  const params = new URLSearchParams({
    client_id: env.client.NEXT_PUBLIC_FACEBOOK_APP_ID,
    redirect_uri: redirectUri,
    state,
    scope: FACEBOOK_ADS_SCOPES,
    response_type: "code",
  });
  return `${getMetaOAuthBase()}/dialog/oauth?${params.toString()}`;
}
