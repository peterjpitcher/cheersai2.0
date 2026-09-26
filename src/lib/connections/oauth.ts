import { env } from "@/env";
import { getMetaOAuthBase } from "@/lib/meta/graph";

// Only what publishing uses. Meta App Review rejects permissions the app never
// calls, so pages_manage_metadata and instagram_manage_comments were dropped
// (no webhook subscription or comment call exists). Facebook posts and stories
// need pages_show_list, pages_read_engagement and pages_manage_posts; Instagram
// publishing needs instagram_basic, instagram_content_publish and
// pages_read_engagement; business_management lists Pages held in a business
// portfolio. See docs/runbooks/meta-app-review.md.
export const FACEBOOK_SCOPE_LIST: readonly string[] = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
];

export const INSTAGRAM_SCOPE_LIST: readonly string[] = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
];

const FACEBOOK_SCOPES = FACEBOOK_SCOPE_LIST.join(",");
const INSTAGRAM_SCOPES = INSTAGRAM_SCOPE_LIST.join(",");

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
